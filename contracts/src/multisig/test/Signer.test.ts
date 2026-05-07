import { beforeEach, describe, expect, it } from 'vitest';
import { SignerSimulator } from './simulators/SignerSimulator.js';

const THRESHOLD = 2n;
const IS_INIT = true;

// Simple `Bytes<32>` ids
const SIGNER = new Uint8Array(32).fill(1);
const SIGNER2 = new Uint8Array(32).fill(2);
const SIGNER3 = new Uint8Array(32).fill(3);
const SIGNERS = [SIGNER, SIGNER2, SIGNER3];
const OTHER = new Uint8Array(32).fill(4);
const OTHER2 = new Uint8Array(32).fill(5);

let contract: SignerSimulator;

describe('Signer', () => {
  describe('when not initialized', () => {
    beforeEach(() => {
      const isNotInit = false;
      contract = new SignerSimulator(SIGNERS, 0n, isNotInit);
    });

    const circuitsRequiringInit: [string, unknown[]][] = [
      ['assertSigner', [SIGNER]],
      ['assertThresholdMet', [0n]],
      ['getSignerCount', []],
      ['getThreshold', []],
    ];

    it.each(circuitsRequiringInit)('%s should fail', (circuitName, args) => {
      expect(() => {
        (
          contract[circuitName as keyof SignerSimulator] as (
            ...a: unknown[]
          ) => unknown
        )(...args);
      }).toThrow('Initializable: contract not initialized');
    });

    it('isSigner should succeed (no init guard)', () => {
      expect(contract.isSigner(SIGNER)).toEqual(false);
    });
  });

  describe('initialization', () => {
    it('should fail with a threshold of zero', () => {
      expect(() => {
        new SignerSimulator(SIGNERS, 0n, IS_INIT);
      }).toThrow('Signer: threshold must not be zero');
    });

    it('should fail when threshold exceeds signer count', () => {
      expect(() => {
        new SignerSimulator(SIGNERS, BigInt(SIGNERS.length) + 1n, IS_INIT);
      }).toThrow('Signer: threshold exceeds signer count');
    });

    it('should fail with duplicate signers', () => {
      const duplicateSigners = [SIGNER, SIGNER, SIGNER2];
      expect(() => {
        new SignerSimulator(duplicateSigners, THRESHOLD, IS_INIT);
      }).toThrow('Signer: signer already active');
    });

    it('should initialize with threshold equal to signer count', () => {
      const contract = new SignerSimulator(
        SIGNERS,
        BigInt(SIGNERS.length),
        IS_INIT,
      );
      expect(contract.getThreshold()).toEqual(BigInt(SIGNERS.length));
    });

    it('should initialize', () => {
      expect(() => {
        contract = new SignerSimulator(SIGNERS, THRESHOLD, IS_INIT);
      }).not.toThrow();

      expect(contract.getThreshold()).toEqual(THRESHOLD);
      expect(contract.getSignerCount()).toEqual(BigInt(SIGNERS.length));
      expect(() => {
        for (let i = 0; i < SIGNERS.length; i++) {
          contract.assertSigner(SIGNERS[i]);
        }
      }).not.toThrow();
    });

    it('should fail when initialized twice', () => {
      contract = new SignerSimulator(SIGNERS, THRESHOLD, IS_INIT);
      expect(() => {
        contract.initialize(SIGNERS, THRESHOLD);
      }).toThrow('Initializable: contract already initialized');
    });
  });

  beforeEach(() => {
    contract = new SignerSimulator(SIGNERS, THRESHOLD, IS_INIT);
  });

  describe('assertSigner', () => {
    it('should pass with good signer', () => {
      expect(() => contract.assertSigner(SIGNER)).not.toThrow();
    });

    it('should fail with bad signer', () => {
      expect(() => {
        contract.assertSigner(OTHER);
      }).toThrow('Signer: not a signer');
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
      }).toThrow('Signer: threshold not met');
    });

    it('should fail with zero approvals', () => {
      expect(() => {
        contract.assertThresholdMet(0n);
      }).toThrow('Signer: threshold not met');
    });
  });

  describe('getSignerCount', () => {
    it('should return the initial signer count', () => {
      expect(contract.getSignerCount()).toEqual(BigInt(SIGNERS.length));
    });

    it('should reflect additions', () => {
      contract._addSigner(OTHER);
      expect(contract.getSignerCount()).toEqual(BigInt(SIGNERS.length) + 1n);
    });

    it('should reflect removals', () => {
      contract._removeSigner(SIGNER3);
      expect(contract.getSignerCount()).toEqual(BigInt(SIGNERS.length) - 1n);
    });
  });

  describe('getThreshold', () => {
    it('should return the initial threshold', () => {
      expect(contract.getThreshold()).toEqual(THRESHOLD);
    });

    it('should reflect _changeThreshold', () => {
      contract._changeThreshold(3n);
      expect(contract.getThreshold()).toEqual(3n);
    });

    it('should reflect _setThreshold', () => {
      contract._setThreshold(1n);
      expect(contract.getThreshold()).toEqual(1n);
    });
  });

  describe('isSigner', () => {
    it('should return true for an active signer', () => {
      expect(contract.isSigner(SIGNER)).toEqual(true);
    });

    it('should return false for a non-signer', () => {
      expect(contract.isSigner(OTHER)).toEqual(false);
    });
  });

  describe('_addSigner', () => {
    it('should add a new signer', () => {
      contract._addSigner(OTHER);

      expect(contract.isSigner(OTHER)).toEqual(true);
      expect(contract.getSignerCount()).toEqual(BigInt(SIGNERS.length) + 1n);
    });

    it('should fail when adding an existing signer', () => {
      contract._addSigner(OTHER);

      expect(() => {
        contract._addSigner(OTHER);
      }).toThrow('Signer: signer already active');
    });

    it('should add multiple new signers', () => {
      contract._addSigner(OTHER);
      contract._addSigner(OTHER2);

      expect(contract.isSigner(OTHER)).toEqual(true);
      expect(contract.isSigner(OTHER2)).toEqual(true);
      expect(contract.getSignerCount()).toEqual(BigInt(SIGNERS.length) + 2n);
    });

    it('should allow re-adding a previously removed signer', () => {
      expect(contract.isSigner(SIGNER)).toEqual(true);

      contract._removeSigner(SIGNER);
      expect(contract.isSigner(SIGNER)).toEqual(false);

      contract._addSigner(SIGNER);
      expect(contract.isSigner(SIGNER)).toEqual(true);
    });
  });

  describe('_removeSigner', () => {
    it('should remove an existing signer', () => {
      contract._removeSigner(SIGNER3);

      expect(contract.isSigner(SIGNER3)).toEqual(false);
      expect(contract.getSignerCount()).toEqual(BigInt(SIGNERS.length) - 1n);
    });

    it('should fail when removing a non-signer', () => {
      expect(() => {
        contract._removeSigner(OTHER);
      }).toThrow('Signer: not a signer');
    });

    it('should fail when removal would breach threshold', () => {
      contract._removeSigner(SIGNER3);

      expect(() => {
        contract._removeSigner(SIGNER2);
      }).toThrow('Signer: removal would breach threshold');
    });

    it('should allow removal after threshold is lowered', () => {
      contract._changeThreshold(1n);
      contract._removeSigner(SIGNER3);
      contract._removeSigner(SIGNER2);

      expect(contract.getSignerCount()).toEqual(1n);
      expect(contract.isSigner(SIGNER)).toEqual(true);
      expect(contract.isSigner(SIGNER2)).toEqual(false);
      expect(contract.isSigner(SIGNER3)).toEqual(false);
    });

    it('should keep signer count in sync after multiple add/remove operations', () => {
      contract._addSigner(OTHER);
      contract._addSigner(OTHER2);
      contract._removeSigner(SIGNER3);
      contract._removeSigner(OTHER);

      expect(contract.getSignerCount()).toEqual(3n);
      expect(contract.isSigner(SIGNER)).toEqual(true);
      expect(contract.isSigner(SIGNER2)).toEqual(true);
      expect(contract.isSigner(SIGNER3)).toEqual(false);
      expect(contract.isSigner(OTHER)).toEqual(false);
      expect(contract.isSigner(OTHER2)).toEqual(true);
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
      }).toThrow('Signer: threshold must not be zero');
    });

    it('should fail when threshold exceeds signer count', () => {
      expect(() => {
        contract._changeThreshold(BigInt(SIGNERS.length) + 1n);
      }).toThrow('Signer: threshold exceeds signer count');
    });

    it('should allow threshold equal to signer count', () => {
      contract._changeThreshold(BigInt(SIGNERS.length));

      expect(contract.getThreshold()).toEqual(BigInt(SIGNERS.length));
    });

    it('should reflect new threshold in assertThresholdMet', () => {
      contract._changeThreshold(3n);

      expect(() => {
        contract.assertThresholdMet(2n);
      }).toThrow('Signer: threshold not met');

      expect(() => contract.assertThresholdMet(3n)).not.toThrow();
    });
  });

  describe('_setThreshold', () => {
    beforeEach(() => {
      const isNotInit = false;
      contract = new SignerSimulator(SIGNERS, 0n, isNotInit);
    });

    it('should have an empty state', () => {
      expect(contract.getPublicState()._threshold).toEqual(0n);
      expect(contract.getPublicState()._signerCount).toEqual(0n);
      expect(contract.getPublicState()._signers.isEmpty()).toEqual(true);
    });

    it('should set threshold without signers', () => {
      expect(contract.getPublicState()._threshold).toEqual(0n);

      contract._setThreshold(2n);
      expect(contract.getPublicState()._threshold).toEqual(2n);
    });

    it('should set threshold multiple times', () => {
      contract._setThreshold(2n);
      contract._setThreshold(3n);
      expect(contract.getPublicState()._threshold).toEqual(3n);
    });

    it('should fail with zero threshold', () => {
      expect(() => {
        contract._setThreshold(0n);
      }).toThrow('Signer: threshold must not be zero');
    });
  });

  describe('custom setup flow when not initialized', () => {
    beforeEach(() => {
      const isNotInit = false;
      contract = new SignerSimulator(SIGNERS, 0n, isNotInit);
    });

    it('should have no signers by default', () => {
      expect(contract.getPublicState()._signerCount).toEqual(0n);
      expect(contract.isSigner(SIGNER)).toEqual(false);
    });

    it('should have zero threshold by default', () => {
      expect(contract.getPublicState()._threshold).toEqual(0n);
    });

    it('should allow adding signers then setting threshold', () => {
      contract._addSigner(SIGNER);
      contract._addSigner(SIGNER2);
      contract._addSigner(SIGNER3);
      contract._changeThreshold(2n);

      expect(contract.getPublicState()._signerCount).toEqual(3n);
      expect(contract.getPublicState()._threshold).toEqual(2n);
      expect(contract.isSigner(SIGNER)).toEqual(true);
    });

    it('should allow setting threshold then adding signers to meet it', () => {
      contract._setThreshold(2n);
      contract._addSigner(SIGNER);
      contract._addSigner(SIGNER2);

      expect(contract.getPublicState()._signerCount).toEqual(2n);
      expect(contract.getPublicState()._threshold).toEqual(2n);
    });

    it('should fail _changeThreshold before signers are added', () => {
      expect(() => {
        contract._changeThreshold(2n);
      }).toThrow('Signer: threshold exceeds signer count');
    });
  });
});
