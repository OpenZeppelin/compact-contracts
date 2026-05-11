// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts v0.0.1-alpha.1 (crypto/utils/jubjubRingSign.ts)
//
// Off-chain K-of-N Schnorr ring signature prover + reference verifier on the
// Jubjub embedded curve. Cryptographic basis: Cramer-Damgård-Schoenmakers
// (1994) "Proofs of partial knowledge" — a witness-indistinguishable
// Σ-protocol over the OR-composition `{∃ sᵢ : Pᵢ = sᵢ·G}` for `i ∈ {0..N-1}`,
// generalised to K-of-N via uniform challenge splitting.
//
// Signature shape (sent on-chain): `(R[N], σ[N], c[N])` where every slot
// individually satisfies `σᵢ·G == Rᵢ + cᵢ·Pᵢ` AND the challenges sum to the
// global Fiat-Shamir challenge: `Σ cᵢ ≡ cGlobal (mod r_jubjub)`. The verifier
// can't tell which K of N indices are the "honest" signers.
//
// This module is the off-chain counterpart of `crypto/JubjubSchnorrRing.compact`.
// Cross-side parity is pinned by the unit-test suite via the simulator.

import {
  CompactTypeBytes,
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
import { sampleScalar } from './frost/polynomial.js';
import {
  fitInJubjubScalar,
  isIdentity,
  modAdd,
  modJubjubOrder,
  modMul,
  modNeg,
  modSub,
} from './jubjub.js';

/**
 * Domain tag baked into the ring-signature challenge preimage. MUST match
 * the literal in `contracts/src/crypto/JubjubSchnorrRing.compact` exactly,
 * encoded as a 32-byte right-padded ASCII string (Compact's `pad(32, ...)`).
 *
 * Distinct from `"Schnorr:Jubjub:v1"` so a ring-style proof can never be
 * replayed as a plain single-signer Schnorr signature on the same curve.
 */
const RING_DOMAIN_TAG: Uint8Array = padRight32('RingSig:Jubjub:v1');

/**
 * A Schnorr K-of-N ring signature on Jubjub. All three arrays have length N
 * (the ring size). On-chain order matters — `R[i]`, `sigma[i]`, `c[i]` all
 * correspond to ring slot `i`. There is no in-band marker of which slots are
 * the K honest signers; that is precisely what witness-indistinguishability
 * hides.
 */
export interface JubjubRingSignature {
  readonly R: JubjubPoint[];
  readonly sigma: bigint[];
  readonly c: bigint[];
}

/**
 * One honest signer's identifying material. `index` is their 0-based slot in
 * the ring (must match the ring slot whose public key is `secret · G`).
 */
export interface HonestSigner {
  readonly index: number;
  readonly secret: bigint;
}

/**
 * Compute the global Fiat-Shamir challenge for a ring signature.
 *
 * Chained Poseidon — must byte-match the on-chain `JubjubSchnorrRing.challenge`
 * circuit's `fold`-based derivation:
 *
 *   acc₀ = degradeToTransient(domain_tag)
 *   acc_{i+1} = Poseidon(acc_i, R[i].x, R[i].y)   for i ∈ [0, N)
 *   cFull = Poseidon(acc_N, msg)
 *   return fitInJubjubScalar(cFull)
 *
 * The ring public keys are intentionally NOT folded in: they are pinned by
 * the contract state (`_ring`), and the per-slot verify equation already
 * binds each `cᵢ` to its `Pᵢ`. Including them in the hash would be
 * defence-in-depth only and adds Poseidon cost for no security gain in this
 * construction.
 */
export function ringChallenge(
  R: readonly JubjubPoint[],
  message: Uint8Array,
): bigint {
  if (message.length !== 32) {
    throw new Error(
      `ringChallenge: message must be 32 bytes, got ${message.length}`,
    );
  }
  const N = R.length;
  if (N < 1) {
    throw new Error('ringChallenge: ring must be non-empty');
  }
  const rtType3 = new CompactTypeVector(3, CompactTypeField);
  const rtType2 = new CompactTypeVector(2, CompactTypeField);
  let acc = degradeToTransient(RING_DOMAIN_TAG);
  for (let i = 0; i < N; i++) {
    acc = transientHash(rtType3, [
      acc,
      jubjubPointX(R[i]!),
      jubjubPointY(R[i]!),
    ]);
  }
  const cFull = transientHash(rtType2, [acc, degradeToTransient(message)]);
  return fitInJubjubScalar(cFull);
}

/**
 * Produce a K-of-N Schnorr ring signature on Jubjub.
 *
 * The `honestSigners` array gives the K secret-key holders; their `index`
 * fields must be distinct and each must match the slot whose public key is
 * the corresponding secret's generator multiple (`ecMulGenerator(secret) ==
 * ring[index]`).
 *
 * For K=1 the protocol is fully non-interactive — a single signer simulates
 * the other N-1 slots themselves. For K≥2 the (in-process) coordinator below
 * performs one round of inter-signer coordination: the K-1 "non-leader"
 * honest signers draw their `cᵢ` uniformly at random, the leader (lowest
 * index) computes their `c` deterministically so the per-slot challenges sum
 * to the global challenge. All K honest signers then compute their `σᵢ`
 * locally from `(rᵢ, cᵢ, sᵢ)`.
 *
 * The output is a uniformly-distributed witness-indistinguishable artefact:
 * given only the public ring and the signature, no PPT distinguisher tells
 * which K slots are honest.
 */
export function ringSign(
  honestSigners: readonly HonestSigner[],
  ring: readonly JubjubPoint[],
  message: Uint8Array,
): JubjubRingSignature {
  const N = ring.length;
  const K = honestSigners.length;

  validateInputs(honestSigners, ring, message, N, K);

  const honestIndices = honestSigners.map((s) => s.index).sort((a, b) => a - b);
  const honestSet = new Set(honestIndices);
  const fakeIndices: number[] = [];
  for (let i = 0; i < N; i++) {
    if (!honestSet.has(i)) fakeIndices.push(i);
  }

  // Per-slot signature pieces (filled in as we go).
  const R: JubjubPoint[] = new Array(N);
  const sigma: bigint[] = new Array(N);
  const c: bigint[] = new Array(N);

  // 1. For each fake slot j: simulate a valid Schnorr equation by picking
  //    σⱼ, cⱼ uniformly and back-computing Rⱼ = σⱼ·G − cⱼ·Pⱼ.
  for (const j of fakeIndices) {
    sigma[j] = sampleScalar();
    c[j] = sampleScalar();
    const term1 = ecMulGenerator(sigma[j]!);
    const term2 = ecMul(ring[j]!, modNeg(c[j]!));
    R[j] = ecAdd(term1, term2);
  }

  // 2. Each honest signer i: pick fresh nonce rᵢ, set Rᵢ = rᵢ·G.
  //    `nonces` is keyed by ring index for later σ computation.
  const nonces = new Map<number, bigint>();
  for (const { index } of honestSigners) {
    const r = sampleScalar();
    nonces.set(index, r);
    R[index] = ecMulGenerator(r);
  }

  // 3. Compute the global challenge from all R's + msg.
  const cGlobal = ringChallenge(R, message);

  // 4. Split the remaining challenge among the honest signers.
  //    The K-1 "non-leader" honest signers pick cᵢ uniformly; the leader
  //    (lowest honest index) computes their c to close the sum.
  //
  //    Witness-indistinguishability holds because:
  //    - cⱼ for fakes are uniform by construction
  //    - cᵢ for non-leader honest signers are uniform by construction
  //    - leader's c is uniform conditioned on the others, given cGlobal is
  //      from a random oracle on the Rᵢ's
  let cFakeSum = 0n;
  for (const j of fakeIndices) cFakeSum = modAdd(cFakeSum, c[j]!);
  let cHonestRemaining = modSub(cGlobal, cFakeSum);

  const leaderIndex = honestIndices[0]!;
  for (let k = 1; k < honestIndices.length; k++) {
    const i = honestIndices[k]!;
    c[i] = sampleScalar();
    cHonestRemaining = modSub(cHonestRemaining, c[i]!);
  }
  c[leaderIndex] = cHonestRemaining;

  // 5. Each honest signer i: response σᵢ = rᵢ + cᵢ·sᵢ (mod r_jubjub).
  for (const { index, secret } of honestSigners) {
    const r = nonces.get(index)!;
    sigma[index] = modAdd(r, modMul(c[index]!, modJubjubOrder(secret)));
  }

  return { R, sigma, c };
}

/**
 * Off-chain reference verifier for a Jubjub K-of-N ring signature. Mirrors
 * the on-chain `JubjubSchnorrRing.verify` circuit, including:
 *  - identity-point rejection on every ring slot
 *  - global challenge recomputation from R's + msg
 *  - per-slot equation `σᵢ·G == Rᵢ + cᵢ·Pᵢ`
 *  - sum-check `Σ cᵢ ≡ cGlobal (mod r_jubjub)` lifted to the curve as
 *    `Σ cᵢ·G == cGlobal·G` (so the check lives entirely in the Jubjub group)
 */
export function ringVerify(
  ring: readonly JubjubPoint[],
  message: Uint8Array,
  sig: JubjubRingSignature,
): boolean {
  const N = ring.length;
  if (sig.R.length !== N || sig.sigma.length !== N || sig.c.length !== N) {
    return false;
  }
  for (let i = 0; i < N; i++) {
    if (isIdentity(ring[i]!) || isIdentity(sig.R[i]!)) return false;
  }

  const cGlobal = ringChallenge(sig.R, message);

  // Per-slot equations.
  for (let i = 0; i < N; i++) {
    const lhs = ecMulGenerator(sig.sigma[i]!);
    const rhs = ecAdd(sig.R[i]!, ecMul(ring[i]!, sig.c[i]!));
    if (
      jubjubPointX(lhs) !== jubjubPointX(rhs) ||
      jubjubPointY(lhs) !== jubjubPointY(rhs)
    ) {
      return false;
    }
  }

  // Sum-check via EC point comparison (lifts the mod r_jubjub equality
  // out of Compact's native BLS12-381-Fr arithmetic).
  let cSumPoint: JubjubPoint | undefined;
  for (let i = 0; i < N; i++) {
    const term = ecMulGenerator(sig.c[i]!);
    cSumPoint = cSumPoint === undefined ? term : ecAdd(cSumPoint, term);
  }
  const cGlobalPoint = ecMulGenerator(cGlobal);
  return (
    cSumPoint !== undefined &&
    jubjubPointX(cSumPoint) === jubjubPointX(cGlobalPoint) &&
    jubjubPointY(cSumPoint) === jubjubPointY(cGlobalPoint)
  );
}

// ─── Internals ──────────────────────────────────────────────────────────────

function validateInputs(
  honestSigners: readonly HonestSigner[],
  ring: readonly JubjubPoint[],
  message: Uint8Array,
  N: number,
  K: number,
): void {
  if (message.length !== 32) {
    throw new Error(
      `ringSign: message must be 32 bytes, got ${message.length}`,
    );
  }
  if (N < 2) {
    throw new Error(`ringSign: ring must have at least 2 members (got ${N})`);
  }
  if (K < 1 || K > N) {
    throw new Error(
      `ringSign: threshold K must be in [1, N=${N}] (got ${K})`,
    );
  }
  const seen = new Set<number>();
  for (const { index, secret } of honestSigners) {
    if (index < 0 || index >= N) {
      throw new Error(
        `ringSign: honest-signer index ${index} out of range [0, ${N})`,
      );
    }
    if (seen.has(index)) {
      throw new Error(
        `ringSign: duplicate honest-signer index ${index}`,
      );
    }
    seen.add(index);
    if (modJubjubOrder(secret) === 0n) {
      throw new Error(
        `ringSign: honest-signer at index ${index} has zero secret`,
      );
    }
    // Spot-check: secret · G == ring[index]. Catches off-by-one slot bugs
    // before they manifest as opaque verification failures.
    const expectedPk = ecMulGenerator(modJubjubOrder(secret));
    const declaredPk = ring[index]!;
    if (
      jubjubPointX(expectedPk) !== jubjubPointX(declaredPk) ||
      jubjubPointY(expectedPk) !== jubjubPointY(declaredPk)
    ) {
      throw new Error(
        `ringSign: secret at index ${index} does not match ring[${index}]`,
      );
    }
  }
  for (let i = 0; i < N; i++) {
    if (isIdentity(ring[i]!)) {
      throw new Error(
        `ringSign: ring slot ${i} is the curve identity (not allowed)`,
      );
    }
  }
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

// Re-export for callers building per-domain message hashes that want to
// match `persistentHash<Vector<N, Bytes<32>>>` from Compact.
export { CompactTypeBytes };
