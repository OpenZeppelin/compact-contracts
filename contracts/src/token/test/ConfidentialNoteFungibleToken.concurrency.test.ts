/**
 * Concurrency claims for the ConfidentialNoteFungibleToken core.
 *
 * Whether a call still lands once someone else's call moved the ledger first.
 *
 * Every case builds two calls against one snapshot, lands the first, then applies
 * the second. See `#test-utils/concurrency/types.ts` for why that reproduces a
 * real conflict deterministically, with no race to lose.
 *
 * EXHAUSTIVE, NOT SAMPLED. Five callable operations give 25 ordered pairs, doubled
 * for spend-vs-spend which splits on whether both spend the same note. Enumerating
 * a space that small beats sampling it. Each case asserts against {@link predict}
 * rather than a memorised answer, so a new circuit with unexpected pinning fails
 * here instead of silently widening the gap between model and module.
 *
 * What each operation pins:
 *
 *   `_mint` / `_mintNote`   read `_issuedNonces.member(tag)`, pinning that ONE
 *                           key, then insert into `_commitments` at the LIVE
 *                           first-free index. Distinct nonces commute.
 *   `transfer` / `burn` /   read `_nullifiers.member(nf)`, pinning that ONE key,
 *   `_consumeNote`          and `checkRoot(root)`, which on a HistoricMerkleTree
 *                           pins "in history" and survives concurrent inserts.
 *
 * Two pinned key spaces, so the matrix holds one of them still: every call below
 * emits a nonce nobody else emits, which isolates the nullifier axis. The mint
 * axis gets its own describe at the foot of the file.
 *
 * `_mint` x `transfer` is the load-bearing row: swap `HistoricMerkleTree` for
 * `MerkleTree` and it fails, since plain `checkRoot` pins the CURRENT root. Nothing
 * else notices that one-word change, so keep that row if this matrix is trimmed.
 */

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
  pureCircuits as core,
  Contract as MockCore,
} from '../../../artifacts/MockConfidentialNoteFungibleToken/contract/index.js';
import {
  ConfidentialNoteFungibleTokenWitnesses,
  createNoteWallet,
  type Note,
  type NoteWallet,
} from './witnesses/ConfidentialNoteFungibleTokenWitnesses.js';

// ---------------------------------------------------------------------------
// Two parties, one ledger
// ---------------------------------------------------------------------------

type PrivateState = Record<string, never>;
type NoteParty = Party<NoteWallet, MockCore<PrivateState>>;

/**
 * A party's spend secret comes from its name, so the derived public keys below
 * are stable across every `beforeEach` and can be computed once.
 */
const noteParties = () =>
  createParties<NoteWallet, MockCore<PrivateState>>(['alice', 'bob'], {
    wallet: (label) => {
      const wallet = createNoteWallet();
      wallet.secretKey = labelledSecret(label);
      return wallet;
    },
    contract: (wallet) =>
      new MockCore(ConfidentialNoteFungibleTokenWitnesses(wallet)),
  });

const ALICE = core.derivePk(labelledSecret('alice'));
const BOB = core.derivePk(labelledSecret('bob'));

const NOTE_VALUE = 100n;
const SPEND_VALUE = 30n;

/**
 * A caller-built note, for the one operation that takes one as an argument. Per
 * actor, because `_mintNote` reserves its nonce: one shared note would collide
 * on that reservation and measure the wrong axis.
 */
const callerBuilt = (actor: string): Note => ({
  value: 5n,
  nonce: actor === 'alice' ? 42n : 43n,
});

// ---------------------------------------------------------------------------
// The operation space, and the conflict model it is measured against
// ---------------------------------------------------------------------------

/** Every circuit the mock exposes that writes to the ledger. */
const OPERATIONS = [
  '_mint',
  '_mintNote',
  'transfer',
  'burn',
  '_consumeNote',
] as const;

type Operation = (typeof OPERATIONS)[number];

/** Whether an operation consumes the caller's input note. */
const SPENDS: Readonly<Record<Operation, boolean>> = {
  _mint: false,
  _mintNote: false,
  transfer: true,
  burn: true,
  _consumeNote: true,
};

/**
 * The conflict model in one line: two calls built on one snapshot collide only
 * where they pin the same key. Every call in this matrix emits its own nonce,
 * so the only key two of them can share is a nullifier.
 *
 * @param first - The operation that lands.
 * @param second - The operation applied against the moved state.
 * @param sameNote - Whether both calls spend the one note.
 */
const predict = (
  first: Operation,
  second: Operation,
  sameNote: boolean,
): Outcome =>
  SPENDS[first] && SPENDS[second] && sameNote
    ? 'second-rejected'
    : 'both-landed';

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

