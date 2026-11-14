/**
 * Concurrency claims for the CustodialConfidentialNoteFungibleToken preset.
 *
 * Every case builds two calls against one snapshot, lands the first, then
 * applies the second. See `#test-utils/concurrency/types.ts` for why that
 * reproduces a real conflict deterministically.
 *
 * What each operation pins:
 *
 *   `mint`, `transferOwnership`,   read `Ownable._owner`, pinning its value.
 *   `owner`                        `transferOwnership` also writes it.
 *   `transfer`, `burn`             read `_noteSalt`, which never moves, and
 *                                  pin the spent note's nullifier. The root
 *                                  they prove against stays in history.
 *
 * So a handover invalidates every in-flight call that reads the owner, two
 * spends conflict only on one note, and nothing else conflicts. Five
 * operations give 25 ordered pairs, doubled where both spend, each asserted
 * against {@link predict}.
 */

import type { ChargedState } from '@midnight-ntwrk/compact-runtime';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import { createConcurrencyHarness } from '#test-utils/concurrency/backend.js';
import {
  createParties,
  labelledSecret,
} from '#test-utils/concurrency/parties.js';
import { race } from '#test-utils/concurrency/race.js';
import type {
  Call,
  ConcurrencyHarness,
  Outcome,
} from '#test-utils/concurrency/types.js';
import {
  ledger,
  Contract as MockCustodial,
  pureCircuits as preset,
} from '../../../../artifacts/token/presets/test/mocks/MockCustodialConfidentialNoteFungibleToken/contract/index.js';
import type {
  Account,
  Note,
} from './simulators/CustodialConfidentialNoteFungibleTokenSimulator.js';
import {
  CustodialConfidentialNoteFungibleTokenWitnesses,
  type CustodialWallet,
  ISSUER_SALT,
  NOTE_SALT,
} from './witnesses/CustodialConfidentialNoteFungibleTokenWitnesses.js';

// ---------------------------------------------------------------------------
// Parties and keys
// ---------------------------------------------------------------------------

type PrivateState = Record<string, never>;

/** The issuer, and two holders who spend their own notes. */
const NAMES = ['issuer', 'alice', 'bob'] as const;

type Holder = 'alice' | 'bob';

const ISSUER = preset.deriveAccount(labelledSecret('issuer'), ISSUER_SALT);

const NOTE_KEYS: Readonly<Record<Holder, Account>> = {
  alice: preset.deriveAccount(labelledSecret('alice'), NOTE_SALT),
  bob: preset.deriveAccount(labelledSecret('bob'), NOTE_SALT),
};

/** Two candidate ids, so two handovers built on one snapshot stay distinguishable. */
const TARGETS = [
  preset.deriveAccount(labelledSecret('first-successor'), ISSUER_SALT),
  preset.deriveAccount(labelledSecret('second-successor'), ISSUER_SALT),
] as const;

const NOTE_VALUE = 100n;
const SPEND_VALUE = 30n;

const parties = () =>
  createParties<CustodialWallet, MockCustodial<PrivateState>>(NAMES, {
    wallet: (label) => ({ secretKey: labelledSecret(label) }),
    contract: (wallet) =>
      new MockCustodial<PrivateState>(
        CustodialConfidentialNoteFungibleTokenWitnesses(wallet),
      ),
  });

// ---------------------------------------------------------------------------
// The operation space, and the conflict model it is measured against
// ---------------------------------------------------------------------------

const OPERATIONS = [
  'mint',
  'transferOwnership',
  'owner',
  'transfer',
  'burn',
] as const;

type Operation = (typeof OPERATIONS)[number];

/** Whether the call's transcript pins the value of `_owner`. */
const READS_OWNER: Readonly<Record<Operation, boolean>> = {
  mint: true,
  transferOwnership: true,
  owner: true,
  transfer: false,
  burn: false,
};

/** Whether the call moves `_owner` (every handover here installs a new id). */
const WRITES_OWNER: Readonly<Record<Operation, boolean>> = {
  mint: false,
  transferOwnership: true,
  owner: false,
  transfer: false,
  burn: false,
};

/** Whether the call consumes the caller's note. */
const SPENDS: Readonly<Record<Operation, boolean>> = {
  mint: false,
  transferOwnership: false,
  owner: false,
  transfer: true,
  burn: true,
};

/**
 * The second call fails only when the first moved an owner the second read,
 * or both spend one note.
 */
const predict = (
  first: Operation,
  second: Operation,
  sameNote: boolean,
): Outcome =>
  (WRITES_OWNER[first] && READS_OWNER[second]) ||
  (SPENDS[first] && SPENDS[second] && sameNote)
    ? 'second-rejected'
    : 'both-landed';

