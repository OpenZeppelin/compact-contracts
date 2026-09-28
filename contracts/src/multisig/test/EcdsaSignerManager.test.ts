import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  highSTwin,
  type Signer,
  sign,
  signerFromLabel,
} from '#test-utils/fixtures/ecdsa.js';
import {
  approvalsOf,
  noneSlot,
  signedApprovals,
  someSlot,
} from './EcdsaTestUtils.js';
import { EcdsaSignerManagerSimulator } from './simulators/EcdsaSignerManagerSimulator.js';
import { EcdsaSignerManagerSmallSetSimulator } from './simulators/EcdsaSignerManagerSmallSetSimulator.js';

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

// Each signer signs the digest it is submitted against, padded with `none`.
const approve = (
  m: EcdsaSignerManagerSimulator,
  digest: Uint8Array,
  signers: Signer[],
) => m.assertApprovals(digest, signedApprovals(signers, digest));

const approvalOf = (signer: Signer, digest: Uint8Array = DIGEST) =>
  someSlot(signer.publicKey, sign(signer, digest));

const smallSet = (threshold: bigint, soloSigner = false) =>
  EcdsaSignerManagerSmallSetSimulator.create(
    INSTANCE_SALT,
    [COMMITMENT1, COMMITMENT2],
    threshold,
    soloSigner,
  );

