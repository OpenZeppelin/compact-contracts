import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  highSTwin,
  type Signer,
  sign,
  signerFromLabel,
} from '#test-utils/fixtures/ecdsa.js';
import { EcdsaMultisig1To1Simulator } from './simulators/EcdsaMultisig1To1Simulator.js';
import { EcdsaMultisig1To3Simulator } from './simulators/EcdsaMultisig1To3Simulator.js';
import { EcdsaMultisig2To1Simulator } from './simulators/EcdsaMultisig2To1Simulator.js';
import { EcdsaMultisig2To3And3To3Simulator } from './simulators/EcdsaMultisig2To3And3To3Simulator.js';
import { EcdsaMultisig2To3Simulator } from './simulators/EcdsaMultisig2To3Simulator.js';
import { EcdsaMultisig3To3Simulator } from './simulators/EcdsaMultisig3To3Simulator.js';

const INSTANCE_SALT = new Uint8Array(32).fill(0xaa);
const OTHER_SALT = new Uint8Array(32).fill(0xbb);

// The module verifies a caller-supplied digest, so any 32-byte value works;
// no operation encoding is reconstructed here.
const DIGEST = new Uint8Array(32).fill(0x42);
const OTHER_DIGEST = new Uint8Array(32).fill(0x43);

// Real secp256k1 signers, deterministic from labels. No caller identity is
// involved, so this spec runs unchanged on live.
const S1 = signerFromLabel('ecdsa-multisig-1');
const S2 = signerFromLabel('ecdsa-multisig-2');
const S3 = signerFromLabel('ecdsa-multisig-3');
const OUTSIDER = signerFromLabel('ecdsa-multisig-outsider');

const commitmentOf = (signer: Signer, salt: Uint8Array = INSTANCE_SALT) =>
  EcdsaMultisig2To3Simulator.calculateSignerId(signer.publicKey, salt);

const COMMITMENT1 = commitmentOf(S1);
const COMMITMENT2 = commitmentOf(S2);
const COMMITMENT3 = commitmentOf(S3);
const SIGNER_COMMITMENTS = [COMMITMENT1, COMMITMENT2, COMMITMENT3];
const OUTSIDER_COMMITMENT = commitmentOf(OUTSIDER);

let manager: EcdsaMultisig2To3Simulator;

// Mutating groups build one manager per test (`beforeEach`); the read-only
// `view` group shares one deploy (`beforeAll`).
const freshMultisig = () =>
  EcdsaMultisig2To3Simulator.create(INSTANCE_SALT, SIGNER_COMMITMENTS, true);

// Each signer signs the digest it is submitted against.
const approve = (
  m: EcdsaMultisig2To3Simulator,
  digest: Uint8Array,
  signers: Signer[],
) =>
  m.assertApprovals(
    digest,
    signers.map((s) => s.publicKey),
    signers.map((s) => sign(s, digest)),
  );

