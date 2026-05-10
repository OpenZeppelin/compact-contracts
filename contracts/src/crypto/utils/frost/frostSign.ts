// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts v0.0.1-alpha.1 (crypto/utils/frost/frostSign.ts)
//
// FROST K-of-N threshold signing on Jubjub.
//
// Protocol summary (per RFC 9591):
//
//   Round 1 (commit). Each signer i ∈ S samples (d_i, e_i) and publishes
//                     (D_i, E_i) = (d_i·G, e_i·G).
//
//   Round 2 (bind).   Coordinator collects {(i, D_i, E_i) | i ∈ S},
//                     derives ρ_i = H_binding(i, m, list)  for each i,
//                     computes R = Σ_i (D_i + ρ_i·E_i),
//                     computes c = schnorrChallenge(R, P_agg, m).
//
//   Round 3 (sign).   Each signer returns
//                     z_i = (d_i + ρ_i·e_i + λ_i^S · c · s_i)  mod r
//                     where λ_i^S is the Lagrange coefficient for i over S.
//                     Coordinator aggregates σ = Σ_i z_i mod r.
//                     Output (R, σ) — verifies under P_agg as a vanilla
//                     Schnorr signature.
//
// Security NOTE — nonces:
//   Reusing (d_i, e_i) across two distinct messages immediately leaks s_i.
//   This module enforces single-use via a `NonceHandle` that's consumed by
//   `frostPartialSign` — calling `partialSign` twice on the same handle
//   throws.
//
// Cross-side parity:
//   The challenge c is computed via `schnorrChallenge` from `../jubjubSchnorr.js`
//   — the same function used by the off-chain reference verifier and bit-for-bit
//   matching the on-chain `Schnorr.challenge` circuit. So an aggregated
//   FROST signature `(R, σ)` verifies under the on-chain `Schnorr.verify`
//   without modification.

