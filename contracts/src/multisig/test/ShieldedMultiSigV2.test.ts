import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  highSTwin,
  type Signer,
  sign,
  signerFromLabel,
} from '#test-utils/fixtures/ecdsa.js';
import {
  GENESIS_NATIVE_SHIELDED_TOKEN_COLORS,
  encodeShieldedCoinInfo as makeCoin,
} from '#test-utils/fixtures/nativeShieldedToken.js';
import { executeMsgHash } from './EcdsaTestUtils.js';
import { ShieldedMultiSigV2Simulator } from './simulators/ShieldedMultiSigV2Simulator.js';

const RecipientKind = { ShieldedUser: 0, UnshieldedUser: 1, Contract: 2 };

const INSTANCE_SALT = new Uint8Array(32).fill(0xaa);
// A shielded token type the deployer wallet holds on live (genesis-minted);
// `fill(1)` would be unfunded on live. On dry the color is arbitrary.
const COLOR = GENESIS_NATIVE_SHIELDED_TOKEN_COLORS.nativeShieldedToken1;
const AMOUNT = 1000n;

// Real secp256k1 signers, deterministic from labels. Authorization needs a
// genuine ECDSA signature over the operation digest, but it stays
// caller-agnostic (no `ownPublicKey` identity), so this spec runs unchanged on
// live.
const S1 = signerFromLabel('v2-signer-1');
const S2 = signerFromLabel('v2-signer-2');
const S3 = signerFromLabel('v2-signer-3');
const OUTSIDER = signerFromLabel('v2-outsider');

const COMMITMENT1 = ShieldedMultiSigV2Simulator.calculateSignerId(
  S1.publicKey,
  INSTANCE_SALT,
);
const COMMITMENT2 = ShieldedMultiSigV2Simulator.calculateSignerId(
  S2.publicKey,
  INSTANCE_SALT,
);
const COMMITMENT3 = ShieldedMultiSigV2Simulator.calculateSignerId(
  S3.publicKey,
  INSTANCE_SALT,
);
const SIGNER_COMMITMENTS = [COMMITMENT1, COMMITMENT2, COMMITMENT3];

function makeRecipient(address: Uint8Array): {
  kind: number;
  address: Uint8Array;
} {
  return { kind: RecipientKind.ShieldedUser, address };
}

function makeQualifiedCoin(
  color: Uint8Array,
  value: bigint,
  mtIndex: bigint,
  nonce?: Uint8Array,
): {
  nonce: Uint8Array;
  color: Uint8Array;
  value: bigint;
  mt_index: bigint;
} {
  return {
    nonce: nonce ?? new Uint8Array(32).fill(0),
    color,
    value,
    mt_index: mtIndex,
  };
}

const hexBytes = (hex: string): Uint8Array =>
  Uint8Array.from(Buffer.from(hex, 'hex'));

let multisig: ShieldedMultiSigV2Simulator;

// The digest `execute` computes: persistentHash([domain, self, nonce,
// persistentHash(to), coin.color, amount]).
async function executeDigest(
  m: ShieldedMultiSigV2Simulator,
  to: { kind: number; address: Uint8Array },
  coin: { color: Uint8Array },
  amount: bigint,
): Promise<Uint8Array> {
  return executeMsgHash({
    contractAddress: Uint8Array.from(Buffer.from(m.contractAddress, 'hex')),
    nonce: await m.getNonce(),
    to,
    coinColor: coin.color,
    amount,
  });
}

// A fresh 2-of-3 stateless multisig. Mutating groups build one per test
// (`beforeEach`); the read-only `view` group shares one deploy (`beforeAll`).
const freshMultisig = () =>
  ShieldedMultiSigV2Simulator.create(INSTANCE_SALT, SIGNER_COMMITMENTS, 2n);

