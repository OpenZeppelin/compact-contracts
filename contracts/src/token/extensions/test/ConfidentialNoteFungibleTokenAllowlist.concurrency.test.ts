/**
 * Concurrency claims for the ConfidentialNoteFungibleTokenAllowlist extension.
 *
 * Every case builds two calls against one snapshot, lands the first, then
 * applies the second. See `#test-utils/concurrency/types.ts` for why that
 * reproduces a real conflict deterministically.
 *
 * What each operation pins:
 *
 *   `assertAllowed`   "its root is in `_allowed`'s history"
 *   `_allow`          "the leaf is not in `_members`"
 *   `_disallow`       "its root is in `_allowed`'s history", then resets the
 *                     history to the current root
 *
 * Inserts pin nothing, and a removal leaves no earlier root in history. So a
 * removal fails every in-flight `assertAllowed` and `_disallow`, two `_allow`
 * of one account conflict, and nothing else does. Every verdict is asserted
 * against {@link predict}, the model above; a disagreement is a finding.
 *
 * The composed mock's spends write nothing to the list, so a spend landing
 * first never blocks a removal, and a removal landing first fails every
 * in-flight spend or mint, whoever it removed.
 */

import type {
  ChargedState,
  MerkleTreePathEntry,
} from '@midnight-ntwrk/compact-runtime';
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
  pureCircuits as allowlist,
  Contract as MockAllowlist,
  ledger as standaloneLedger,
} from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenAllowlist/contract/index.js';
import {
  pureCircuits as composed,
  ledger as composedLedger,
  Contract as MockAllowlisted,
} from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenAllowlisted/contract/index.js';
import {
  CustodialConfidentialNoteFungibleTokenWitnesses,
  type CustodialWallet,
  NOTE_SALT,
} from '../../presets/test/witnesses/CustodialConfidentialNoteFungibleTokenWitnesses.js';
import type { Note } from './simulators/ConfidentialNoteFungibleTokenAllowlistedSimulator.js';
import {
  type Identifier,
  slotOf,
} from './simulators/ConfidentialNoteFungibleTokenAllowlistSimulator.js';

type PrivateState = Record<string, never>;

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const keyAccount = (label: string): Identifier => ({
  is_left: true,
  left: labelledSecret(label),
  right: { bytes: new Uint8Array(32) },
});

// ---------------------------------------------------------------------------
// The extension alone
// ---------------------------------------------------------------------------

/** Listed before every case. */
const MEMBERS = ['M0', 'M1', 'M2', 'M3'].map(keyAccount);

/** Not listed: the only accounts an `_allow` can be built for. */
const CANDIDATES = ['N0', 'N1'].map(keyAccount);

const OPERATIONS = ['assertAllowed', '_allow', '_disallow'] as const;

type Operation = (typeof OPERATIONS)[number];

/** Whether the call pins "my root is in history". */
const PINS_ROOT: Readonly<Record<Operation, boolean>> = {
  assertAllowed: true,
  _allow: false,
  _disallow: true,
};

/** Whether the call drops every earlier root from history. */
const RESETS_HISTORY: Readonly<Record<Operation, boolean>> = {
  assertAllowed: false,
  _allow: false,
  _disallow: true,
};

/**
 * The second call fails only when the first dropped the root it pinned, or
 * both add one account.
 */
const predict = (
  first: Operation,
  second: Operation,
  sameAccount: boolean,
): Outcome =>
  (RESETS_HISTORY[first] && PINS_ROOT[second]) ||
  (first === '_allow' && second === '_allow' && sameAccount)
    ? 'second-rejected'
    : 'both-landed';

/** The two calls target one account only when both are `_allow` or neither is. */
const canShare = (first: Operation, second: Operation): boolean =>
  (first === '_allow') === (second === '_allow');

interface MatrixCase {
  readonly first: Operation;
  readonly second: Operation;
  readonly sameAccount: boolean;
  readonly expected: Outcome;
  readonly name: string;
}

const describeCase = (
  first: Operation,
  second: Operation,
  sameAccount: boolean,
  expected: Outcome,
): string => {
  const accounts = canShare(first, second)
    ? sameAccount
      ? ' on one account'
      : ' on two accounts'
    : '';
  return expected === 'both-landed'
    ? `should let ${first} and ${second} both land${accounts}`
    : `should not let ${second} land after ${first}${accounts}`;
};

