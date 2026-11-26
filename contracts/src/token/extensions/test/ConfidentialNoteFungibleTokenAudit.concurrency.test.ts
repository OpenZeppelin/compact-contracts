/**
 * Concurrency claims for the ConfidentialNoteFungibleTokenAudit extension, on
 * the composed mock (core + audit).
 *
 * Every case builds two calls against one snapshot, lands the first, then
 * applies the second. See `#test-utils/concurrency/types.ts` for why that
 * reproduces a real conflict deterministically.
 *
 * What each operation pins:
 *
 *   `mint`, `transfer`,      read `_auditKey`, pinning its value. Each record
 *   `burn`, `seize`          is a `pushFront`, which pins nothing. The spends
 *                            also pin the spent note's nullifier.
 *   `_setAuditKey`           reads the flag, which never moves, and writes
 *                            `_auditKey`. It reads no key.
 *
 * So a rotation to another key invalidates every in-flight audited call, a
 * rotation is never blocked, two spends conflict only on one note, and nothing
 * else conflicts. Five operations give 25 ordered pairs, doubled where both
 * spend, each asserted against {@link predict}.
 */

import type { ChargedState } from '@midnight-ntwrk/compact-runtime';
import { ecMulGenerator } from '@midnight-ntwrk/compact-runtime';
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
  Contract as MockAudited,
} from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenAudited/contract/index.js';
import {
  CustodialConfidentialNoteFungibleTokenWitnesses,
  type CustodialWallet,
  NOTE_SALT,
} from '../../presets/test/witnesses/CustodialConfidentialNoteFungibleTokenWitnesses.js';
import type {
  Identifier,
  Note,
} from './simulators/ConfidentialNoteFungibleTokenAuditedSimulator.js';

// ---------------------------------------------------------------------------
// Parties and keys
// ---------------------------------------------------------------------------

type PrivateState = Record<string, never>;

/** The admin calls the ungated circuits; two holders spend their own notes. */
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

const AUDIT_SCALAR = 111222333444555n;
const AUDIT_KEY = ecMulGenerator(AUDIT_SCALAR);

/** Two candidate keys, so two rotations built on one snapshot stay distinguishable. */
const TARGETS = [
  ecMulGenerator(999888777666555n),
  ecMulGenerator(555444333222111n),
] as const;

const NOTE_VALUE = 100n;
const SPEND_VALUE = 30n;

