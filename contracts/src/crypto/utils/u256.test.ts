import { describe, expect, test } from 'vitest';
import { MAX_UINT64 } from './consts';
import { FIELD_MODULUS, fromU256, toU256 } from './u256';

describe('U256 Utils', () => {
  describe('toU256', () => {
    test('should convert zero correctly', () => {
      const result = toU256(0n);
      expect(result).toEqual({
        low: { low: 0n, high: 0n },
        high: { low: 0n, high: 0n },
      });
    });

    test('should convert small numbers correctly', () => {
      const result = toU256(123n);
      expect(result).toEqual({
        low: { low: 123n, high: 0n },
        high: { low: 0n, high: 0n },
      });
    });

    test('should convert numbers that fit in 64 bits', () => {
      const value = MAX_UINT64;
      const result = toU256(value);
      expect(result).toEqual({
        low: { low: MAX_UINT64, high: 0n },
        high: { low: 0n, high: 0n },
      });
    });

    test('should convert numbers that fit in 128 bits', () => {
      const value = (1n << 64n) + 123n; // Value that spans both 64-bit parts of low
      const result = toU256(value);
      expect(result).toEqual({
        low: { low: 123n, high: 1n },
        high: { low: 0n, high: 0n },
      });
    });

    test('should convert numbers that span 128-bit boundary', () => {
      const value = (1n << 128n) + 456n; // Value that spans into high
      const result = toU256(value);
      expect(result).toEqual({
        low: { low: 456n, high: 0n },
        high: { low: 1n, high: 0n },
      });
    });

    test('should convert large numbers correctly', () => {
      const value = (1n << 192n) + (1n << 128n) + (1n << 64n) + 789n;
      const result = toU256(value);
      expect(result).toEqual({
        low: { low: 789n, high: 1n },
        high: { low: 1n, high: 1n },
      });
    });

    test('should handle maximum U256 value', () => {
      const maxU256 = (1n << 256n) - 1n;
      const result = toU256(maxU256);
      expect(result).toEqual({
        low: { low: MAX_UINT64, high: MAX_UINT64 },
        high: { low: MAX_UINT64, high: MAX_UINT64 },
      });
    });
  });

  describe('fromU256', () => {
    test('should convert zero U256 back to zero', () => {
      const u256 = {
        low: { low: 0n, high: 0n },
        high: { low: 0n, high: 0n },
      };
      const result = fromU256(u256);
      expect(result).toBe(0n);
    });

    test('should convert small numbers correctly', () => {
      const u256 = {
        low: { low: 123n, high: 0n },
        high: { low: 0n, high: 0n },
      };
      const result = fromU256(u256);
      expect(result).toBe(123n);
    });

    test('should convert numbers spanning 64-bit boundary', () => {
      const u256 = {
        low: { low: 123n, high: 1n },
        high: { low: 0n, high: 0n },
      };
      const result = fromU256(u256);
      expect(result).toBe((1n << 64n) + 123n);
    });

    test('should convert numbers spanning 128-bit boundary', () => {
      const u256 = {
        low: { low: 456n, high: 0n },
        high: { low: 1n, high: 0n },
      };
      const result = fromU256(u256);
      expect(result).toBe((1n << 128n) + 456n);
    });

    test('should convert large numbers correctly', () => {
      const u256 = {
        low: { low: 789n, high: 1n },
        high: { low: 1n, high: 1n },
      };
      const result = fromU256(u256);
      expect(result).toBe((1n << 192n) + (1n << 128n) + (1n << 64n) + 789n);
    });

    test('should handle maximum U256 value', () => {
      const u256 = {
        low: { low: MAX_UINT64, high: MAX_UINT64 },
        high: { low: MAX_UINT64, high: MAX_UINT64 },
      };
      const result = fromU256(u256);
      expect(result).toBe((1n << 256n) - 1n);
    });
  });

  describe('round-trip conversion', () => {
    test('should preserve values through toU256 -> fromU256', () => {
      const testValues = [
        0n,
        1n,
        123n,
        MAX_UINT64,
        (1n << 64n) + 456n,
        (1n << 128n) + 789n,
        (1n << 192n) + (1n << 128n) + (1n << 64n) + 123n,
        (1n << 256n) - 1n,
      ];

      for (const value of testValues) {
        const u256 = toU256(value);
        const backToBigint = fromU256(u256);
        expect(backToBigint).toBe(value);
      }
    });

    test('should preserve U256 values through fromU256 -> toU256', () => {
      const testU256s = [
        { low: { low: 0n, high: 0n }, high: { low: 0n, high: 0n } },
        { low: { low: 123n, high: 0n }, high: { low: 0n, high: 0n } },
        { low: { low: 123n, high: 1n }, high: { low: 0n, high: 0n } },
        { low: { low: 456n, high: 0n }, high: { low: 1n, high: 0n } },
        { low: { low: 789n, high: 1n }, high: { low: 1n, high: 1n } },
        {
          low: { low: MAX_UINT64, high: MAX_UINT64 },
          high: { low: MAX_UINT64, high: MAX_UINT64 },
        },
      ];

      for (const u256 of testU256s) {
        const bigint = fromU256(u256);
        const backToU256 = toU256(bigint);
        expect(backToU256).toEqual(u256);
      }
    });
  });

  describe('FIELD_MODULUS', () => {
    test('should have correct value', () => {
      expect(FIELD_MODULUS).toBe(2n ** 254n - 1n);
    });

    test('should be less than 2^256', () => {
      expect(FIELD_MODULUS).toBeLessThan(2n ** 256n);
    });

    test('should be greater than 2^253', () => {
      expect(FIELD_MODULUS).toBeGreaterThan(2n ** 253n);
    });
  });
});
