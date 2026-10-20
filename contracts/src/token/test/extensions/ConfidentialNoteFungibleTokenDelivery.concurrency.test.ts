/**
 * Concurrency claims for the ConfidentialNoteFungibleTokenDelivery extension,
 * on the composed mock (core + delivery).
 *
 * Every case builds two calls against one snapshot, lands the first, then
 * applies the second. See `#test-utils/concurrency/types.ts` for why that
 * reproduces a real conflict deterministically.
 *
 * The delivery adds one `pushFront` per output and reads nothing, so it pins
 * nothing: the conflict model is the core's, unchanged. Two calls collide only
 * where both spend one note. The three callable operations give 9 ordered
 * pairs, the spend-vs-spend ones split on note sharing, and every verdict is
 * asserted against {@link predict} rather than a memorised answer, so a
 * delivery that started pinning a read would fail here.
 */

import type { ChargedState } from '@midnight-ntwrk/compact-runtime';
import { ecMulGenerator } from '@midnight-ntwrk/compact-runtime';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import { createConcurrencyHarness } from '#test-utils/concurrency/backend.js';
import {
  createParties,
  labelledSecret,
  type Party,
} from '#test-utils/concurrency/parties.js';
import { race } from '#test-utils/concurrency/race.js';
import type {
  Call,
  ConcurrencyHarness,
  Outcome,
} from '#test-utils/concurrency/types.js';
import {
  pureCircuits as composed,
  ledger,
  Contract as MockDelivered,
} from '../../../../artifacts/MockConfidentialNoteFungibleTokenDelivered/contract/index.js';
import {
  ConfidentialNoteFungibleTokenDeliveryWitnesses,
  createDeliveryWallet,
  type DeliveryWallet,
} from '../witnesses/ConfidentialNoteFungibleTokenDeliveryWitnesses.js';
import {
  ConfidentialNoteFungibleTokenWitnesses,
  createNoteWallet,
  INSTANCE_SALT,
  type NoteCommitmentLedger,
  type NoteWallet,
} from '../witnesses/ConfidentialNoteFungibleTokenWitnesses.js';

// ---------------------------------------------------------------------------
// Two parties, one ledger
// ---------------------------------------------------------------------------

type PrivateState = Record<string, never>;

/** A party's private inputs: the core's wallet and the delivery seed knob. */
type DeliveredWallet = { note: NoteWallet; delivery: DeliveryWallet };
type DeliveredParty = Party<DeliveredWallet, MockDelivered<PrivateState>>;

const deliveredParties = () =>
  createParties<DeliveredWallet, MockDelivered<PrivateState>>(
    ['alice', 'bob'],
    {
      wallet: (label) => {
        const note = createNoteWallet();
        note.secretKey = labelledSecret(label);
        return { note, delivery: createDeliveryWallet() };
      },
      contract: (wallet) =>
        new MockDelivered<PrivateState>({
          ...ConfidentialNoteFungibleTokenWitnesses<NoteCommitmentLedger>(
            wallet.note,
          ),
          ...ConfidentialNoteFungibleTokenDeliveryWitnesses<
            NoteCommitmentLedger,
            PrivateState
          >(wallet.delivery),
        }),
    },
  );

type Keys = { pk: bigint; ek: bigint; encPk: { x: bigint; y: bigint } };

const keysFor = (label: string, ek: bigint): Keys => ({
  pk: composed.derivePk(labelledSecret(label), INSTANCE_SALT),
  ek,
  encPk: ecMulGenerator(ek),
});

const ALICE = keysFor('alice', 111222333444555n);
const BOB = keysFor('bob', 999888777666555n);

const NOTE_VALUE = 100n;
const SPEND_VALUE = 30n;

// ---------------------------------------------------------------------------
// The operation space, and the conflict model it is measured against
// ---------------------------------------------------------------------------

/** Every circuit the composed mock exposes that writes to the ledger. */
const OPERATIONS = ['mint', 'transfer', 'burn'] as const;

type Operation = (typeof OPERATIONS)[number];

const SPENDS: Readonly<Record<Operation, boolean>> = {
  mint: false,
  transfer: true,
  burn: true,
};

/** Two calls built on one snapshot collide only where both spend one note. */
const predict = (
  first: Operation,
  second: Operation,
  sameNote: boolean,
): Outcome =>
  SPENDS[first] && SPENDS[second] && sameNote
    ? 'second-rejected'
    : 'both-landed';

interface MatrixCase {
  readonly first: Operation;
  readonly second: Operation;
  readonly sameNote: boolean;
  readonly expected: Outcome;
  readonly name: string;
}

