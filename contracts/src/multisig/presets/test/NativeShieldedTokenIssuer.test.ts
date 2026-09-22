import { convertBigintToBytes } from '@midnight-ntwrk/compact-runtime';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { id, TypedDataEncoder } from 'ethers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/fixtures/address.js';
import {
  highSTwin,
  type Signer,
  sign,
  signerFromLabel,
} from '#test-utils/fixtures/ecdsa.js';
import { shieldedTestKey } from '#test-utils/fixtures/shieldedKey.js';
import type {
  Maybe,
  QualifiedShieldedCoinInfo,
  ShieldedCoinInfo,
} from '../../../../artifacts/MockNativeShieldedTokenIssuer/contract/index.js';
import {
  burnMsgHash,
  bytesOf,
  type EitherRecipient,
  executeMsgHash,
  hexOf,
  mintMsgHash,
} from '../../test/EcdsaTestUtils.js';
import {
  calculateSignerId,
  NativeShieldedTokenIssuerSimulator,
} from './simulators/NativeShieldedTokenIssuerSimulator.js';

// ─── Fixtures ─────────────────────────────────────────────────────

const INSTANCE_SALT = new Uint8Array(32).fill(0xaa);
const TOKEN_DOMAIN = new Uint8Array(32);
Buffer.from('smt:token:').copy(TOKEN_DOMAIN);
const TOKEN_NAME = 'MultiSig Token';
const TOKEN_SYMBOL = 'MST';
const TOKEN_DECIMALS = 6n;

// Real secp256k1 signers, deterministic from labels. A signer's on-chain
// identity is the commitment `calculateSignerId(pk, salt)`; authorization also
// needs a genuine ECDSA signature over the operation digest. Both are
// caller-agnostic (no `ownPublicKey` identity), so this spec runs unchanged on
// live.
const S1 = signerFromLabel('v3-signer-1');
const S2 = signerFromLabel('v3-signer-2');
const S3 = signerFromLabel('v3-signer-3');
const OUTSIDER = signerFromLabel('v3-outsider');

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
let USER_RECIPIENT: ReturnType<typeof shieldedTestKey>;

// ─── Signing helpers ──────────────────────────────────────────────

const addrBytes = (m: NativeShieldedTokenIssuerSimulator): Uint8Array =>
  Uint8Array.from(Buffer.from(m.contractAddress, 'hex'));

/** The mint digest the contract computes for these params at its current nonce. */
async function mintDigest(
  m: NativeShieldedTokenIssuerSimulator,
  recipient: EitherRecipient,
  amount: bigint,
): Promise<Uint8Array> {
  return mintMsgHash({
    contractAddress: addrBytes(m),
    instanceSalt: INSTANCE_SALT,
    recipient,
    opNonce: await m.getNonce(),
    amount,
  });
}

/** The burn digest the contract computes for these params at its current nonce. */
async function burnDigest(
  m: NativeShieldedTokenIssuerSimulator,
  amount: bigint,
): Promise<Uint8Array> {
  return burnMsgHash({
    contractAddress: addrBytes(m),
    instanceSalt: INSTANCE_SALT,
    opNonce: await m.getNonce(),
    amount,
  });
}

/** Mints, signing the correct digest with each of `signers`. */
async function mint(
  m: NativeShieldedTokenIssuerSimulator,
  amount: bigint,
  recipient: EitherRecipient,
  signers: Signer[],
): Promise<ShieldedCoinInfo> {
  const digest = await mintDigest(m, recipient, amount);
  return m.mint(
    amount,
    recipient,
    signers.map((s) => s.publicKey),
    signers.map((s) => sign(s, digest)),
  );
}

/** Asserts `coin` is a well-formed coin of `m`'s token carrying `amount`. */
async function expectMintedCoin(
  m: NativeShieldedTokenIssuerSimulator,
  coin: ShieldedCoinInfo,
  amount: bigint,
): Promise<void> {
  expect(coin.color).toStrictEqual(await m.tokenColor());
  expect(coin.value).toStrictEqual(amount);
  expect(coin.nonce).toBeInstanceOf(Uint8Array);
  expect(coin.nonce.length).toStrictEqual(32);
}

function makeQualifiedCoin(
  color: Uint8Array,
  value: bigint,
  mtIndex = 0n,
  nonce?: Uint8Array,
): QualifiedShieldedCoinInfo {
  return {
    nonce: nonce ?? new Uint8Array(32).fill(0),
    color,
    value,
    mt_index: mtIndex,
  };
}

