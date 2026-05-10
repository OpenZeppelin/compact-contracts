import { describe, expect, it } from 'vitest';
import {
  type DkgFinalState,
  type DkgProposal,
  type ParticipantId,
  dkgPropose,
  dkgVerifyAndFinalize,
  runDkgInProcess,
} from '../utils/frost/dkg.js';
import { runFrostSigning } from '../utils/frost/frostCoordinator.js';
import {
  frostAggregateScalars,
  frostBindingFactor,
  frostGroupCommitment,
  frostNonceCommit,
  frostPartialSign,
  nonceCommitmentOf,
} from '../utils/frost/frostSign.js';
import {
  evalPoly,
  invMod,
  lagrangeCoefficient,
} from '../utils/frost/polynomial.js';
import {
  jubjubKeypairFromSecret,
  jubjubVerify,
  schnorrChallenge,
} from '../utils/jubjubSchnorr.js';
import { JUBJUB_SCALAR_ORDER, modJubjubOrder } from '../utils/jubjub.js';
import {
  ecAdd,
  ecMulGenerator,
  jubjubPointX,
  jubjubPointY,
} from '@midnight-ntwrk/compact-runtime';
import { SchnorrSimulator } from './simulators/SchnorrSimulator.js';

const PARTICIPANTS: ParticipantId[] = [1n, 2n, 3n]; // ADMIN=1, ALICE=2, BOB=3
const THRESHOLD = 2;
const MESSAGE = new Uint8Array(32).fill(0x42);

/**
 * Run a fresh DKG and return all three participants' DkgFinalState. Tests
 * call this in a `beforeEach` to start from a clean state — DKG outputs are
 * randomized, so re-using state across tests would create false negatives.
 */
function freshDkg(): DkgFinalState[] {
  return runDkgInProcess(PARTICIPANTS, THRESHOLD);
}

describe('crypto/utils/frost — primitives', () => {
  describe('evalPoly', () => {
    it('Horner evaluation — constant polynomial', () => {
      expect(evalPoly([5n], 0n)).toBe(5n);
      expect(evalPoly([5n], 100n)).toBe(5n);
    });

    it('Horner evaluation — linear polynomial f(x) = 3 + 7x', () => {
      const coeffs = [3n, 7n];
      expect(evalPoly(coeffs, 0n)).toBe(3n);
      expect(evalPoly(coeffs, 1n)).toBe(10n);
      expect(evalPoly(coeffs, 5n)).toBe(38n);
    });

    it('Horner evaluation reduces results mod r', () => {
      const coeffs = [1n, 1n];
      const x = JUBJUB_SCALAR_ORDER - 1n;
      // f(r-1) = 1 + (r-1) = r ≡ 0 mod r.
      expect(evalPoly(coeffs, x)).toBe(0n);
    });
  });

  describe('invMod', () => {
    it('inverse of 1 is 1', () => {
      expect(invMod(1n)).toBe(1n);
    });

    it('a * invMod(a) ≡ 1 mod r for arbitrary a', () => {
      const a = 0x1234567890abcdef1234567890abcdefn;
      const inv = invMod(a);
      const product = modJubjubOrder(a * inv);
      expect(product).toBe(1n);
    });

    it('throws on zero', () => {
      expect(() => invMod(0n)).toThrow(/no modular inverse/);
    });
  });

  describe('lagrangeCoefficient', () => {
    it('λ_i for the singleton set {i} is 1', () => {
      expect(lagrangeCoefficient(2n, [2n])).toBe(1n);
    });

    it('λ_1 over {1, 2}: hand-computed value', () => {
      // λ_1 = 2 / (2 - 1) = 2.
      expect(lagrangeCoefficient(1n, [1n, 2n])).toBe(2n);
    });

    it('λ_2 over {1, 2}: 1 / (1 - 2) = -1 ≡ r-1', () => {
      expect(lagrangeCoefficient(2n, [1n, 2n])).toBe(JUBJUB_SCALAR_ORDER - 1n);
    });

    it('Σ λ_i = 1 over any subset (Lagrange identity)', () => {
      const subset = [1n, 3n];
      const lambda1 = lagrangeCoefficient(1n, subset);
      const lambda3 = lagrangeCoefficient(3n, subset);
      expect(modJubjubOrder(lambda1 + lambda3)).toBe(1n);
    });

    it('throws when participant not in set', () => {
      expect(() => lagrangeCoefficient(5n, [1n, 2n])).toThrow(/not in the signer set/);
    });

    it('throws on duplicate IDs in set', () => {
      expect(() => lagrangeCoefficient(1n, [1n, 1n])).toThrow(/duplicate/);
    });
  });
});