const MATRIX: readonly MatrixCase[] = OPERATIONS.flatMap((first) =>
  OPERATIONS.flatMap((second) =>
    (canShare(first, second) ? [true, false] : [false]).map((sameAccount) => {
      const expected = predict(first, second, sameAccount);
      return {
        first,
        second,
        sameAccount,
        expected,
        name: describeCase(first, second, sameAccount, expected),
      };
    }),
  ),
);

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenAllowlist: concurrency',
  () => {
    let harness: ConcurrencyHarness;

    const view = async () =>
      standaloneLedger((await harness.snapshot()) as ChargedState);

    const pathOf = async (
      account: Identifier,
    ): Promise<MerkleTreePathEntry[] | undefined> =>
      (await view()).Allowlist__allowed.findPathForLeaf(
        allowlist.leafOf(account),
      )?.path;

    /** The call for `operation`, aimed at `account`. */
    const callFor = async (
      operation: Operation,
      account: Identifier,
    ): Promise<Call> => {
      if (operation === '_allow') {
        return { actor: 'admin', circuitId: '_allow', args: [account] };
      }
      const path = await pathOf(account);
      if (path === undefined) throw new Error('test setup: account not listed');
      return { actor: 'admin', circuitId: operation, args: [account, path] };
    };

    /** The two accounts of a case: members, or candidates for `_allow`. */
    const targets = (
      testCase: MatrixCase,
    ): [first: Identifier, second: Identifier] => {
      const pool = (op: Operation) => (op === '_allow' ? CANDIDATES : MEMBERS);
      const first = pool(testCase.first)[0];
      const second = testCase.sameAccount ? first : pool(testCase.second)[1];
      return [first, second];
    };

    beforeEach(async () => {
      harness = await createConcurrencyHarness({
        contracts: createParties<
          Record<string, never>,
          MockAllowlist<PrivateState>
        >(['admin'], {
          wallet: () => ({}),
          contract: () => new MockAllowlist<PrivateState>({}),
        }).contracts,
        privateState: {},
      });
      for (const account of MEMBERS) {
        await harness.apply({
          actor: 'admin',
          circuitId: '_allow',
          args: [account],
        });
      }
    });

    for (const testCase of MATRIX) {
      it(testCase.name, async () => {
        const [firstAccount, secondAccount] = targets(testCase);

        const verdict = await race(
          harness,
          await callFor(testCase.first, firstAccount),
          await callFor(testCase.second, secondAccount),
        );

        expect(verdict.outcome).toBe(testCase.expected);
        if (verdict.outcome === 'second-rejected') {
          expect(verdict.reason).not.toBe('');
        }

        // The list after the race: what landed, and only that.
        const live = new Set(MEMBERS.map((a) => hex(allowlist.leafOf(a))));
        const landed: [Operation, Identifier][] = [
          [testCase.first, firstAccount],
          ...(verdict.outcome === 'both-landed'
            ? [[testCase.second, secondAccount] as [Operation, Identifier]]
            : []),
        ];
        for (const [op, account] of landed) {
          const leaf = hex(allowlist.leafOf(account));
          if (op === '_allow') live.add(leaf);
          if (op === '_disallow') live.delete(leaf);
        }
        const state = await view();
        expect([...state.Allowlist__members].map(hex).sort()).toStrictEqual(
          [...live].sort(),
        );
        for (const account of [...MEMBERS, ...CANDIDATES]) {
          const isLive = live.has(hex(allowlist.leafOf(account)));
          expect(await pathOf(account)).toSatisfy(
            (path) => (path !== undefined) === isLive,
          );
        }
      });
    }

    // A removal built before an addition still clears its own slot.
    it('should tombstone the proven slot when an addition lands first', async () => {
      const verdict = await race(
        harness,
        await callFor('_allow', CANDIDATES[0]),
        await callFor('_disallow', MEMBERS[1]),
      );

      expect(verdict.outcome).toBe('both-landed');
      const state = await view();
      expect(state.Allowlist__allowed.firstFree()).toBe(5n);
      for (const [slot, account] of [
        [0, MEMBERS[0]],
        [2, MEMBERS[2]],
        [3, MEMBERS[3]],
        [4, CANDIDATES[0]],
      ] as const) {
        const path = await pathOf(account);
        expect(path).toBeDefined();
        expect(slotOf(path ?? [])).toBe(BigInt(slot));
      }
    });

    // The duplicate pins only "the leaf is not in `_members`", which the
    // removal makes true again.
    it('should let an _allow rejected while the account is listed land after its _disallow', async () => {
      const account = CANDIDATES[0];
      const leaf = allowlist.leafOf(account);
      const snapshot = await harness.snapshot();
      const first = await harness.build(
        await callFor('_allow', account),
        snapshot,
      );
      const duplicate = await harness.build(
        await callFor('_allow', account),
        snapshot,
      );
      await harness.land(first);

      expect((await harness.attempt(duplicate)).outcome).toBe('rejected');

      await harness.apply(await callFor('_disallow', account));
      expect((await view()).Allowlist__members.member(leaf)).toBe(false);

      expect(await harness.attempt(duplicate)).toStrictEqual({
        outcome: 'landed',
      });
      expect((await view()).Allowlist__members.member(leaf)).toBe(true);
      expect(slotOf((await pathOf(account)) ?? [])).toBe(5n);
    });
  },
);

// ---------------------------------------------------------------------------
// Composed with the core
// ---------------------------------------------------------------------------

const HOLDERS = ['alice', 'bob'] as const;
type Holder = (typeof HOLDERS)[number];

