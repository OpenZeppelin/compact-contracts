import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  highSTwin,
  type Signer,
  sign,
  signerFromLabel,
} from '#test-utils/fixtures/ecdsa.js';
import { EcdsaSignerManagerSimulator } from './simulators/EcdsaSignerManagerSimulator.js';

const INSTANCE_SALT = new Uint8Array(32).fill(0xaa);
const OTHER_SALT = new Uint8Array(32).fill(0xbb);

// The module verifies a caller-supplied digest, so any 32-byte value works;
// no operation encoding is reconstructed here.
const DIGEST = new Uint8Array(32).fill(0x42);
const OTHER_DIGEST = new Uint8Array(32).fill(0x43);

// Real secp256k1 signers, deterministic from labels. No caller identity is
// involved, so this spec runs unchanged on live.
const S1 = signerFromLabel('ecdsa-manager-1');
const S2 = signerFromLabel('ecdsa-manager-2');
const S3 = signerFromLabel('ecdsa-manager-3');
const OUTSIDER = signerFromLabel('ecdsa-manager-outsider');

const commitmentOf = (signer: Signer, salt: Uint8Array = INSTANCE_SALT) =>
  EcdsaSignerManagerSimulator.calculateSignerId(signer.publicKey, salt);

const COMMITMENT1 = commitmentOf(S1);
const COMMITMENT2 = commitmentOf(S2);
const COMMITMENT3 = commitmentOf(S3);
const SIGNER_COMMITMENTS = [COMMITMENT1, COMMITMENT2, COMMITMENT3];
const OUTSIDER_COMMITMENT = commitmentOf(OUTSIDER);

let manager: EcdsaSignerManagerSimulator;

// Mutating groups build one manager per test (`beforeEach`); the read-only
// `view` group shares one deploy (`beforeAll`).
const freshManager = (threshold = 2n) =>
  EcdsaSignerManagerSimulator.create(
    INSTANCE_SALT,
    SIGNER_COMMITMENTS,
    threshold,
  );

// Each signer signs the digest it is submitted against.
const approve = (
  m: EcdsaSignerManagerSimulator,
  digest: Uint8Array,
  signers: Signer[],
) =>
  m.assertApprovals(
    digest,
    signers.map((s) => s.publicKey),
    signers.map((s) => sign(s, digest)),
  );

