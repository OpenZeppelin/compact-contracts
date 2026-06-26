import { beforeEach, describe, expect, it } from 'vitest';
import { EcdsaSignerManagerSimulator } from './simulators/EcdsaSignerManagerSimulator.js';

const THRESHOLD = 2n;

// Instance salt and ECDSA public keys (Bytes<64>) used to derive commitments.
const SALT = new Uint8Array(32).fill(7);
const PK1 = new Uint8Array(64).fill(1);
const PK2 = new Uint8Array(64).fill(2);
const PK3 = new Uint8Array(64).fill(3);
const PK_UNKNOWN = new Uint8Array(64).fill(9);

// A dummy signature and message hash. The ECDSA check is stubbed, so the
// signature bytes are irrelevant to verification today.
const SIG = new Uint8Array(64).fill(0);
const MSG = new Uint8Array(32).fill(5);

const COMMITMENT1 = EcdsaSignerManagerSimulator.calculateSignerId(PK1, SALT);
const COMMITMENT2 = EcdsaSignerManagerSimulator.calculateSignerId(PK2, SALT);
const COMMITMENT3 = EcdsaSignerManagerSimulator.calculateSignerId(PK3, SALT);
const SIGNERS = [COMMITMENT1, COMMITMENT2, COMMITMENT3];

let verifier: EcdsaSignerManagerSimulator;

describe('EcdsaSignerManager', () => {
  beforeEach(async () => {
    verifier = await EcdsaSignerManagerSimulator.create(
      SALT,
      SIGNERS,
      THRESHOLD,
    );
  });

  describe('initialization', () => {
    it('should register all signer commitments', async () => {
      expect(await verifier.getSignerCount()).toEqual(3n);
      expect(await verifier.getThreshold()).toEqual(2n);
      expect(await verifier.isSigner(COMMITMENT1)).toEqual(true);
      expect(await verifier.isSigner(COMMITMENT2)).toEqual(true);
      expect(await verifier.isSigner(COMMITMENT3)).toEqual(true);
    });

    it('should not recognize an unregistered commitment', async () => {
      const unknown = EcdsaSignerManagerSimulator.calculateSignerId(
        PK_UNKNOWN,
        SALT,
      );
      expect(await verifier.isSigner(unknown)).toEqual(false);
    });
  });

  describe('_calculateSignerId', () => {
    it('should be deterministic for the same key and salt', () => {
      expect(
        EcdsaSignerManagerSimulator.calculateSignerId(PK1, SALT),
      ).toStrictEqual(COMMITMENT1);
    });

    it('should produce a different commitment for a different salt', () => {
      const otherSalt = new Uint8Array(32).fill(8);
      expect(
        EcdsaSignerManagerSimulator.calculateSignerId(PK1, otherSalt),
      ).not.toStrictEqual(COMMITMENT1);
    });

    it('should produce a different commitment for a different key', () => {
      expect(COMMITMENT1).not.toStrictEqual(COMMITMENT2);
    });
  });

  describe('verify', () => {
    it('should pass with two distinct registered signers', async () => {
      await verifier.verify(MSG, [PK1, PK2], [SIG, SIG]);
    });

    it('should reject a duplicate signer', async () => {
      await expect(
        verifier.verify(MSG, [PK1, PK1], [SIG, SIG]),
      ).rejects.toThrow('EcdsaSignerManager: duplicate signer');
    });

    it('should reject an unregistered signer', async () => {
      await expect(
        verifier.verify(MSG, [PK_UNKNOWN, PK2], [SIG, SIG]),
      ).rejects.toThrow('SignerManager: not a signer');
    });
  });
});