describe('EcdsaMultisig', () => {
  describe('constructor', () => {
    beforeEach(async () => {
      manager = await freshMultisig();
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

    it('should initialize a single signer at threshold 1 and accept its approval', async () => {
      const solo = await EcdsaMultisig1To1Simulator.create(
        INSTANCE_SALT,
        COMMITMENT1,
      );
      expect(await solo.getSignerCount()).toEqual(1n);
      expect(await solo.getThreshold()).toEqual(1n);
      await solo.assertApprovals(DIGEST, [S1.publicKey], [sign(S1, DIGEST)]);
    });

    it('should fail when initialized twice', async () => {
      await expect(
        EcdsaMultisig2To3Simulator.create(
          INSTANCE_SALT,
          SIGNER_COMMITMENTS,
          true,
          true,
        ),
      ).rejects.toThrow('EcdsaMultisig: signers already registered');
    });

    it('rejects a width above the signer count', async () => {
      await expect(
        EcdsaMultisig2To1Simulator.create(INSTANCE_SALT, COMMITMENT1),
      ).rejects.toThrow('Signer: threshold exceeds signer count');
    });
  });

  describe('uninitialized', () => {
    it('should reject approvals with the threshold unset', async () => {
      const uninitialized = await EcdsaMultisig2To3Simulator.create(
        INSTANCE_SALT,
        SIGNER_COMMITMENTS,
        false,
      );
      expect(await uninitialized.getSignerCount()).toEqual(0n);
      await expect(approve(uninitialized, DIGEST, [S1, S2])).rejects.toThrow(
        'Signer: threshold not set',
      );
    });
  });

  describe('3-of-3', () => {
    let all: EcdsaMultisig3To3Simulator;

    beforeEach(async () => {
      all = await EcdsaMultisig3To3Simulator.create(
        INSTANCE_SALT,
        SIGNER_COMMITMENTS,
      );
    });

    const approveAll = (signers: Signer[]) =>
      all.assertApprovals(
        DIGEST,
        signers.map((s) => s.publicKey),
        signers.map((s) => sign(s, DIGEST)),
      );

    it('should initialize with 3-of-3 threshold', async () => {
      expect(await all.getSignerCount()).toEqual(3n);
      expect(await all.getThreshold()).toEqual(3n);
    });

    it('should accept approvals from all three signers', async () => {
      await approveAll([S1, S2, S3]);
    });

    it('should reject a non-adjacent duplicate signer', async () => {
      await expect(approveAll([S1, S2, S1])).rejects.toThrow(
        'EcdsaMultisig: duplicate signer',
      );
    });

    it('should reject a non-signer pubkey in the last slot', async () => {
      await expect(approveAll([S1, S2, OUTSIDER])).rejects.toThrow(
        'Signer: not a signer',
      );
    });

    it('rejects a third approval signed over another digest', async () => {
      await expect(
        all.assertApprovals(
          DIGEST,
          [S1.publicKey, S2.publicKey, S3.publicKey],
          [sign(S1, DIGEST), sign(S2, DIGEST), sign(S3, OTHER_DIGEST)],
        ),
      ).rejects.toThrow('EcdsaMultisig: invalid signature');
    });
  });

  describe('1-of-3', () => {
    let oneOfThree: EcdsaMultisig1To3Simulator;

    beforeEach(async () => {
      oneOfThree = await EcdsaMultisig1To3Simulator.create(
        INSTANCE_SALT,
        SIGNER_COMMITMENTS,
      );
    });

    const approveOne = (signer: Signer) =>
      oneOfThree.assertApprovals(
        DIGEST,
        [signer.publicKey],
        [sign(signer, DIGEST)],
      );

    it('initializes with 1-of-3 threshold', async () => {
      expect(await oneOfThree.getSignerCount()).toEqual(3n);
      expect(await oneOfThree.getThreshold()).toEqual(1n);
    });

    it('accepts one approval from any signer', async () => {
      for (const s of [S1, S2, S3]) {
        await approveOne(s);
      }
    });

    it('rejects a lone non-signer approval', async () => {
      await expect(approveOne(OUTSIDER)).rejects.toThrow(
        'Signer: not a signer',
      );
    });
  });

  describe('two widths in one contract', () => {
    let shared: EcdsaMultisig2To3And3To3Simulator;

    const approveAt = (width: 2 | 3, signers: Signer[]) => {
      const pubkeys = signers.map((s) => s.publicKey);
      const signatures = signers.map((s) => sign(s, DIGEST));
      return width === 2
        ? shared.assertApprovals2Approvals(DIGEST, pubkeys, signatures)
        : shared.assertApprovals3Approvals(DIGEST, pubkeys, signatures);
    };

    it('rejects initializing the second width', async () => {
      await expect(
        EcdsaMultisig2To3And3To3Simulator.create(
          INSTANCE_SALT,
          SIGNER_COMMITMENTS,
          true,
        ),
      ).rejects.toThrow('EcdsaMultisig: signers already registered');
    });

    describe('with only width 2 initialized', () => {
      beforeEach(async () => {
        shared = await EcdsaMultisig2To3And3To3Simulator.create(
          INSTANCE_SALT,
          SIGNER_COMMITMENTS,
          false,
        );
      });

      it('reads threshold 2 at both widths', async () => {
        expect(await shared.getThreshold2()).toEqual(2n);
        expect(await shared.getThreshold3()).toEqual(2n);
      });

      it('rejects width-3 approvals: the uninitialized width has no salt', async () => {
        await expect(approveAt(3, [S1, S2, S3])).rejects.toThrow(
          'Signer: not a signer',
        );
      });

      it('accepts two approvals at width 2', async () => {
        await approveAt(2, [S1, S2]);
      });
    });
  });

  describe('when initialized', () => {
    describe('view', () => {
      beforeAll(async () => {
        manager = await freshMultisig();
      });

      it('getSignerCount should return 3', async () => {
        expect(await manager.getSignerCount()).toEqual(3n);
      });

      it('getThreshold should return 2', async () => {
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
        manager = await freshMultisig();
      });

      it('should accept two valid signatures from signers 1 and 2', async () => {
        await approve(manager, DIGEST, [S1, S2]);
      });

      it('should accept two valid signatures from signers 2 and 3', async () => {
        await approve(manager, DIGEST, [S2, S3]);
      });

      it('should reject duplicate signer', async () => {
        await expect(approve(manager, DIGEST, [S1, S1])).rejects.toThrow(
          'EcdsaMultisig: duplicate signer',
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
        ).rejects.toThrow('EcdsaMultisig: invalid signature');
      });

      it('should reject a signature over a different digest', async () => {
        await expect(
          manager.assertApprovals(
            DIGEST,
            [S1.publicKey, S2.publicKey],
            [sign(S1, DIGEST), sign(S2, OTHER_DIGEST)],
          ),
        ).rejects.toThrow('EcdsaMultisig: invalid signature');
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
        ).rejects.toThrow('EcdsaMultisig: invalid signature');
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

      it('should match the pinned vector', () => {
        // SHA-256 over little-endian pkX and pkY, the salt, and
        // pad(32, "ecdsaMultisig:signer:").
        expect(Buffer.from(COMMITMENT1).toString('hex')).toEqual(
          'f258010243b8adea16f1c6ded83c78d46dbbec0a7471c8ed012475cf246a3e03',
        );
      });

      it('should match the constructor-registered commitments', async () => {
        manager = await freshMultisig();
        expect(await manager.isSigner(commitmentOf(S1))).toEqual(true);
        expect(await manager.isSigner(commitmentOf(S1, OTHER_SALT))).toEqual(
          false,
        );
      });

      it('should reject the identity point', () => {
        expect(() =>
          EcdsaMultisig2To3Simulator.calculateSignerId(
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
