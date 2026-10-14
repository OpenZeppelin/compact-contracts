import fc from 'fast-check';
import { beforeAll, describe, expect, test } from 'vitest';
import { expectRejection } from '#test-utils/assertions/rejection.js';
import { Uint64Simulator } from './simulators/Uint64Simulator.js';
import { MAX_UINT64 } from './utils/consts.js';
import { isqrt, toBytesLE, toVecLE } from './utils/oracles.js';
import {
  nonZeroUpTo,
  RUNS,
  skipProperties,
  uint64,
} from './utils/properties.js';

/**
 * Property tests of every `Uint64` circuit against bigint oracles (INV-2,
 * INV-5 to INV-7, INV-11).
 */

describe.skipIf(skipProperties)('Uint64 properties', () => {
  let s: Uint64Simulator;
  const divisor = nonZeroUpTo(MAX_UINT64);

  beforeAll(async () => {
    s = await Uint64Simulator.create();
  });

  test('add returns a + b', async () => {
    await fc.assert(
      fc.asyncProperty(uint64, uint64, async (a, b) => {
        expect(await s.add(a, b)).toBe(a + b);
      }),
      RUNS,
    );
  });

  test('addChecked returns a + b, or fails on overflow', async () => {
    await fc.assert(
      fc.asyncProperty(uint64, uint64, async (a, b) => {
        if (a + b <= MAX_UINT64) {
          expect(await s.addChecked(a, b)).toBe(a + b);
        } else {
          await expectRejection(
            s.addChecked(a, b),
            'Uint64: addition overflow',
          );
        }
      }),
      RUNS,
    );
  });

  test('sub returns a - b, or fails on underflow', async () => {
    await fc.assert(
      fc.asyncProperty(uint64, uint64, async (a, b) => {
        if (a >= b) {
          expect(await s.sub(a, b)).toBe(a - b);
        } else {
          await expectRejection(s.sub(a, b), 'Uint64: subtraction underflow');
        }
      }),
      RUNS,
    );
  });

  test('mul returns a * b', async () => {
    await fc.assert(
      fc.asyncProperty(uint64, uint64, async (a, b) => {
        expect(await s.mul(a, b)).toBe(a * b);
      }),
      RUNS,
    );
  });

  test('mulChecked returns a * b, or fails on overflow', async () => {
    const small = fc.bigInt({ min: 0n, max: 0xffffffffn });
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(uint64, small),
        fc.oneof(uint64, small),
        async (a, b) => {
          if (a * b <= MAX_UINT64) {
            expect(await s.mulChecked(a, b)).toBe(a * b);
          } else {
            await expectRejection(
              s.mulChecked(a, b),
              'Uint64: multiplication overflow',
            );
          }
        },
      ),
      RUNS,
    );
  });

  test('div, rem, divRem and isMultiple agree with bigint division', async () => {
    await fc.assert(
      fc.asyncProperty(uint64, divisor, async (a, b) => {
        expect(await s.div(a, b)).toBe(a / b);
        expect(await s.rem(a, b)).toBe(a % b);
        expect(await s.divRem(a, b)).toEqual({
          quotient: a / b,
          remainder: a % b,
        });
        expect(await s.isMultiple(a, b)).toBe(a % b === 0n);
      }),
      RUNS,
    );
  });

  test('sqrt returns floor(sqrt(n))', async () => {
    await fc.assert(
      fc.asyncProperty(uint64, async (n) => {
        expect(await s.sqrt(n)).toBe(isqrt(n));
      }),
      RUNS,
    );
  });

  test('min and max', async () => {
    await fc.assert(
      fc.asyncProperty(uint64, uint64, async (a, b) => {
        expect(await s.min(a, b)).toBe(a < b ? a : b);
        expect(await s.max(a, b)).toBe(a > b ? a : b);
      }),
      RUNS,
    );
  });

  test('toBytes and toUnpackedBytes return the little-endian bytes', async () => {
    await fc.assert(
      fc.asyncProperty(uint64, async (v) => {
        expect(await s.toBytes(v)).toEqual(toBytesLE(v, 8));
        expect(await s.toUnpackedBytes(v)).toEqual(toVecLE(v, 8));
      }),
      RUNS,
    );
  });
});
