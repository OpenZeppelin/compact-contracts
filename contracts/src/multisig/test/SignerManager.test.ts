import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import { SignerManagerSimulator } from './simulators/SignerManagerSimulator.js';

const THRESHOLD = 2n;

const [_SIGNER, Z_SIGNER] = utils.generateEitherPubKeyPair('SIGNER');
const [_SIGNER2, Z_SIGNER2] = utils.generateEitherPubKeyPair('SIGNER2');
const [_SIGNER3, Z_SIGNER3] = utils.generateEitherPubKeyPair('SIGNER3');
const SIGNERS = [Z_SIGNER, Z_SIGNER2, Z_SIGNER3];
const [_OTHER, Z_OTHER] = utils.generateEitherPubKeyPair('OTHER');
const [_OTHER2, Z_OTHER2] = utils.generateEitherPubKeyPair('OTHER2');

let contract: SignerManagerSimulator;

describe('SigningManager', () => {
  describe('initialization', () => {
    it('should fail with a threshold of zero', () => {
      expect(() => {
        new SignerManagerSimulator(SIGNERS, 0n);
      }).toThrow('SignerManager: threshold must be > 0');
    });

    it('should fail with duplicate signers', () => {
      const duplicateSigners = [Z_SIGNER, Z_SIGNER, Z_SIGNER2];
      expect(() => {
        new SignerManagerSimulator(duplicateSigners, THRESHOLD);
      }).toThrow('SignerManager: signer already active');
    });

    it('should initialize', () => {
      expect(() => {
        contract = new SignerManagerSimulator(SIGNERS, THRESHOLD);
      }).to.be.ok;

      // Check thresh
      expect(contract.getThreshold()).toEqual(THRESHOLD);

      // Check signers
      expect(contract.getSignerCount()).toEqual(BigInt(SIGNERS.length));
      expect(() => {
        for (let i = 0; i < SIGNERS.length; i++) {
          contract.assertSigner(SIGNERS[i]);
        }
      }).to.be.ok;
    });
  });

  beforeEach(() => {
    contract = new SignerManagerSimulator(SIGNERS, THRESHOLD);
  });

  describe('assertSigner', () => {
    it('should pass with good signer', () => {
      expect(() => contract.assertSigner(Z_SIGNER)).not.toThrow();
    });

    it('should fail with bad signer', () => {
      expect(() => {
        contract.assertSigner(Z_OTHER);
      }).toThrow('SignerManager: not a signer');
    });
  });

  describe('assertThresholdMet', () => {
    it('should pass when approvals equal threshold', () => {
      expect(() => contract.assertThresholdMet(THRESHOLD)).not.toThrow();
    });

    it('should pass when approvals exceed threshold', () => {
      expect(() => contract.assertThresholdMet(THRESHOLD + 1n)).not.toThrow();
    });

    it('should fail when approvals are below threshold', () => {
      expect(() => {
        contract.assertThresholdMet(THRESHOLD - 1n);
      }).toThrow('SignerManager: threshold not met');
    });

    it('should fail with zero approvals', () => {
      expect(() => {
        contract.assertThresholdMet(0n);
      }).toThrow('SignerManager: threshold not met');
    });
  });

  describe('isSigner', () => {
    it('should return true for an active signer', () => {
      expect(contract.isSigner(Z_SIGNER)).toEqual(true);
    });

    it('should return false for a non-signer', () => {
      expect(contract.isSigner(Z_OTHER)).toEqual(false);
    });
  });

  describe('_addSigner', () => {
    it('should add a new signer', () => {
      contract._addSigner(Z_OTHER);

      expect(contract.isSigner(Z_OTHER)).toEqual(true);
      expect(contract.getSignerCount()).toEqual(BigInt(SIGNERS.length) + 1n);
    });

    it('should fail when adding an existing signer', () => {
      expect(() => {
        contract._addSigner(Z_SIGNER);
      }).toThrow('SignerManager: signer already active');
    });

    it('should add multiple new signers', () => {
      contract._addSigner(Z_OTHER);
      contract._addSigner(Z_OTHER2);

      expect(contract.isSigner(Z_OTHER)).toEqual(true);
      expect(contract.isSigner(Z_OTHER2)).toEqual(true);
      expect(contract.getSignerCount()).toEqual(BigInt(SIGNERS.length) + 2n);
    });
  });

  describe('_removeSigner', () => {
    it('should remove an existing signer', () => {
      contract._removeSigner(Z_SIGNER3);

      expect(contract.isSigner(Z_SIGNER3)).toEqual(false);
      expect(contract.getSignerCount()).toEqual(BigInt(SIGNERS.length) - 1n);
    });

    it('should fail when removing a non-signer', () => {
      expect(() => {
        contract._removeSigner(Z_OTHER);
      }).toThrow('SignerManager: not a signer');
    });

    it('should fail when removal would breach threshold', () => {
      // Remove one signer: count goes from 3 to 2, threshold is 2 — ok
      contract._removeSigner(Z_SIGNER3);

      // Remove another: count would go from 2 to 1, threshold is 2 — breach
      expect(() => {
        contract._removeSigner(Z_SIGNER2);
      }).toThrow('SignerManager: removal would breach threshold');
    });

    it('should allow removal after threshold is lowered', () => {
      contract._changeThreshold(1n);
      contract._removeSigner(Z_SIGNER3);
      contract._removeSigner(Z_SIGNER2);

      expect(contract.getSignerCount()).toEqual(1n);
      expect(contract.isSigner(Z_SIGNER)).toEqual(true);
      expect(contract.isSigner(Z_SIGNER2)).toEqual(false);
      expect(contract.isSigner(Z_SIGNER3)).toEqual(false);
    });
  });

  describe('_changeThreshold', () => {
    it('should update the threshold', () => {
      contract._changeThreshold(3n);

      expect(contract.getThreshold()).toEqual(3n);
    });

    it('should allow lowering the threshold', () => {
      contract._changeThreshold(1n);

      expect(contract.getThreshold()).toEqual(1n);
    });

    it('should fail with a threshold of zero', () => {
      expect(() => {
        contract._changeThreshold(0n);
      }).toThrow('SignerManager: threshold must be > 0');
    });

    it('should fail when threshold exceeds signer count', () => {
      expect(() => {
        contract._changeThreshold(BigInt(SIGNERS.length) + 1n);
      }).toThrow('SignerManager: threshold exceeds signer count');
    });

    it('should allow threshold equal to signer count', () => {
      contract._changeThreshold(BigInt(SIGNERS.length));

      expect(contract.getThreshold()).toEqual(BigInt(SIGNERS.length));
    });

    it('should reflect new threshold in assertThresholdMet', () => {
      contract._changeThreshold(3n);

      expect(() => {
        contract.assertThresholdMet(2n);
      }).toThrow('SignerManager: threshold not met');

      expect(() => contract.assertThresholdMet(3n)).not.toThrow();
    });
  });
});