const describeCase = (
  first: Operation,
  second: Operation,
  sameNote: boolean,
  expected: Outcome,
): string => {
  const bothSpend = SPENDS[first] && SPENDS[second];
  const notes = bothSpend
    ? sameNote
      ? ' on one note'
      : ' on separate notes'
    : '';
  return expected === 'both-landed'
    ? `should let ${first} and ${second} both land${notes}`
    : `should not let ${first} and ${second} both land${notes}`;
};

const MATRIX: readonly MatrixCase[] = OPERATIONS.flatMap((first) =>
  OPERATIONS.flatMap((second) => {
    const sharings = SPENDS[first] && SPENDS[second] ? [true, false] : [false];
    return sharings.map((sameNote) => {
      const expected = predict(first, second, sameNote);
      return {
        first,
        second,
        sameNote,
        expected,
        name: describeCase(first, second, sameNote, expected),
      };
    });
  }),
);

// TODO: Support live concurrency https://github.com/OpenZeppelin/compact-contracts/issues/749
describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenDelivery: concurrency',
  () => {
    let harness: ConcurrencyHarness;
    let alice: DeliveredParty;
    let bob: DeliveredParty;

    beforeEach(async () => {
      const { parties, contracts } = deliveredParties();
      alice = parties.alice;
      bob = parties.bob;
      harness = await createConcurrencyHarness({
        contracts,
        privateState: {},
        constructorArgs: [INSTANCE_SALT, ALICE.pk, ALICE.encPk, NOTE_VALUE],
      });
    });

    const keysOf = (party: DeliveredParty): Keys =>
      party === alice ? ALICE : BOB;

    /**
     * Gives `holder` a spendable note, committed on the shared ledger. The
     * circuits return nothing, so the note is read back the way a wallet reads
     * it: the newest entry, opened with the holder's scalar.
     */
    const arm = async (holder: DeliveredParty): Promise<void> => {
      const { pk, ek, encPk } = keysOf(holder);
      await harness.apply({
        actor: holder.name,
        circuitId: 'mint',
        args: [pk, encPk, NOTE_VALUE],
      });
      const view = ledger((await harness.snapshot()) as ChargedState);
      const [entry] = [...view.Delivery__deliveries];
      const { value, nonce } = composed.recoverNote(entry, ek);
      holder.wallet.note.inputNote = { value, nonce };
    };

    /** The call `actor` makes for `operation`, spending its own note. */
    const callFor = (actor: DeliveredParty, operation: Operation): Call => {
      const self = keysOf(actor);
      const other = actor === alice ? BOB : ALICE;
      switch (operation) {
        case 'mint':
          return {
            actor: actor.name,
            circuitId: 'mint',
            args: [self.pk, self.encPk, NOTE_VALUE],
          };
        case 'transfer':
          return {
            actor: actor.name,
            circuitId: 'transfer',
            args: [other.pk, other.encPk, self.encPk, SPEND_VALUE],
          };
        case 'burn':
          return {
            actor: actor.name,
            circuitId: 'burn',
            args: [self.encPk, SPEND_VALUE],
          };
      }
    };

    for (const testCase of MATRIX) {
      it(testCase.name, async () => {
        // Same note means one party issuing both calls; separate notes means
        // two parties, each armed with its own.
        const secondParty = testCase.sameNote ? alice : bob;

        if (SPENDS[testCase.first]) {
          await arm(alice);
        }
        if (SPENDS[testCase.second] && secondParty !== alice) {
          await arm(secondParty);
        }
        if (
          SPENDS[testCase.second] &&
          secondParty === alice &&
          !SPENDS[testCase.first]
        ) {
          await arm(alice);
        }

        const verdict = await race(
          harness,
          callFor(alice, testCase.first),
          callFor(secondParty, testCase.second),
        );

        expect(verdict.outcome).toBe(testCase.expected);
        if (verdict.outcome === 'second-rejected') {
          expect(verdict.reason).not.toBe('');
        }
      });
    }

    // The claim the matrix rests on: two pushes built on one snapshot both
    // land and the feed holds both, in landing order.
    it('should keep both entries when two deliveries race', async () => {
      const before = ledger(
        (await harness.snapshot()) as ChargedState,
      ).Delivery__deliveries.length();

      const verdict = await race(
        harness,
        callFor(alice, 'mint'),
        callFor(bob, 'mint'),
      );

      const view = ledger((await harness.snapshot()) as ChargedState);
      expect(verdict.outcome).toBe('both-landed');
      expect(view.Delivery__deliveries.length()).toBe(before + 2n);
      const [newest, older] = [...view.Delivery__deliveries];
      expect(composed.recoverNote(newest, BOB.ek).value).toBe(NOTE_VALUE);
      expect(composed.recoverNote(older, ALICE.ek).value).toBe(NOTE_VALUE);
    });
  },
);
