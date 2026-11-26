/**
 * Stateful invariants of the allowlist extension, over generated sequences of
 * `_allow`, `_disallow` and `assertAllowed` on a pool of six accounts.
 *
 * A shadow model holds, per account, whether it is live and the slot it was
 * last allowed at, plus the lifetime count of additions. After every step the
 * ledger must agree with it:
 *
 *   - `_members` is exactly the set of live leaves,
 *   - every live account has one fresh path, at its model slot, that passes,
 *   - every other account has no path,
 *   - `firstFree` is the lifetime count: removals never lower it and a
 *     re-added account takes a new slot.
 *
 * Each account also keeps the path it was given when allowed. That path must
 * keep passing across later additions, and fail after any removal.
 *
 * DRY ONLY. Each step is a transaction on live, so 20 runs of 12 would be some
 * 240 txs. Live covers the same circuits by example in the unit suite.
 */

import type { MerkleTreePathEntry } from '@midnight-ntwrk/compact-runtime';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { expectRejection } from '#test-utils/assertions/rejection.js';
import { pureCircuits as allowlist } from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenAllowlist/contract/index.js';
import {
  ConfidentialNoteFungibleTokenAllowlistSimulator,
  type Identifier,
  slotOf,
} from './simulators/ConfidentialNoteFungibleTokenAllowlistSimulator.js';

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

const POOL = 6;

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const account = (label: string): Identifier => {
  const left = new Uint8Array(32);
  left.set(new TextEncoder().encode(label));
  return { is_left: true, left, right: { bytes: new Uint8Array(32) } };
};

const ACCOUNTS = Array.from({ length: POOL }, (_, i) => account(`A${i}`));

const ERR = {
  notAllowed: 'ConfidentialNoteFungibleTokenAllowlist: account not allowed',
  alreadyAllowed:
    'ConfidentialNoteFungibleTokenAllowlist: account already allowed',
} as const;

const ZERO_PATH: MerkleTreePathEntry[] = Array.from({ length: 32 }, () => ({
  sibling: { field: 0n },
  goes_left: false,
}));

// ---------------------------------------------------------------------------
// The operations a sequence is built from
// ---------------------------------------------------------------------------

type Op = {
  readonly kind: 'allow' | 'disallow' | 'check';
  readonly who: number;
};

const opArb: fc.Arbitrary<Op> = fc.record({
  kind: fc.constantFrom(
    'allow' as const,
    'disallow' as const,
    'check' as const,
  ),
  who: fc.integer({ min: 0, max: POOL - 1 }),
});

const sequence = (maxOps: number): fc.Arbitrary<Op[]> =>
  fc.array(opArb, { minLength: 1, maxLength: maxOps });

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

