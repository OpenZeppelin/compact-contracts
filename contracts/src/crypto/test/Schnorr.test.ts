import { beforeEach, describe, expect, it } from 'vitest';
import {
  jubjubKeypairFromSecret,
  jubjubSign,
  jubjubVerify,
  schnorrChallenge,
} from '../utils/jubjubSchnorr.js';
import { SchnorrSimulator } from './simulators/SchnorrSimulator.js';

/**
 * crypto/Schnorr — end-to-end Schnorr-on-Jubjub verifier.
 *
 * Pins:
 *  - Cross-side determinism: off-chain signer (compact-runtime primitives)
 *    produces signatures the compiled-on-chain `Schnorr_verify` accepts.
 *  - Off-chain `schnorrChallenge` byte-matches the on-chain `Schnorr_challenge`
 *    (read via the mock's `testChallenge` ledger field).
 *  - Tampered sigma / message / R / P are rejected by the on-chain verifier.
 *  - `Schnorr_assertValid` reverts with the documented error message.
 */
describe('crypto/Schnorr — Schnorr-on-Jubjub verifier', () => {
  // Deterministic test vectors — re-runs produce identical state.
  const SECRET =
    0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefn;
  const NONCE_SEED =
    0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321n;
  const MESSAGE = new Uint8Array(32).fill(0x42);

  let sim: SchnorrSimulator;

  beforeEach(() => {
    sim = new SchnorrSimulator();
  });

  describe('off-chain reference (jubjubSchnorr.ts)', () => {
    it('round-trips: jubjubVerify accepts a fresh jubjubSign output', () => {
      const kp = jubjubKeypairFromSecret(SECRET);
      const sig = jubjubSign(kp.secret, MESSAGE, NONCE_SEED);
      expect(jubjubVerify(kp.publicKey, MESSAGE, sig)).toBe(true);
    });

    it('rejects a tampered sigma', () => {
      const kp = jubjubKeypairFromSecret(SECRET);
      const sig = jubjubSign(kp.secret, MESSAGE, NONCE_SEED);
      expect(
        jubjubVerify(kp.publicKey, MESSAGE, { R: sig.R, sigma: sig.sigma + 1n }),
      ).toBe(false);
    });

    it('rejects a tampered message', () => {
      const kp = jubjubKeypairFromSecret(SECRET);
      const sig = jubjubSign(kp.secret, MESSAGE, NONCE_SEED);
      const wrongMessage = new Uint8Array(32).fill(0x43);
      expect(jubjubVerify(kp.publicKey, wrongMessage, sig)).toBe(false);
    });
  });

  describe('on-chain Schnorr_verify (via simulator)', () => {
    it('accepts a signature produced by the off-chain signer', () => {
      const kp = jubjubKeypairFromSecret(SECRET);
      const sig = jubjubSign(kp.secret, MESSAGE, NONCE_SEED);
      sim.testVerify(kp.publicKey, MESSAGE, sig);
      expect(sim.getLedger()._lastVerifyResult).toBe(true);
      expect(sim.getLedger()._verifyCalls).toBe(1n);
    });

    it('rejects a tampered sigma', () => {
      const kp = jubjubKeypairFromSecret(SECRET);
      const sig = jubjubSign(kp.secret, MESSAGE, NONCE_SEED);
      sim.testVerify(kp.publicKey, MESSAGE, {
        R: sig.R,
        sigma: sig.sigma + 1n,
      });
      expect(sim.getLedger()._lastVerifyResult).toBe(false);
    });

    it('rejects a tampered message', () => {
      const kp = jubjubKeypairFromSecret(SECRET);
      const sig = jubjubSign(kp.secret, MESSAGE, NONCE_SEED);
      const wrongMessage = new Uint8Array(32).fill(0x43);
      sim.testVerify(kp.publicKey, wrongMessage, sig);
      expect(sim.getLedger()._lastVerifyResult).toBe(false);
    });

    it('rejects a tampered R', () => {
      const kp = jubjubKeypairFromSecret(SECRET);
      const sig = jubjubSign(kp.secret, MESSAGE, NONCE_SEED);
      // Replace R with a different valid Jubjub point.
      const otherKp = jubjubKeypairFromSecret(SECRET + 7n);
      sim.testVerify(kp.publicKey, MESSAGE, {
        R: otherKp.publicKey,
        sigma: sig.sigma,
      });
      expect(sim.getLedger()._lastVerifyResult).toBe(false);
    });

    it('rejects a signature under the wrong public key', () => {
      const realKp = jubjubKeypairFromSecret(SECRET);
      const sig = jubjubSign(realKp.secret, MESSAGE, NONCE_SEED);
      const otherKp = jubjubKeypairFromSecret(SECRET + 1n);
      sim.testVerify(otherKp.publicKey, MESSAGE, sig);
      expect(sim.getLedger()._lastVerifyResult).toBe(false);
    });
  });

  describe('cross-side challenge agreement', () => {
    it('off-chain schnorrChallenge matches on-chain Schnorr_challenge bit-for-bit', () => {
      const kp = jubjubKeypairFromSecret(SECRET);
      const sig = jubjubSign(kp.secret, MESSAGE, NONCE_SEED);
      const offChainC = schnorrChallenge(sig.R, kp.publicKey, MESSAGE);
      sim.testChallenge(sig.R, kp.publicKey, MESSAGE);
      expect(sim.getLedger()._lastChallenge).toBe(offChainC);
    });
  });

  describe('on-chain Schnorr_assertValid', () => {
    it('passes silently for a valid signature', () => {
      const kp = jubjubKeypairFromSecret(SECRET);
      const sig = jubjubSign(kp.secret, MESSAGE, NONCE_SEED);
      expect(() =>
        sim.testAssertValid(kp.publicKey, MESSAGE, sig),
      ).not.toThrow();
    });

    it('reverts on a tampered signature with the documented error', () => {
      const kp = jubjubKeypairFromSecret(SECRET);
      const sig = jubjubSign(kp.secret, MESSAGE, NONCE_SEED);
      expect(() =>
        sim.testAssertValid(kp.publicKey, MESSAGE, {
          R: sig.R,
          sigma: sig.sigma + 1n,
        }),
      ).toThrow(/Schnorr: invalid signature/);
    });
  });
});
