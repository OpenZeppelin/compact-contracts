// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts v0.0.1-alpha.1 (crypto/utils/frost/dkg.ts)
//
// Pedersen-VSS based Distributed Key Generation (DKG) over the Jubjub curve.
//
// Each of N participants:
//   1. Samples a random polynomial f_i of degree threshold-1.
//   2. Publishes coefficient commitments C_{i,j} = a_{i,j} * G.
//   3. Sends private shares s_{i→j} = f_i(j) to every other participant.
//   4. Verifies all received shares against the senders' commitments.
//   5. Locally computes:
//        secret share s_j = Σ_i s_{i→j}        (mod r)
//        aggregated public key P_agg = Σ_i C_{i,0}.
//
// The aggregated public key has secret s_agg = Σ_i a_{i,0} (the sum of every
// participant's constant term). No single participant ever learns s_agg —
// that's the security property Pedersen DKG buys over a trusted dealer.
//
// This implementation runs all participants synchronously in-process for
// testing. Production use requires a real message-passing layer with retry
// and Byzantine-fault-tolerance handling — explicitly out of scope here.
// See `multisig/scheme-e1-frost.md` § "Phasing".

import {
  type JubjubPoint,
  ecAdd,
  ecMul,
  ecMulGenerator,
  jubjubPointX,
  jubjubPointY,
} from '@midnight-ntwrk/compact-runtime';
import { JUBJUB_SCALAR_ORDER, modJubjubOrder } from '../jubjub.js';
import {
  evalPoly,
  randomPolynomial,
} from './polynomial.js';

/** Identifier for a DKG participant. Must be a non-zero scalar in Fr. */
export type ParticipantId = bigint;

/**
 * What a participant publishes (commitments) plus what they secretly send to
 * each peer (shares). In the in-process simulator both are gathered together;
 * in a real network commitments would be broadcast and shares would be
 * transmitted through point-to-point secure channels.
 */
export interface DkgProposal {
  readonly fromId: ParticipantId;
  /**
   * `commitments[k] = a_k * G` for the polynomial `f(x) = a_0 + a_1*x + ...`.
   * Length is `threshold` (i.e. `degree + 1`).
   */
  readonly commitments: readonly JubjubPoint[];
  /**
   * `shares.get(j) = f(j) mod r` — the share to send privately to participant `j`.
   * Includes self (`j == fromId`) so the protocol logic is uniform.
   */
  readonly shares: ReadonlyMap<ParticipantId, bigint>;
}

/**
 * Final per-participant DKG output after verifying everyone's contributions.
 */
export interface DkgFinalState {
  readonly myId: ParticipantId;
  /** This participant's secret share `s_j = Σ_i f_i(j) mod r`. Sensitive. */
  readonly secretShare: bigint;
  /** Aggregated public key `P_agg = Σ_i a_{i,0} * G`. Public. */
  readonly aggregatedKey: JubjubPoint;
  /** The full set of every participant's published coefficient commitments. */
  readonly allCommitments: ReadonlyMap<ParticipantId, readonly JubjubPoint[]>;
}

/**
 * Step 1 of DKG (per participant).
 *
 * Samples a random polynomial of degree `threshold - 1`, computes the
 * coefficient commitments, and computes the per-peer shares.
 *
 * Returns the proposal object that this participant should publish (the
 * commitments) and privately distribute (the shares) to every peer.
 */
export function dkgPropose(
  myId: ParticipantId,
  participantIds: readonly ParticipantId[],
  threshold: number,
): DkgProposal {
  validateParticipantIds(participantIds);
  if (!participantIds.includes(myId)) {
    throw new Error(`dkgPropose: myId ${myId} not in participant set`);
  }
  if (threshold < 1 || threshold > participantIds.length) {
    throw new Error(
      `dkgPropose: threshold ${threshold} out of range for ${participantIds.length} participants`,
    );
  }

  const coeffs = randomPolynomial(threshold - 1);
  const commitments = coeffs.map((c) => ecMulGenerator(c));
  const shares = new Map<ParticipantId, bigint>();
  for (const j of participantIds) {
    shares.set(j, evalPoly(coeffs, j));
  }
  return { fromId: myId, commitments, shares };
}

/**
 * Step 2 of DKG (per participant).
 *
 * Given every peer's proposal (commitments + the share that peer sent to me),
 * verify each share against its sender's commitments, then locally compute
 * my secret share and the aggregated public key.
 *
 * Throws if any received share fails the commitment check — that participant
 * is provably misbehaving (or the messages were tampered with).
 */
