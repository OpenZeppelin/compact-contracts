// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts v0.0.1-alpha.1 (crypto/utils/frost/frostCoordinator.ts)
//
// In-process orchestration of the FROST 3-round signing protocol.
//
// In a real deployment the rounds happen across a network with the
// coordinator routing messages. For tests + demos we drive all signers
// inside one JS process.

import {
  type JubjubPoint,
  jubjubPointX,
  jubjubPointY,
} from '@midnight-ntwrk/compact-runtime';
import {
  type JubjubSchnorrSignature,
  schnorrChallenge,
} from '../jubjubSchnorr.js';
import type { DkgFinalState, ParticipantId } from './dkg.js';
import {
  type NonceCommitment,
  type NonceHandle,
  frostAggregateScalars,
  frostAssembleSignature,
  frostBindingFactor,
  frostGroupCommitment,
  frostNonceCommit,
  frostPartialSign,
  nonceCommitmentOf,
} from './frostSign.js';

/**
 * Per-signer in-process state held during a single signing run.
 */
interface SignerState {
  readonly dkg: DkgFinalState;
  readonly nonceHandle: NonceHandle;
  readonly commitment: NonceCommitment;
}

/**
 * Run the full FROST signing protocol in-process.
 *
 * Pre-conditions:
 *   - Every entry of `dkgStates` MUST share the same `aggregatedKey` —
 *     that's what the DKG ceremony agrees on. Mixed states indicate the
 *     callers ran different DKG instances.
 *   - `signerSubset` MUST be a subset of `dkgStates`'s participant IDs of
 *     size at least the threshold (FROST K-of-N).
 *
 * The coordinator does NOT hold secret shares — those stay inside each
 * signer's `dkg.secretShare`. The coordinator only sees public commitments
 * and aggregated outputs.
 *
 * @returns the aggregated Schnorr signature `(R, σ)`, plus the aggregated
 *   public key (for the caller's convenience — it's identical to every
 *   signer's `dkg.aggregatedKey`).
 */
export function runFrostSigning(
  dkgStates: readonly DkgFinalState[],
  signerSubset: readonly ParticipantId[],
  message: Uint8Array,
): {
  signature: JubjubSchnorrSignature;
  aggregatedKey: JubjubPoint;
  groupCommitment: JubjubPoint;
} {
  if (dkgStates.length === 0) {
    throw new Error('runFrostSigning: empty dkgStates');
  }
  if (signerSubset.length === 0) {
    throw new Error('runFrostSigning: empty signer subset');
  }
  // Sanity: agreement on the aggregated public key across DKG outputs.
  const aggregatedKey = dkgStates[0]!.aggregatedKey;
  for (const s of dkgStates) {
    if (
      s.aggregatedKey !== aggregatedKey &&
      !pointsLooseEqual(s.aggregatedKey, aggregatedKey)
    ) {
      throw new Error(
        `runFrostSigning: DKG states disagree on aggregated key — participant ${s.myId} differs`,
      );
    }
  }

  // Resolve subset → DKG states. Order matters: coordinator computes binding
  // factors over a sorted-by-participant-id view to keep it canonical.
  const subset = [...signerSubset].sort((a, b) => (a < b ? -1 : 1));
  const seen = new Set<ParticipantId>();
  for (const id of subset) {
    if (seen.has(id)) {
      throw new Error(`runFrostSigning: duplicate participant ${id} in subset`);
    }
    seen.add(id);
  }
  const signers: SignerState[] = subset.map((id) => {
    const dkg = dkgStates.find((s) => s.myId === id);
    if (!dkg) {
      throw new Error(`runFrostSigning: subset includes unknown participant ${id}`);
    }
    const nonceHandle = frostNonceCommit(id);
    return { dkg, nonceHandle, commitment: nonceCommitmentOf(nonceHandle) };
  });

  // Round 2: coordinator computes binding factors, group commitment, challenge.
  const commitments = signers.map((s) => s.commitment);
  const bindings = subset.map((id) =>
    frostBindingFactor(id, message, commitments),
  );
  const groupCommitment = frostGroupCommitment(commitments, bindings);
  const challenge = schnorrChallenge(groupCommitment, aggregatedKey, message);

  // Round 3: each signer produces their partial signature.
  const partials: bigint[] = [];
  for (let k = 0; k < signers.length; k++) {
    const s = signers[k]!;
    const z = frostPartialSign(
      s.nonceHandle,
      s.dkg.secretShare,
      subset,
      bindings[k]!,
      challenge,
    );
    partials.push(z);
  }

  // Aggregate.
  const sigma = frostAggregateScalars(partials);
  const signature = frostAssembleSignature(groupCommitment, sigma);

  return { signature, aggregatedKey, groupCommitment };
}

function pointsLooseEqual(a: JubjubPoint, b: JubjubPoint): boolean {
  // Coordinate-by-coordinate comparison. (JSON.stringify can't handle the
  // bigint coordinate fields; equality via the runtime accessors is the
  // canonical path used everywhere else in the package.)
  return jubjubPointX(a) === jubjubPointX(b) && jubjubPointY(a) === jubjubPointY(b);
}