describe('ShieldedMultiSigV2', () => {
  describe('constructor', () => {
    it('should initialize with 2-of-3 threshold', async () => {
      multisig = await ShieldedMultiSigV2Simulator.create(
        INSTANCE_SALT,
        SIGNER_COMMITMENTS,
        2n,
      );
      expect(await multisig.getSignerCount()).toEqual(3n);
      expect(await multisig.getThreshold()).toEqual(2n);
    });

    it('should initialize with 1-of-3 threshold', async () => {
      multisig = await ShieldedMultiSigV2Simulator.create(
        INSTANCE_SALT,
        SIGNER_COMMITMENTS,
        1n,
      );
      expect(await multisig.getThreshold()).toEqual(1n);
    });

    it('should fail with zero threshold', async () => {
      await expect(
        ShieldedMultiSigV2Simulator.create(
          INSTANCE_SALT,
          SIGNER_COMMITMENTS,
          0n,
        ),
      ).rejects.toThrow('Signer: threshold must not be zero');
    });

    it('should fail with threshold greater than 2', async () => {
      await expect(
        ShieldedMultiSigV2Simulator.create(
          INSTANCE_SALT,
          SIGNER_COMMITMENTS,
          3n,
        ),
      ).rejects.toThrow(
        'ShieldedMultiSigV2: threshold cannot exceed 2 (execute verifies at most 2 signatures)',
      );
    });

    it('should register all signer commitments', async () => {
      multisig = await ShieldedMultiSigV2Simulator.create(
        INSTANCE_SALT,
        SIGNER_COMMITMENTS,
        2n,
      );
      for (const commitment of SIGNER_COMMITMENTS) {
        expect(await multisig.isSigner(commitment)).toEqual(true);
      }
    });

    it('should reject a non-signer commitment', async () => {
      multisig = await ShieldedMultiSigV2Simulator.create(
        INSTANCE_SALT,
        SIGNER_COMMITMENTS,
        2n,
      );
      const unknown = ShieldedMultiSigV2Simulator.calculateSignerId(
        OUTSIDER.publicKey,
        INSTANCE_SALT,
      );
      expect(await multisig.isSigner(unknown)).toEqual(false);
    });
  });

  describe('when initialized', () => {
    describe('view', () => {
      beforeAll(async () => {
        multisig = await freshMultisig();
      });

      it('getNonce should start at 0', async () => {
        expect(await multisig.getNonce()).toEqual(0n);
      });

      it('getSignerCount should return 3', async () => {
        expect(await multisig.getSignerCount()).toEqual(3n);
      });

      it('getThreshold should match constructor arg', async () => {
        expect(await multisig.getThreshold()).toEqual(2n);
      });
    });

    describe('deposit', () => {
      beforeEach(async () => {
        multisig = await freshMultisig();
      });

      it('should accept deposits without reverting', async () => {
        await multisig.deposit(makeCoin(COLOR, AMOUNT));
      });
    });

    describe('execute', () => {
      beforeEach(async () => {
        multisig = await freshMultisig();
      });

      // A real send spends a deposited coin, which the live harness cannot yet
      // fund and track.
      describe.skipIf(isLiveBackend())('happy path (dry only)', () => {
        // Both output nonces derive from the deposited coin, so sending 100
        // of a 1000 deposit is fully determined.
        const EXPECTED_SEND_RESULT = {
          change: {
            is_some: true,
            value: {
              nonce: hexBytes(
                '1d62fa499a81ab6b63c7e8fb768dcb46729383838adec43fa70b2381e0765400',
              ),
              color: COLOR,
              value: 900n,
            },
          },
          sent: {
            nonce: hexBytes(
              'f0925e45d140674d1bbc00240a017b3d9635b803ee6e75a61569afd28440cf00',
            ),
            color: COLOR,
            value: 100n,
          },
        };

        async function execute(
          to: { kind: number; address: Uint8Array },
          amount: bigint,
          coin: {
            nonce: Uint8Array;
            color: Uint8Array;
            value: bigint;
            mt_index: bigint;
          },
          signers: Signer[],
        ) {
          const digest = await executeDigest(multisig, to, coin, amount);
          return multisig.execute(
            to,
            amount,
            coin,
            signers.map((s) => s.publicKey),
            signers.map((s) => sign(s, digest)),
          );
        }

        it('should execute a send with signers 0 and 1', async () => {
          await multisig.deposit(makeCoin(COLOR, AMOUNT));
          const to = makeRecipient(new Uint8Array(32).fill(7));
          const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
          expect(await execute(to, 100n, coin, [S1, S2])).toStrictEqual(
            EXPECTED_SEND_RESULT,
          );
          expect(await multisig.getNonce()).toEqual(1n);
        });

        it('should execute a send with signers 1 and 2', async () => {
          await multisig.deposit(makeCoin(COLOR, AMOUNT));
          const to = makeRecipient(new Uint8Array(32).fill(7));
          const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
          // Same expectation under different approvers: authorization
          // cannot influence the coins produced.
          expect(await execute(to, 100n, coin, [S2, S3])).toStrictEqual(
            EXPECTED_SEND_RESULT,
          );
          expect(await multisig.getNonce()).toEqual(1n);
        });

        it('should reject signatures replayed after the nonce moves', async () => {
          await multisig.deposit(makeCoin(COLOR, AMOUNT));
          const to = makeRecipient(new Uint8Array(32).fill(7));
          const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
          const digest = await executeDigest(multisig, to, coin, 100n);
          const pubkeys = [S1.publicKey, S2.publicKey];
          const sigs = [sign(S1, digest), sign(S2, digest)];

          await multisig.execute(to, 100n, coin, pubkeys, sigs);
          expect(await multisig.getNonce()).toEqual(1n);
          await expect(
            multisig.execute(to, 100n, coin, pubkeys, sigs),
          ).rejects.toThrow('Multisig: invalid signature');
        });
      });

      it('should reject duplicate signer', async () => {
        const to = makeRecipient(new Uint8Array(32).fill(7));
        const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
        const digest = await executeDigest(multisig, to, coin, 100n);
        await expect(
          multisig.execute(
            to,
            100n,
            coin,
            [S1.publicKey, S1.publicKey],
            [sign(S1, digest), sign(S1, digest)],
          ),
        ).rejects.toThrow('Multisig: duplicate signer');
      });

      it('should reject a non-signer pubkey', async () => {
        const to = makeRecipient(new Uint8Array(32).fill(7));
        const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
        const digest = await executeDigest(multisig, to, coin, 100n);
        await expect(
          multisig.execute(
            to,
            100n,
            coin,
            [S1.publicKey, OUTSIDER.publicKey],
            [sign(S1, digest), sign(OUTSIDER, digest)],
          ),
        ).rejects.toThrow('Signer: not a signer');
      });

      it('should reject a signature from the wrong key', async () => {
        const to = makeRecipient(new Uint8Array(32).fill(7));
        const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
        const digest = await executeDigest(multisig, to, coin, 100n);
        // S2's pubkey is registered, but S3 produced the signature.
        await expect(
          multisig.execute(
            to,
            100n,
            coin,
            [S1.publicKey, S2.publicKey],
            [sign(S1, digest), sign(S3, digest)],
          ),
        ).rejects.toThrow('Multisig: invalid signature');
      });

      it('should reject a signature over a different digest', async () => {
        const to = makeRecipient(new Uint8Array(32).fill(7));
        const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
        const digest = await executeDigest(multisig, to, coin, 100n);
        const wrongDigest = await executeDigest(multisig, to, coin, 999n);
        await expect(
          multisig.execute(
            to,
            100n,
            coin,
            [S1.publicKey, S2.publicKey],
            [sign(S1, digest), sign(S2, wrongDigest)],
          ),
        ).rejects.toThrow('Multisig: invalid signature');
      });

      it('should reject a high-s signature', async () => {
        const to = makeRecipient(new Uint8Array(32).fill(7));
        const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
        const digest = await executeDigest(multisig, to, coin, 100n);
        // The twin verifies under plain ECDSA, so only the low-s gate can
        // reject it.
        await expect(
          multisig.execute(
            to,
            100n,
            coin,
            [S1.publicKey, S2.publicKey],
            [sign(S1, digest), highSTwin(sign(S2, digest))],
          ),
        ).rejects.toThrow('Multisig: invalid signature');
      });

      it('should reject a signature over a different recipient kind', async () => {
        const address = new Uint8Array(32).fill(7);
        const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
        // Signed for a shielded user; submitted for a contract at the same
        // address bytes.
        const digest = await executeDigest(
          multisig,
          makeRecipient(address),
          coin,
          100n,
        );
        await expect(
          multisig.execute(
            { kind: RecipientKind.Contract, address },
            100n,
            coin,
            [S1.publicKey, S2.publicKey],
            [sign(S1, digest), sign(S2, digest)],
          ),
        ).rejects.toThrow('Multisig: invalid signature');
      });
    });

    describe('cross-instance replay', () => {
      // A distinct deployed address for the second instance, so its digest
      // (which commits to `kernel.self()`) differs from the first's. Dry only:
      // live deploys already differ, and live `create()` refuses an address
      // other than the one actually deployed.
      const OTHER_ADDRESS = '11'.repeat(32);

      it('should reject a signature bound to another instance', async () => {
        const instance1 = await freshMultisig();
        const instance2 = await ShieldedMultiSigV2Simulator.create(
          INSTANCE_SALT,
          SIGNER_COMMITMENTS,
          2n,
          isLiveBackend() ? {} : { contractAddress: OTHER_ADDRESS },
        );
        const to = makeRecipient(new Uint8Array(32).fill(7));
        const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
        const digest = await executeDigest(instance1, to, coin, 100n);
        await expect(
          instance2.execute(
            to,
            100n,
            coin,
            [S1.publicKey, S2.publicKey],
            [sign(S1, digest), sign(S2, digest)],
          ),
        ).rejects.toThrow('Multisig: invalid signature');
      });
    });
  });
});
