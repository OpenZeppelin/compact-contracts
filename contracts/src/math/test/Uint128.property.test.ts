import fc from 'fast-check';
import { beforeAll, describe, expect, test } from 'vitest';
import { expectRejection } from '#test-utils/assertions/rejection.js';
import { Uint128Simulator } from './simulators/Uint128Simulator.js';
import { MAX_UINT64, MAX_UINT128 } from './utils/consts.js';
import { isqrt, toU128, toU256 } from './utils/oracles.js';
import {
  nonZeroUpTo,
  RUNS,
  skipProperties,
  uint128,
} from './utils/properties.js';

/**
 * Property tests of every `Uint128` circuit, both the `Uint<128>` and the
 * `U128` form, against bigint oracles (INV-8 to INV-11).
 */

describe.skipIf(skipProperties)('Uint128 properties', () => {
  let s: Uint128Simulator;
  const divisor = nonZeroUpTo(MAX_UINT128);
  // A factor up to 2^64 + 2^32, so that some products fit 128 bits.
  const factor = fc.oneof(
    uint128,
    fc.bigInt({ min: 0n, max: MAX_UINT64 + (1n << 32n) }),
  );

  beforeAll(async () => {
    s = await Uint128Simulator.create();
  });

  test('toU128 and toUint128 convert between the two forms', async () => {
    await fc.assert(
      fc.asyncProperty(uint128, async (v) => {
        expect(await s.toU128(v)).toEqual(toU128(v));
        expect(await s.toUint128(toU128(v))).toBe(v);
      }),
      RUNS,
    );
  });

  test('eq, lt, lte, gt, gte and isZero agree with bigint comparison', async () => {
    await fc.assert(
      fc.asyncProperty(uint128, uint128, async (a, b) => {
        const [x, y] = [toU128(a), toU128(b)];
        expect(await s.eq(a, b)).toBe(a === b);
        expect(await s.eqU128(x, y)).toBe(a === b);
        expect(await s.lt(a, b)).toBe(a < b);
        expect(await s.ltU128(x, y)).toBe(a < b);
        expect(await s.lte(a, b)).toBe(a <= b);
        expect(await s.lteU128(x, y)).toBe(a <= b);
        expect(await s.gt(a, b)).toBe(a > b);
        expect(await s.gtU128(x, y)).toBe(a > b);
        expect(await s.gte(a, b)).toBe(a >= b);
        expect(await s.gteU128(x, y)).toBe(a >= b);
        expect(await s.isZero(a)).toBe(a === 0n);
        expect(await s.isZeroU128(x)).toBe(a === 0n);
      }),
      RUNS,
    );
  });

  test('min and max', async () => {
    await fc.assert(
      fc.asyncProperty(uint128, uint128, async (a, b) => {
        const [x, y] = [toU128(a), toU128(b)];
        expect(await s.min(a, b)).toBe(a <= b ? a : b);
        expect(await s.minU128(x, y)).toEqual(a <= b ? x : y);
        expect(await s.max(a, b)).toBe(a >= b ? a : b);
        expect(await s.maxU128(x, y)).toEqual(a >= b ? x : y);
      }),
      RUNS,
    );
  });

  test('add returns a + b as U256', async () => {
    await fc.assert(
      fc.asyncProperty(uint128, uint128, async (a, b) => {
        expect(await s.add(a, b)).toEqual(toU256(a + b));
        expect(await s.addU128(toU128(a), toU128(b))).toEqual(toU256(a + b));
      }),
      RUNS,
    );
  });

  test('addChecked returns a + b, or fails on overflow', async () => {
    await fc.assert(
      fc.asyncProperty(uint128, uint128, async (a, b) => {
        if (a + b <= MAX_UINT128) {
          expect(await s.addChecked(a, b)).toBe(a + b);
          expect(await s.addCheckedU128(toU128(a), toU128(b))).toBe(a + b);
        } else {
          await expectRejection(
            s.addChecked(a, b),
            'Uint128: addition overflow',
          );
          await expectRejection(
            s.addCheckedU128(toU128(a), toU128(b)),
            'Uint128: addition overflow',
          );
        }
      }),
      RUNS,
    );
  });

  test('sub returns a - b, or fails on underflow', async () => {
    await fc.assert(
      fc.asyncProperty(uint128, uint128, async (a, b) => {
        if (a >= b) {
          expect(await s.sub(a, b)).toBe(a - b);
          expect(await s.subU128(toU128(a), toU128(b))).toEqual(toU128(a - b));
        } else {
          await expectRejection(s.sub(a, b), 'Uint128: subtraction underflow');
          await expectRejection(
            s.subU128(toU128(a), toU128(b)),
            'Uint128: subtraction underflow',
          );
        }
      }),
      RUNS,
    );
  });

  test('mul returns a * b as U256', async () => {
    await fc.assert(
      fc.asyncProperty(uint128, uint128, async (a, b) => {
        expect(await s.mul(a, b)).toEqual(toU256(a * b));
        expect(await s.mulU128(toU128(a), toU128(b))).toEqual(toU256(a * b));
      }),
      RUNS,
    );
  });

  test('mulChecked returns a * b, or fails on overflow', async () => {
    await fc.assert(
      fc.asyncProperty(factor, factor, async (a, b) => {
        if (a * b <= MAX_UINT128) {
          expect(await s.mulChecked(a, b)).toBe(a * b);
          expect(await s.mulCheckedU128(toU128(a), toU128(b))).toBe(a * b);
        } else {
          await expectRejection(
            s.mulChecked(a, b),
            'Uint128: multiplication overflow',
          );
          await expectRejection(
            s.mulCheckedU128(toU128(a), toU128(b)),
            'Uint128: multiplication overflow',
          );
        }
      }),
      RUNS,
    );
  });

  test('div, rem, divRem and isMultiple agree with bigint division', async () => {
    await fc.assert(
      fc.asyncProperty(uint128, divisor, async (a, b) => {
        const [x, y] = [toU128(a), toU128(b)];
        const quotientRemainder = {
          quotient: toU128(a / b),
          remainder: toU128(a % b),
        };
        expect(await s.div(a, b)).toBe(a / b);
        expect(await s.divU128(x, y)).toEqual(toU128(a / b));
        expect(await s.rem(a, b)).toBe(a % b);
        expect(await s.remU128(x, y)).toEqual(toU128(a % b));
        expect(await s.divRem(a, b)).toEqual(quotientRemainder);
        expect(await s.divRemU128(x, y)).toEqual(quotientRemainder);
        expect(await s.isMultiple(a, b)).toBe(a % b === 0n);
        expect(await s.isMultipleU128(x, y)).toBe(a % b === 0n);
      }),
      RUNS,
    );
  });

  test('sqrt returns floor(sqrt(n))', async () => {
    await fc.assert(
      fc.asyncProperty(uint128, async (n) => {
        expect(await s.sqrt(n)).toBe(isqrt(n));
        expect(await s.sqrtU128(toU128(n))).toBe(isqrt(n));
      }),
      RUNS,
    );
  });
});
