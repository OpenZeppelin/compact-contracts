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
    beforeEach(async () => {
      const isNotInit = false;
      contract = await SignerSimulator.create(SIGNERS, 0n, isNotInit);
    });

    const circuitsRequiringInit: [string, unknown[]][] = [
      ['assertSigner', [SIGNER]],
      ['assertThresholdMet', [0n]],
      ['getSignerCount', []],
      ['getThreshold', []],
    ];

    it.each(
      circuitsRequiringInit,
    )('%s should fail', async (circuitName, args) => {
      await expect(
        (
          contract[circuitName as keyof SignerSimulator] as (
            ...a: unknown[]
          ) => Promise<unknown>
        )(...args),
      ).rejects.toThrow('Signer: contract not initialized');
    });

    it('isSigner should succeed (no init guard)', async () => {
      expect(await contract.isSigner(SIGNER)).toEqual(false);
    });
  });

  describe('initialization', () => {
    it('should fail with a threshold of zero', async () => {
      await expect(
        SignerSimulator.create(SIGNERS, 0n, IS_INIT),
      ).rejects.toThrow('Signer: threshold must not be zero');
    });

    it('should fail when threshold exceeds signer count', async () => {
      await expect(
        SignerSimulator.create(SIGNERS, BigInt(SIGNERS.length) + 1n, IS_INIT),
      ).rejects.toThrow('Signer: threshold exceeds signer count');
    });

    it('should fail with duplicate signers', async () => {
      const duplicateSigners = [SIGNER, SIGNER, SIGNER2];
      await expect(
        SignerSimulator.create(duplicateSigners, THRESHOLD, IS_INIT),
      ).rejects.toThrow('Signer: signer already active');
    });

    it('should initialize with threshold equal to signer count', async () => {
      const contract = await SignerSimulator.create(
        SIGNERS,
        BigInt(SIGNERS.length),
        IS_INIT,
      );
      expect(await contract.getThreshold()).toEqual(BigInt(SIGNERS.length));
    });

    it('should initialize', async () => {
      contract = await SignerSimulator.create(SIGNERS, THRESHOLD, IS_INIT);

      expect(await contract.getThreshold()).toEqual(THRESHOLD);
      expect(await contract.getSignerCount()).toEqual(BigInt(SIGNERS.length));
      for (let i = 0; i < SIGNERS.length; i++) {
        await contract.assertSigner(SIGNERS[i]);
      }
    });

    it('should fail when initialized twice', async () => {
      contract = await SignerSimulator.create(SIGNERS, THRESHOLD, IS_INIT);
      await expect(contract.initialize(SIGNERS, THRESHOLD)).rejects.toThrow(
        'Signer: contract already initialized',
      );
    });
  });

  beforeEach(async () => {
    contract = await SignerSimulator.create(SIGNERS, THRESHOLD, IS_INIT);
  });

  describe('assertSigner', () => {
    it('should pass with good signer', async () => {
      await contract.assertSigner(SIGNER);
    });

    it('should fail with bad signer', async () => {
      await expect(contract.assertSigner(OTHER)).rejects.toThrow(
        'Signer: not a signer',
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
        'Signer: threshold not met',
      );
    });

    it('should fail with zero approvals', async () => {
      await expect(contract.assertThresholdMet(0n)).rejects.toThrow(
        'Signer: threshold not met',
      );
    });
  });

  describe('getSignerCount', () => {
    it('should return the initial signer count', async () => {
      expect(await contract.getSignerCount()).toEqual(BigInt(SIGNERS.length));
    });

    it('should reflect additions', async () => {
      await contract._addSigner(OTHER);
      expect(await contract.getSignerCount()).toEqual(
        BigInt(SIGNERS.length) + 1n,
      );
    });

    it('should reflect removals', async () => {
      await contract._removeSigner(SIGNER3);
      expect(await contract.getSignerCount()).toEqual(
        BigInt(SIGNERS.length) - 1n,
      );
    });
  });

  describe('getThreshold', () => {
    it('should return the initial threshold', async () => {
      expect(await contract.getThreshold()).toEqual(THRESHOLD);
    });

    it('should reflect _changeThreshold', async () => {
      await contract._changeThreshold(3n);
      expect(await contract.getThreshold()).toEqual(3n);
    });

    it('should reflect _setThreshold', async () => {
      await contract._setThreshold(1n);
      expect(await contract.getThreshold()).toEqual(1n);
    });
  });

  describe('isSigner', () => {
    it('should return true for an active signer', async () => {
      expect(await contract.isSigner(SIGNER)).toEqual(true);
    });

    it('should return false for a non-signer', async () => {
      expect(await contract.isSigner(OTHER)).toEqual(false);
    });
  });

  describe('_addSigner', () => {
    it('should add a new signer', async () => {
      await contract._addSigner(OTHER);

      expect(await contract.isSigner(OTHER)).toEqual(true);
      expect(await contract.getSignerCount()).toEqual(
        BigInt(SIGNERS.length) + 1n,
      );
    });

    it('should fail when adding an existing signer', async () => {
      await contract._addSigner(OTHER);

      await expect(contract._addSigner(OTHER)).rejects.toThrow(
        'Signer: signer already active',
      );
    });

    it('should add multiple new signers', async () => {
      await contract._addSigner(OTHER);
      await contract._addSigner(OTHER2);

      expect(await contract.isSigner(OTHER)).toEqual(true);
      expect(await contract.isSigner(OTHER2)).toEqual(true);
      expect(await contract.getSignerCount()).toEqual(
        BigInt(SIGNERS.length) + 2n,
      );
    });

    it('should allow re-adding a previously removed signer', async () => {
      expect(await contract.isSigner(SIGNER)).toEqual(true);

      await contract._removeSigner(SIGNER);
      expect(await contract.isSigner(SIGNER)).toEqual(false);

      await contract._addSigner(SIGNER);
      expect(await contract.isSigner(SIGNER)).toEqual(true);
    });
  });

  describe('_removeSigner', () => {
    it('should remove an existing signer', async () => {
      await contract._removeSigner(SIGNER3);

      expect(await contract.isSigner(SIGNER3)).toEqual(false);
      expect(await contract.getSignerCount()).toEqual(
        BigInt(SIGNERS.length) - 1n,
      );
    });

    it('should fail when removing a non-signer', async () => {
      await expect(contract._removeSigner(OTHER)).rejects.toThrow(
        'Signer: not a signer',
      );
    });

    it('should fail when removal would breach threshold', async () => {
      await contract._removeSigner(SIGNER3);

      await expect(contract._removeSigner(SIGNER2)).rejects.toThrow(
        'Signer: removal would breach threshold',
      );
    });

    it('should allow removal after threshold is lowered', async () => {
      await contract._changeThreshold(1n);
      await contract._removeSigner(SIGNER3);
      await contract._removeSigner(SIGNER2);

      expect(await contract.getSignerCount()).toEqual(1n);
      expect(await contract.isSigner(SIGNER)).toEqual(true);
      expect(await contract.isSigner(SIGNER2)).toEqual(false);
      expect(await contract.isSigner(SIGNER3)).toEqual(false);
    });

    it('should keep signer count in sync after multiple add/remove operations', async () => {
      await contract._addSigner(OTHER);
      await contract._addSigner(OTHER2);
      await contract._removeSigner(SIGNER3);
      await contract._removeSigner(OTHER);

      expect(await contract.getSignerCount()).toEqual(3n);
      expect(await contract.isSigner(SIGNER)).toEqual(true);
      expect(await contract.isSigner(SIGNER2)).toEqual(true);
      expect(await contract.isSigner(SIGNER3)).toEqual(false);
      expect(await contract.isSigner(OTHER)).toEqual(false);
      expect(await contract.isSigner(OTHER2)).toEqual(true);
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
        'Signer: threshold must not be zero',
      );
    });

    it('should fail when threshold exceeds signer count', async () => {
      await expect(
        contract._changeThreshold(BigInt(SIGNERS.length) + 1n),
      ).rejects.toThrow('Signer: threshold exceeds signer count');
    });

    it('should allow threshold equal to signer count', async () => {
      await contract._changeThreshold(BigInt(SIGNERS.length));

      expect(await contract.getThreshold()).toEqual(BigInt(SIGNERS.length));
    });

    it('should reflect new threshold in assertThresholdMet', async () => {
      await contract._changeThreshold(3n);

      await expect(contract.assertThresholdMet(2n)).rejects.toThrow(
        'Signer: threshold not met',
      );

      await contract.assertThresholdMet(3n);
    });
  });

  describe('_setThreshold', () => {
    beforeEach(async () => {
      const isNotInit = false;
      contract = await SignerSimulator.create(SIGNERS, 0n, isNotInit);
    });

    it('should have an empty state', async () => {
      expect((await contract.getPublicState())._threshold).toEqual(0n);
      expect((await contract.getPublicState())._signerCount).toEqual(0n);
      expect((await contract.getPublicState())._signers.isEmpty()).toEqual(
        true,
      );
    });

    it('should set threshold without signers', async () => {
      expect((await contract.getPublicState())._threshold).toEqual(0n);

      await contract._setThreshold(2n);
      expect((await contract.getPublicState())._threshold).toEqual(2n);
    });

    it('should set threshold multiple times', async () => {
      await contract._setThreshold(2n);
      await contract._setThreshold(3n);
      expect((await contract.getPublicState())._threshold).toEqual(3n);
    });

    it('should fail with zero threshold', async () => {
      await expect(contract._setThreshold(0n)).rejects.toThrow(
        'Signer: threshold must not be zero',
      );
    });
  });

  describe('custom setup flow when not initialized', () => {
    beforeEach(async () => {
      const isNotInit = false;
      contract = await SignerSimulator.create(SIGNERS, 0n, isNotInit);
    });

    it('should have no signers by default', async () => {
      expect((await contract.getPublicState())._signerCount).toEqual(0n);
      expect(await contract.isSigner(SIGNER)).toEqual(false);
    });

    it('should have zero threshold by default', async () => {
      expect((await contract.getPublicState())._threshold).toEqual(0n);
    });

    it('should allow adding signers then setting threshold', async () => {
      await contract._addSigner(SIGNER);
      await contract._addSigner(SIGNER2);
      await contract._addSigner(SIGNER3);
      await contract._changeThreshold(2n);

      expect((await contract.getPublicState())._signerCount).toEqual(3n);
      expect((await contract.getPublicState())._threshold).toEqual(2n);
      expect(await contract.isSigner(SIGNER)).toEqual(true);
    });

    it('should allow setting threshold then adding signers to meet it', async () => {
      await contract._setThreshold(2n);
      await contract._addSigner(SIGNER);
      await contract._addSigner(SIGNER2);

      expect((await contract.getPublicState())._signerCount).toEqual(2n);
      expect((await contract.getPublicState())._threshold).toEqual(2n);
    });

    it('should fail _changeThreshold before signers are added', async () => {
      await expect(contract._changeThreshold(2n)).rejects.toThrow(
        'Signer: threshold exceeds signer count',
      );
    });
  });
});
