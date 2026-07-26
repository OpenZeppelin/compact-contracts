import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/fixtures/address.js';
import { shieldedTestRecipient } from '#test-utils/fixtures/shieldedKey.js';
import {
  burnMsgHash,
  type EitherRecipient,
  mintMsgHash,
  type Signer,
  sign,
  signerFromLabel,
} from './EcdsaTestUtils.js';
import {
  calculateSignerId,
  ShieldedMultiSigV3Simulator,
} from './simulators/ShieldedMultiSigV3Simulator.js';

// ─── Fixtures ─────────────────────────────────────────────────────

const INSTANCE_SALT = new Uint8Array(32).fill(0xaa);
const INIT_COIN_NONCE = new Uint8Array(32).fill(0xbb);
const TOKEN_DOMAIN = new Uint8Array(32);
Buffer.from('smt:token:').copy(TOKEN_DOMAIN);

// Real secp256k1 signers. A signer's on-chain identity is the commitment
// `calculateSignerId(pk, salt)`; authorization now requires a real ECDSA
// signature over the operation's keccak256 message hash. Deterministic keys
// (derived from labels) keep the fixtures stable across runs.
const S1 = signerFromLabel('multisig-signer-1');
const S2 = signerFromLabel('multisig-signer-2');
const S3 = signerFromLabel('multisig-signer-3');
const OUTSIDER = signerFromLabel('multisig-outsider');

const COMMITMENT1 = calculateSignerId(S1.publicKey, INSTANCE_SALT);
const COMMITMENT2 = calculateSignerId(S2.publicKey, INSTANCE_SALT);
const COMMITMENT3 = calculateSignerId(S3.publicKey, INSTANCE_SALT);
const SIGNER_COMMITMENTS = [COMMITMENT1, COMMITMENT2, COMMITMENT3];

// A contract recipient for `mint`. Dry-only: minting to a non-participating
// contract publishes an output no one claims, which a live node rejects (the
// same unclaimed-output limit that blocks atomic contract-recipient sends).
const CONTRACT_RECIPIENT = utils.createEitherTestContractAddress('TARGET');

// The user recipient for `mint`. Assigned in `beforeEach` after `create()`: on
// live it resolves to the deployer's own coin public key (whose encryption key
// the node can resolve), so the minted coin is deliverable; dry → a synthetic
// user.
let USER_RECIPIENT: ReturnType<typeof shieldedTestRecipient>;

// ─── Signing helpers ──────────────────────────────────────────────

const addrBytes = (m: ShieldedMultiSigV3Simulator): Uint8Array =>
  Uint8Array.from(Buffer.from(m.contractAddress, 'hex'));

/** The mint digest the contract will compute for these params at its current nonce. */
async function mintDigest(
  m: ShieldedMultiSigV3Simulator,
  recipient: EitherRecipient,
  amount: bigint,
): Promise<Uint8Array> {
  return mintMsgHash({
    contractAddress: addrBytes(m),
    recipient,
    opNonce: await m.getNonce(),
    amount,
  });
}

/** The burn digest the contract will compute for these params at its current nonce. */
async function burnDigest(
  m: ShieldedMultiSigV3Simulator,
  amount: bigint,
): Promise<Uint8Array> {
  return burnMsgHash({
    contractAddress: addrBytes(m),
    opNonce: await m.getNonce(),
    amount,
  });
}

/** Mint, signing the correct digest with each of `signers`. */
async function mint(
  m: ShieldedMultiSigV3Simulator,
  amount: bigint,
  recipient: EitherRecipient,
  signers: Signer[],
): Promise<void> {
  const digest = await mintDigest(m, recipient, amount);
  await m.mint(
    amount,
    recipient,
    signers.map((s) => s.publicKey),
    signers.map((s) => sign(s, digest)),
  );
}

