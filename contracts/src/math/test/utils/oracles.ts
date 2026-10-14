import { MAX_UINT64 } from './consts.js';

/**
 * Independent bigint oracles for the math tests. They do not use the test
 * witnesses or the circuits, so a test can disagree with both.
 */

/** A `U128` value as its two 64-bit limbs. */
export type U128Limbs = { low: bigint; high: bigint };

/** Splits a bigint below 2^128 into its 64-bit limbs. */
export const toU128 = (n: bigint): U128Limbs => ({
  low: n & MAX_UINT64,
  high: (n >> 64n) & MAX_UINT64,
});
