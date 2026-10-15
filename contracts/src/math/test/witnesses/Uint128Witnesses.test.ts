import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { describe, expect, test } from 'vitest';
import { MAX_UINT64, MAX_UINT128 } from '../utils/consts.js';
import {
  toBigint,
  toU128,
  Uint128PrivateState,
  Uint128Witnesses,
} from './Uint128Witnesses.js';

const context = (
  privateState: Uint128PrivateState = Uint128PrivateState,
): WitnessContext<unknown, Uint128PrivateState> =>
  ({ privateState }) as WitnessContext<unknown, Uint128PrivateState>;

const witnesses = Uint128Witnesses();
const MODULUS = 1n << 64n;

describe('Uint128Witnesses', () => {
  test('toU128 and toBigint are inverse for the limb boundaries', () => {
    for (const value of [0n, 1n, MAX_UINT64, MODULUS, MAX_UINT128]) {
      const limbs = toU128(value);
      expect(limbs.low <= MAX_UINT64 && limbs.high <= MAX_UINT64).toBe(true);
      expect(toBigint(limbs)).toBe(value);
    }
  });

  test('every witness returns the private state unchanged', () => {
    const state = Object.freeze({ ...Uint128PrivateState });
    expect(
      witnesses.wit_divU128(context(state), toU128(7n), toU128(2n))[0],
    ).toBe(state);
    expect(witnesses.wit_divUint128(context(state), 7n, 2n)[0]).toBe(state);
    expect(witnesses.wit_sqrtU128(context(state), toU128(7n))[0]).toBe(state);
  });

  describe('wit_divU128 and wit_divUint128', () => {
    test('return q, r with a = q * b + r and r < b for small inputs', () => {
      for (let a = 0n; a < 128n; a++) {
        for (let b = 1n; b < 24n; b++) {
          const [, u128] = witnesses.wit_divU128(
            context(),
            toU128(a),
            toU128(b),
          );
          const [, uint] = witnesses.wit_divUint128(context(), a, b);
          expect(uint).toEqual(u128);
          const q = toBigint(u128.quotient);
          const r = toBigint(u128.remainder);
          expect(q * b + r).toBe(a);
          expect(r < b).toBe(true);
        }
      }
    });

    test('split a value with the divisor 2^64 and leave both high limbs 0', () => {
      for (const value of [0n, 1n, MAX_UINT64, MODULUS, MAX_UINT128]) {
        const [, { quotient, remainder }] = witnesses.wit_divUint128(
          context(),
          value,
          MODULUS,
        );
        expect(quotient).toEqual({ low: value >> 64n, high: 0n });
        expect(remainder).toEqual({ low: value & MAX_UINT64, high: 0n });
      }
    });

    test('are deterministic', () => {
      expect(witnesses.wit_divUint128(context(), MAX_UINT128, 3n)).toEqual(
        witnesses.wit_divUint128(context(), MAX_UINT128, 3n),
      );
    });

    test('throw RangeError for a zero divisor', () => {
      expect(() =>
        witnesses.wit_divU128(context(), toU128(5n), toU128(0n)),
      ).toThrow(RangeError);
      expect(() => witnesses.wit_divUint128(context(), 5n, 0n)).toThrow(
        RangeError,
      );
    });
  });

  describe('wit_sqrtU128', () => {
    test('returns floor(sqrt(n)) for every n below 2^14', () => {
      for (let n = 0n; n < 1n << 14n; n++) {
        const [, root] = witnesses.wit_sqrtU128(context(), toU128(n));
        expect(root * root <= n && (root + 1n) * (root + 1n) > n).toBe(true);
      }
    });

    test('returns 2^64 - 1 for 2^128 - 1', () => {
      expect(witnesses.wit_sqrtU128(context(), toU128(MAX_UINT128))[1]).toBe(
        MAX_UINT64,
      );
    });
  });
});
