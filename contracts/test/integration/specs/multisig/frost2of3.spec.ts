import { jubjubPointX, jubjubPointY } from '@midnight-ntwrk/compact-runtime';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type DkgFinalState,
  type ParticipantId,
  runDkgInProcess,
} from '../../../../src/crypto/utils/frost/dkg.js';
import { runFrostSigning } from '../../../../src/crypto/utils/frost/frostCoordinator.js';
import {
  deployTestSchnorrVerifier,
  type TestSchnorrVerifierKit,
} from '../../fixtures/testSchnorrVerifier.js';

/**
 * Scheme E.1 — FROST 2-of-3 threshold Schnorr signing, end-to-end against a
 * live local Midnight node + proof server.
 *
 * Real-world story modelled here:
 *   - Three independent participants (mapped to ADMIN/ALICE/BOB in the
 *     existing prefunded pool) jointly run a Pedersen DKG ceremony in
 *     process. After DKG every participant holds a secret share `s_i` and
 *     they all agree on the same aggregated public key `P_agg`. No single
 *     participant ever learns the global secret `s_agg`.
 *   - Any 2 of the 3 can later run the FROST 3-round signing protocol to
 *     produce a single Schnorr signature `(R, σ)` valid under `P_agg` —
 *     bit-for-bit a vanilla Schnorr-on-Jubjub signature. The third
 *     participant stays offline.
 *   - The live proof server accepts the signature via the existing
 *     `TestSchnorrVerifier` contract (the same artifact the crypto/Schnorr
 *     foundation tests deploy). On-chain there is exactly ONE signature
 *     verification regardless of K — the privacy + cost win that
 *     distinguishes Scheme E from Schemes C and D.
 *
 * Pins:
 *  - DKG produces a consistent `P_agg` across all three participants.
 *  - Any 2-of-3 signer subset produces a signature that the proof server
 *    accepts via `TestSchnorrVerifier.testVerify(P_agg, msg, sig)`.
 *  - A signature for `msg_A` is rejected when submitted with `msg_B`.
 *  - A tampered `σ` is rejected.
 *  - The chain-level revert path (`testAssertValid`) reverts on a bad sig.
 */

const PARTICIPANTS: ParticipantId[] = [1n, 2n, 3n]; // 1=ADMIN, 2=ALICE, 3=BOB
const THRESHOLD = 2;
const MESSAGE = new Uint8Array(32).fill(0x42);

describe('Scheme E.1 — FROST 2-of-3 (live node)', () => {
  let kit: TestSchnorrVerifierKit;
  let dkgStates: DkgFinalState[];

  beforeAll(async () => {
    // Run the Pedersen DKG ceremony once for the whole spec — every test
    // produces signatures under the same aggregated key. This mirrors how a
    // real deployment would work: DKG happens once at setup time, not per-tx.
    dkgStates = runDkgInProcess(PARTICIPANTS, THRESHOLD);

    // Deploy the existing Schnorr-verifier test contract. Its `testVerify`
    // circuit accepts any (P, msg, sig) and writes the boolean result to the
    // ledger; for Scheme E we pass `P = P_agg` and the FROST-aggregated
    // signature.
    kit = await deployTestSchnorrVerifier();
  }, 240_000);

  afterAll(async () => {
    await kit?.teardown();
  });

  it('DKG produces a consistent aggregated public key across all participants', () => {
    const ref = dkgStates[0]!.aggregatedKey;
    for (const s of dkgStates) {
      expect(jubjubPointX(s.aggregatedKey)).toBe(jubjubPointX(ref));
      expect(jubjubPointY(s.aggregatedKey)).toBe(jubjubPointY(ref));
    }
  });

  it('proof server accepts an aggregated FROST signature from ALICE+BOB (P=2,3)', async () => {
    const { signature, aggregatedKey } = runFrostSigning(
      dkgStates,
      [2n, 3n],
      MESSAGE,
    );
    await kit.deployed.callTx.testVerify(aggregatedKey, MESSAGE, signature);
    const ledger = await kit.readLedger();
    expect(ledger._lastVerifyResult).toBe(true);
  }, 180_000);

  it('proof server accepts an aggregated FROST signature from ADMIN+ALICE (P=1,2)', async () => {
    const { signature, aggregatedKey } = runFrostSigning(
      dkgStates,
      [1n, 2n],
      MESSAGE,
    );
    await kit.deployed.callTx.testVerify(aggregatedKey, MESSAGE, signature);
    const ledger = await kit.readLedger();
    expect(ledger._lastVerifyResult).toBe(true);
  }, 180_000);

  it('proof server accepts an aggregated FROST signature from ADMIN+BOB (P=1,3)', async () => {
    const { signature, aggregatedKey } = runFrostSigning(
      dkgStates,
      [1n, 3n],
      MESSAGE,
    );
    await kit.deployed.callTx.testVerify(aggregatedKey, MESSAGE, signature);
    const ledger = await kit.readLedger();
    expect(ledger._lastVerifyResult).toBe(true);
  }, 180_000);

  it('proof server REJECTS a FROST signature submitted with a different message', async () => {
    const { signature, aggregatedKey } = runFrostSigning(
      dkgStates,
      [2n, 3n],
      MESSAGE,
    );
    const wrongMessage = new Uint8Array(32).fill(0x43);
    await kit.deployed.callTx.testVerify(aggregatedKey, wrongMessage, signature);
    const ledger = await kit.readLedger();
    expect(ledger._lastVerifyResult).toBe(false);
  }, 180_000);

  it('proof server REJECTS a FROST signature with tampered sigma', async () => {
    const { signature, aggregatedKey } = runFrostSigning(
      dkgStates,
      [2n, 3n],
      MESSAGE,
    );
    const tampered = { R: signature.R, sigma: signature.sigma + 1n };
    await kit.deployed.callTx.testVerify(aggregatedKey, MESSAGE, tampered);
    const ledger = await kit.readLedger();
    expect(ledger._lastVerifyResult).toBe(false);
  }, 180_000);

  it('on-chain assertValid REVERTS the tx on a tampered FROST signature', async () => {
    const { signature, aggregatedKey } = runFrostSigning(
      dkgStates,
      [2n, 3n],
      MESSAGE,
    );
    const tampered = { R: signature.R, sigma: signature.sigma + 1n };
    await expect(
      kit.deployed.callTx.testAssertValid(aggregatedKey, MESSAGE, tampered),
    ).rejects.toThrow(/Schnorr: invalid signature/);
  }, 180_000);
});