interface Model {
  /** Lifetime additions: the next slot `_allow` writes. */
  additions: bigint;
  /** Removals so far. A path captured under an older count is stale. */
  removals: number;
  /** Per account: its slot while live, undefined otherwise. */
  slots: (bigint | undefined)[];
  /** Per account: the path it got when allowed, and the removal count then. */
  captured: ({ path: MerkleTreePathEntry[]; removals: number } | undefined)[];
}

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenAllowlist: invariants under generated op sequences',
  () => {
    let list: ConfidentialNoteFungibleTokenAllowlistSimulator;

    const cells = async () => {
      const state = await list.getPublicState();
      return {
        root: state.Allowlist__allowed.root(),
        firstFree: state.Allowlist__allowed.firstFree(),
        history: Array.from({
          [Symbol.iterator]: () => state.Allowlist__allowed.history(),
        }),
        members: [...state.Allowlist__members].map(hex).sort(),
      };
    };

    const isLive = (model: Model, who: number): boolean =>
      model.slots[who] !== undefined;

    /** The captured path if no removal came after it, else a fresh one. */
    const pathFor = async (
      model: Model,
      who: number,
    ): Promise<MerkleTreePathEntry[]> => {
      const kept = model.captured[who];
      return kept !== undefined && kept.removals === model.removals
        ? kept.path
        : list.allowPathOf(ACCOUNTS[who]);
    };

    /** A path a non-member might try: a live member's, or a zero one. */
    const borrowedPath = async (
      model: Model,
    ): Promise<MerkleTreePathEntry[]> => {
      const lender = model.slots.findIndex((slot) => slot !== undefined);
      return lender === -1 ? ZERO_PATH : list.allowPathOf(ACCOUNTS[lender]);
    };

    const expectRefused = async (
      call: () => Promise<unknown>,
      reason: string,
    ): Promise<void> => {
      const before = await cells();
      await expectRejection(call(), reason);
      expect(await cells()).toStrictEqual(before);
    };

    const step = async (op: Op, model: Model): Promise<void> => {
      const target = ACCOUNTS[op.who];
      const live = isLive(model, op.who);

      if (op.kind === 'allow') {
        if (live) {
          await expectRefused(() => list._allow(target), ERR.alreadyAllowed);
          return;
        }
        await list._allow(target);
        model.slots[op.who] = model.additions;
        model.additions += 1n;
        model.captured[op.who] = {
          path: await list.allowPathOf(target),
          removals: model.removals,
        };
        return;
      }

      if (op.kind === 'check') {
        if (live) {
          await list.assertAllowed(target, await pathFor(model, op.who));
        } else {
          const path = await borrowedPath(model);
          await expectRefused(
            () => list.assertAllowed(target, path),
            ERR.notAllowed,
          );
        }
        return;
      }

      if (!live) {
        const path = await borrowedPath(model);
        await expectRefused(() => list._disallow(target, path), ERR.notAllowed);
        return;
      }

      // Paths of the other live members, taken before the removal.
      const others = model.slots.flatMap((slot, who) =>
        slot !== undefined && who !== op.who ? [who] : [],
      );
      const stale = await Promise.all(
        others.map((who) => list.allowPathOf(ACCOUNTS[who])),
      );

      await list._disallow(target, await pathFor(model, op.who));
      model.slots[op.who] = undefined;
      model.captured[op.who] = undefined;
      model.removals += 1;

      for (const [i, who] of others.entries()) {
        await expectRejection(
          list.assertAllowed(ACCOUNTS[who], stale[i]),
          ERR.notAllowed,
        );
      }
    };

    const checkInvariants = async (model: Model): Promise<void> => {
      const state = await list.getPublicState();

      expect(state.Allowlist__allowed.firstFree()).toBe(model.additions);
      expect([...state.Allowlist__members].map(hex).sort()).toStrictEqual(
        model.slots
          .flatMap((slot, who) =>
            slot !== undefined ? [hex(allowlist.leafOf(ACCOUNTS[who]))] : [],
          )
          .sort(),
      );

      for (const [who, target] of ACCOUNTS.entries()) {
        const found = state.Allowlist__allowed.findPathForLeaf(
          allowlist.leafOf(target),
        );
        const slot = model.slots[who];
        if (slot === undefined) {
          expect(found).toBeUndefined();
          continue;
        }
        expect(found).toBeDefined();
        expect(slotOf(found?.path ?? [])).toBe(slot);
        await list.assertAllowed(target, found?.path ?? []);

        const kept = model.captured[who];
        if (kept !== undefined && kept.removals === model.removals) {
          await list.assertAllowed(target, kept.path);
        }
      }
    };

    const freshModel = (): Model => ({
      additions: 0n,
      removals: 0,
      slots: Array.from({ length: POOL }, () => undefined),
      captured: Array.from({ length: POOL }, () => undefined),
    });

    it('should keep the ledger consistent with the model after every step', async () => {
      await fc.assert(
        fc.asyncProperty(sequence(12), async (ops) => {
          list = await ConfidentialNoteFungibleTokenAllowlistSimulator.create();
          const model = freshModel();
          await checkInvariants(model);

          for (const op of ops) {
            await step(op, model);
            await checkInvariants(model);
          }
        }),
        { numRuns: 20 },
      );
    }, 180_000);

    // Sequences biased to churn: fill the pool, then remove and re-add, so
    // tombstones and re-additions dominate.
    it('should keep the ledger consistent through removal and re-addition churn', async () => {
      const churn = fc.array(
        fc.record({
          kind: fc.constantFrom('allow' as const, 'disallow' as const),
          who: fc.integer({ min: 0, max: POOL - 1 }),
        }),
        { minLength: 4, maxLength: 10 },
      );

      await fc.assert(
        fc.asyncProperty(churn, async (ops) => {
          list = await ConfidentialNoteFungibleTokenAllowlistSimulator.create();
          const model = freshModel();
          for (let who = 0; who < POOL; who++) {
            await step({ kind: 'allow', who }, model);
          }
          await checkInvariants(model);

          for (const op of ops) {
            await step(op, model);
            await checkInvariants(model);
          }
        }),
        { numRuns: 8 },
      );
    }, 180_000);
  },
);
