import { describe, expect, test } from 'vitest';
import {
  MAX_UINT8,
  MAX_UINT16,
  MAX_UINT32,
  MAX_UINT64,
  MAX_UINT128,
  MAX_UINT256,
} from './consts.js';

describe('Constants', () => {
  test('MAX_U8 should be 2^8 - 1', () => {
    expect(MAX_UINT8).toBe(2n ** 8n - 1n);
    expect(MAX_UINT8).toBe(255n);
  });

  test('MAX_U16 should be 2^16 - 1', () => {
    expect(MAX_UINT16).toBe(2n ** 16n - 1n);
    expect(MAX_UINT16).toBe(65535n);
  });

  test('MAX_U32 should be 2^32 - 1', () => {
    expect(MAX_UINT32).toBe(2n ** 32n - 1n);
    expect(MAX_UINT32).toBe(4294967295n);
  });

  test('MAX_U64 should be 2^64 - 1', () => {
    expect(MAX_UINT64).toBe(2n ** 64n - 1n);
    expect(MAX_UINT64).toBe(18446744073709551615n);
  });

  test('MAX_U128 should be 2^128 - 1', () => {
    expect(MAX_UINT128).toBe(2n ** 128n - 1n);
    expect(MAX_UINT128).toBe(340282366920938463463374607431768211455n);
  });

  test('MAX_U256 should be 2^256 - 1', () => {
    expect(MAX_UINT256).toBe(2n ** 256n - 1n);
    expect(MAX_UINT256).toBe(
      115792089237316195423570985008687907853269984665640564039457584007913129639935n,
    );
  });
});
