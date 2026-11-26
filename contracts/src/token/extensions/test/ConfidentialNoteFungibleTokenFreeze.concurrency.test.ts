/**
 * Concurrency claims for the core + freeze composition.
 *
 * Every case builds two calls against one snapshot, lands the first, then
 * applies the second. See `#test-utils/concurrency/types.ts` for why that
 * reproduces a real conflict deterministically.
 *
 * What each operation pins, per note:
 *
 *   `transfer`, `burn`   read the note's membership in `_frozen` and in the
 *                        core's nullifiers, then insert its nullifier.
 *   `seize`              reads and inserts the nullifier. No freeze read.
 *   `isFrozen`           reads the membership in `_frozen`.
 *   `_freeze`,           write the membership in `_frozen` and read nothing.
 *   `_unfreeze`
 *   `mint`               pins only a fresh issued-nonce tag.
 *
 * So the second call fails when both spend one note, or when the first changed
 * a frozen state the second read. A freeze or unfreeze that leaves the state
 * as it was fails nothing. The first matrix starts from two unfrozen notes;
 * the second from a frozen note, where a spend of it cannot be built.
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
  pureCircuits as composed,
  ledger,
  Contract as MockFreezable,
} from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenFreezable/contract/index.js';
import {
  CustodialConfidentialNoteFungibleTokenWitnesses,
  type CustodialWallet,
  NOTE_SALT,
} from '../../presets/test/witnesses/CustodialConfidentialNoteFungibleTokenWitnesses.js';
import type {
  Identifier,
  Note,
} from './simulators/ConfidentialNoteFungibleTokenFreezableSimulator.js';

// ---------------------------------------------------------------------------
// Parties and keys
// ---------------------------------------------------------------------------

type PrivateState = Record<string, never>;

/** An administrator for the ungated calls, and two holders. */
const NAMES = ['admin', 'alice', 'bob'] as const;

type Holder = 'alice' | 'bob';

const NOTE_KEYS: Readonly<Record<Holder, Identifier>> = {
  alice: composed.deriveIdentifier(labelledSecret('alice'), NOTE_SALT),
  bob: composed.deriveIdentifier(labelledSecret('bob'), NOTE_SALT),
};

const RECOVERY = composed.deriveIdentifier(
  labelledSecret('recovery'),
  NOTE_SALT,
);

const NOTE_VALUE = 100n;
const SPEND_VALUE = 30n;

const parties = () =>
  createParties<CustodialWallet, MockFreezable<PrivateState>>(NAMES, {
    wallet: (label) => ({ secretKey: labelledSecret(label) }),
    contract: (wallet) =>
      new MockFreezable<PrivateState>(
        CustodialConfidentialNoteFungibleTokenWitnesses(wallet),
      ),
  });

// ---------------------------------------------------------------------------
// The operation space, and the conflict model it is measured against
// ---------------------------------------------------------------------------

const OPERATIONS = [
  'mint',
  'transfer',
  'burn',
  'seize',
  '_freeze',
  '_unfreeze',
  'isFrozen',
] as const;

type Operation = (typeof OPERATIONS)[number];

/** Whether the call acts on one note: spends it, or names its nullifier. */
const ON_NOTE: Readonly<Record<Operation, boolean>> = {
  mint: false,
  transfer: true,
  burn: true,
  seize: true,
  _freeze: true,
  _unfreeze: true,
  isFrozen: true,
};

/** Whether the call's transcript pins the note's membership in `_frozen`. */
const READS_FROZEN: Readonly<Record<Operation, boolean>> = {
  mint: false,
  transfer: true,
  burn: true,
  seize: false,
  _freeze: false,
  _unfreeze: false,
  isFrozen: true,
};

/** Whether the call consumes the note: pins and inserts its nullifier. */
const SPENDS: Readonly<Record<Operation, boolean>> = {
  mint: false,
  transfer: true,
  burn: true,
  seize: true,
  _freeze: false,
  _unfreeze: false,
  isFrozen: false,
};

