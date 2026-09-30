import { describe, expect, it } from 'vitest';
import {
  type Signer,
  sign,
  signerFromLabel,
} from '#test-utils/fixtures/ecdsa.js';
import { EcdsaMultisigCoreSimulator } from './simulators/EcdsaMultisigCoreSimulator.js';

const INSTANCE_SALT = new Uint8Array(32).fill(0xaa);
const DIGEST = new Uint8Array(32).fill(0x42);

const S1 = signerFromLabel('ecdsa-multisig-1');
const S2 = signerFromLabel('ecdsa-multisig-2');
const S3 = signerFromLabel('ecdsa-multisig-3');

const SIGNER_COMMITMENTS = [S1, S2, S3].map((s) =>
  EcdsaMultisigCoreSimulator.calculateSignerId(s.publicKey, INSTANCE_SALT),
);

const freshMultisig = (threshold: bigint) =>
  EcdsaMultisigCoreSimulator.create(
    INSTANCE_SALT,
    SIGNER_COMMITMENTS,
    threshold,
  );

// Each signer signs the digest it is submitted against. The call-site width
// follows the number of signers.
const approve = (
  m: EcdsaMultisigCoreSimulator,
  digest: Uint8Array,
  signers: Signer[],
) => {
  const pubkeys = signers.map((s) => s.publicKey);
  const signatures = signers.map((s) => sign(s, digest));
  switch (signers.length) {
    case 1:
      return m.assertApprovals1Approval(digest, pubkeys, signatures);
    case 2:
      return m.assertApprovals2Approvals(digest, pubkeys, signatures);
    default:
      return m.assertApprovals3Approvals(digest, pubkeys, signatures);
  }
};

describe('EcdsaMultisigCore', () => {
  describe('constructor', () => {
    it('should reject threshold 0', async () => {
      await expect(freshMultisig(0n)).rejects.toThrow(
        'Signer: threshold must not be zero',
      );
    });

    it('should reject a threshold above the signer count', async () => {
      await expect(freshMultisig(4n)).rejects.toThrow(
        'Signer: threshold exceeds signer count',
      );
    });
  });

  describe('threshold 1', () => {
    it('should accept one approval from any signer', async () => {
      const m = await freshMultisig(1n);
      expect(await m.getThreshold()).toEqual(1n);
      for (const s of [S1, S2, S3]) {
        await approve(m, DIGEST, [s]);
      }
    });

    it('should accept two approvals', async () => {
      await approve(await freshMultisig(1n), DIGEST, [S1, S2]);
    });
  });

  describe('threshold 2', () => {
    it('should reject one approval', async () => {
      await expect(
        approve(await freshMultisig(2n), DIGEST, [S1]),
      ).rejects.toThrow('Signer: threshold not met');
    });

    it('accepts exactly two approvals', async () => {
      await approve(await freshMultisig(2n), DIGEST, [S1, S2]);
    });

    it('should accept three approvals', async () => {
      await approve(await freshMultisig(2n), DIGEST, [S1, S2, S3]);
    });
  });

  describe('threshold 3', () => {
    it('should accept three distinct signers', async () => {
      const m = await freshMultisig(3n);
      expect(await m.getThreshold()).toEqual(3n);
      await approve(m, DIGEST, [S1, S2, S3]);
    });

    it('should reject two approvals', async () => {
      await expect(
        approve(await freshMultisig(3n), DIGEST, [S1, S2]),
      ).rejects.toThrow('Signer: threshold not met');
    });
  });
});
