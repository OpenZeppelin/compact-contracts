import { constructJubjubPoint } from '@midnight-ntwrk/compact-runtime';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  jubjubKeypairFromSecret,
  jubjubSignDeterministic,
  jubjubVerify,
} from '../../../../src/crypto/utils/jubjubSchnorr.js';
import {
  deployTestSchnorrVerifier,
  type TestSchnorrVerifierKit,
} from '../../fixtures/testSchnorrVerifier.js';

/**
 * crypto/Schnorr — end-to-end verification on a live local Midnight node.
 *
 * Pins:
 *  - Cross-side determinism: the off-chain signer (using compact-runtime
 *    primitives) produces signatures the on-chain verifier accepts.
 *  - Tamper rejection: altering sigma, R, the message, or the public key
 *    causes the verifier to reject.
 *  - Chain-level revert path: `testAssertValid` reverts the tx when
 *    verification fails.
 *
 * If this spec passes, every multisig scheme in the design proposals
 * (C, D, E) can rely on `crypto/Schnorr.verify` as the underlying
 * authentication primitive.
 */
describe('crypto/Schnorr — end-to-end Schnorr-on-Jubjub verify', () => {
  let kit: TestSchnorrVerifierKit;
  // Deterministic secrets for reproducibility across runs.
  const SECRET = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefn;
  const NONCE_SEED = 0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321n;
  const MESSAGE = new Uint8Array(32).fill(0x42);

  beforeAll(async () => {
    kit = await deployTestSchnorrVerifier();
  }, 240_000);

  afterAll(async () => {
    await kit?.teardown();
  });

  it('deploys the verifier contract', () => {
    expect(kit.contractAddress).toMatch(/^[0-9a-f]+$/);
  });

  it('off-chain reference verifier accepts a fresh signature', () => {
    const kp = jubjubKeypairFromSecret(SECRET);
    const sig = jubjubSignDeterministic(kp.secret, MESSAGE, NONCE_SEED);
    expect(jubjubVerify(kp.publicKey, MESSAGE, sig)).toBe(true);
  });

  it('off-chain reference verifier rejects a tampered sigma', () => {
    const kp = jubjubKeypairFromSecret(SECRET);
    const sig = jubjubSignDeterministic(kp.secret, MESSAGE, NONCE_SEED);
    expect(
      jubjubVerify(kp.publicKey, MESSAGE, { R: sig.R, sigma: sig.sigma + 1n }),
    ).toBe(false);
  });

  it('on-chain verify accepts a valid signature', async () => {
    const kp = jubjubKeypairFromSecret(SECRET);
    const sig = jubjubSignDeterministic(kp.secret, MESSAGE, NONCE_SEED);
    await kit.deployed.callTx.testVerify(kp.publicKey, MESSAGE, sig);
    const ledger = await kit.readLedger();
    expect(ledger._lastVerifyResult).toBe(true);
    expect(ledger._verifyCalls).toBeGreaterThanOrEqual(1n);
  }, 180_000);

  it('on-chain verify rejects a tampered sigma', async () => {
    const kp = jubjubKeypairFromSecret(SECRET);
    const sig = jubjubSignDeterministic(kp.secret, MESSAGE, NONCE_SEED);
    const tampered = { R: sig.R, sigma: sig.sigma + 1n };
    await kit.deployed.callTx.testVerify(kp.publicKey, MESSAGE, tampered);
    const ledger = await kit.readLedger();
    expect(ledger._lastVerifyResult).toBe(false);
  }, 180_000);

  it('on-chain verify rejects a wrong-message signature', async () => {
    const kp = jubjubKeypairFromSecret(SECRET);
    const sig = jubjubSignDeterministic(kp.secret, MESSAGE, NONCE_SEED);
    const wrongMessage = new Uint8Array(32).fill(0x43);
    await kit.deployed.callTx.testVerify(kp.publicKey, wrongMessage, sig);
    const ledger = await kit.readLedger();
    expect(ledger._lastVerifyResult).toBe(false);
  }, 180_000);

  it('on-chain verify rejects a signature under a different signer', async () => {
    const realKp = jubjubKeypairFromSecret(SECRET);
    const sig = jubjubSignDeterministic(realKp.secret, MESSAGE, NONCE_SEED);
    const otherKp = jubjubKeypairFromSecret(SECRET + 1n);
    await kit.deployed.callTx.testVerify(otherKp.publicKey, MESSAGE, sig);
    const ledger = await kit.readLedger();
    expect(ledger._lastVerifyResult).toBe(false);
  }, 180_000);

  it('on-chain assertValid reverts the tx on a tampered signature', async () => {
    const kp = jubjubKeypairFromSecret(SECRET);
    const sig = jubjubSignDeterministic(kp.secret, MESSAGE, NONCE_SEED);
    const tampered = { R: sig.R, sigma: sig.sigma + 1n };
    await expect(
      kit.deployed.callTx.testAssertValid(kp.publicKey, MESSAGE, tampered),
    ).rejects.toThrow(/Schnorr: invalid signature/);
  }, 180_000);

  it('on-chain verify rejects a signature with identity public key', async () => {
    const kp = jubjubKeypairFromSecret(SECRET);
    const sig = jubjubSignDeterministic(kp.secret, MESSAGE, NONCE_SEED);
    const identity = constructJubjubPoint(0n, 1n);
    await kit.deployed.callTx.testVerify(identity, MESSAGE, sig);
    const ledger = await kit.readLedger();
    expect(ledger._lastVerifyResult).toBe(false);
  }, 180_000);

  it('on-chain verify rejects a signature with identity R', async () => {
    const kp = jubjubKeypairFromSecret(SECRET);
    const sig = jubjubSignDeterministic(kp.secret, MESSAGE, NONCE_SEED);
    const identity = constructJubjubPoint(0n, 1n);
    await kit.deployed.callTx.testVerify(kp.publicKey, MESSAGE, {
      R: identity,
      sigma: sig.sigma,
    });
    const ledger = await kit.readLedger();
    expect(ledger._lastVerifyResult).toBe(false);
  }, 180_000);
});
