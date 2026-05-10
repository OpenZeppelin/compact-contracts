// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts v0.0.1-alpha.1 (crypto/utils/frost/polynomial.ts)
//
// Polynomial arithmetic over the Jubjub scalar field Fr. Used by FROST's
// secret-sharing layer (Pedersen DKG produces a degree-(threshold-1) polynomial
// per participant) and by the Lagrange-interpolation step in the threshold
// signing protocol.

import { JUBJUB_SCALAR_ORDER, modJubjubOrder } from '../jubjub.js';

const ZERO = 0n;
const ONE = 1n;

/**
 * Evaluate a polynomial `f(x) = a_0 + a_1*x + a_2*x^2 + ...` over Fr at point `x`,
 * using Horner's rule.
 *
 * Coefficients in `coeffs` are ordered low-to-high (`coeffs[0]` is `a_0`).
 * Result is reduced into [0, JUBJUB_SCALAR_ORDER).
 */
export function evalPoly(coeffs: readonly bigint[], x: bigint): bigint {
  if (coeffs.length === 0) return ZERO;
  // Horner: f(x) = (((a_n * x + a_{n-1}) * x + ...) * x + a_0).
  let acc = ZERO;
  for (let i = coeffs.length - 1; i >= 0; i--) {
    acc = modJubjubOrder(acc * x + coeffs[i]!);
  }
  return acc;
}

/**
 * Modular inverse of `a` in Fr via Fermat's little theorem:
 * `a^(p - 2) mod p` where `p = JUBJUB_SCALAR_ORDER`.
 *
 * Throws if `a ≡ 0 (mod p)` (no inverse exists).
 */
export function invMod(a: bigint): bigint {
  const reduced = modJubjubOrder(a);
  if (reduced === ZERO) {
    throw new Error('invMod: zero has no modular inverse in Fr');
  }
  return modPow(reduced, JUBJUB_SCALAR_ORDER - 2n, JUBJUB_SCALAR_ORDER);
}

/**
 * Modular exponentiation: returns `base^exp mod modulus`. Square-and-multiply.
 */
export function modPow(base: bigint, exp: bigint, modulus: bigint): bigint {
  if (modulus === ONE) return ZERO;
  let result = ONE;
  let b = ((base % modulus) + modulus) % modulus;
  let e = exp;
  while (e > ZERO) {
    if ((e & ONE) === ONE) {
      result = (result * b) % modulus;
    }
    e >>= ONE;
    b = (b * b) % modulus;
  }
  return result;
}

/**
 * Lagrange coefficient `λ_i^S` for participant `i` over the signer set `signerSet`.
 *
 * Formula: `λ_i = Π_{j ∈ S, j != i} ( j / (j - i) )` mod r.
 *
 * Used in FROST round 3 to weight each participant's secret-share contribution
 * such that the partial signatures sum to a valid signature under the
 * aggregated public key.
 *
 * @throws if `i` is not in `signerSet` or `signerSet` contains duplicates.
 */
export function lagrangeCoefficient(
  i: bigint,
  signerSet: readonly bigint[],
): bigint {
  // Sanity: i must be a member of S.
  if (!signerSet.includes(i)) {
    throw new Error(
      `lagrangeCoefficient: participant ${i} is not in the signer set [${signerSet.join(
        ', ',
      )}]`,
    );
  }
  // Sanity: distinct participants.
  const seen = new Set<bigint>();
  for (const j of signerSet) {
    if (seen.has(j)) {
      throw new Error(
        `lagrangeCoefficient: duplicate participant ${j} in signer set`,
      );
    }
    seen.add(j);
  }

  let num = ONE;
  let den = ONE;
  for (const j of signerSet) {
    if (j === i) continue;
    num = modJubjubOrder(num * j);
    den = modJubjubOrder(den * modJubjubOrder(j - i));
  }
  return modJubjubOrder(num * invMod(den));
}

/**
 * Generate a random polynomial of degree `degree` over Fr, with coefficients
 * uniformly sampled in `[0, JUBJUB_SCALAR_ORDER)`. Coefficient at index 0 is
 * the constant term (the secret in Pedersen DKG).
 *
 * `degree = threshold - 1` for FROST K-of-N.
 */
export function randomPolynomial(degree: number): bigint[] {
  if (degree < 0) {
    throw new Error(`randomPolynomial: degree must be non-negative, got ${degree}`);
  }
  const coeffs: bigint[] = [];
  for (let i = 0; i <= degree; i++) {
    coeffs.push(sampleScalar());
  }
  return coeffs;
}

/**
 * Sample a uniformly random non-zero scalar in `[1, JUBJUB_SCALAR_ORDER)`.
 *
 * Uses wide reduction: pull 64 random bytes, interpret as a 512-bit integer,
 * then reduce mod r. The statistical bias relative to a uniform sample on
 * [0, r) is bounded by 2^(256 - 252) / 2^256 ≈ 2^-252 — cryptographically
 * negligible. (Compare: the naive 32-byte rejection-sample loop has an
 * ≈88% rejection rate per attempt because r ≈ 2^252.86 is well below 2^256,
 * so an N-attempt loop occasionally exhausts in practice.)
 */
export function sampleScalar(): bigint {
  const buf = new Uint8Array(64);
  crypto.getRandomValues(buf);
  let x = ZERO;
  for (const b of buf) x = (x << 8n) | BigInt(b);
  const reduced = x % JUBJUB_SCALAR_ORDER;
  // Map the (negligibly rare) 0 case onto 1 so callers always get a non-zero
  // scalar; this preserves uniformity outside [0, 1] which is fine here.
  return reduced === ZERO ? ONE : reduced;
}