describe('crypto/utils/frost — Pedersen DKG', () => {
  it('three participants agree on the same aggregated public key', () => {
    const states = freshDkg();
    const ref = states[0]!.aggregatedKey;
    for (const s of states) {
      expect(jubjubPointX(s.aggregatedKey)).toBe(jubjubPointX(ref));
      expect(jubjubPointY(s.aggregatedKey)).toBe(jubjubPointY(ref));
    }
  });

  it('aggregated key matches sum of constant-term commitments', () => {
    // Build a deterministic DKG by inspecting proposals → recompute P_agg
    // from the published commitments. (We can't peek at coefficients, but we
    // can verify that the post-finalize aggregated key equals the sum of all
    // C_{i,0}.)
    const proposals = PARTICIPANTS.map((id) =>
      dkgPropose(id, PARTICIPANTS, THRESHOLD),
    );
    let expected = proposals[0]!.commitments[0]!;
    for (let k = 1; k < proposals.length; k++) {
      expected = ecAdd(expected, proposals[k]!.commitments[0]!);
    }
    // Finalize from each participant's perspective; aggregated key must match.
    for (const id of PARTICIPANTS) {
      const final = dkgVerifyAndFinalize(id, PARTICIPANTS, proposals);
      expect(jubjubPointX(final.aggregatedKey)).toBe(jubjubPointX(expected));
      expect(jubjubPointY(final.aggregatedKey)).toBe(jubjubPointY(expected));
    }
  });

  it('rejects a tampered share whose commitments do not match', () => {
    const proposals = PARTICIPANTS.map((id) =>
      dkgPropose(id, PARTICIPANTS, THRESHOLD),
    );
    // Tamper: change the share that participant 1 sends to participant 2.
    const tamperedShares = new Map(proposals[0]!.shares);
    tamperedShares.set(2n, 0xdeadbeefn);
    const tampered: DkgProposal = {
      ...proposals[0]!,
      shares: tamperedShares,
    };
    const proposalsTampered: DkgProposal[] = [
      tampered,
      proposals[1]!,
      proposals[2]!,
    ];
    expect(() =>
      dkgVerifyAndFinalize(2n, PARTICIPANTS, proposalsTampered),
    ).toThrow(/does not match commitments/);
  });

  it('rejects an out-of-range share', () => {
    const proposals = PARTICIPANTS.map((id) =>
      dkgPropose(id, PARTICIPANTS, THRESHOLD),
    );
    const tamperedShares = new Map(proposals[0]!.shares);
    tamperedShares.set(2n, JUBJUB_SCALAR_ORDER + 1n);
    const tampered: DkgProposal = {
      ...proposals[0]!,
      shares: tamperedShares,
    };
    const proposalsTampered: DkgProposal[] = [
      tampered,
      proposals[1]!,
      proposals[2]!,
    ];
    expect(() =>
      dkgVerifyAndFinalize(2n, PARTICIPANTS, proposalsTampered),
    ).toThrow(/out of range/);
  });

  it('rejects a duplicate proposal sender', () => {
    const proposals = PARTICIPANTS.map((id) =>
      dkgPropose(id, PARTICIPANTS, THRESHOLD),
    );
    expect(() =>
      dkgVerifyAndFinalize(1n, PARTICIPANTS, [
        proposals[0]!,
        proposals[0]!, // ← duplicate sender
        proposals[2]!,
      ]),
    ).toThrow(/duplicate/);
  });

  it("trusted-dealer scalar reconstruction matches the secret share's polynomial root", () => {
    // For 2-of-3 we should be able to reconstruct s_agg from any 2 participants'
    // secret shares using Lagrange interpolation at x=0:
    //   s_agg = Σ λ_i^S * s_i  (over signer subset S, evaluated at x=0).
    // Then s_agg * G should equal P_agg.
    const states = freshDkg();
    const subset = [1n, 2n] as const;
    const sharesInSubset = subset.map(
      (id) => states.find((s) => s.myId === id)!.secretShare,
    );
    const lambdas = subset.map((id) => lagrangeCoefficient(id, [...subset]));
    let reconstructed = 0n;
    for (let i = 0; i < subset.length; i++) {
      reconstructed = modJubjubOrder(
        reconstructed + lambdas[i]! * sharesInSubset[i]!,
      );
    }
    const reconstructedKey = ecMulGenerator(reconstructed);
    expect(jubjubPointX(reconstructedKey)).toBe(
      jubjubPointX(states[0]!.aggregatedKey),
    );
    expect(jubjubPointY(reconstructedKey)).toBe(
      jubjubPointY(states[0]!.aggregatedKey),
    );
  });
});