/** The frozen state the call leaves the note in, or undefined if it writes none. */
const SETS_FROZEN: Readonly<Record<Operation, boolean | undefined>> = {
  mint: undefined,
  transfer: undefined,
  burn: undefined,
  seize: undefined,
  _freeze: true,
  _unfreeze: false,
  isFrozen: undefined,
};

/** Whether `operation` moves the frozen state of a note that starts `frozen`. */
const changesFrozen = (operation: Operation, frozen: boolean): boolean =>
  SETS_FROZEN[operation] !== undefined && SETS_FROZEN[operation] !== frozen;

/**
 * The second call fails only when both act on one note and either both spend
 * it, or the first moved a frozen state the second read.
 */
const predict = (
  first: Operation,
  second: Operation,
  sameNote: boolean,
  startFrozen: boolean,
): Outcome =>
  sameNote &&
  ((SPENDS[first] && SPENDS[second]) ||
    (changesFrozen(first, startFrozen) && READS_FROZEN[second]))
    ? 'second-rejected'
    : 'both-landed';

interface NoteState {
  readonly frozen: boolean;
  readonly spent: boolean;
}

/** The frozen and spent state of one note after a list of landed calls. */
const stateAfter = (
  landed: readonly Operation[],
  startFrozen: boolean,
): NoteState =>
  landed.reduce<NoteState>(
    (state, operation) => ({
      frozen: SETS_FROZEN[operation] ?? state.frozen,
      spent: state.spent || SPENDS[operation],
    }),
    { frozen: startFrozen, spent: false },
  );

/** Each case runs two mints, an optional freeze and two builds. */
const CASE_TIMEOUT = 30_000;

interface MatrixCase {
  readonly first: Operation;
  readonly second: Operation;
  /** Only meaningful when both operations act on a note. */
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
    ON_NOTE[first] && ON_NOTE[second]
      ? sameNote
        ? ' on one note'
        : ' on separate notes'
      : '';
  return expected === 'both-landed'
    ? `should let ${first} and ${second} both land${notes}`
    : `should not let ${second} land after ${first}${notes}`;
};

const matrix = (
  operations: readonly Operation[],
  startFrozen: boolean,
  sharings: (first: Operation, second: Operation) => boolean[],
): readonly MatrixCase[] =>
  operations.flatMap((first) =>
    operations.flatMap((second) =>
      sharings(first, second).map((sameNote) => {
        const expected = predict(first, second, sameNote, startFrozen);
        return {
          first,
          second,
          sameNote,
          expected,
          name: describeCase(first, second, sameNote, expected),
        };
      }),
    ),
  );

/** From unfrozen notes: every ordered pair, split on "same note" where it applies. */
const UNFROZEN_MATRIX = matrix(OPERATIONS, false, (first, second) =>
  ON_NOTE[first] && ON_NOTE[second] ? [true, false] : [false],
);

/** The calls that can be built on a frozen note. */
const ON_FROZEN: readonly Operation[] = OPERATIONS.filter(
  (operation) => !READS_FROZEN[operation] || operation === 'isFrozen',
);

/** From a frozen note, both calls on it. */
const FROZEN_MATRIX = matrix(ON_FROZEN, true, (first, second) =>
  ON_NOTE[first] && ON_NOTE[second] ? [true] : [false],
);

