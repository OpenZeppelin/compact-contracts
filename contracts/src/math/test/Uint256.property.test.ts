import fc from 'fast-check';
import { beforeAll, describe, expect, test } from 'vitest';
import { Uint256Simulator } from './simulators/Uint256Simulator.js';
import { MAX_UINT256 } from './utils/consts.js';
import { toBytesLE, toU256, toVecLE } from './utils/oracles.js';
import { RUNS, skipProperties, uintUpTo } from './utils/properties.js';

/**
 * Property tests of the `Uint256` circuits against bigint oracles (INV-5,
 * Z12 limb order).
 */

describe.skipIf(skipProperties)('Uint256 properties', () => {
  let s: Uint256Simulator;
  const uint256 = uintUpTo(MAX_UINT256);

  beforeAll(async () => {
    s = await Uint256Simulator.create();
  });

  test('toBytes and toUnpackedBytes return the little-endian bytes', async () => {
    await fc.assert(
      fc.asyncProperty(uint256, async (v) => {
        expect(await s.toBytes(toU256(v))).toEqual(toBytesLE(v, 32));
        expect(await s.toUnpackedBytes(toU256(v))).toEqual(toVecLE(v, 32));
      }),
      RUNS,
    );
  });

  test('eq, lt, lte, gt and gte agree with bigint comparison', async () => {
    // Pairs that differ only in a low limb test the limb order.
    const pair = fc.oneof(
      fc.tuple(uint256, uint256),
      uint256.chain((a) =>
        fc.tuple(
          fc.constant(a),
          uintUpTo(2n ** 128n - 1n).map((low) => ((a >> 128n) << 128n) + low),
        ),
      ),
    );
    await fc.assert(
      fc.asyncProperty(pair, async ([a, b]) => {
        const [x, y] = [toU256(a), toU256(b)];
        expect(await s.eq(x, y)).toBe(a === b);
        expect(await s.lt(x, y)).toBe(a < b);
        expect(await s.lte(x, y)).toBe(a <= b);
        expect(await s.gt(x, y)).toBe(a > b);
        expect(await s.gte(x, y)).toBe(a >= b);
      }),
      RUNS,
    );
  });
});
