import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import {
  SignerManagerSimulator,
  type SignerSet,
} from './simulators/SignerManagerSimulator.js';

const THRESHOLD = 2n;

const [_SIGNER, Z_SIGNER] = utils.generateEitherPubKeyPair('SIGNER');
const [_SIGNER2, Z_SIGNER2] = utils.generateEitherPubKeyPair('SIGNER2');
const [_SIGNER3, Z_SIGNER3] = utils.generateEitherPubKeyPair('SIGNER3');
const SIGNERS: SignerSet = [Z_SIGNER, Z_SIGNER2, Z_SIGNER3];
const [_OTHER, Z_OTHER] = utils.generateEitherPubKeyPair('OTHER');
const [_OTHER2, Z_OTHER2] = utils.generateEitherPubKeyPair('OTHER2');

let contract: SignerManagerSimulator;

describe('SigningManager', () => {
  describe('initialization', () => {
    it('should fail with a threshold of zero', async () => {
      await expect(SignerManagerSimulator.create(SIGNERS, 0n)).rejects.toThrow(
        'SignerManager: threshold must be > 0',
      );
    });

    it('should fail with duplicate signers', async () => {
      const duplicateSigners: SignerSet = [Z_SIGNER, Z_SIGNER, Z_SIGNER2];
      await expect(
        SignerManagerSimulator.create(duplicateSigners, THRESHOLD),
      ).rejects.toThrow('SignerManager: signer already active');
    });

    it('should initialize', async () => {
      contract = await SignerManagerSimulator.create(SIGNERS, THRESHOLD);

      // Check thresh
      expect(await contract.getThreshold()).toEqual(THRESHOLD);

      // Check signers
      expect(await contract.getSignerCount()).toEqual(BigInt(SIGNERS.length));
      for (let i = 0; i < SIGNERS.length; i++) {
        await contract.assertSigner(SIGNERS[i]);
      }
    });
  });

  beforeEach(async () => {
    contract = await SignerManagerSimulator.create(SIGNERS, THRESHOLD);
  });

  describe('assertSigner', () => {
    it('should pass with good signer', async () => {
      await contract.assertSigner(Z_SIGNER);
    });

    it('should fail with bad signer', async () => {
      await expect(contract.assertSigner(Z_OTHER)).rejects.toThrow(
        'SignerManager: not a signer',
      );
    });
  });

  describe('assertThresholdMet', () => {
    it('should pass when approvals equal threshold', async () => {
      await contract.assertThresholdMet(THRESHOLD);
    });

    it('should pass when approvals exceed threshold', async () => {
      await contract.assertThresholdMet(THRESHOLD + 1n);
    });

    it('should fail when approvals are below threshold', async () => {
      await expect(contract.assertThresholdMet(THRESHOLD - 1n)).rejects.toThrow(
        'SignerManager: threshold not met',
      );
    });

    it('should fail with zero approvals', async () => {
      await expect(contract.assertThresholdMet(0n)).rejects.toThrow(
        'SignerManager: threshold not met',
      );
    });
  });

  describe('isSigner', () => {
    it('should return true for an active signer', async () => {
      expect(await contract.isSigner(Z_SIGNER)).toEqual(true);
    });

    it('should return false for a non-signer', async () => {
      expect(await contract.isSigner(Z_OTHER)).toEqual(false);
    });
  });

  describe('_addSigner', () => {
    it('should add a new signer', async () => {
      await contract._addSigner(Z_OTHER);

      expect(await contract.isSigner(Z_OTHER)).toEqual(true);
      expect(await contract.getSignerCount()).toEqual(
        BigInt(SIGNERS.length) + 1n,
      );
    });

    it('should fail when adding an existing signer', async () => {
      await expect(contract._addSigner(Z_SIGNER)).rejects.toThrow(
        'SignerManager: signer already active',
      );
    });

    it('should add multiple new signers', async () => {
      await contract._addSigner(Z_OTHER);
      await contract._addSigner(Z_OTHER2);

      expect(await contract.isSigner(Z_OTHER)).toEqual(true);
      expect(await contract.isSigner(Z_OTHER2)).toEqual(true);
      expect(await contract.getSignerCount()).toEqual(
        BigInt(SIGNERS.length) + 2n,
      );
    });
  });

  describe('_removeSigner', () => {
    it('should remove an existing signer', async () => {
      await contract._removeSigner(Z_SIGNER3);

      expect(await contract.isSigner(Z_SIGNER3)).toEqual(false);
      expect(await contract.getSignerCount()).toEqual(
        BigInt(SIGNERS.length) - 1n,
      );
    });

    it('should fail when removing a non-signer', async () => {
      await expect(contract._removeSigner(Z_OTHER)).rejects.toThrow(
        'SignerManager: not a signer',
      );
    });

    it('should fail when removal would breach threshold', async () => {
      // Remove one signer: count goes from 3 to 2, threshold is 2 — ok
      await contract._removeSigner(Z_SIGNER3);

      // Remove another: count would go from 2 to 1, threshold is 2 — breach
      await expect(contract._removeSigner(Z_SIGNER2)).rejects.toThrow(
        'SignerManager: removal would breach threshold',
      );
    });

    it('should allow removal after threshold is lowered', async () => {
      await contract._changeThreshold(1n);
      await contract._removeSigner(Z_SIGNER3);
      await contract._removeSigner(Z_SIGNER2);

      expect(await contract.getSignerCount()).toEqual(1n);
      expect(await contract.isSigner(Z_SIGNER)).toEqual(true);
      expect(await contract.isSigner(Z_SIGNER2)).toEqual(false);
      expect(await contract.isSigner(Z_SIGNER3)).toEqual(false);
    });
  });

  describe('_changeThreshold', () => {
    it('should update the threshold', async () => {
      await contract._changeThreshold(3n);

      expect(await contract.getThreshold()).toEqual(3n);
    });

    it('should allow lowering the threshold', async () => {
      await contract._changeThreshold(1n);

      expect(await contract.getThreshold()).toEqual(1n);
    });

    it('should fail with a threshold of zero', async () => {
      await expect(contract._changeThreshold(0n)).rejects.toThrow(
        'SignerManager: threshold must be > 0',
      );
    });

    it('should fail when threshold exceeds signer count', async () => {
      await expect(
        contract._changeThreshold(BigInt(SIGNERS.length) + 1n),
      ).rejects.toThrow('SignerManager: threshold exceeds signer count');
    });

    it('should allow threshold equal to signer count', async () => {
      await contract._changeThreshold(BigInt(SIGNERS.length));

      expect(await contract.getThreshold()).toEqual(BigInt(SIGNERS.length));
    });

    it('should reflect new threshold in assertThresholdMet', async () => {
      await contract._changeThreshold(3n);

      await expect(contract.assertThresholdMet(2n)).rejects.toThrow(
        'SignerManager: threshold not met',
      );

      await contract.assertThresholdMet(3n);
    });
  });
});
