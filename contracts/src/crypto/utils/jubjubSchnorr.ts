// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts v0.0.1-alpha.1 (crypto/utils/jubjubSchnorr.ts)
//
// Off-chain Schnorr-on-Jubjub keygen, signer, and reference verifier.
//
// All elliptic-curve and hash operations route through @midnight-ntwrk/compact-runtime
// so the off-chain output is bit-identical to the on-chain Schnorr.compact module.
// The runtime exposes the same Poseidon `transientHash`, `ecAdd`, `ecMul`,
// `ecMulGenerator`, `jubjubPointX`, `jubjubPointY`, and `degradeToTransient`
// primitives the circuit calls — there is no second cryptographic implementation
// to keep in sync.

import {
  CompactTypeField,
  CompactTypeVector,
  degradeToTransient,
  ecAdd,
  ecMul,
  ecMulGenerator,
  type JubjubPoint,
  jubjubPointX,
  jubjubPointY,
  transientHash,
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
 * Number of bits the on-chain `fitInJubjubScalar` keeps from a Field value
 * before passing it to `ecMul` / `ecMulGenerator`. The on-chain code zeroes
 * the most significant byte of the LE byte encoding, so the safe range is
 * [0, 2^248). This module reproduces that reduction exactly so off-chain
 * challenge values match on-chain ones bit-for-bit.
 *
 * See the @notice in contracts/src/crypto/Schnorr.compact for the
 * full background on why this truncation is required.
 */
export const JUBJUB_TRUNCATION_BITS = 248;
const JUBJUB_TRUNCATION_MASK = (1n << BigInt(JUBJUB_TRUNCATION_BITS)) - 1n;

/**
 * Domain tag baked into the Schnorr challenge preimage.
 * MUST match the literal in `contracts/src/crypto/Schnorr.compact` exactly,
 * encoded as a 32-byte right-padded ASCII string (Compact's `pad(32, ...)`).
 */
const SCHNORR_DOMAIN_TAG: Uint8Array = padRight32('Schnorr:Jubjub:v1');

export interface JubjubKeypair {
  /** Secret scalar in `[1, JUBJUB_SCALAR_ORDER)`. */
  readonly secret: bigint;
  /** Public key `P = secret * G` on Jubjub. */
  readonly publicKey: JubjubPoint;
}

export interface JubjubSchnorrSignature {
  readonly R: JubjubPoint;
  readonly sigma: bigint;
}

/**
 * Build a deterministic keypair from a secret seed bigint.
 * The seed is reduced modulo the Jubjub scalar order; values that reduce to
 * zero are rejected.
 */
export function jubjubKeypairFromSecret(secret: bigint): JubjubKeypair {
  const reduced = modOrder(secret);
  if (reduced === 0n) {
    throw new Error('jubjubKeypairFromSecret: secret reduces to zero');
  }
  return {
    secret: reduced,
    publicKey: ecMulGenerator(reduced),
  };
}

/**
 * Compute the Fiat-Shamir challenge for a Schnorr-on-Jubjub signature.
 *
 * MUST byte-match the on-chain `Schnorr_challenge` circuit. That includes
 * the trailing `fitInJubjubScalar` truncation, which zeroes the top byte
 * of the LE encoding so the result fits in the Jubjub scalar field
 * (modulus ~2^252).
 */
export function schnorrChallenge(
  R: JubjubPoint,
  P: JubjubPoint,
  message: Uint8Array,
): bigint {
  if (message.length !== 32) {
    throw new Error(
      `schnorrChallenge: message must be 32 bytes, got ${message.length}`,
    );
  }
  const rtType = new CompactTypeVector(6, CompactTypeField);
  const cFull = transientHash(rtType, [
    degradeToTransient(SCHNORR_DOMAIN_TAG),
    jubjubPointX(R),
    jubjubPointY(R),
    jubjubPointX(P),
    jubjubPointY(P),
    degradeToTransient(message),
  ]);
  return fitInJubjubScalar(cFull);
}

/**
 * Truncates a Field value to [0, 2^248) so it fits in the Jubjub scalar
 * field. Equivalent to zeroing the most-significant byte of the LE byte
 * encoding, which is what the on-chain `Schnorr.fitInJubjubScalar` circuit
 * does. See `JUBJUB_TRUNCATION_BITS` for the rationale.
 */
export function fitInJubjubScalar(c: bigint): bigint {
  return c & JUBJUB_TRUNCATION_MASK;
}

/**
 * Produce a Schnorr-on-Jubjub signature over `message` under `secret`.
 *
 * Pass `nonceSeed` for deterministic test vectors; otherwise a fresh
 * cryptographically-strong nonce is sampled.
 *
 * The signature scalar is computed as `sigma = (r + c * s) mod n` where
 * `n = JUBJUB_SCALAR_ORDER`. The challenge `c` is the raw `transientHash`
 * output (a BLS12-381 scalar-field element); the on-chain `ecMul(P, c)`
 * reduces `c` modulo `n` automatically, so we apply the same reduction
 * here for the verify equation `sigma * G == R + c * P` to hold.
 */
export function jubjubSign(
  secret: bigint,
  message: Uint8Array,
  nonceSeed?: bigint,
): JubjubSchnorrSignature {
  const s = modOrder(secret);
  if (s === 0n) throw new Error('jubjubSign: secret reduces to zero');
  const r = nonceSeed !== undefined ? modOrder(nonceSeed) : sampleScalar();
  if (r === 0n) throw new Error('jubjubSign: nonce reduces to zero');

  const R = ecMulGenerator(r);
  const P = ecMulGenerator(s);
  const c = schnorrChallenge(R, P, message);
  const sigma = modOrder(r + c * s);
  return { R, sigma };
}

/**
 * Off-chain reference verifier — useful for unit tests that want a
 * deploy-free smoke check. Mirrors the on-chain `Schnorr.verify`.
 */
export function jubjubVerify(
  P: JubjubPoint,
  message: Uint8Array,
  sig: JubjubSchnorrSignature,
): boolean {
  const c = schnorrChallenge(sig.R, P, message);
  const lhs = ecMulGenerator(sig.sigma);
  const rhs = ecAdd(sig.R, ecMul(P, c));
  return jubjubPointX(lhs) === jubjubPointX(rhs)
    && jubjubPointY(lhs) === jubjubPointY(rhs);
}

// ─── Internals ──────────────────────────────────────────────────────────────

function modOrder(x: bigint): bigint {
  const m = x % JUBJUB_SCALAR_ORDER;
  return m < 0n ? m + JUBJUB_SCALAR_ORDER : m;
}

function padRight32(s: string): Uint8Array {
  const enc = new TextEncoder().encode(s);
  if (enc.length > 32) {
    throw new Error(`padRight32: input too long (${enc.length} bytes)`);
  }
  const out = new Uint8Array(32);
  out.set(enc, 0);
  return out;
}

function sampleScalar(): bigint {
  const buf = new Uint8Array(32);
  for (let attempt = 0; attempt < 64; attempt += 1) {
    crypto.getRandomValues(buf);
    let x = 0n;
    for (const b of buf) x = (x << 8n) | BigInt(b);
    if (x !== 0n && x < JUBJUB_SCALAR_ORDER) return x;
  }
  throw new Error('sampleScalar: rejection sampling exhausted');
}
