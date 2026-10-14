import { MAX_UINT64, MAX_UINT128 } from './consts.js';

/**
 * Independent bigint oracles for the math tests. They do not use the test
 * witnesses or the circuits, so a test can disagree with both.
 */

/** A `U128` value as its two 64-bit limbs. */
export type U128Limbs = { low: bigint; high: bigint };

/** A `U256` value as its two `U128` halves. */
export type U256Limbs = { low: U128Limbs; high: U128Limbs };

/** Splits a bigint below 2^128 into its 64-bit limbs. */
export const toU128 = (n: bigint): U128Limbs => ({
  low: n & MAX_UINT64,
  high: (n >> 64n) & MAX_UINT64,
});

/** Splits a bigint below 2^256 into its two `U128` halves. */
export const toU256 = (n: bigint): U256Limbs => ({
  low: toU128(n & MAX_UINT128),
  high: toU128(n >> 128n),
});

/** Recomposes a `U256` into a bigint. */
export const fromU256 = (u: U256Limbs): bigint =>
  u.low.low +
  (u.low.high << 64n) +
  (u.high.low << 128n) +
  (u.high.high << 192n);

/** Reads little-endian bytes as a bigint (byte 0 is the least significant). */
export const bytesLEToBigint = (bytes: Uint8Array): bigint => {
  let result = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result;
};

/** Writes a bigint as `length` little-endian byte values (element 0 is the LSB). */
export const toVecLE = (n: bigint, length: number): bigint[] =>
  Array.from({ length }, (_, i) => (n >> (8n * BigInt(i))) & 0xffn);

/** Writes a bigint as `length` little-endian bytes. */
export const toBytesLE = (n: bigint, length: number): Uint8Array =>
  Uint8Array.from(toVecLE(n, length), (b) => Number(b));
