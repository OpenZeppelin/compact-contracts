// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts v0.0.1-alpha.1 (crypto/utils/jubjub.ts)
//
// Off-chain TypeScript mirror of the on-chain `crypto/Jubjub.compact` module.
// Generic Jubjub primitives reusable across every crypto utility (Schnorr,
// Pedersen, FROST, ECDH, …). Provides bit-for-bit-compatible implementations
// of the on-chain helpers so test vectors and signature production agree
// with the verifier.
//
// All elliptic-curve and hash operations route through
// `@midnight-ntwrk/compact-runtime` so the TS output is identical to the
// circuit's. There is no second cryptographic implementation to keep in sync.

import {
  type JubjubPoint,
  jubjubPointX,
  jubjubPointY,
} from '@midnight-ntwrk/compact-runtime';

/**
 * Jubjub scalar field order (Zcash Sapling parameters).
 *
 * Source: midnight-zk-main/curves/src/jubjub/fr.rs:76 and
 * midnight-zk-main/curves/README.md:104.
 *
 * r = 0x0e7db4ea6533afa906673b0101343b00a6682093ccc81082d0970e5ed6f72cb7
 */
export const JUBJUB_SCALAR_ORDER: bigint =
  0x0e7db4ea6533afa906673b0101343b00a6682093ccc81082d0970e5ed6f72cb7n;

/**
 * Number of bits the on-chain `Jubjub.fitInJubjubScalar` keeps from a Field
 * value before passing it to `ecMul` / `ecMulGenerator`. The on-chain code
 * zeroes the most significant byte of the LE byte encoding, so the safe
 * range is [0, 2^248). This module reproduces that reduction exactly so
 * off-chain and on-chain scalar values match bit-for-bit.
 *
 * See the @notice block in contracts/src/crypto/Jubjub.compact for the
 * full background on why this truncation is required.
 */
export const JUBJUB_TRUNCATION_BITS = 248;
const JUBJUB_TRUNCATION_MASK = (1n << BigInt(JUBJUB_TRUNCATION_BITS)) - 1n;

/**
 * Returns whether a Jubjub point is the curve identity (additive zero).
 * Mirrors the on-chain `Jubjub.isIdentity` circuit. The identity in
 * twisted-Edwards form is `(0, 1)`.
 */
export function isIdentity(p: JubjubPoint): boolean {
  return jubjubPointX(p) === 0n && jubjubPointY(p) === 1n;
}

/**
 * Truncates a Field value to [0, 2^248) so it fits in the Jubjub scalar
 * field. Equivalent to zeroing the most-significant byte of the LE byte
 * encoding, which is what the on-chain `Jubjub.fitInJubjubScalar` circuit
 * does. See `JUBJUB_TRUNCATION_BITS` for the rationale.
 */
export function fitInJubjubScalar(c: bigint): bigint {
  return c & JUBJUB_TRUNCATION_MASK;
}

/**
 * Reduce a bigint into [0, JUBJUB_SCALAR_ORDER). Used by signature scalar
 * arithmetic — `sigma = (r + c*s) mod JUBJUB_SCALAR_ORDER`.
 */
export function modJubjubOrder(x: bigint): bigint {
  const m = x % JUBJUB_SCALAR_ORDER;
  return m < 0n ? m + JUBJUB_SCALAR_ORDER : m;
}
