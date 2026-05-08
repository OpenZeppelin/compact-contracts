// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts v0.0.1-alpha.1 (crypto/utils/jubjubSchnorr.ts)
//
// Off-chain Schnorr-on-Jubjub keygen, signer, and reference verifier.
//
// Generic Jubjub primitives (isIdentity, fitInJubjubScalar, scalar order)
// live in `./jubjub.js` and are imported here so the same constants and
// helpers can be reused by other cryptographic schemes (Pedersen, FROST,
// ECDH, …) without coupling to Schnorr.

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
import { fitInJubjubScalar, isIdentity, modJubjubOrder } from './jubjub.js';

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
  const reduced = modJubjubOrder(secret);
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
 * the trailing `Jubjub.fitInJubjubScalar` truncation, which zeroes the top
 * byte of the LE encoding so the result fits in the Jubjub scalar field
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
 * Produce a Schnorr-on-Jubjub signature over `message` under `secret`.
 *
 * Always samples a fresh, cryptographically-strong nonce. This is the
 * function production callers should use.
 *
 * The signature scalar is computed as `sigma = (r + c * s) mod n` where
 * `n = JUBJUB_SCALAR_ORDER` and `c` is the truncated challenge from
 * `schnorrChallenge` (already in [0, 2^248)). The verify equation
 * `sigma * G == R + c * P` holds with `c` reduced identically on both sides.
 *
 * For deterministic test vectors, use `jubjubSignDeterministic` instead.
 */
export function jubjubSign(
  secret: bigint,
  message: Uint8Array,
): JubjubSchnorrSignature {
  return signWithNonce(secret, message, sampleScalar());
}

/**
 * Produce a Schnorr-on-Jubjub signature with a CALLER-SUPPLIED nonce.
 *
 * **WARNING — TEST/CEREMONY USE ONLY.** Reusing the same nonce across two
 * different messages under the same secret immediately leaks the secret:
 *
 *     sigma_1 - sigma_2 == (c_1 - c_2) * s   mod Fr
 *     ⇒ s = (sigma_1 - sigma_2) * (c_1 - c_2)^{-1}   mod Fr
 *
 * Production code MUST use `jubjubSign`, which samples a fresh nonce per call.
 * This entrypoint exists exclusively for deterministic test vectors and for
 * orchestrated signing protocols (e.g. FROST) that derive nonces via a
 * separate, audited mechanism.
 */
export function jubjubSignDeterministic(
  secret: bigint,
  message: Uint8Array,
  nonceSeed: bigint,
): JubjubSchnorrSignature {
  return signWithNonce(secret, message, modJubjubOrder(nonceSeed));
}

function signWithNonce(
  secret: bigint,
  message: Uint8Array,
  rRaw: bigint,
): JubjubSchnorrSignature {
  const s = modJubjubOrder(secret);
  if (s === 0n) throw new Error('jubjubSign: secret reduces to zero');
  const r = modJubjubOrder(rRaw);
  if (r === 0n) throw new Error('jubjubSign: nonce reduces to zero');

  const R = ecMulGenerator(r);
  const P = ecMulGenerator(s);
  const c = schnorrChallenge(R, P, message);
  const sigma = modJubjubOrder(r + c * s);
  return { R, sigma };
}

/**
 * Off-chain reference verifier — useful for unit tests that want a
 * deploy-free smoke check. Mirrors the on-chain `Schnorr.verify`, including
 * the rejection of identity-element inputs.
 */
export function jubjubVerify(
  P: JubjubPoint,
  message: Uint8Array,
  sig: JubjubSchnorrSignature,
): boolean {
  if (isIdentity(P) || isIdentity(sig.R)) return false;
  const c = schnorrChallenge(sig.R, P, message);
  const lhs = ecMulGenerator(sig.sigma);
  const rhs = ecAdd(sig.R, ecMul(P, c));
  return jubjubPointX(lhs) === jubjubPointX(rhs)
    && jubjubPointY(lhs) === jubjubPointY(rhs);
}

// ─── Internals ──────────────────────────────────────────────────────────────

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
    if (x !== 0n && x < (1n << 252n)) return x;
  }
  throw new Error('sampleScalar: rejection sampling exhausted');
}