export function dkgVerifyAndFinalize(
  myId: ParticipantId,
  participantIds: readonly ParticipantId[],
  proposalsFromEveryone: readonly DkgProposal[],
): DkgFinalState {
  validateParticipantIds(participantIds);
  if (!participantIds.includes(myId)) {
    throw new Error(`dkgVerifyAndFinalize: myId ${myId} not in participant set`);
  }
  if (proposalsFromEveryone.length !== participantIds.length) {
    throw new Error(
      `dkgVerifyAndFinalize: expected ${participantIds.length} proposals, got ${proposalsFromEveryone.length}`,
    );
  }
  // Reject duplicates / unknown senders.
  const seenSenders = new Set<ParticipantId>();
  for (const p of proposalsFromEveryone) {
    if (!participantIds.includes(p.fromId)) {
      throw new Error(`dkgVerifyAndFinalize: unknown sender ${p.fromId}`);
    }
    if (seenSenders.has(p.fromId)) {
      throw new Error(`dkgVerifyAndFinalize: duplicate proposal from ${p.fromId}`);
    }
    seenSenders.add(p.fromId);
  }

  // Verify each peer's share-to-me against their published commitments,
  // and accumulate the aggregated public key + my secret share.
  let mySecret = 0n;
  let aggregatedKey: JubjubPoint | null = null;
  const allCommitments = new Map<ParticipantId, readonly JubjubPoint[]>();

  for (const proposal of proposalsFromEveryone) {
    const myShareFromThem = proposal.shares.get(myId);
    if (myShareFromThem === undefined) {
      throw new Error(
        `dkgVerifyAndFinalize: proposal from ${proposal.fromId} is missing the share for me (${myId})`,
      );
    }
    assertShareConsistent(myId, myShareFromThem, proposal.commitments, proposal.fromId);

    mySecret = modJubjubOrder(mySecret + myShareFromThem);
    aggregatedKey =
      aggregatedKey === null
        ? proposal.commitments[0]!
        : ecAdd(aggregatedKey, proposal.commitments[0]!);
    allCommitments.set(proposal.fromId, proposal.commitments);
  }

  if (aggregatedKey === null) {
    throw new Error('dkgVerifyAndFinalize: no proposals contributed to aggregated key');
  }

  return {
    myId,
    secretShare: mySecret,
    aggregatedKey,
    allCommitments,
  };
}

/**
 * Verify that `f_fromId(myId) * G == Σ_k myId^k * commitments[k]`.
 *
 * If this passes, the share `myShareFromThem` is consistent with the public
 * commitments — i.e. the sender did NOT lie about their polynomial.
 *
 * Throws on mismatch; returns void on success.
 */
function assertShareConsistent(
  myId: ParticipantId,
  myShareFromThem: bigint,
  senderCommitments: readonly JubjubPoint[],
  senderId: ParticipantId,
): void {
  if (myShareFromThem < 0n || myShareFromThem >= JUBJUB_SCALAR_ORDER) {
    throw new Error(
      `dkg: share from ${senderId} to ${myId} is out of range`,
    );
  }
  // Expected: share * G.
  const expected = ecMulGenerator(myShareFromThem);

  // Computed from commitments: Σ_k myId^k * C_k via Horner.
  // We work top-down: acc = C_n; for k from n-1 downto 0: acc = myId * acc + C_k.
  // Translated to EC: acc' = myId * acc, then acc'' = acc' + C_k.
  if (senderCommitments.length === 0) {
    throw new Error(`dkg: sender ${senderId} published zero commitments`);
  }
  let acc: JubjubPoint = senderCommitments[senderCommitments.length - 1]!;
  for (let k = senderCommitments.length - 2; k >= 0; k--) {
    acc = ecMul(acc, myId);
    acc = ecAdd(acc, senderCommitments[k]!);
  }

  if (!pointsEqualLocal(expected, acc)) {
    throw new Error(
      `dkg: share from participant ${senderId} to ${myId} does not match commitments`,
    );
  }
}

function pointsEqualLocal(a: JubjubPoint, b: JubjubPoint): boolean {
  return jubjubPointX(a) === jubjubPointX(b) && jubjubPointY(a) === jubjubPointY(b);
}

function validateParticipantIds(ids: readonly ParticipantId[]): void {
  if (ids.length === 0) {
    throw new Error('participantIds: must be non-empty');
  }
  const seen = new Set<ParticipantId>();
  for (const id of ids) {
    if (id <= 0n || id >= JUBJUB_SCALAR_ORDER) {
      throw new Error(`participantIds: id ${id} out of range`);
    }
    if (seen.has(id)) {
      throw new Error(`participantIds: duplicate id ${id}`);
    }
    seen.add(id);
  }
}

/**
 * Convenience: run a full Pedersen DKG round in-process across `participantIds`
 * for a `K-of-N` configuration. Returns each participant's `DkgFinalState`.
 *
 * In a real deployment this orchestration would be done by a network protocol;
 * for test/research use we run it synchronously.
 */
export function runDkgInProcess(
  participantIds: readonly ParticipantId[],
  threshold: number,
): DkgFinalState[] {
  // Phase A: each proposes.
  const proposals: DkgProposal[] = participantIds.map((id) =>
    dkgPropose(id, participantIds, threshold),
  );

  // Phase B: each verifies + finalizes using everyone's proposals.
  return participantIds.map((id) =>
    dkgVerifyAndFinalize(id, participantIds, proposals),
  );
}