// ---------------------------------------------------------------------------
// The matrices
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenFreeze: concurrency',
  () => {
    let harness: ConcurrencyHarness;

    const view = async () => ledger((await harness.snapshot()) as ChargedState);

    /** Gives `holder` a note, committed on the shared ledger. */
    const arm = async (holder: Holder): Promise<Note> =>
      harness.apply<Note>({
        actor: 'admin',
        circuitId: 'mint',
        args: [NOTE_KEYS[holder], NOTE_VALUE],
      });

    const pathOf = async (holder: Holder, note: Note) => {
      const path = (await view()).Core__commitments.findPathForLeaf(
        composed.commitOf(note, NOTE_KEYS[holder]),
      );
      if (path === undefined) throw new Error('test setup: note not committed');
      return path.path;
    };

    /** The call for `operation`, on `holder`'s `note` where it takes one. */
    const callFor = async (
      operation: Operation,
      holder: Holder,
      note: Note,
    ): Promise<Call> => {
      const nf = composed.nullifierOf(note);
      const recipient = holder === 'alice' ? NOTE_KEYS.bob : NOTE_KEYS.alice;
      switch (operation) {
        case 'mint':
          return {
            actor: 'admin',
            circuitId: 'mint',
            args: [NOTE_KEYS.alice, NOTE_VALUE],
          };
        case 'transfer':
          return {
            actor: holder,
            circuitId: 'transfer',
            args: [recipient, SPEND_VALUE, note, await pathOf(holder, note)],
          };
        case 'burn':
          return {
            actor: holder,
            circuitId: 'burn',
            args: [SPEND_VALUE, note, await pathOf(holder, note)],
          };
        case 'seize':
          return {
            actor: 'admin',
            circuitId: 'seize',
            args: [
              NOTE_KEYS[holder],
              RECOVERY,
              note,
              await pathOf(holder, note),
            ],
          };
        case '_freeze':
        case '_unfreeze':
        case 'isFrozen':
          return { actor: 'admin', circuitId: operation, args: [nf] };
      }
    };

    const stateOf = async (note: Note) => {
      const state = await view();
      const nf = composed.nullifierOf(note);
      return {
        frozen: state.Freeze__frozen.member(nf),
        spent: state.Core__nullifiers.member(nf),
      };
    };

    /** Races one case; alice's note is the first call's, the second's is alice's or bob's. */
    const runCase = async (
      testCase: MatrixCase,
      startFrozen: boolean,
    ): Promise<void> => {
      const aliceNote = await arm('alice');
      const bobNote = await arm('bob');
      if (startFrozen) {
        await harness.apply({
          actor: 'admin',
          circuitId: '_freeze',
          args: [composed.nullifierOf(aliceNote)],
        });
      }
      const secondHolder: Holder = testCase.sameNote ? 'alice' : 'bob';

      const verdict = await race(
        harness,
        await callFor(testCase.first, 'alice', aliceNote),
        await callFor(
          testCase.second,
          secondHolder,
          testCase.sameNote ? aliceNote : bobNote,
        ),
      );

      expect(verdict.outcome).toBe(testCase.expected);
      if (verdict.outcome === 'second-rejected') {
        expect(verdict.reason).not.toBe('');
      }

      const landedSecond = verdict.outcome === 'both-landed';
      const onAlice: Operation[] = [testCase.first];
      const onBob: Operation[] = [];
      if (landedSecond && ON_NOTE[testCase.second]) {
        (testCase.sameNote ? onAlice : onBob).push(testCase.second);
      }
      expect(await stateOf(aliceNote)).toStrictEqual(
        stateAfter(
          onAlice.filter((operation) => ON_NOTE[operation]),
          startFrozen,
        ),
      );
      expect(await stateOf(bobNote)).toStrictEqual(stateAfter(onBob, false));
    };

    beforeEach(async () => {
      harness = await createConcurrencyHarness({
        contracts: parties().contracts,
        privateState: {},
        constructorArgs: [NOTE_SALT],
      });
    });

    describe('from unfrozen notes', () => {
      for (const testCase of UNFROZEN_MATRIX) {
        it(
          testCase.name,
          async () => {
            await runCase(testCase, false);
          },
          CASE_TIMEOUT,
        );
      }
    });

    describe('from a frozen note', () => {
      for (const testCase of FROZEN_MATRIX) {
        it(
          testCase.name,
          async () => {
            await runCase(testCase, true);
          },
          CASE_TIMEOUT,
        );
      }
    });
  },
);