describe('EcdsaSignerManager', () => {
  describe('constructor', () => {
    beforeEach(async () => {
      manager = await freshManager();
    });

    it('should register all signer commitments', async () => {
      for (const commitment of SIGNER_COMMITMENTS) {
        expect(await manager.isSigner(commitment)).toEqual(true);
      }
    });

    it('should reject a non-signer commitment', async () => {
      expect(await manager.isSigner(OUTSIDER_COMMITMENT)).toEqual(false);
    });

    it('should initialize with 2-of-3 threshold', async () => {
      expect(await manager.getSignerCount()).toEqual(3n);
      expect(await manager.getThreshold()).toEqual(2n);
    });

    it('should initialize with 1-of-3 threshold', async () => {
      const oneOfThree = await freshManager(1n);
      expect(await oneOfThree.getThreshold()).toEqual(1n);
    });

    it('should fail with zero threshold', async () => {
      await expect(freshManager(0n)).rejects.toThrow(
        'Signer: threshold must not be zero',
      );
    });

    it('should fail with a threshold above the signer count', async () => {
      await expect(freshManager(4n)).rejects.toThrow(
        'Signer: threshold exceeds signer count',
      );
    });
  });

  describe('when initialized', () => {
    describe('view', () => {
      beforeAll(async () => {
        manager = await freshManager();
      });

      it('getSignerCount should return 3', async () => {
        expect(await manager.getSignerCount()).toEqual(3n);
      });

      it('getThreshold should match constructor arg', async () => {
        expect(await manager.getThreshold()).toEqual(2n);
      });

      it('isSigner should return true for each registered commitment', async () => {
        expect(await manager.isSigner(COMMITMENT1)).toEqual(true);
        expect(await manager.isSigner(COMMITMENT2)).toEqual(true);
        expect(await manager.isSigner(COMMITMENT3)).toEqual(true);
      });

      it('isSigner should return false for an unregistered commitment', async () => {
        expect(await manager.isSigner(OUTSIDER_COMMITMENT)).toEqual(false);
      });
    });

    describe('assertApprovals', () => {
      beforeEach(async () => {
        manager = await freshManager();
      });

      it('should accept two valid signatures from signers 1 and 2', async () => {
        await approve(manager, DIGEST, [S1, S2]);
      });

      it('should accept two valid signatures from signers 2 and 3', async () => {
        await approve(manager, DIGEST, [S2, S3]);
      });

      it('should accept two valid signatures under a 1-of-3 threshold', async () => {
        const oneOfThree = await freshManager(1n);
        await approve(oneOfThree, DIGEST, [S1, S2]);
      });

      // The Vector<2> surface contributes at most 2 approvals, so a 3-of-3
      // configuration can never be satisfied through it.
      it('should reject approvals below the threshold', async () => {
        const threeOfThree = await freshManager(3n);
        await expect(approve(threeOfThree, DIGEST, [S1, S2])).rejects.toThrow(
          'Signer: threshold not met',
        );
      });

      it('should reject duplicate signer', async () => {
        await expect(approve(manager, DIGEST, [S1, S1])).rejects.toThrow(
          'Multisig: duplicate signer',
        );
      });

      it('should reject a non-signer pubkey', async () => {
        await expect(approve(manager, DIGEST, [S1, OUTSIDER])).rejects.toThrow(
          'Signer: not a signer',
        );
      });

      it('should reject a signature from the wrong key', async () => {
        // S2's pubkey is registered, but S3 produced the signature.
        await expect(
          manager.assertApprovals(
            DIGEST,
            [S1.publicKey, S2.publicKey],
            [sign(S1, DIGEST), sign(S3, DIGEST)],
          ),
        ).rejects.toThrow('Multisig: invalid signature');
      });

      it('should reject a signature over a different digest', async () => {
        await expect(
          manager.assertApprovals(
            DIGEST,
            [S1.publicKey, S2.publicKey],
            [sign(S1, DIGEST), sign(S2, OTHER_DIGEST)],
          ),
        ).rejects.toThrow('Multisig: invalid signature');
      });

      it('should reject a high-s signature', async () => {
        // The twin verifies under plain ECDSA, so only the low-s gate can be
        // what rejects it.
        await expect(
          manager.assertApprovals(
            DIGEST,
            [S1.publicKey, S2.publicKey],
            [sign(S1, DIGEST), highSTwin(sign(S2, DIGEST))],
          ),
        ).rejects.toThrow('Multisig: invalid signature');
      });
    });

    describe('calculateSignerId', () => {
      it('should be deterministic for the same key and salt', () => {
        expect(commitmentOf(S1)).toEqual(COMMITMENT1);
      });

      it('should differ across keys under the same salt', () => {
        expect(COMMITMENT1).not.toEqual(COMMITMENT2);
        expect(COMMITMENT2).not.toEqual(COMMITMENT3);
      });

      it('should differ across salts for the same key', () => {
        expect(commitmentOf(S1, OTHER_SALT)).not.toEqual(COMMITMENT1);
      });

      it('should match the constructor-registered commitments', async () => {
        manager = await freshManager();
        expect(await manager.isSigner(commitmentOf(S1))).toEqual(true);
        expect(await manager.isSigner(commitmentOf(S1, OTHER_SALT))).toEqual(
          false,
        );
      });

      it('should reject the identity point', () => {
        expect(() =>
          EcdsaSignerManagerSimulator.calculateSignerId(
            { x: 0n, y: 0n, identity: true },
            INSTANCE_SALT,
          ),
        ).toThrow(
          'cannot extract the x-coordinate of the secp256k1 identity point',
        );
      });
    });
  });
});
