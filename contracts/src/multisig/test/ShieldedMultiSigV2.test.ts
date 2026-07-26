import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  GENESIS_NATIVE_SHIELDED_TOKEN_COLORS,
  encodeShieldedCoinInfo as makeCoin,
} from '#test-utils/fixtures/nativeShieldedToken.js';
import {
  executeMsgHash,
  type Signer,
  sign,
  signerFromLabel,
} from './EcdsaTestUtils.js';
import { ShieldedMultiSigV2Simulator } from './simulators/ShieldedMultiSigV2Simulator.js';

const RecipientKind = { ShieldedUser: 0, UnshieldedUser: 1, Contract: 2 };

const INSTANCE_SALT = new Uint8Array(32).fill(0xaa);
// A shielded token type the deployer wallet holds on live (genesis-minted);
// `fill(1)` would be unfunded on live. On dry the color is arbitrary.
const COLOR = GENESIS_NATIVE_SHIELDED_TOKEN_COLORS.nativeShieldedToken1;
const AMOUNT = 1000n;

// Real secp256k1 signers (deterministic from labels). Authorization requires a
// real ECDSA signature over the operation's persistentHash message digest.
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

let multisig: ShieldedMultiSigV2Simulator;

// The execute digest the contract computes: persistentHash([nonce, to.address,
// coin.color, amount]).
async function executeDigest(
  m: ShieldedMultiSigV2Simulator,
  to: { address: Uint8Array },
  coin: { color: Uint8Array },
  amount: bigint,
): Promise<Uint8Array> {
  return executeMsgHash({
    nonce: await m.getNonce(),
    toAddress: to.address,
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
      multisig = await freshMultisig();
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
        ShieldedMultiSigV2Simulator.create(INSTANCE_SALT, SIGNER_COMMITMENTS, 0n),
      ).rejects.toThrow('SignerManager: threshold must be > 0');
    });

    it('should fail with threshold greater than 2', async () => {
      await expect(
        ShieldedMultiSigV2Simulator.create(INSTANCE_SALT, SIGNER_COMMITMENTS, 3n),
      ).rejects.toThrow(
        'ShieldedMultiSigV2: threshold cannot exceed 2 (execute verifies at most 2 signatures)',
      );
    });

    it('should register all signer commitments', async () => {
      multisig = await freshMultisig();
      for (const commitment of SIGNER_COMMITMENTS) {
        expect(await multisig.isSigner(commitment)).toEqual(true);
      }
    });

    it('should reject a non-signer commitment', async () => {
      multisig = await freshMultisig();
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

      // A real send spends a deposited coin; dry-only until the live harness can
      // fund and track it.
      describe.skipIf(isLiveBackend())('happy path (dry only)', () => {
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
          await execute(to, 100n, coin, [S1, S2]);
          expect(await multisig.getNonce()).toEqual(1n);
        });

        it('should execute with signers 1 and 2', async () => {
          await multisig.deposit(makeCoin(COLOR, AMOUNT));
          const to = makeRecipient(new Uint8Array(32).fill(7));
          const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
          await execute(to, 100n, coin, [S2, S3]);
          expect(await multisig.getNonce()).toEqual(1n);
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
        ).rejects.toThrow('SignerManager: not a signer');
      });

      it('should reject an invalid signature', async () => {
        const to = makeRecipient(new Uint8Array(32).fill(7));
        const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
        const digest = await executeDigest(multisig, to, coin, 100n);
        // S2's pubkey is registered, but the signature is made by S3.
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
    });
  });
});