interface MatrixCase {
  readonly first: Operation;
  readonly second: Operation;
  /** Only meaningful when both operations spend. */
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

/** Every ordered pair, split on note sharing wherever that can matter. */
const MATRIX: readonly MatrixCase[] = OPERATIONS.flatMap((first) =>
  OPERATIONS.flatMap((second) => {
    const sharings = SPENDS[first] && SPENDS[second] ? [true, false] : [false];
    return sharings.map((sameNote) => ({
      first,
      second,
      sameNote,
      expected: predict(first, second, sameNote),
      name: describeCase(
        first,
        second,
        sameNote,
        predict(first, second, sameNote),
      ),
    }));
  }),
);

// TODO: Support live concurrency https://github.com/OpenZeppelin/compact-contracts/issues/749
describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleToken: concurrency',
  () => {
    // These cases are backend-neutral: they assert a verdict from `race`, not a
    // transport. The skip above comes off once the live harness lands.
    let harness: ConcurrencyHarness;
    let alice: NoteParty;
    let bob: NoteParty;

    beforeEach(async () => {
      const { parties, contracts } = noteParties();
      alice = parties.alice;
      bob = parties.bob;
      harness = await createConcurrencyHarness({
        contracts,
        privateState: {},
      });
    });

    /** Gives `holder` a spendable note, committed on the shared ledger. */
    const arm = async (holder: NoteParty, ownerPk: bigint): Promise<void> => {
      holder.wallet.inputNote = await harness.apply<Note>({
        actor: holder.name,
        circuitId: '_mint',
        args: [ownerPk, NOTE_VALUE],
      });
    };

    /** The call `actor` makes for `operation`, spending its own note. */
    const callFor = (actor: NoteParty, operation: Operation): Call => {
      const self = actor === alice ? ALICE : BOB;
      const other = actor === alice ? BOB : ALICE;
      switch (operation) {
        case '_mint':
          return {
            actor: actor.name,
            circuitId: '_mint',
            args: [self, NOTE_VALUE],
          };
        case '_mintNote':
          return {
            actor: actor.name,
            circuitId: '_mintNote',
            args: [callerBuilt(actor.name), self],
          };
        case 'transfer':
          return {
            actor: actor.name,
            circuitId: 'transfer',
            args: [other, SPEND_VALUE],
          };
        case 'burn':
          return { actor: actor.name, circuitId: 'burn', args: [SPEND_VALUE] };
        case '_consumeNote':
          return {
            actor: actor.name,
            circuitId: '_consumeNote',
            args: [self],
          };
      }
    };

    for (const testCase of MATRIX) {
      it(testCase.name, async () => {
        // Same note means one party issuing both calls; separate notes means two
        // parties, each armed with its own.
        const secondParty = testCase.sameNote ? alice : bob;

        if (SPENDS[testCase.first]) {
          await arm(alice, ALICE);
        }
        if (SPENDS[testCase.second] && secondParty !== alice) {
          await arm(secondParty, BOB);
        }
        if (
          SPENDS[testCase.second] &&
          secondParty === alice &&
          !SPENDS[testCase.first]
        ) {
          await arm(alice, ALICE);
        }

        const verdict = await race(
          harness,
          callFor(alice, testCase.first),
          callFor(secondParty, testCase.second),
        );

        expect(verdict).toBe(testCase.expected);
      });
    }
  },
);

// ---------------------------------------------------------------------------
// The other pinned key: an issued nonce
// ---------------------------------------------------------------------------

/**
 * `_mintNote` reserves its output nonce, which gives mints a pinned key of their
 * own. The claim is that it pins the KEY and not the set.
 *
 * That is the whole reason the reservation reads `Set.member` rather than a
 * counter or the tree's next index. Either of those pins one value every mint
 * shares, so one mint per block would land and the rest would be rejected
 * against a moved state. Here only the duplicate is.
 *
 * Both cases go through the same build-then-replay path as the matrix, so a
 * rejection is a pinned-read divergence in the verifying runtime, not a
 * re-execution that happened to throw.
 */
describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleToken: issued-nonce concurrency',
  () => {
    let harness: ConcurrencyHarness;

    beforeEach(async () => {
      const { contracts } = noteParties();
      harness = await createConcurrencyHarness({
        contracts,
        privateState: {},
      });
    });

    const mintNote = (actor: string, nonce: bigint, ownerPk: bigint): Call => ({
      actor,
      circuitId: '_mintNote',
      args: [{ value: NOTE_VALUE, nonce }, ownerPk],
    });

    it('should let two mints of distinct nonces both land', async () => {
      const verdict = await race(
        harness,
        mintNote('alice', 1n, ALICE),
        mintNote('bob', 2n, BOB),
      );

      expect(verdict).toBe('both-landed');
    });

    it('should not let two mints of one nonce both land', async () => {
      const verdict = await race(
        harness,
        mintNote('alice', 1n, ALICE),
        mintNote('bob', 1n, BOB),
      );

      expect(verdict).toBe('second-rejected');
    });
  },
);
