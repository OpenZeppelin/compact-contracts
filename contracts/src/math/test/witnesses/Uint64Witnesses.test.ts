import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { describe, expect, test } from 'vitest';
import { MAX_UINT32, MAX_UINT64 } from '../utils/consts.js';
import { Uint64PrivateState, Uint64Witnesses } from './Uint64Witnesses.js';

const context = (
  privateState: Uint64PrivateState = Uint64PrivateState,
): WitnessContext<unknown, Uint64PrivateState> =>
  ({ privateState }) as WitnessContext<unknown, Uint64PrivateState>;

const witnesses = Uint64Witnesses();

describe('Uint64Witnesses', () => {
  test('every witness returns the private state unchanged', () => {
    const state = Object.freeze({ ...Uint64PrivateState });
    expect(witnesses.wit_divUint64(context(state), 7n, 2n)[0]).toBe(state);
    expect(witnesses.wit_sqrtUint64(context(state), 7n)[0]).toBe(state);
    expect(witnesses.wit_uint64ToUnpackedBytes(context(state), 7n)[0]).toBe(
      state,
    );
  });

  describe('wit_divUint64', () => {
    test('returns q, r with a = q * b + r and r < b for small inputs', () => {
      for (let a = 0n; a < 256n; a++) {
        for (let b = 1n; b < 32n; b++) {
          const [, { quotient, remainder }] = witnesses.wit_divUint64(
            context(),
            a,
            b,
          );
          expect(quotient * b + remainder).toBe(a);
          expect(remainder < b).toBe(true);
        }
      }
    });

    test('handles the 64-bit boundaries', () => {
      expect(witnesses.wit_divUint64(context(), MAX_UINT64, 1n)[1]).toEqual({
        quotient: MAX_UINT64,
        remainder: 0n,
      });
      expect(
        witnesses.wit_divUint64(context(), MAX_UINT64, MAX_UINT64)[1],
      ).toEqual({ quotient: 1n, remainder: 0n });
    });

    test('is deterministic', () => {
      expect(witnesses.wit_divUint64(context(), 1000n, 7n)).toEqual(
        witnesses.wit_divUint64(context(), 1000n, 7n),
      );
    });

    test('throws RangeError for a zero divisor', () => {
      expect(() => witnesses.wit_divUint64(context(), 5n, 0n)).toThrow(
        RangeError,
      );
    });
  });

  describe('wit_sqrtUint64', () => {
    test('returns floor(sqrt(n)) for every n below 2^16', () => {
      for (let n = 0n; n < 1n << 16n; n++) {
        const [, root] = witnesses.wit_sqrtUint64(context(), n);
        expect(root * root <= n && (root + 1n) * (root + 1n) > n).toBe(true);
      }
    });

    test('returns 2^32 - 1 for 2^64 - 1', () => {
      expect(witnesses.wit_sqrtUint64(context(), MAX_UINT64)[1]).toBe(
        MAX_UINT32,
      );
    });
  });

  describe('wit_uint64ToUnpackedBytes', () => {
    const recompose = (vec: bigint[]): bigint =>
      vec.reduce((sum, digit, i) => sum + (digit << (8n * BigInt(i))), 0n);

    test('returns the 8 little-endian digits of every 12-bit value', () => {
      for (let value = 0n; value < 1n << 12n; value++) {
        const [, vec] = witnesses.wit_uint64ToUnpackedBytes(context(), value);
        expect(vec).toHaveLength(8);
        expect(vec.every((digit) => digit >= 0n && digit <= 0xffn)).toBe(true);
        expect(recompose(vec)).toBe(value);
      }
    });

    test('returns eight 0xff digits for 2^64 - 1', () => {
      expect(
        witnesses.wit_uint64ToUnpackedBytes(context(), MAX_UINT64)[1],
      ).toEqual(Array(8).fill(0xffn));
    });
  });
});