import {
  type JubjubPoint,
  CompactTypeBytes,
  CompactTypeVector,
  convertFieldToBytes,
  ecAdd,
  ecMul,
  ecMulGenerator,
  jubjubPointX,
  jubjubPointY,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import {
  type JubjubSchnorrSignature,
  schnorrChallenge,
} from '../jubjubSchnorr.js';
import { JUBJUB_SCALAR_ORDER, modJubjubOrder } from '../jubjub.js';
import { lagrangeCoefficient, sampleScalar } from './polynomial.js';

/** A signer's commitment pair `(D_i, E_i)` from round 1. */
export interface NonceCommitment {
  readonly participantId: bigint;
  readonly D: JubjubPoint;
  readonly E: JubjubPoint;
}

/**
 * Stateful handle holding the matching `(d_i, e_i)` secret nonces, plus a
 * one-shot used flag to forbid reuse. `frostPartialSign` consumes the
 * handle — calling it twice throws.
 */
export interface NonceHandle {
  readonly participantId: bigint;
  readonly commitment: NonceCommitment;
  // Mutable flag tracked privately. Deliberately not part of the type to keep
  // it implementation-only.
}

interface NonceHandleInternal extends NonceHandle {
  // Hidden secrets — never leave this module.
  readonly _d: bigint;
  readonly _e: bigint;
  _used: boolean;
}

/**
 * Round 1: sample fresh nonces and produce a commitment `(D_i, E_i)`.
 *
 * The returned `NonceHandle` is opaque from outside the module; pass it
 * verbatim into `frostPartialSign` in round 3. Do NOT log or persist it —
 * its secret nonces, if exfiltrated, expose `s_i` via the Schnorr equation.
 */
export function frostNonceCommit(participantId: bigint): NonceHandle {
  if (participantId <= 0n || participantId >= JUBJUB_SCALAR_ORDER) {
    throw new Error(`frostNonceCommit: participantId ${participantId} out of range`);
  }
  const d = sampleScalar();
  const e = sampleScalar();
  const D = ecMulGenerator(d);
  const E = ecMulGenerator(e);
  const handle: NonceHandleInternal = {
    participantId,
    commitment: { participantId, D, E },
    _d: d,
    _e: e,
    _used: false,
  };
  return handle;
}

/** Public commitment view — what the signer publishes to the coordinator. */
export function nonceCommitmentOf(handle: NonceHandle): NonceCommitment {
  return handle.commitment;
}

/**
 * Compute the binding factor `ρ_i` for participant `i` given message `m` and
 * the full list of round-1 commitments.
 *
 * `ρ_i = persistentHash([
 *           pad32("FROST:Jubjub:bind:v1"),
 *           encodeIndex(i),
 *           m,
 *           encodedBindingList(commitments)
 *        ]) mod r`
 *
 * Pure function — every participant computes the same `ρ_i` when given the
 * same `(i, m, sortedCommitments)`.
 *
 * @throws if `commitments` does not contain an entry for `i`.
 */
export function frostBindingFactor(
  i: bigint,
  message: Uint8Array,
  commitments: readonly NonceCommitment[],
): bigint {
  if (!commitments.some((c) => c.participantId === i)) {
    throw new Error(`frostBindingFactor: participant ${i} not in commitments`);
  }
  if (message.length !== 32) {
    throw new Error(
      `frostBindingFactor: message must be 32 bytes, got ${message.length}`,
    );
  }
  const sorted = sortCommitments(commitments);
  const blob = encodeBindingPreimage(i, message, sorted);
  // SHA-256 → reduce mod r. Hash output is Bytes<32>; interpret as big-endian
  // integer and reduce.
  const rt = new CompactTypeBytes(blob.length);
  // We can't use persistentHash<T>([...]) for a variable-length Vector here,
  // so we hash the concatenated blob as a single Bytes<n> input.
  const hashOut = persistentHash(rt, blob);
  let acc = 0n;
  for (const b of hashOut) acc = (acc << 8n) | BigInt(b);
  const reduced = modJubjubOrder(acc);
  // ρ = 0 would zero the binding term; rejection-handle the (≈ 1/2^252)
  // unlikely case by adding 1, preserving uniqueness across participants.
  // For practical purposes this never happens with a real hash.
  return reduced === 0n ? 1n : reduced;
}

/**
 * Compute the group commitment `R = Σ_i (D_i + ρ_i·E_i)` for the signer set.
 *
 * `commitments` and `bindings` MUST be index-aligned — `bindings[k]` is the
 * binding factor for `commitments[k].participantId`.
 */
export function frostGroupCommitment(
  commitments: readonly NonceCommitment[],
  bindings: readonly bigint[],
): JubjubPoint {
  if (commitments.length !== bindings.length) {
    throw new Error(
      `frostGroupCommitment: commitments (${commitments.length}) and bindings (${bindings.length}) must align`,
    );
  }
  if (commitments.length === 0) {
    throw new Error('frostGroupCommitment: empty commitment set');
  }
  let R: JubjubPoint | null = null;
  for (let k = 0; k < commitments.length; k++) {
    const { D, E } = commitments[k]!;
    const bindingTerm = ecMul(E, bindings[k]!);
    const slot = ecAdd(D, bindingTerm);
    R = R === null ? slot : ecAdd(R, slot);
  }
  return R!;
}

/**
 * Round 3: produce participant `i`'s partial signature.
 *
 * `z_i = (d_i + ρ_i·e_i + λ_i^S · c · s_i)  mod r`.
 *
 * Consumes the `nonceHandle` — calling this twice on the same handle throws.
 *
 * @param nonceHandle - From `frostNonceCommit`. Single-use.
 * @param secretShare - This participant's DKG secret share `s_i`.
 * @param signerSet   - The full signer subset `S` (sorted, distinct ParticipantIds).
 *                      MUST include `nonceHandle.participantId`.
 * @param bindingFactor - `ρ_i` for this participant. Compute via `frostBindingFactor`.
 * @param challenge   - `c` = `schnorrChallenge(R, P_agg, m)`. Compute once,
 *                      pass to every participant.
 */
export function frostPartialSign(
  nonceHandle: NonceHandle,
  secretShare: bigint,
  signerSet: readonly bigint[],
  bindingFactor: bigint,
  challenge: bigint,
): bigint {
  const internal = nonceHandle as NonceHandleInternal;
  if (internal._used) {
    throw new Error(
      `frostPartialSign: nonce handle for participant ${internal.participantId} has already been consumed; nonce reuse is forbidden`,
    );
  }
  internal._used = true;

  const i = internal.participantId;
  const lambda = lagrangeCoefficient(i, signerSet);
  const term1 = internal._d;
  const term2 = modJubjubOrder(bindingFactor * internal._e);
  const term3 = modJubjubOrder(modJubjubOrder(lambda * challenge) * secretShare);
  return modJubjubOrder(term1 + term2 + term3);
}

/**
 * Aggregate K partial signatures into a single Schnorr signature scalar.
 * `σ = Σ_i z_i mod r`.
 */
export function frostAggregateScalars(zs: readonly bigint[]): bigint {
  let acc = 0n;
  for (const z of zs) acc = modJubjubOrder(acc + z);
  return acc;
}

/**
 * Bundle the aggregated `(R, σ)` into a `JubjubSchnorrSignature` object —
 * the same shape that `crypto/Schnorr.compact` and the off-chain
 * `jubjubVerify` reference accept.
 */
export function frostAssembleSignature(
  R: JubjubPoint,
  sigma: bigint,
): JubjubSchnorrSignature {
  return { R, sigma };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const BINDING_DOMAIN_TAG = 'FROST:Jubjub:bind:v1';

function sortCommitments(
  commitments: readonly NonceCommitment[],
): NonceCommitment[] {
  const copy = [...commitments];
  copy.sort((a, b) => (a.participantId < b.participantId ? -1 : 1));
  return copy;
}

function encodeBindingPreimage(
  i: bigint,
  message: Uint8Array,
  sortedCommitments: readonly NonceCommitment[],
): Uint8Array {
  // Layout: domain(32) || index(32) || message(32) || forEach(idx32, Dx32, Dy32, Ex32, Ey32)
  // Each Field is 32 bytes via convertFieldToBytes.
  const perCommitment = 32 + 32 + 32 + 32 + 32; // 160 bytes
  const total = 32 + 32 + 32 + sortedCommitments.length * perCommitment;
  const buf = new Uint8Array(total);
  let off = 0;

  buf.set(padRight32(BINDING_DOMAIN_TAG), off); off += 32;
  buf.set(convertFieldToBytes(32, i, ''), off); off += 32;
  buf.set(message, off); off += 32;

  for (const c of sortedCommitments) {
    buf.set(convertFieldToBytes(32, c.participantId, ''), off); off += 32;
    buf.set(convertFieldToBytes(32, jubjubPointX(c.D), ''), off); off += 32;
    buf.set(convertFieldToBytes(32, jubjubPointY(c.D), ''), off); off += 32;
    buf.set(convertFieldToBytes(32, jubjubPointX(c.E), ''), off); off += 32;
    buf.set(convertFieldToBytes(32, jubjubPointY(c.E), ''), off); off += 32;
  }
  return buf;
}

function padRight32(s: string): Uint8Array {
  const enc = new TextEncoder().encode(s);
  if (enc.length > 32) throw new Error('padRight32: too long');
  const out = new Uint8Array(32);
  out.set(enc, 0);
  return out;
}