function makeQualifiedCoin(
  color: Uint8Array,
  value: bigint,
  mtIndex = 0n,
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

let multisig: ShieldedMultiSigV3Simulator;

// A fresh multisig-token instance. Mutating groups build one per test
// (`beforeEach`); read-only groups build one per group (`beforeAll`) to save a
// live deploy tx.
const freshMultisig = () =>
  ShieldedMultiSigV3Simulator.create(
    INSTANCE_SALT,
    INIT_COIN_NONCE,
    TOKEN_DOMAIN,
    SIGNER_COMMITMENTS,
  );

describe('ShieldedMultiSigV3', () => {
  describe('constructor', () => {
    it('should initialize', async () => {
      multisig = await freshMultisig();
      expect(await multisig.getSignerCount()).toEqual(3n);
      expect(await multisig.getThreshold()).toEqual(2n);
    });

    it('should register all signer commitments', async () => {
      multisig = await freshMultisig();
      for (const commitment of SIGNER_COMMITMENTS) {
        expect(await multisig.isSigner(commitment)).toEqual(true);
      }
    });

    it('should reject a non-signer commitment', async () => {
      multisig = await freshMultisig();
      const unknown = await multisig._calculateSignerId(
        OUTSIDER.publicKey,
        INSTANCE_SALT,
      );
      expect(await multisig.isSigner(unknown)).toEqual(false);
    });

    it('should fail with duplicate signer commitments', async () => {
      await expect(
        ShieldedMultiSigV3Simulator.create(
          INSTANCE_SALT,
          INIT_COIN_NONCE,
          TOKEN_DOMAIN,
          [COMMITMENT1, COMMITMENT1, COMMITMENT2],
        ),
      ).rejects.toThrow('Signer: signer already active');
    });

    it('should store token domain', async () => {
      multisig = await freshMultisig();
      expect(await multisig.getTokenDomain()).toEqual(TOKEN_DOMAIN);
    });
  });

  describe('when initialized', () => {
    beforeAll(async () => {
      multisig = await freshMultisig();
      USER_RECIPIENT = shieldedTestRecipient();
    });

    describe('view', () => {
      it('getNonce should start at 0', async () => {
        expect(await multisig.getNonce()).toEqual(0n);
      });

      it('getSignerCount should return 3', async () => {
        expect(await multisig.getSignerCount()).toEqual(3n);
      });

      it('getThreshold should match constructor arg', async () => {
        expect(await multisig.getThreshold()).toEqual(2n);
      });

      it('getTokenType should return non-zero', async () => {
        expect(await multisig.getTokenType()).not.toEqual(new Uint8Array(32));
      });

      it('getTokenType should be deterministic', async () => {
        expect(await multisig.getTokenType()).toEqual(
          await multisig.getTokenType(),
        );
      });
    });

    describe('_calculateSignerId', () => {
      it('should produce deterministic commitments', async () => {
        const c1 = await multisig._calculateSignerId(S1.publicKey, INSTANCE_SALT);
        const c2 = await multisig._calculateSignerId(S1.publicKey, INSTANCE_SALT);
        expect(c1).toEqual(c2);
      });

      it('should produce different commitments for different keys', async () => {
        const c1 = await multisig._calculateSignerId(S1.publicKey, INSTANCE_SALT);
        const c2 = await multisig._calculateSignerId(S2.publicKey, INSTANCE_SALT);
        expect(c1).not.toEqual(c2);
      });

      it('should produce different commitments for different salts', async () => {
        const salt2 = new Uint8Array(32).fill(0xcc);
        const c1 = await multisig._calculateSignerId(S1.publicKey, INSTANCE_SALT);
        const c2 = await multisig._calculateSignerId(S1.publicKey, salt2);
        expect(c1).not.toEqual(c2);
      });

      it('should match registered commitments', async () => {
        expect(
          await multisig._calculateSignerId(S1.publicKey, INSTANCE_SALT),
        ).toEqual(COMMITMENT1);
        expect(
          await multisig._calculateSignerId(S2.publicKey, INSTANCE_SALT),
        ).toEqual(COMMITMENT2);
        expect(
          await multisig._calculateSignerId(S3.publicKey, INSTANCE_SALT),
        ).toEqual(COMMITMENT3);
      });
    });

    describe('mint', () => {
      beforeEach(async () => {
        multisig = await freshMultisig();
      });

      it('should mint to a user recipient with signers 0 and 1', async () => {
        await mint(multisig, 100n, USER_RECIPIENT, [S1, S2]);
      });

      it('should mint to a user recipient with signers 0 and 2', async () => {
        await mint(multisig, 100n, USER_RECIPIENT, [S1, S3]);
      });

      it('should mint to a user recipient with signers 1 and 2', async () => {
        await mint(multisig, 100n, USER_RECIPIENT, [S2, S3]);
      });

      // Live: a mint to a non-participating contract leaves an unclaimed output
      // the node rejects (no atomic cross-contract receive today).
      it.skipIf(isLiveBackend())(
        'should mint to a contract recipient',
        async () => {
          await mint(multisig, 100n, CONTRACT_RECIPIENT, [S1, S2]);
        },
      );

      it('should reject duplicate signer', async () => {
        const digest = await mintDigest(multisig, USER_RECIPIENT, 100n);
        await expect(
          multisig.mint(
            100n,
            USER_RECIPIENT,
            [S1.publicKey, S1.publicKey],
            [sign(S1, digest), sign(S1, digest)],
          ),
        ).rejects.toThrow('Multisig: duplicate signer');
      });

      it('should reject a non-signer pubkey', async () => {
        const digest = await mintDigest(multisig, USER_RECIPIENT, 100n);
        await expect(
          multisig.mint(
            100n,
            USER_RECIPIENT,
            [S1.publicKey, OUTSIDER.publicKey],
            [sign(S1, digest), sign(OUTSIDER, digest)],
          ),
        ).rejects.toThrow('Signer: not a signer');
      });

      it('should reject a signature that does not match the message', async () => {
        // S2 signs a digest for a different amount; its pubkey is a registered
        // signer, so the failure is the ECDSA check, not membership.
        const digest = await mintDigest(multisig, USER_RECIPIENT, 100n);
        const wrongDigest = mintMsgHash({
          contractAddress: addrBytes(multisig),
          recipient: USER_RECIPIENT,
          opNonce: await multisig.getNonce(),
          amount: 999n,
        });
        await expect(
          multisig.mint(
            100n,
            USER_RECIPIENT,
            [S1.publicKey, S2.publicKey],
            [sign(S1, digest), sign(S2, wrongDigest)],
          ),
        ).rejects.toThrow('Multisig: invalid signature');
      });

      it('should reject a signature from the wrong key', async () => {
        // Present S2's registered pubkey but a signature made by S3.
        const digest = await mintDigest(multisig, USER_RECIPIENT, 100n);
        await expect(
          multisig.mint(
            100n,
            USER_RECIPIENT,
            [S1.publicKey, S2.publicKey],
            [sign(S1, digest), sign(S3, digest)],
          ),
        ).rejects.toThrow('Multisig: invalid signature');
      });

      it('should increment nonce after mint', async () => {
        expect(await multisig.getNonce()).toEqual(0n);
        await mint(multisig, 100n, USER_RECIPIENT, [S1, S2]);
        expect(await multisig.getNonce()).toEqual(1n);
      });

      it('should increment nonce on each mint', async () => {
        await mint(multisig, 100n, USER_RECIPIENT, [S1, S2]);
        await mint(multisig, 200n, USER_RECIPIENT, [S1, S3]);
        await mint(multisig, 300n, USER_RECIPIENT, [S2, S3]);
        expect(await multisig.getNonce()).toEqual(3n);
      });

      it('should accept zero amount', async () => {
        await mint(multisig, 0n, USER_RECIPIENT, [S1, S2]);
      });

      it('should prevent replay by binding the signature to the nonce', async () => {
        // Signatures valid for nonce 0 must not authorize a second mint (nonce 1).
        const digest = await mintDigest(multisig, USER_RECIPIENT, 100n);
        const pubkeys = [S1.publicKey, S2.publicKey];
        const sigs = [sign(S1, digest), sign(S2, digest)];
        await multisig.mint(100n, USER_RECIPIENT, pubkeys, sigs);
        expect(await multisig.getNonce()).toEqual(1n);
        // Replaying the exact same signatures now fails: the digest for nonce 1
        // differs, so the ECDSA check rejects them.
        await expect(
          multisig.mint(100n, USER_RECIPIENT, pubkeys, sigs),
        ).rejects.toThrow('Multisig: invalid signature');
      });
    });

    describe('burn', () => {
      beforeEach(async () => {
        multisig = await freshMultisig();
      });

      // Happy-path burns execute a real spend, so they are dry-only until the
      // live harness can fund and track the burned coin.
      describe.skipIf(isLiveBackend())('happy path (dry only)', () => {
        async function burn(
          amount: bigint,
          coinValue: bigint,
          signers: Signer[],
        ): Promise<void> {
          const coin = makeQualifiedCoin(
            await multisig.getTokenType(),
            coinValue,
          );
          const digest = await burnDigest(multisig, amount);
          await multisig.burn(
            coin,
            amount,
            signers.map((s) => s.publicKey),
            signers.map((s) => sign(s, digest)),
          );
        }

        it('should burn with valid coin and signers 0 and 1', async () => {
          await burn(100n, 100n, [S1, S2]);
        });

        it('should burn with signers 0 and 2', async () => {
          await burn(100n, 100n, [S1, S3]);
        });

        it('should burn with signers 1 and 2', async () => {
          await burn(100n, 100n, [S2, S3]);
        });

        it('should burn partial amount', async () => {
          await burn(50n, 100n, [S1, S2]);
        });

        it('should handle zero burn amount', async () => {
          await burn(0n, 100n, [S1, S2]);
        });

        it('should share nonce across mint and burn', async () => {
          await mint(multisig, 100n, USER_RECIPIENT, [S1, S2]);
          expect(await multisig.getNonce()).toEqual(1n);
          await burn(50n, 100n, [S1, S3]);
          expect(await multisig.getNonce()).toEqual(2n);
        });
      });

      it('should reject duplicate signer', async () => {
        const coin = makeQualifiedCoin(await multisig.getTokenType(), 100n);
        const digest = await burnDigest(multisig, 100n);
        await expect(
          multisig.burn(
            coin,
            100n,
            [S1.publicKey, S1.publicKey],
            [sign(S1, digest), sign(S1, digest)],
          ),
        ).rejects.toThrow('Multisig: duplicate signer');
      });

      it('should reject a non-signer pubkey', async () => {
        const coin = makeQualifiedCoin(await multisig.getTokenType(), 100n);
        const digest = await burnDigest(multisig, 100n);
        await expect(
          multisig.burn(
            coin,
            100n,
            [S1.publicKey, OUTSIDER.publicKey],
            [sign(S1, digest), sign(OUTSIDER, digest)],
          ),
        ).rejects.toThrow('Signer: not a signer');
      });

      it('should reject an invalid signature', async () => {
        const coin = makeQualifiedCoin(await multisig.getTokenType(), 100n);
        const digest = await burnDigest(multisig, 100n);
        await expect(
          multisig.burn(
            coin,
            100n,
            [S1.publicKey, S2.publicKey],
            [sign(S1, digest), sign(S3, digest)],
          ),
        ).rejects.toThrow('Multisig: invalid signature');
      });

      it('should reject wrong token color', async () => {
        const wrongColor = new Uint8Array(32).fill(0xde);
        const coin = makeQualifiedCoin(wrongColor, 100n);
        const digest = await burnDigest(multisig, 100n);
        await expect(
          multisig.burn(
            coin,
            100n,
            [S1.publicKey, S2.publicKey],
            [sign(S1, digest), sign(S2, digest)],
          ),
        ).rejects.toThrow('Multisig: coin not from this contract');
      });

      it('should reject insufficient coin value', async () => {
        const coin = makeQualifiedCoin(await multisig.getTokenType(), 10n);
        const digest = await burnDigest(multisig, 100n);
        await expect(
          multisig.burn(
            coin,
            100n,
            [S1.publicKey, S2.publicKey],
            [sign(S1, digest), sign(S2, digest)],
          ),
        ).rejects.toThrow('Multisig: insufficient coin value');
      });

      it('should reject when amount exceeds value by 1', async () => {
        const coin = makeQualifiedCoin(await multisig.getTokenType(), 99n);
        const digest = await burnDigest(multisig, 100n);
        await expect(
          multisig.burn(
            coin,
            100n,
            [S1.publicKey, S2.publicKey],
            [sign(S1, digest), sign(S2, digest)],
          ),
        ).rejects.toThrow('Multisig: insufficient coin value');
      });
    });

    describe('domain separation', () => {
      beforeAll(async () => {
        multisig = await freshMultisig();
      });

      it('should isolate signers across instances with different salts', async () => {
        const salt2 = new Uint8Array(32).fill(0xcc);
        const c1 = await multisig._calculateSignerId(S1.publicKey, INSTANCE_SALT);
        const c2 = await multisig._calculateSignerId(S1.publicKey, salt2);
        expect(c1).not.toEqual(c2);
      });

      it('should derive different token types with different domains', async () => {
        const altDomain = new Uint8Array(32);
        Buffer.from('alt:token:').copy(altDomain);

        const alt = await ShieldedMultiSigV3Simulator.create(
          INSTANCE_SALT,
          INIT_COIN_NONCE,
          altDomain,
          SIGNER_COMMITMENTS,
        );

        expect(await multisig.getTokenType()).not.toEqual(
          await alt.getTokenType(),
        );
      });
    });

    describe('nonce', () => {
      beforeEach(async () => {
        multisig = await freshMultisig();
      });

      it('should start at 0', async () => {
        expect(await multisig.getNonce()).toEqual(0n);
      });

      it('should increment monotonically', async () => {
        for (let i = 0; i < 5; i++) {
          await mint(multisig, 1n, USER_RECIPIENT, [S1, S2]);
          expect(await multisig.getNonce()).toEqual(BigInt(i + 1));
        }
      });
    });

    describe('cross-instance replay', () => {
      // A distinct deployed address for the second instance, so its message
      // hash (which commits to `kernel.self()`) differs from the first's.
      const OTHER_ADDRESS = '11'.repeat(32);

      it('should reject a signature bound to another instance', async () => {
        const instance1 = await freshMultisig();
        const instance2 = await ShieldedMultiSigV3Simulator.create(
          INSTANCE_SALT,
          INIT_COIN_NONCE,
          TOKEN_DOMAIN,
          SIGNER_COMMITMENTS,
          { contractAddress: OTHER_ADDRESS },
        );

        // Signatures produced for instance1's message hash...
        const digest1 = await mintDigest(instance1, USER_RECIPIENT, 100n);
        const pubkeys = [S1.publicKey, S2.publicKey];
        const sigs = [sign(S1, digest1), sign(S2, digest1)];

        // ...authorize instance1...
        await instance1.mint(100n, USER_RECIPIENT, pubkeys, sigs);
        expect(await instance1.getNonce()).toEqual(1n);

        // ...but are rejected by instance2 (different `kernel.self()` → different hash).
        await expect(
          instance2.mint(100n, USER_RECIPIENT, pubkeys, sigs),
        ).rejects.toThrow('Multisig: invalid signature');
      });
    });
  });
});
