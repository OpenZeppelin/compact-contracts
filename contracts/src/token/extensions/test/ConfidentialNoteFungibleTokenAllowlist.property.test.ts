/**
 * Stateless properties of the allowlist extension.
 *
 * The unit suite states each claim at hand-picked points. This states the same
 * claims over generated accounts, paths and list sizes, so they hold where
 * nobody chose, and a failure shrinks to the smallest counterexample.
 *
 * `leafOf` is pure and evaluates locally even on live, so its properties run
 * 100 times anywhere. The others deploy a list per run and make up to a few
 * dozen calls, so they are DRY ONLY. Live covers the same circuits by example
 * in the unit suite.
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
// Generators, each pinned to the circuit's own type
// ---------------------------------------------------------------------------

const NOT_ALLOWED =
  'ConfidentialNoteFungibleTokenAllowlist: account not allowed';

const DEPTH = 32;

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

/** `Bytes<32>`. */
const bytes32 = () => fc.uint8Array({ minLength: 32, maxLength: 32 });

/** `Bytes<32>`, never zero, so the account is never the zero account. */
const nonZero32 = () => bytes32().filter((b) => b.some((x) => x !== 0));

/** An account on either arm, inactive arm zero. */
const account = (): fc.Arbitrary<Identifier> =>
  fc.tuple(fc.boolean(), nonZero32()).map(([isLeft, bytes]) => ({
    is_left: isLeft,
    left: isLeft ? bytes : new Uint8Array(32),
    right: { bytes: isLeft ? new Uint8Array(32) : bytes },
  }));

/** Any `Vector<32, MerkleTreePathEntry>`. */
const anyPath = (): fc.Arbitrary<MerkleTreePathEntry[]> =>
  fc.array(
    fc.record({
      sibling: fc.record({ field: fc.bigInt({ min: 0n, max: 2n ** 254n }) }),
      goes_left: fc.boolean(),
    }),
    { minLength: DEPTH, maxLength: DEPTH },
  );

/** A list size and a slot inside it. */
const sizeAndSlot = (): fc.Arbitrary<[number, number]> =>
  fc
    .integer({ min: 2, max: 9 })
    .chain((size) =>
      fc.tuple(fc.constant(size), fc.integer({ min: 0, max: size - 1 })),
    );

/** `count` distinct accounts, by hex of their leaf. */
const distinctAccounts = (count: number): fc.Arbitrary<Identifier[]> =>
  fc.uniqueArray(account(), {
    minLength: count,
    maxLength: count,
    selector: (a) => hex(allowlist.leafOf(a)),
  });

const PROPERTY_RUNS = 15;

/** A fresh list holding `accounts`, in order. */
const listOf = async (
  accounts: Identifier[],
): Promise<ConfidentialNoteFungibleTokenAllowlistSimulator> => {
  const list = await ConfidentialNoteFungibleTokenAllowlistSimulator.create();
  for (const a of accounts) {
    await list._allow(a);
  }
  return list;
};

// ---------------------------------------------------------------------------
// leafOf
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenAllowlist property: leafOf', () => {
  it('should ignore the inactive arm, whatever it holds', () => {
    fc.assert(
      fc.property(account(), bytes32(), (a, garbage) => {
        const variant = a.is_left
          ? { ...a, right: { bytes: garbage } }
          : { ...a, left: garbage };

        expect(allowlist.leafOf(variant)).toStrictEqual(allowlist.leafOf(a));
      }),
    );
  });

  it('should tell the two arms apart for any bytes', () => {
    fc.assert(
      fc.property(nonZero32(), (bytes) => {
        const key = {
          is_left: true,
          left: bytes,
          right: { bytes: new Uint8Array(32) },
        };
        const contract = {
          is_left: false,
          left: new Uint8Array(32),
          right: { bytes },
        };

        expect(allowlist.leafOf(key)).not.toStrictEqual(
          allowlist.leafOf(contract),
        );
      }),
    );
  });

  it('should give distinct accounts distinct leaves', () => {
    fc.assert(
      fc.property(account(), account(), (a, b) => {
        fc.pre(
          a.is_left !== b.is_left ||
            hex(a.is_left ? a.left : a.right.bytes) !==
              hex(b.is_left ? b.left : b.right.bytes),
        );

        expect(allowlist.leafOf(a)).not.toStrictEqual(allowlist.leafOf(b));
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// assertAllowed
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenAllowlist property: assertAllowed',
  () => {
    it('should pass no generated path, for a member or a non-member', async () => {
      await fc.assert(
        fc.asyncProperty(
          distinctAccounts(4),
          anyPath(),
          async ([m0, m1, m2, outsider], path) => {
            const list = await listOf([m0, m1, m2]);

            await expectRejection(list.assertAllowed(m1, path), NOT_ALLOWED);
            await expectRejection(
              list.assertAllowed(outsider, path),
              NOT_ALLOWED,
            );
          },
        ),
        { numRuns: PROPERTY_RUNS },
      );
    }, 60_000);

    it("should pass no non-member with any member's fresh path", async () => {
      await fc.assert(
        fc.asyncProperty(
          distinctAccounts(5),
          fc.integer({ min: 0, max: 3 }),
          async (accounts, slot) => {
            const outsider = accounts[4];
            const list = await listOf(accounts.slice(0, 4));
            const path = await list.allowPathOf(accounts[slot]);

            await expectRejection(
              list.assertAllowed(outsider, path),
              NOT_ALLOWED,
            );
            await list.assertAllowed(accounts[slot], path);
          },
        ),
        { numRuns: PROPERTY_RUNS },
      );
    }, 60_000);
  },
);

// ---------------------------------------------------------------------------
// _disallow
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenAllowlist property: _disallow',
  () => {
    it('should clear the proven slot and only it, for any list size and slot', async () => {
      await fc.assert(
        fc.asyncProperty(
          sizeAndSlot().chain(([size, slot]) =>
            fc.tuple(fc.constant(slot), distinctAccounts(size)),
          ),
          async ([slot, accounts]) => {
            const list = await listOf(accounts);
            const removed = accounts[slot];
            const before = await list.getPublicState();
            const firstFree = before.Allowlist__allowed.firstFree();
            const members = [...before.Allowlist__members].map(hex).sort();

            await list._disallow(removed, await list.allowPathOf(removed));

            const after = await list.getPublicState();
            expect(
              after.Allowlist__allowed.findPathForLeaf(
                allowlist.leafOf(removed),
              ),
            ).toBeUndefined();
            expect(after.Allowlist__allowed.firstFree()).toBe(firstFree);
            expect([...after.Allowlist__members].map(hex).sort()).toStrictEqual(
              members.filter((leaf) => leaf !== hex(allowlist.leafOf(removed))),
            );
            for (const [i, a] of accounts.entries()) {
              if (i === slot) continue;
              const path = await list.allowPathOf(a);
              expect(slotOf(path)).toBe(BigInt(i));
              await list.assertAllowed(a, path);
            }
          },
        ),
        { numRuns: PROPERTY_RUNS },
      );
    }, 120_000);
  },
);