/** The owner left after the race: the last handover that landed, if any. */
const ownerAfter = (
  first: Operation,
  second: Operation,
  outcome: Outcome,
): Account => {
  if (outcome === 'both-landed' && WRITES_OWNER[second]) return TARGETS[1];
  if (WRITES_OWNER[first]) return TARGETS[0];
  return ISSUER;
};

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
  const notes =
    SPENDS[first] && SPENDS[second]
      ? sameNote
        ? ' on one note'
        : ' on separate notes'
      : '';
  return expected === 'both-landed'
    ? `should let ${first} and ${second} both land${notes}`
    : `should not let ${second} land after ${first}${notes}`;
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

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'CustodialConfidentialNoteFungibleToken: concurrency',
  () => {
    let harness: ConcurrencyHarness;

    const view = async () => ledger((await harness.snapshot()) as ChargedState);

    /** Gives `holder` a spendable note, committed on the shared ledger. */
    const arm = async (holder: Holder): Promise<Note> =>
      harness.apply<Note>({
        actor: 'issuer',
        circuitId: 'mint',
        args: [NOTE_KEYS[holder], NOTE_VALUE],
      });

    const pathOf = async (holder: Holder, note: Note) => {
      const path = (await view()).Token_Core__commitments.findPathForLeaf(
        preset.commitOf(note, NOTE_KEYS[holder]),
      );
      if (path === undefined) throw new Error('test setup: note not committed');
      return path.path;
    };

    /** The call for `operation`. A spend is `holder` spending `note`. */
    const callFor = async (
      operation: Operation,
      slot: 0 | 1,
      holder: Holder,
      note: Note | undefined,
    ): Promise<Call> => {
      switch (operation) {
        case 'mint':
          return {
            actor: 'issuer',
            circuitId: 'mint',
            args: [NOTE_KEYS.alice, NOTE_VALUE],
          };
        case 'transferOwnership':
          return {
            actor: 'issuer',
            circuitId: 'transferOwnership',
            args: [TARGETS[slot]],
          };
        case 'owner':
          return { actor: 'issuer', circuitId: 'owner', args: [] };
        case 'transfer':
        case 'burn': {
          if (note === undefined) throw new Error('test setup: no note armed');
          const path = await pathOf(holder, note);
          const recipient =
            holder === 'alice' ? NOTE_KEYS.bob : NOTE_KEYS.alice;
          return operation === 'transfer'
            ? {
                actor: holder,
                circuitId: 'transfer',
                args: [recipient, SPEND_VALUE, note, path],
              }
            : {
                actor: holder,
                circuitId: 'burn',
                args: [SPEND_VALUE, note, path],
              };
        }
      }
    };

    beforeEach(async () => {
      harness = await createConcurrencyHarness({
        contracts: parties().contracts,
        privateState: {},
        constructorArgs: [ISSUER, ISSUER_SALT, NOTE_SALT, 1n],
      });
    });

    for (const testCase of MATRIX) {
      it(testCase.name, async () => {
        // Same note means alice issues both spends; separate notes means bob
        // spends his own second.
        const secondHolder: Holder = testCase.sameNote ? 'alice' : 'bob';
        const aliceNote =
          SPENDS[testCase.first] ||
          (SPENDS[testCase.second] && secondHolder === 'alice')
            ? await arm('alice')
            : undefined;
        const bobNote =
          SPENDS[testCase.second] && secondHolder === 'bob'
            ? await arm('bob')
            : undefined;

        const verdict = await race(
          harness,
          await callFor(testCase.first, 0, 'alice', aliceNote),
          await callFor(
            testCase.second,
            1,
            secondHolder,
            secondHolder === 'alice' ? aliceNote : bobNote,
          ),
        );

        expect(verdict.outcome).toBe(testCase.expected);
        if (verdict.outcome === 'second-rejected') {
          expect(verdict.reason).not.toBe('');
        }
        expect((await view()).Token_Ownable__owner).toStrictEqual(
          ownerAfter(testCase.first, testCase.second, verdict.outcome),
        );
      });
    }

    // The conflict is on the owner's value: a handover that writes the id it
    // found leaves every pinned read valid.
    it('should let an in-flight mint land after a handover to the same id', async () => {
      const verdict = await race(
        harness,
        { actor: 'issuer', circuitId: 'transferOwnership', args: [ISSUER] },
        await callFor('mint', 1, 'alice', undefined),
      );

      expect(verdict.outcome).toBe('both-landed');
      const state = await view();
      expect(state.Token_Ownable__owner).toStrictEqual(ISSUER);
      expect(state.Token_Core__commitments.firstFree()).toBe(1n);
    });

    it('should not let an in-flight mint commit a note after a handover', async () => {
      const verdict = await race(
        harness,
        await callFor('transferOwnership', 0, 'alice', undefined),
        await callFor('mint', 1, 'alice', undefined),
      );

      expect(verdict.outcome).toBe('second-rejected');
      expect((await view()).Token_Core__commitments.firstFree()).toBe(0n);
    });
  },
);