let multisig: NativeShieldedTokenIssuerSimulator;

// A fresh multisig-token instance. Mutating groups build one per test
// (`beforeEach`); read-only groups build one per group (`beforeAll`) to save a
// live deploy tx.
const freshMultisig = () =>
  NativeShieldedTokenIssuerSimulator.create(
    INSTANCE_SALT,
    TOKEN_DOMAIN,
    TOKEN_NAME,
    TOKEN_SYMBOL,
    TOKEN_DECIMALS,
    SIGNER_COMMITMENTS,
    true,
  );

describe('NativeShieldedTokenIssuer', () => {
  describe('constructor', () => {
    // The constructor derives the domain separator from hand-counted string
    // literals (`pad(25, "…")`). A miscount there fails every signature with
    // "invalid signature", which points at the signature rather than at the
    // length. Asserting the deployed separator against ethers localises it.
    it('should derive a domain separator matching ethers', async () => {
      multisig = await freshMultisig();

      expect(
        Buffer.from(
          (await multisig.getPublicState())._domainSeparator,
        ).toString('hex'),
      ).toEqual(
        TypedDataEncoder.hashDomain({
          name: 'NativeShieldedTokenIssuer',
          version: '1',
          salt: `0x${Buffer.from(INSTANCE_SALT).toString('hex')}`,
        }).slice(2),
      );
    });

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
        NativeShieldedTokenIssuerSimulator.create(
          INSTANCE_SALT,
          TOKEN_DOMAIN,
          TOKEN_NAME,
          TOKEN_SYMBOL,
          TOKEN_DECIMALS,
          [COMMITMENT1, COMMITMENT1, COMMITMENT2],
          true,
        ),
      ).rejects.toThrow('Signer: signer already active');
    });

    it('stores the token metadata', async () => {
      multisig = await freshMultisig();
      expect(await multisig.name()).toStrictEqual(TOKEN_NAME);
      expect(await multisig.symbol()).toStrictEqual(TOKEN_SYMBOL);
      expect(await multisig.decimals()).toStrictEqual(TOKEN_DECIMALS);
    });

    it('surfaces the composed state in ledger()', async () => {
      multisig = await freshMultisig();
      const state = await multisig.getPublicState();
      expect(state._counter).toStrictEqual(0n);
      expect(state._domainSeparator).toStrictEqual(
        bytesOf(
          TypedDataEncoder.hashDomain({
            name: 'NativeShieldedTokenIssuer',
            version: '1',
            salt: hexOf(INSTANCE_SALT),
          }),
        ),
      );
      expect(state._derivedNonceCounter).toStrictEqual(0n);
      expect(state._instanceSalt).toStrictEqual(INSTANCE_SALT);
      expect(state._signerCount).toStrictEqual(3n);
      expect(state._threshold).toStrictEqual(2n);
      for (const commitment of SIGNER_COMMITMENTS) {
        expect(state._signers.member(commitment)).toStrictEqual(true);
      }
      expect(state._domain).toStrictEqual(TOKEN_DOMAIN);
      expect(state._name).toStrictEqual(TOKEN_NAME);
      expect(state._symbol).toStrictEqual(TOKEN_SYMBOL);
      expect(state._decimals).toStrictEqual(TOKEN_DECIMALS);
      expect(state._isInitialized).toStrictEqual(true);
    });
  });

  describe('when initialized', () => {
    // USER_RECIPIENT is stable (deployer key on live, synthetic on dry), so
    // resolve it once after the first deploy. The read-only `view` and
    // `_calculateSignerId` groups run first and reuse this shared deploy;
    // mutating groups below build their own fresh instance per test.
    beforeAll(async () => {
      multisig = await freshMultisig();
      USER_RECIPIENT = shieldedTestKey();
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

      it('tokenColor is non-zero', async () => {
        expect(await multisig.tokenColor()).not.toEqual(new Uint8Array(32));
      });

      it('tokenColor is deterministic', async () => {
        expect(await multisig.tokenColor()).toEqual(
          await multisig.tokenColor(),
        );
      });
    });

    describe('_calculateSignerId', () => {
      it('should produce deterministic commitments', async () => {
        const c1 = await multisig._calculateSignerId(
          S1.publicKey,
          INSTANCE_SALT,
        );
        const c2 = await multisig._calculateSignerId(
          S1.publicKey,
          INSTANCE_SALT,
        );
        expect(c1).toEqual(c2);
      });

      it('should produce different commitments for different keys', async () => {
        const c1 = await multisig._calculateSignerId(
          S1.publicKey,
          INSTANCE_SALT,
        );
        const c2 = await multisig._calculateSignerId(
          S2.publicKey,
          INSTANCE_SALT,
        );
        expect(c1).not.toEqual(c2);
      });

      it('should produce different commitments for different salts', async () => {
        const salt2 = new Uint8Array(32).fill(0xcc);
        const c1 = await multisig._calculateSignerId(
          S1.publicKey,
          INSTANCE_SALT,
        );
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
        const coin = await mint(multisig, 100n, USER_RECIPIENT, [S1, S2]);
        await expectMintedCoin(multisig, coin, 100n);
      });

      it('should mint to a user recipient with signers 0 and 2', async () => {
        const coin = await mint(multisig, 100n, USER_RECIPIENT, [S1, S3]);
        await expectMintedCoin(multisig, coin, 100n);
      });

      it('should mint to a user recipient with signers 1 and 2', async () => {
        const coin = await mint(multisig, 100n, USER_RECIPIENT, [S2, S3]);
        await expectMintedCoin(multisig, coin, 100n);
      });

      // A contract recipient other than this contract would leave an unclaimed
      // output, so the core refuses it before anything is minted.
      it('should reject a mint to a foreign contract recipient', async () => {
        await expect(
          mint(multisig, 100n, CONTRACT_RECIPIENT, [S1, S2]),
        ).rejects.toThrow(
          'NativeShieldedToken: recipient contract must be self',
        );
      });

      it('derives a different nonce on each mint', async () => {
        const first = await mint(multisig, 100n, USER_RECIPIENT, [S1, S2]);
        const second = await mint(multisig, 100n, USER_RECIPIENT, [S1, S2]);
        expect(first.nonce).not.toEqual(second.nonce);
      });

      it('rejects a zero recipient', async () => {
        await expect(
          mint(multisig, 100n, utils.ZERO_KEY, [S1, S2]),
        ).rejects.toThrow('NativeShieldedToken: invalid recipient');
      });

      it('should reject duplicate signer', async () => {
        await expect(
          mint(multisig, 100n, USER_RECIPIENT, [S1, S1]),
        ).rejects.toThrow('Multisig: duplicate signer');
      });

      it('should reject a non-signer pubkey', async () => {
        await expect(
          mint(multisig, 100n, USER_RECIPIENT, [S1, OUTSIDER]),
        ).rejects.toThrow('Signer: not a signer');
      });

      it('should reject a signature from the wrong key', async () => {
        // S2's pubkey is registered, but S3 produced the signature.
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

      it('should reject a signature over a different digest', async () => {
        const digest = await mintDigest(multisig, USER_RECIPIENT, 100n);
        const wrongDigest = await mintDigest(multisig, USER_RECIPIENT, 999n);
        await expect(
          multisig.mint(
            100n,
            USER_RECIPIENT,
            [S1.publicKey, S2.publicKey],
            [sign(S1, digest), sign(S2, wrongDigest)],
          ),
        ).rejects.toThrow('Multisig: invalid signature');
      });

      describe('parameter binding', () => {
        it('should reject a signature bound to a different amount', async () => {
          const digest = await mintDigest(multisig, USER_RECIPIENT, 999n);

          await expect(
            multisig.mint(
              100n,
              USER_RECIPIENT,
              [S1.publicKey, S2.publicKey],
              [sign(S1, digest), sign(S2, digest)],
            ),
          ).rejects.toThrow('Multisig: invalid signature');
        });

        it('should reject a signature bound to a different recipient', async () => {
          // `shieldedTestKey()` is deterministic, so a second call would return
          // the same key and the digests would match
          const other = utils.eitherUserFromCoinPublicKey(
            utils.toHexPadded('OTHER_RECIPIENT'),
          );
          const digest = await mintDigest(multisig, USER_RECIPIENT, 100n);

          await expect(
            multisig.mint(
              100n,
              other,
              [S1.publicKey, S2.publicKey],
              [sign(S1, digest), sign(S2, digest)],
            ),
          ).rejects.toThrow('Multisig: invalid signature');
        });

        it('should reject a signature over a different recipient kind', async () => {
          const address = new Uint8Array(32).fill(7);
          const zero = new Uint8Array(32);
          const asUser: EitherRecipient = {
            is_left: true,
            left: { bytes: address },
            right: { bytes: zero },
          };
          const asContract: EitherRecipient = {
            is_left: false,
            left: { bytes: zero },
            right: { bytes: address },
          };
          // Signed for a shielded user; submitted for a contract at the same
          // address bytes.
          const digest = await mintDigest(multisig, asUser, 100n);

          await expect(
            multisig.mint(
              100n,
              asContract,
              [S1.publicKey, S2.publicKey],
              [sign(S1, digest), sign(S2, digest)],
            ),
          ).rejects.toThrow('Multisig: invalid signature');
        });

        it('should reject a burn signature replayed as a mint', async () => {
          const digest = await burnDigest(multisig, 100n);

          await expect(
            multisig.mint(
              100n,
              USER_RECIPIENT,
              [S1.publicKey, S2.publicKey],
              [sign(S1, digest), sign(S2, digest)],
            ),
          ).rejects.toThrow('Multisig: invalid signature');
        });

        it('should reject a mint signature replayed as a burn', async () => {
          const digest = await mintDigest(multisig, USER_RECIPIENT, 100n);
          const coin = makeQualifiedCoin(await multisig.tokenColor(), 100n);

          await expect(
            multisig.burn(
              coin,
              100n,
              [S1.publicKey, S2.publicKey],
              [sign(S1, digest), sign(S2, digest)],
            ),
          ).rejects.toThrow('Multisig: invalid signature');
        });
      });

      // Each of these signs a digest that differs from the contract's only in
      // the encoding decision named, so a passing mint would mean that
      // decision had silently changed. The wrong digests are built with
      // ethers, not with this repo's encoders.
      describe('encoding scheme', () => {
        const MINT_TYPES = {
          Mint: [
            { name: 'contractAddress', type: 'bytes32' },
            { name: 'recipient', type: 'bytes32' },
            { name: 'isContract', type: 'bool' },
            { name: 'nonce', type: 'uint256' },
            { name: 'amount', type: 'uint256' },
          ],
        };

        const mintValue = (
          m: NativeShieldedTokenIssuerSimulator,
          nonce: bigint,
        ) => ({
          contractAddress: hexOf(addrBytes(m)),
          recipient: hexOf(USER_RECIPIENT.left.bytes),
          isContract: false,
          nonce,
          amount: 100n,
        });

        const ourDomain = {
          name: 'NativeShieldedTokenIssuer',
          version: '1',
          salt: hexOf(INSTANCE_SALT),
        };

        const mintWith = async (digest: Uint8Array) =>
          multisig.mint(
            100n,
            USER_RECIPIENT,
            [S1.publicKey, S2.publicKey],
            [sign(S1, digest), sign(S2, digest)],
          );

        it('should use the type hashes ethers derives', () => {
          const BURN_TYPES = {
            Burn: [
              { name: 'contractAddress', type: 'bytes32' },
              { name: 'nonce', type: 'uint256' },
              { name: 'amount', type: 'uint256' },
            ],
          };

          // `id` is keccak256 over the UTF-8 bytes, which is how EIP-712
          // defines a type hash.
          expect(
            id(TypedDataEncoder.from(MINT_TYPES).encodeType('Mint')),
          ).toEqual(
            '0x28d4c840bc95fe084ea5e3209443ba6721b7170971ee05efaf0a9851ee5fd1f5',
          );
          expect(
            id(TypedDataEncoder.from(BURN_TYPES).encodeType('Burn')),
          ).toEqual(
            '0xdf62d67d390806a6b63fbd9fb5b8904ef86a4d67f3824a3d855f6eefb8e79809',
          );
        });

        // Without the 0x1901 envelope the struct hash is not a typed-data
        // digest, so signing it must not authorize anything.
        it('should reject a signature over the bare struct hash', async () => {
          const structHash = bytesOf(
            TypedDataEncoder.hashStruct(
              'Mint',
              MINT_TYPES,
              mintValue(multisig, await multisig.getNonce()),
            ),
          );

          await expect(mintWith(structHash)).rejects.toThrow(
            'Multisig: invalid signature',
          );
        });

        // The property EIP-712 is here for: a signature obtained under any
        // other application's domain cannot be replayed against this one.
        it('should reject a digest built under a different domain', async () => {
          const digest = bytesOf(
            TypedDataEncoder.hash(
              { ...ourDomain, name: 'SomeOtherApp' },
              MINT_TYPES,
              mintValue(multisig, await multisig.getNonce()),
            ),
          );

          await expect(mintWith(digest)).rejects.toThrow(
            'Multisig: invalid signature',
          );
        });

        // The salt is the only per-deployment and per-network separator the
        // domain carries, so a digest under a different salt must not verify.
        it('should reject a digest built under a different salt', async () => {
          const digest = bytesOf(
            TypedDataEncoder.hash(
              { ...ourDomain, salt: hexOf(new Uint8Array(32).fill(0xee)) },
              MINT_TYPES,
              mintValue(multisig, await multisig.getNonce()),
            ),
          );

          await expect(mintWith(digest)).rejects.toThrow(
            'Multisig: invalid signature',
          );
        });

        // The type hash is the struct's first word, so renaming a field --
        // which leaves every value identical -- must change the digest.
        it('should reject a digest whose type hash differs', async () => {
          const renamed = {
            Mint: MINT_TYPES.Mint.map((f) =>
              f.name === 'amount' ? { ...f, name: 'value' } : f,
            ),
          };
          const v = mintValue(multisig, await multisig.getNonce());
          const { amount, ...rest } = v;
          const digest = bytesOf(
            TypedDataEncoder.hash(ourDomain, renamed, {
              ...rest,
              value: amount,
            }),
          );

          await expect(mintWith(digest)).rejects.toThrow(
            'Multisig: invalid signature',
          );
        });

        // The defect `utils/EvmAbi` exists to prevent: Compact's native
        // integer cast is little-endian, which no EVM signer produces. Built
        // by hand because no correct implementation will produce it.
        it('should reject a signature over little-endian encoded integers', async () => {
          const nonce = await multisig.getNonce();
          const le = (v: bigint) => convertBigintToBytes(32, v, 'V3.test');
          const typeHash = bytesOf(
            id(TypedDataEncoder.from(MINT_TYPES).encodeType('Mint')),
          );
          const boolWord = new Uint8Array(32);

          const structHash = keccak_256(
            Buffer.concat(
              [
                typeHash,
                addrBytes(multisig),
                USER_RECIPIENT.left.bytes,
                boolWord,
                le(nonce),
                le(100n),
              ].map(Buffer.from),
            ),
          );
          const digest = keccak_256(
            Buffer.concat([
              Buffer.from([0x19, 0x01]),
              Buffer.from(bytesOf(TypedDataEncoder.hashDomain(ourDomain))),
              Buffer.from(structHash),
            ]),
          );

          await expect(mintWith(digest)).rejects.toThrow(
            'Multisig: invalid signature',
          );
        });
      });

      it('should reject a high-s signature', async () => {
        const digest = await mintDigest(multisig, USER_RECIPIENT, 100n);
        // The twin verifies under plain ECDSA, so only the low-s gate can
        // reject it.
        await expect(
          multisig.mint(
            100n,
            USER_RECIPIENT,
            [S1.publicKey, S2.publicKey],
            [sign(S1, digest), highSTwin(sign(S2, digest))],
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
        const coin = await mint(multisig, 0n, USER_RECIPIENT, [S1, S2]);
        await expectMintedCoin(multisig, coin, 0n);
      });

      it('should reject signatures replayed after the nonce moves', async () => {
        const digest = await mintDigest(multisig, USER_RECIPIENT, 100n);
        const pubkeys = [S1.publicKey, S2.publicKey];
        const sigs = [sign(S1, digest), sign(S2, digest)];

        await multisig.mint(100n, USER_RECIPIENT, pubkeys, sigs);
        expect(await multisig.getNonce()).toEqual(1n);
        await expect(
          multisig.mint(100n, USER_RECIPIENT, pubkeys, sigs),
        ).rejects.toThrow('Multisig: invalid signature');
      });
    });

    // A successful burn spends a real coin of the contract's own token. Its
    // nonce is derived inside the mint circuit, so the spec cannot reconstruct
    // it to recover the coin's `mt_index` on live (that is the wallet SDK's
    // ciphertext-discovery job, out of scope for the coin tracker). The
    // rejection paths below throw before the receive/spend, so they run on both
    // backends; the success paths are dry-only.
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
        ): Promise<Maybe<ShieldedCoinInfo>> {
          const coin = makeQualifiedCoin(
            await multisig.tokenColor(),
            coinValue,
          );
          const digest = await burnDigest(multisig, amount);
          return multisig.burn(
            coin,
            amount,
            signers.map((s) => s.publicKey),
            signers.map((s) => sign(s, digest)),
          );
        }

        it('should burn with valid coin and signers 0 and 1', async () => {
          const change = await burn(100n, 100n, [S1, S2]);
          expect(change.is_some).toStrictEqual(false);
        });

        it('should burn with signers 0 and 2', async () => {
          const change = await burn(100n, 100n, [S1, S3]);
          expect(change.is_some).toStrictEqual(false);
        });

        it('should burn with signers 1 and 2', async () => {
          const change = await burn(100n, 100n, [S2, S3]);
          expect(change.is_some).toStrictEqual(false);
        });

        it('returns the change coin on a partial burn', async () => {
          const change = await burn(50n, 100n, [S1, S2]);
          expect(change.is_some).toStrictEqual(true);
          expect(change.value.value).toStrictEqual(50n);
          expect(change.value.color).toStrictEqual(await multisig.tokenColor());
        });

        it('returns the whole coin as change on a zero burn', async () => {
          const change = await burn(0n, 100n, [S1, S2]);
          expect(change.is_some).toStrictEqual(true);
          expect(change.value.value).toStrictEqual(100n);
          expect(change.value.color).toStrictEqual(await multisig.tokenColor());
        });

        it('should share nonce across mint and burn', async () => {
          await mint(multisig, 100n, USER_RECIPIENT, [S1, S2]);
          expect(await multisig.getNonce()).toEqual(1n);

          await burn(50n, 100n, [S1, S3]);
          expect(await multisig.getNonce()).toEqual(2n);
        });
      });

      it('should reject duplicate signer', async () => {
        const coin = makeQualifiedCoin(await multisig.tokenColor(), 100n);
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
        const coin = makeQualifiedCoin(await multisig.tokenColor(), 100n);
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

      it('should reject a signature from the wrong key', async () => {
        const coin = makeQualifiedCoin(await multisig.tokenColor(), 100n);
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

      it('should reject a signature bound to a different amount', async () => {
        const coin = makeQualifiedCoin(await multisig.tokenColor(), 100n);
        const digest = await burnDigest(multisig, 50n);
        await expect(
          multisig.burn(
            coin,
            100n,
            [S1.publicKey, S2.publicKey],
            [sign(S1, digest), sign(S2, digest)],
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
        ).rejects.toThrow('NativeShieldedToken: wrong token');
      });

      it('should reject insufficient coin value', async () => {
        const coin = makeQualifiedCoin(await multisig.tokenColor(), 10n);
        const digest = await burnDigest(multisig, 100n);
        await expect(
          multisig.burn(
            coin,
            100n,
            [S1.publicKey, S2.publicKey],
            [sign(S1, digest), sign(S2, digest)],
          ),
        ).rejects.toThrow('NativeShieldedToken: insufficient coin value');
      });

      it('should reject when amount exceeds value by 1', async () => {
        const coin = makeQualifiedCoin(await multisig.tokenColor(), 99n);
        const digest = await burnDigest(multisig, 100n);
        await expect(
          multisig.burn(
            coin,
            100n,
            [S1.publicKey, S2.publicKey],
            [sign(S1, digest), sign(S2, digest)],
          ),
        ).rejects.toThrow('NativeShieldedToken: insufficient coin value');
      });
    });

    describe('domain separation', () => {
      // Read-only on `multisig`, but runs after the mutating groups above, so
      // deploy a clean shared instance for the group.
      beforeAll(async () => {
        multisig = await freshMultisig();
      });

      it('should isolate signers across instances with different salts', async () => {
        const salt2 = new Uint8Array(32).fill(0xcc);
        const c1 = await multisig._calculateSignerId(
          S1.publicKey,
          INSTANCE_SALT,
        );
        const c2 = await multisig._calculateSignerId(S1.publicKey, salt2);
        expect(c1).not.toEqual(c2);
      });

      it('derives different token colors from different domains', async () => {
        const altDomain = new Uint8Array(32);
        Buffer.from('alt:token:').copy(altDomain);

        const alt = await NativeShieldedTokenIssuerSimulator.create(
          INSTANCE_SALT,
          altDomain,
          TOKEN_NAME,
          TOKEN_SYMBOL,
          TOKEN_DECIMALS,
          SIGNER_COMMITMENTS,
          true,
        );

        expect(await multisig.tokenColor()).not.toEqual(await alt.tokenColor());
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

    describe('uninitialized', () => {
      it('cannot mint, and holds a zero domain separator', async () => {
        const uninit = await NativeShieldedTokenIssuerSimulator.create(
          INSTANCE_SALT,
          TOKEN_DOMAIN,
          TOKEN_NAME,
          TOKEN_SYMBOL,
          TOKEN_DECIMALS,
          SIGNER_COMMITMENTS,
          false,
        );

        expect(
          Buffer.from((await uninit.getPublicState())._domainSeparator).every(
            (b) => b === 0,
          ),
        ).toEqual(true);

        const digest = await mintDigest(uninit, USER_RECIPIENT, 100n);
        await expect(
          uninit.mint(
            100n,
            USER_RECIPIENT,
            [S1.publicKey, S2.publicKey],
            [sign(S1, digest), sign(S2, digest)],
          ),
        ).rejects.toThrow('Eip712: domain separator not set');
      });
    });

    describe('cross-preset replay', () => {
      beforeEach(async () => {
        multisig = await freshMultisig();
      });

      it('should reject a ShieldedMultiSigV2 execute signature', async () => {
        const digest = executeMsgHash({
          contractAddress: addrBytes(multisig),
          instanceSalt: INSTANCE_SALT,
          nonce: await multisig.getNonce(),
          to: { kind: 0, address: USER_RECIPIENT.left.bytes },
          coinColor: await multisig.tokenColor(),
          amount: 100n,
        });

        await expect(
          multisig.mint(
            100n,
            USER_RECIPIENT,
            [S1.publicKey, S2.publicKey],
            [sign(S1, digest), sign(S2, digest)],
          ),
        ).rejects.toThrow('Multisig: invalid signature');
      });
    });

    describe('cross-instance replay', () => {
      // A distinct deployed address for the second instance,
      // so its digest differs
      const OTHER_ADDRESS = '11'.repeat(32);

      it('should reject a signature bound to another instance', async () => {
        const instance1 = await freshMultisig();
        const instance2 = await NativeShieldedTokenIssuerSimulator.create(
          INSTANCE_SALT,
          TOKEN_DOMAIN,
          TOKEN_NAME,
          TOKEN_SYMBOL,
          TOKEN_DECIMALS,
          SIGNER_COMMITMENTS,
          true,
          isLiveBackend() ? {} : { contractAddress: OTHER_ADDRESS },
        );

        const digest1 = await mintDigest(instance1, USER_RECIPIENT, 100n);
        const pubkeys = [S1.publicKey, S2.publicKey];
        const sigs = [sign(S1, digest1), sign(S2, digest1)];

        await instance1.mint(100n, USER_RECIPIENT, pubkeys, sigs);
        expect(await instance1.getNonce()).toEqual(1n);

        await expect(
          instance2.mint(100n, USER_RECIPIENT, pubkeys, sigs),
        ).rejects.toThrow('Multisig: invalid signature');
      });

      it('should reject a burn signature bound to another instance', async () => {
        const instance1 = await freshMultisig();
        const instance2 = await NativeShieldedTokenIssuerSimulator.create(
          INSTANCE_SALT,
          TOKEN_DOMAIN,
          TOKEN_NAME,
          TOKEN_SYMBOL,
          TOKEN_DECIMALS,
          SIGNER_COMMITMENTS,
          true,
          isLiveBackend() ? {} : { contractAddress: OTHER_ADDRESS },
        );

        // Same salt, same nonce, same amount: the two digests differ only in
        // the `contractAddress` word.
        const digest = await burnDigest(instance1, 100n);
        const coin = makeQualifiedCoin(await instance2.tokenColor(), 100n);

        await expect(
          instance2.burn(
            coin,
            100n,
            [S1.publicKey, S2.publicKey],
            [sign(S1, digest), sign(S2, digest)],
          ),
        ).rejects.toThrow('Multisig: invalid signature');
      });
    });
  });
});