describe('EcdsaSignerManager', () => {
  describe('constructor', () => {
    beforeEach(async () => {
      manager = await freshManager();
    });

    it('registers all signer commitments', async () => {
      for (const commitment of SIGNER_COMMITMENTS) {
        expect(await manager.isSigner(commitment)).toEqual(true);
      }
    });

    it('does not register a non-signer commitment', async () => {
      expect(await manager.isSigner(OUTSIDER_COMMITMENT)).toEqual(false);
    });

    it('initializes with a 2-of-3 threshold', async () => {
      expect(await manager.getSignerCount()).toEqual(3n);
      expect(await manager.getThreshold()).toEqual(2n);
    });

    it('initializes every threshold from 1 to the signer count', async () => {
      for (const threshold of [1n, 2n, 3n]) {
        const configured = await freshManager(threshold);
        expect(await configured.getThreshold()).toEqual(threshold);
      }
    });

    it('rejects a zero threshold', async () => {
      await expect(freshManager(0n)).rejects.toThrow(
        'Signer: threshold must not be zero',
      );
    });

    it('rejects a threshold above the signer count', async () => {
      await expect(freshManager(4n)).rejects.toThrow(
        'Signer: threshold exceeds signer count',
      );
    });

    it('initializes a 1-of-1 set', async () => {
      const solo = await smallSet(1n, true);
      expect(await solo.getSignerCount()).toEqual(1n);
      expect(await solo.getThreshold()).toEqual(1n);
    });

    it('rejects a 2-of-1 set', async () => {
      await expect(smallSet(2n, true)).rejects.toThrow(
        'Signer: threshold exceeds signer count',
      );
    });

    it('initializes a two-signer set at thresholds 1 and 2', async () => {
      for (const threshold of [1n, 2n]) {
        const pair = await smallSet(threshold);
        expect(await pair.getSignerCount()).toEqual(2n);
        expect(await pair.getThreshold()).toEqual(threshold);
      }
    });

    it('rejects a second initialization', async () => {
      await expect(
        EcdsaSignerManagerSimulator.create(
          INSTANCE_SALT,
          SIGNER_COMMITMENTS,
          2n,
          true,
        ),
      ).rejects.toThrow('EcdsaSignerManager: signers already registered');
    });
  });

  describe('when initialized', () => {
    describe('view', () => {
      beforeAll(async () => {
        manager = await freshManager();
      });

      it('getSignerCount returns 3', async () => {
        expect(await manager.getSignerCount()).toEqual(3n);
      });

      it('getThreshold matches the constructor arg', async () => {
        expect(await manager.getThreshold()).toEqual(2n);
      });

      it('isSigner returns true for each registered commitment', async () => {
        expect(await manager.isSigner(COMMITMENT1)).toEqual(true);
        expect(await manager.isSigner(COMMITMENT2)).toEqual(true);
        expect(await manager.isSigner(COMMITMENT3)).toEqual(true);
      });

      it('isSigner returns false for an unregistered commitment', async () => {
        expect(await manager.isSigner(OUTSIDER_COMMITMENT)).toEqual(false);
      });
    });

    describe('assertApprovals', () => {
      beforeEach(async () => {
        manager = await freshManager();
      });

      describe('at 2-of-3', () => {
        it('accepts signers 1 and 2', async () => {
          await approve(manager, DIGEST, [S1, S2]);
        });

        it('accepts signers 2 and 3', async () => {
          await approve(manager, DIGEST, [S2, S3]);
        });

        it('accepts two approvals in non-adjacent slots', async () => {
          await manager.assertApprovals(DIGEST, [
            approvalOf(S1),
            noneSlot(),
            approvalOf(S3),
          ]);
        });

        it('accepts all three signers', async () => {
          await approve(manager, DIGEST, [S1, S2, S3]);
        });

        it('rejects a single approval', async () => {
          await expect(approve(manager, DIGEST, [S1])).rejects.toThrow(
            'Signer: threshold not met',
          );
        });

        it('rejects all-none slots', async () => {
          await expect(approve(manager, DIGEST, [])).rejects.toThrow(
            'Signer: threshold not met',
          );
        });

        it('does not count a none slot holding a valid approval', async () => {
          await expect(
            manager.assertApprovals(DIGEST, [
              approvalOf(S1),
              noneSlot(approvalOf(S2).value),
              noneSlot(),
            ]),
          ).rejects.toThrow('Signer: threshold not met');
        });

        it('ignores an all-zero none slot', async () => {
          const allZero = {
            pubkey: { x: 0n, y: 0n, identity: false },
            signature: { r: 0n, s: 0n },
          };
          await manager.assertApprovals(DIGEST, [
            approvalOf(S1),
            noneSlot(allZero),
            approvalOf(S2),
          ]);
        });

        it('rejects an identity point in a none slot', async () => {
          const identity = {
            pubkey: { x: 0n, y: 0n, identity: true },
            signature: { r: 0n, s: 0n },
          };
          await expect(
            manager.assertApprovals(DIGEST, [
              approvalOf(S1),
              noneSlot(identity),
              approvalOf(S2),
            ]),
          ).rejects.toThrow(
            'cannot extract the x-coordinate of the secp256k1 identity point',
          );
        });

        it('ignores a none slot holding an outsider with a bad signature', async () => {
          await manager.assertApprovals(DIGEST, [
            noneSlot(approvalOf(OUTSIDER, OTHER_DIGEST).value),
            approvalOf(S1),
            approvalOf(S2),
          ]);
        });
      });

      describe('at 1-of-3', () => {
        it('accepts a single approval in any slot', async () => {
          const oneOfThree = await freshManager(1n);
          await approve(oneOfThree, DIGEST, [S1]);
          await oneOfThree.assertApprovals(DIGEST, [
            noneSlot(),
            noneSlot(),
            approvalOf(S3),
          ]);
        });

        it('rejects all-none slots', async () => {
          const oneOfThree = await freshManager(1n);
          await expect(approve(oneOfThree, DIGEST, [])).rejects.toThrow(
            'Signer: threshold not met',
          );
        });
      });

      describe('at 3-of-3', () => {
        it('accepts all three signers', async () => {
          const threeOfThree = await freshManager(3n);
          await approve(threeOfThree, DIGEST, [S1, S2, S3]);
        });

        it('rejects two approvals', async () => {
          const threeOfThree = await freshManager(3n);
          await expect(approve(threeOfThree, DIGEST, [S1, S3])).rejects.toThrow(
            'Signer: threshold not met',
          );
        });
      });

      describe('duplicates', () => {
        it('rejects a duplicate in adjacent slots', async () => {
          await expect(approve(manager, DIGEST, [S1, S1])).rejects.toThrow(
            'Multisig: duplicate signer',
          );
        });

        it('rejects a duplicate in slots 0 and 2', async () => {
          await expect(
            manager.assertApprovals(DIGEST, [
              approvalOf(S1),
              noneSlot(),
              approvalOf(S1),
            ]),
          ).rejects.toThrow('Multisig: duplicate signer');
        });

        it('rejects a duplicate in slots 1 and 2 behind a distinct slot 0', async () => {
          await expect(approve(manager, DIGEST, [S1, S2, S2])).rejects.toThrow(
            'Multisig: duplicate signer',
          );
        });

        it('ignores a none slot repeating a some slot', async () => {
          await manager.assertApprovals(DIGEST, [
            approvalOf(S1),
            noneSlot(approvalOf(S1).value),
            approvalOf(S2),
          ]);
        });
      });

      describe('invalid approvals', () => {
        it('rejects a non-signer pubkey', async () => {
          await expect(
            approve(manager, DIGEST, [S1, OUTSIDER]),
          ).rejects.toThrow('Signer: not a signer');
        });

        it('rejects a non-signer pubkey above the threshold', async () => {
          await expect(
            approve(manager, DIGEST, [S1, S2, OUTSIDER]),
          ).rejects.toThrow('Signer: not a signer');
        });

        it('rejects a signature from the wrong key', async () => {
          await expect(
            manager.assertApprovals(
              DIGEST,
              approvalsOf(
                [S1.publicKey, S2.publicKey],
                [sign(S1, DIGEST), sign(S3, DIGEST)],
              ),
            ),
          ).rejects.toThrow('Multisig: invalid signature');
        });

        it('rejects a signature over a different digest', async () => {
          await expect(
            manager.assertApprovals(DIGEST, [
              approvalOf(S1),
              approvalOf(S2, OTHER_DIGEST),
              noneSlot(),
            ]),
          ).rejects.toThrow('Multisig: invalid signature');
        });

        it('rejects a high-s signature', async () => {
          // The twin verifies under plain ECDSA, so only the low-s gate can be
          // what rejects it.
          await expect(
            manager.assertApprovals(
              DIGEST,
              approvalsOf(
                [S1.publicKey, S2.publicKey],
                [sign(S1, DIGEST), highSTwin(sign(S2, DIGEST))],
              ),
            ),
          ).rejects.toThrow('Multisig: invalid signature');
        });
      });

      describe('small sets', () => {
        it('accepts the only signer of a 1-of-1 set', async () => {
          const solo = await smallSet(1n, true);
          await solo.assertSoloApproval(DIGEST, [approvalOf(S1)]);
        });

        it('rejects a none slot in a 1-of-1 set', async () => {
          const solo = await smallSet(1n, true);
          await expect(
            solo.assertSoloApproval(DIGEST, [noneSlot()]),
          ).rejects.toThrow('Signer: threshold not met');
        });

        it('rejects the unregistered second signer of a 1-of-1 set', async () => {
          const solo = await smallSet(1n, true);
          await expect(
            solo.assertSoloApproval(DIGEST, [approvalOf(S2)]),
          ).rejects.toThrow('Signer: not a signer');
        });

        it('accepts both signers of a 2-of-2 set', async () => {
          const pair = await smallSet(2n);
          await pair.assertApprovals(DIGEST, [approvalOf(S1), approvalOf(S2)]);
        });

        it('rejects one signer of a 2-of-2 set', async () => {
          const pair = await smallSet(2n);
          await expect(
            pair.assertApprovals(DIGEST, [approvalOf(S1), noneSlot()]),
          ).rejects.toThrow('Signer: threshold not met');
        });

        it('accepts either signer of a 1-of-2 set', async () => {
          const pair = await smallSet(1n);
          await pair.assertApprovals(DIGEST, [noneSlot(), approvalOf(S2)]);
          await pair.assertApprovals(DIGEST, [approvalOf(S1), noneSlot()]);
        });
      });
    });

    describe('calculateSignerId', () => {
      it('is deterministic for the same key and salt', () => {
        expect(commitmentOf(S1)).toEqual(COMMITMENT1);
      });

      it('differs across keys under the same salt', () => {
        expect(COMMITMENT1).not.toEqual(COMMITMENT2);
        expect(COMMITMENT2).not.toEqual(COMMITMENT3);
      });

      it('differs across salts for the same key', () => {
        expect(commitmentOf(S1, OTHER_SALT)).not.toEqual(COMMITMENT1);
      });

      it('matches the constructor-registered commitments', async () => {
        manager = await freshManager();
        expect(await manager.isSigner(commitmentOf(S1))).toEqual(true);
        expect(await manager.isSigner(commitmentOf(S1, OTHER_SALT))).toEqual(
          false,
        );
      });

      it('rejects the identity point', () => {
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