const ACCOUNT: Readonly<Record<Holder | 'carol' | 'dave', Identifier>> = {
  alice: composed.deriveIdentifier(labelledSecret('alice'), NOTE_SALT),
  bob: composed.deriveIdentifier(labelledSecret('bob'), NOTE_SALT),
  carol: composed.deriveIdentifier(labelledSecret('carol'), NOTE_SALT),
  dave: composed.deriveIdentifier(labelledSecret('dave'), NOTE_SALT),
};

const SPENDS = ['mint', 'transfer', 'burn'] as const;
type Spend = (typeof SPENDS)[number];

/** `_allow` adds dave, `_disallow` removes carol: neither touches a party to the spend. */
const EDITS = ['_allow', '_disallow'] as const;
type Edit = (typeof EDITS)[number];

/** Every spend and mint pins a root of the list; an edit pins none of the core's. */
const predictComposed = (first: Spend | Edit, second: Spend | Edit): Outcome =>
  first === '_disallow' && (SPENDS as readonly string[]).includes(second)
    ? 'second-rejected'
    : 'both-landed';

const COMPOSED_MATRIX = SPENDS.flatMap((spend) =>
  EDITS.flatMap((edit) => [[edit, spend] as const, [spend, edit] as const]),
).map(([first, second]) => {
  const expected = predictComposed(first, second);
  return {
    first,
    second,
    expected,
    name:
      expected === 'both-landed'
        ? `should let ${first} and ${second} both land`
        : `should not let ${second} land after ${first}`,
  };
});

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenAllowlist: concurrency composed with the core',
  () => {
    let harness: ConcurrencyHarness;
    let note: Note;

    const view = async () =>
      composedLedger((await harness.snapshot()) as ChargedState);

    const allowPathOf = async (
      account: Identifier,
    ): Promise<MerkleTreePathEntry[]> => {
      const path = (await view()).Allowlist__allowed.findPathForLeaf(
        composed.leafOf(account),
      );
      if (path === undefined) throw new Error('test setup: account not listed');
      return path.path;
    };

    const notePathOf = async (
      n: Note,
      owner: Identifier,
    ): Promise<MerkleTreePathEntry[]> => {
      const path = (await view()).Core__commitments.findPathForLeaf(
        composed.commitOf(n, owner),
      );
      if (path === undefined) throw new Error('test setup: note not committed');
      return path.path;
    };

    const callFor = async (op: Spend | Edit): Promise<Call> => {
      switch (op) {
        case '_allow':
          return { actor: 'admin', circuitId: '_allow', args: [ACCOUNT.dave] };
        case '_disallow':
          return {
            actor: 'admin',
            circuitId: '_disallow',
            args: [ACCOUNT.carol, await allowPathOf(ACCOUNT.carol)],
          };
        case 'mint':
          return {
            actor: 'admin',
            circuitId: 'mint',
            args: [ACCOUNT.bob, 10n, await allowPathOf(ACCOUNT.bob)],
          };
        case 'transfer':
          return {
            actor: 'alice',
            circuitId: 'transfer',
            args: [
              ACCOUNT.bob,
              30n,
              note,
              await notePathOf(note, ACCOUNT.alice),
              await allowPathOf(ACCOUNT.alice),
              await allowPathOf(ACCOUNT.bob),
            ],
          };
        case 'burn':
          return {
            actor: 'alice',
            circuitId: 'burn',
            args: [
              30n,
              note,
              await notePathOf(note, ACCOUNT.alice),
              await allowPathOf(ACCOUNT.alice),
            ],
          };
      }
    };

    beforeEach(async () => {
      harness = await createConcurrencyHarness({
        contracts: createParties<
          CustodialWallet,
          MockAllowlisted<PrivateState>
        >(['admin', ...HOLDERS], {
          wallet: (label) => ({ secretKey: labelledSecret(label) }),
          contract: (wallet) =>
            new MockAllowlisted<PrivateState>(
              CustodialConfidentialNoteFungibleTokenWitnesses(wallet),
            ),
        }).contracts,
        privateState: {},
        constructorArgs: [NOTE_SALT],
      });
      for (const account of [ACCOUNT.alice, ACCOUNT.bob, ACCOUNT.carol]) {
        await harness.apply({
          actor: 'admin',
          circuitId: '_allow',
          args: [account],
        });
      }
      note = await harness.apply<Note>({
        actor: 'admin',
        circuitId: 'mint',
        args: [ACCOUNT.alice, 100n, await allowPathOf(ACCOUNT.alice)],
      });
    });

    for (const testCase of COMPOSED_MATRIX) {
      it(testCase.name, async () => {
        const before = (await view()).Core__commitments.firstFree();

        const verdict = await race(
          harness,
          await callFor(testCase.first),
          await callFor(testCase.second),
        );

        expect(verdict.outcome).toBe(testCase.expected);
        const outputs = (op: Spend | Edit): bigint =>
          op === 'transfer' ? 2n : op === 'mint' || op === 'burn' ? 1n : 0n;
        const landed =
          outputs(testCase.first) +
          (verdict.outcome === 'both-landed' ? outputs(testCase.second) : 0n);
        expect((await view()).Core__commitments.firstFree()).toBe(
          before + landed,
        );
      });
    }
  },
);