const parties = () =>
  createParties<CustodialWallet, MockAudited<PrivateState>>(NAMES, {
    wallet: (label) => ({ secretKey: labelledSecret(label) }),
    contract: (wallet) =>
      new MockAudited<PrivateState>(
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
  '_setAuditKey',
] as const;

type Operation = (typeof OPERATIONS)[number];

/** Whether the call's transcript pins the value of `_auditKey`. */
const READS_KEY: Readonly<Record<Operation, boolean>> = {
  mint: true,
  transfer: true,
  burn: true,
  seize: true,
  _setAuditKey: false,
};

/** Whether the call moves `_auditKey` (every rotation here installs a new key). */
const WRITES_KEY: Readonly<Record<Operation, boolean>> = {
  mint: false,
  transfer: false,
  burn: false,
  seize: false,
  _setAuditKey: true,
};

/** Whether the call consumes a note. */
const SPENDS: Readonly<Record<Operation, boolean>> = {
  mint: false,
  transfer: true,
  burn: true,
  seize: true,
  _setAuditKey: false,
};

/**
 * The second call fails only when the first moved a key the second read, or
 * both consume one note.
 */
const predict = (
  first: Operation,
  second: Operation,
  sameNote: boolean,
): Outcome =>
  (WRITES_KEY[first] && READS_KEY[second]) ||
  (SPENDS[first] && SPENDS[second] && sameNote)
    ? 'second-rejected'
    : 'both-landed';

/** The key left after the race: the last rotation that landed, if any. */
const keyAfter = (first: Operation, second: Operation, outcome: Outcome) => {
  if (outcome === 'both-landed' && WRITES_KEY[second]) return TARGETS[1];
  if (WRITES_KEY[first]) return TARGETS[0];
  return AUDIT_KEY;
};

/** Records a call adds when it lands. */
const RECORDS: Readonly<Record<Operation, bigint>> = {
  mint: 1n,
  transfer: 2n,
  burn: 1n,
  seize: 1n,
  _setAuditKey: 0n,
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
  'ConfidentialNoteFungibleTokenAudit: concurrency',
  () => {
    let harness: ConcurrencyHarness;

    const view = async () => ledger((await harness.snapshot()) as ChargedState);

    /** Gives `holder` a spendable note, committed on the shared ledger. */
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

    /** The call for `operation`. A spend consumes `holder`'s `note`. */
    const callFor = async (
      operation: Operation,
      slot: 0 | 1,
      holder: Holder,
      note: Note | undefined,
    ): Promise<Call> => {
      switch (operation) {
        case 'mint':
          return {
            actor: 'admin',
            circuitId: 'mint',
            args: [NOTE_KEYS.alice, NOTE_VALUE],
          };
        case '_setAuditKey':
          return {
            actor: 'admin',
            circuitId: '_setAuditKey',
            args: [TARGETS[slot]],
          };
        case 'transfer':
        case 'burn':
        case 'seize': {
          if (note === undefined) throw new Error('test setup: no note armed');
          const path = await pathOf(holder, note);
          const recipient =
            holder === 'alice' ? NOTE_KEYS.bob : NOTE_KEYS.alice;
          switch (operation) {
            case 'transfer':
              return {
                actor: holder,
                circuitId: 'transfer',
                args: [recipient, SPEND_VALUE, note, path],
              };
            case 'burn':
              return {
                actor: holder,
                circuitId: 'burn',
                args: [SPEND_VALUE, note, path],
              };
            case 'seize':
              return {
                actor: 'admin',
                circuitId: 'seize',
                args: [NOTE_KEYS[holder], RECOVERY, note, path],
              };
          }
        }
      }
    };

    beforeEach(async () => {
      harness = await createConcurrencyHarness({
        contracts: parties().contracts,
        privateState: {},
        constructorArgs: [NOTE_SALT, AUDIT_KEY],
      });
    });

    for (const testCase of MATRIX) {
      it(testCase.name, async () => {
        // Same note means both calls consume alice's note; separate notes
        // means the second consumes bob's.
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
        const before = (await view()).Audit__auditTrail.length();

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
        const state = await view();
        expect(state.Audit__auditKey).toStrictEqual(
          keyAfter(testCase.first, testCase.second, verdict.outcome),
        );
        const added =
          RECORDS[testCase.first] +
          (verdict.outcome === 'both-landed' ? RECORDS[testCase.second] : 0n);
        expect(state.Audit__auditTrail.length()).toBe(before + added);
        expect(state.Core__commitments.firstFree()).toBe(
          state.Audit__auditTrail.length(),
        );
      });
    }

    // The conflict is on the key's value: a rotation that writes the key it
    // found leaves every pinned read valid.
    it.each(['mint', 'transfer', 'burn', 'seize'] as const)(
      'should let an in-flight %s land after a rotation to the same key',
      async (operation) => {
        const note = SPENDS[operation] ? await arm('alice') : undefined;
        const before = (await view()).Audit__auditTrail.length();

        const verdict = await race(
          harness,
          { actor: 'admin', circuitId: '_setAuditKey', args: [AUDIT_KEY] },
          await callFor(operation, 1, 'alice', note),
        );

        expect(verdict.outcome).toBe('both-landed');
        const state = await view();
        expect(state.Audit__auditKey).toStrictEqual(AUDIT_KEY);
        expect(state.Audit__auditTrail.length()).toBe(
          before + RECORDS[operation],
        );
      },
    );

    it('should not let an in-flight mint commit a note after a rotation', async () => {
      const verdict = await race(
        harness,
        await callFor('_setAuditKey', 0, 'alice', undefined),
        await callFor('mint', 1, 'alice', undefined),
      );

      expect(verdict.outcome).toBe('second-rejected');
      const state = await view();
      expect(state.Core__commitments.firstFree()).toBe(0n);
      expect(state.Audit__auditTrail.length()).toBe(0n);
    });

    // Two pushes built on one snapshot both land and the trail keeps both, in
    // landing order, each opening under the audit scalar.
    it('should keep both records when two audited spends of separate notes race', async () => {
      const aliceNote = await arm('alice');
      const bobNote = await arm('bob');

      const verdict = await race(
        harness,
        await callFor('burn', 0, 'alice', aliceNote),
        await callFor('burn', 1, 'bob', bobNote),
      );

      expect(verdict.outcome).toBe('both-landed');
      const [bobChange, aliceChange] = [...(await view()).Audit__auditTrail];
      const owners = [bobChange, aliceChange].map((record) => {
        const r = composed.recoverRecord(record, AUDIT_SCALAR);
        expect(r.value).toBe(NOTE_VALUE - SPEND_VALUE);
        return composed.ownerOf(r.ownerLo, r.ownerHi);
      });
      expect(owners).toStrictEqual([NOTE_KEYS.bob, NOTE_KEYS.alice]);
    });
  },
);