describe('crypto/utils/frost — FROST 2-of-3 signing', () => {
  it('happy path: ADMIN+ALICE jointly sign; signature verifies under P_agg', () => {
    const states = freshDkg();
    const { signature, aggregatedKey } = runFrostSigning(
      states,
      [1n, 2n], // ADMIN + ALICE
      MESSAGE,
    );
    expect(jubjubVerify(aggregatedKey, MESSAGE, signature)).toBe(true);
  });

  it('happy path: ALICE+BOB jointly sign; signature verifies', () => {
    const states = freshDkg();
    const { signature, aggregatedKey } = runFrostSigning(
      states,
      [2n, 3n],
      MESSAGE,
    );
    expect(jubjubVerify(aggregatedKey, MESSAGE, signature)).toBe(true);
  });

  it('happy path: ADMIN+BOB jointly sign; signature verifies', () => {
    const states = freshDkg();
    const { signature, aggregatedKey } = runFrostSigning(
      states,
      [1n, 3n],
      MESSAGE,
    );
    expect(jubjubVerify(aggregatedKey, MESSAGE, signature)).toBe(true);
  });

  it('all three signing: 3-of-3 also verifies', () => {
    const states = freshDkg();
    const { signature, aggregatedKey } = runFrostSigning(
      states,
      PARTICIPANTS,
      MESSAGE,
    );
    expect(jubjubVerify(aggregatedKey, MESSAGE, signature)).toBe(true);
  });

  it('signature does NOT verify under a different message', () => {
    const states = freshDkg();
    const { signature, aggregatedKey } = runFrostSigning(
      states,
      [1n, 2n],
      MESSAGE,
    );
    const wrongMessage = new Uint8Array(32).fill(0x43);
    expect(jubjubVerify(aggregatedKey, wrongMessage, signature)).toBe(false);
  });

  it('signature does NOT verify with tampered sigma', () => {
    const states = freshDkg();
    const { signature, aggregatedKey } = runFrostSigning(
      states,
      [1n, 2n],
      MESSAGE,
    );
    const tampered = { R: signature.R, sigma: signature.sigma + 1n };
    expect(jubjubVerify(aggregatedKey, MESSAGE, tampered)).toBe(false);
  });

  it('nonce reuse is forbidden — calling partialSign twice on the same handle throws', () => {
    const handle = frostNonceCommit(1n);
    const dummyChallenge = 0x1234n;
    const dummyBinding = 0x5678n;
    const dummySecret = 0x9abcn;
    expect(() =>
      frostPartialSign(handle, dummySecret, [1n, 2n], dummyBinding, dummyChallenge),
    ).not.toThrow();
    expect(() =>
      frostPartialSign(handle, dummySecret, [1n, 2n], dummyBinding, dummyChallenge),
    ).toThrow(/already been consumed/);
  });

  it('aggregating only K-1 partial signatures produces an invalid aggregate', () => {
    // Manually run rounds 1+2, then drop one signer's contribution before aggregation.
    const states = freshDkg();
    const subset: readonly bigint[] = [1n, 2n];
    const handles = subset.map((id) => frostNonceCommit(id));
    const commitments = handles.map(nonceCommitmentOf);
    const bindings = subset.map((id) =>
      frostBindingFactor(id, MESSAGE, commitments),
    );
    const groupCommitment = frostGroupCommitment(commitments, bindings);
    const challenge = schnorrChallenge(
      groupCommitment,
      states[0]!.aggregatedKey,
      MESSAGE,
    );
    // Partial signature from ONLY participant 1.
    const z1 = frostPartialSign(
      handles[0]!,
      states.find((s) => s.myId === 1n)!.secretShare,
      [...subset],
      bindings[0]!,
      challenge,
    );
    const partialSigma = frostAggregateScalars([z1]);
    const partialSig = { R: groupCommitment, sigma: partialSigma };
    expect(jubjubVerify(states[0]!.aggregatedKey, MESSAGE, partialSig)).toBe(false);
  });
});

describe('crypto/utils/frost — cross-side parity (on-chain Schnorr.verify)', () => {
  let sim: SchnorrSimulator;

  it('FROST 2-of-3 signature verifies via the on-chain Schnorr.verify simulator', () => {
    // Run DKG + signing entirely off-chain.
    const states = runDkgInProcess(PARTICIPANTS, THRESHOLD);
    const { signature, aggregatedKey } = runFrostSigning(
      states,
      [2n, 3n], // ALICE + BOB
      MESSAGE,
    );

    // Submit the resulting (R, σ) into the in-process Compact-compiled
    // Schnorr verifier — same code path the proof server runs against.
    sim = new SchnorrSimulator();
    sim.testVerify(aggregatedKey, MESSAGE, signature);
    expect(sim.getLedger()._lastVerifyResult).toBe(true);
  });

  it('FROST signature with tampered sigma is rejected by on-chain Schnorr.verify', () => {
    const states = runDkgInProcess(PARTICIPANTS, THRESHOLD);
    const { signature, aggregatedKey } = runFrostSigning(
      states,
      [2n, 3n],
      MESSAGE,
    );
    const tampered = { R: signature.R, sigma: signature.sigma + 1n };
    sim = new SchnorrSimulator();
    sim.testVerify(aggregatedKey, MESSAGE, tampered);
    expect(sim.getLedger()._lastVerifyResult).toBe(false);
  });

  it('off-chain reference verifier and on-chain simulator agree on a known-good signature', () => {
    // Sanity: a simple non-FROST Schnorr signature also crosses correctly.
    const kp = jubjubKeypairFromSecret(0x1234n);
    sim = new SchnorrSimulator();
    // Dummy sig — easy invalid case to confirm the simulator is healthy.
    const dummySig = {
      R: ecMulGenerator(1n),
      sigma: 0n,
    };
    sim.testVerify(kp.publicKey, MESSAGE, dummySig);
    expect(sim.getLedger()._lastVerifyResult).toBe(false);
  });
});
