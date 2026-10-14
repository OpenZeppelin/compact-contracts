import { describe, expect, test } from 'vitest';
import { sqrtBigint } from './sqrtBigint.js';

describe('sqrtBigint() function', () => {
  test('should handle zero', () => {
    expect(sqrtBigint(0n)).toBe(0n);
  });

  test('should handle 1', () => {
    expect(sqrtBigint(1n)).toBe(1n);
  });

  test('should handle small perfect squares', () => {
    expect(sqrtBigint(4n)).toBe(2n);
    expect(sqrtBigint(9n)).toBe(3n);
    expect(sqrtBigint(16n)).toBe(4n);
    expect(sqrtBigint(25n)).toBe(5n);
    expect(sqrtBigint(100n)).toBe(10n);
  });

  test('should handle small non-perfect squares', () => {
    expect(sqrtBigint(2n)).toBe(1n); // floor(sqrtBigint(2)) ≈ 1.414
    expect(sqrtBigint(3n)).toBe(1n); // floor(sqrtBigint(3)) ≈ 1.732
    expect(sqrtBigint(5n)).toBe(2n); // floor(sqrtBigint(5)) ≈ 2.236
    expect(sqrtBigint(8n)).toBe(2n); // floor(sqrtBigint(8)) ≈ 2.828
    expect(sqrtBigint(99n)).toBe(9n); // floor(sqrtBigint(99)) ≈ 9.95
  });

  test('should handle large perfect squares', () => {
    expect(sqrtBigint(10000n)).toBe(100n);
    expect(sqrtBigint(1000000n)).toBe(1000n);
    expect(sqrtBigint(100000000n)).toBe(10000n);
  });

  test('should handle large non-perfect squares', () => {
    expect(sqrtBigint(101n)).toBe(10n); // floor(sqrtBigint(101)) ≈ 10.05
    expect(sqrtBigint(999999n)).toBe(999n); // floor(sqrtBigint(999999)) ≈ 999.9995
    expect(sqrtBigint(100000001n)).toBe(10000n); // floor(sqrtBigint(100000001)) ≈ 10000.00005
  });

  test('should handle powers of 2', () => {
    expect(sqrtBigint(2n ** 32n)).toBe(2n ** 16n); // sqrtBigint(2^32) = 2^16
    expect(sqrtBigint(2n ** 64n)).toBe(2n ** 32n); // sqrtBigint(2^64) = 2^32
    expect(sqrtBigint(2n ** 128n)).toBe(2n ** 64n); // sqrtBigint(2^128) = 2^64
  });

  test('should handle max Uint<64>', () => {
    const maxU64 = 2n ** 64n - 1n; // 18446744073709551615
    expect(sqrtBigint(maxU64)).toBe(4294967295n); // floor(sqrtBigint(2^64 - 1)) = 2^32 - 1
  });

  test('should handle max Uint<128>', () => {
    const maxU128 = 2n ** 128n - 1n; // 340282366920938463463374607431768211455
    expect(sqrtBigint(maxU128)).toBe(18446744073709551615n); // floor(sqrtBigint(2^128 - 1)) = 2^64 - 1
  });

  test('should throw on negative numbers', () => {
    expect(() => sqrtBigint(-1n)).toThrowError(
      'square root of negative numbers is not supported',
    );
    expect(() => sqrtBigint(-100n)).toThrowError(
      'square root of negative numbers is not supported',
    );
    expect(() => sqrtBigint(-(2n ** 128n))).toThrowError(
      'square root of negative numbers is not supported',
    );
  });
});
