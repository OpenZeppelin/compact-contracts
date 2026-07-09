import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import { shieldedTestRecipient } from '#test-utils/liveShielded.js';
import {
  calculateSignerId,
  NativeShieldedTokenMultisigSimulator,
} from './simulators/NativeShieldedTokenMultisigSimulator.js';

// ─── Fixtures ─────────────────────────────────────────────────────

const INSTANCE_SALT = new Uint8Array(32).fill(0xaa);
const INIT_COIN_NONCE = new Uint8Array(32).fill(0xbb);
const TOKEN_DOMAIN = new Uint8Array(32);
Buffer.from('smt:token:').copy(TOKEN_DOMAIN);

// Signer identity is a commitment (`calculateSignerId(pk, salt)`) passed to
// `mint`/`burn` explicitly, and ECDSA verification is stubbed (`DUMMY_SIG`
// passes), so authorization is caller-agnostic — this spec's signer logic runs
// unchanged on live (no `ownPublicKey`-based identity).
const PK1 = new Uint8Array(64).fill(0x11);
const PK2 = new Uint8Array(64).fill(0x22);
const PK3 = new Uint8Array(64).fill(0x33);
const NON_SIGNER_PK = new Uint8Array(64).fill(0x99);

const COMMITMENT1 = calculateSignerId(PK1, INSTANCE_SALT);
const COMMITMENT2 = calculateSignerId(PK2, INSTANCE_SALT);
const COMMITMENT3 = calculateSignerId(PK3, INSTANCE_SALT);
const SIGNER_COMMITMENTS = [COMMITMENT1, COMMITMENT2, COMMITMENT3];

const DUMMY_SIG = new Uint8Array(64).fill(0xff);

// A contract recipient for `mint`. Dry-only: minting to a non-participating
// contract publishes an output no one claims, which a live node rejects (the
// same unclaimed-output limit that blocks atomic contract-recipient sends).
const CONTRACT_RECIPIENT = utils.createEitherTestContractAddress('TARGET');

// The user recipient for `mint`. Assigned in `beforeEach` after `create()`: on
// live it resolves to the deployer's own coin public key (whose encryption key
// the node can resolve), so the minted coin is deliverable; dry → a synthetic
// user.
let USER_RECIPIENT: ReturnType<typeof shieldedTestRecipient>;

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

let multisig: NativeShieldedTokenMultisigSimulator;

describe('NativeShieldedTokenMultisig', () => {
  describe('constructor', () => {
    it('should initialize', async () => {
      multisig = await NativeShieldedTokenMultisigSimulator.create(
        INSTANCE_SALT,
        INIT_COIN_NONCE,
        TOKEN_DOMAIN,
        SIGNER_COMMITMENTS,
      );
      expect(await multisig.getSignerCount()).toEqual(3n);
      expect(await multisig.getThreshold()).toEqual(2n);
    });

    it('should register all signer commitments', async () => {
      multisig = await NativeShieldedTokenMultisigSimulator.create(
        INSTANCE_SALT,
        INIT_COIN_NONCE,
        TOKEN_DOMAIN,
        SIGNER_COMMITMENTS,
      );
      for (const commitment of SIGNER_COMMITMENTS) {
        expect(await multisig.isSigner(commitment)).toEqual(true);
      }
    });

    it('should reject a non-signer commitment', async () => {
      multisig = await NativeShieldedTokenMultisigSimulator.create(
        INSTANCE_SALT,
        INIT_COIN_NONCE,
        TOKEN_DOMAIN,
        SIGNER_COMMITMENTS,
      );
      const unknown = await multisig._calculateSignerId(
        NON_SIGNER_PK,
        INSTANCE_SALT,
      );
      expect(await multisig.isSigner(unknown)).toEqual(false);
    });

    it('should fail with duplicate signer commitments', async () => {
      await expect(
        NativeShieldedTokenMultisigSimulator.create(
          INSTANCE_SALT,
          INIT_COIN_NONCE,
          TOKEN_DOMAIN,
          [COMMITMENT1, COMMITMENT1, COMMITMENT2],
        ),
      ).rejects.toThrow('Signer: signer already active');
    });

    it('should store token domain', async () => {
      multisig = await NativeShieldedTokenMultisigSimulator.create(
        INSTANCE_SALT,
        INIT_COIN_NONCE,
        TOKEN_DOMAIN,
        SIGNER_COMMITMENTS,
      );
      expect(await multisig.getTokenDomain()).toEqual(TOKEN_DOMAIN);
    });
  });

  describe('when initialized', () => {
    beforeEach(async () => {
      multisig = await NativeShieldedTokenMultisigSimulator.create(
        INSTANCE_SALT,
        INIT_COIN_NONCE,
        TOKEN_DOMAIN,
        SIGNER_COMMITMENTS,
      );
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
        const c1 = await multisig._calculateSignerId(PK1, INSTANCE_SALT);
        const c2 = await multisig._calculateSignerId(PK1, INSTANCE_SALT);
        expect(c1).toEqual(c2);
      });

      it('should produce different commitments for different keys', async () => {
        const c1 = await multisig._calculateSignerId(PK1, INSTANCE_SALT);
        const c2 = await multisig._calculateSignerId(PK2, INSTANCE_SALT);
        expect(c1).not.toEqual(c2);
      });

      it('should produce different commitments for different salts', async () => {
        const salt2 = new Uint8Array(32).fill(0xcc);
        const c1 = await multisig._calculateSignerId(PK1, INSTANCE_SALT);
        const c2 = await multisig._calculateSignerId(PK1, salt2);
        expect(c1).not.toEqual(c2);
      });

      it('should match registered commitments', async () => {
        expect(await multisig._calculateSignerId(PK1, INSTANCE_SALT)).toEqual(
          COMMITMENT1,
        );
        expect(await multisig._calculateSignerId(PK2, INSTANCE_SALT)).toEqual(
          COMMITMENT2,
        );
        expect(await multisig._calculateSignerId(PK3, INSTANCE_SALT)).toEqual(
          COMMITMENT3,
        );
      });
    });

    describe('mint', () => {
      it('should mint to a user recipient with signers 0 and 1', async () => {
        await multisig.mint(
          100n,
          USER_RECIPIENT,
          [PK1, PK2],
          [DUMMY_SIG, DUMMY_SIG],
        );
      });

      it('should mint to a user recipient with signers 0 and 2', async () => {
        await multisig.mint(
          100n,
          USER_RECIPIENT,
          [PK1, PK3],
          [DUMMY_SIG, DUMMY_SIG],
        );
      });

      it('should mint to a user recipient with signers 1 and 2', async () => {
        await multisig.mint(
          100n,
          USER_RECIPIENT,
          [PK2, PK3],
          [DUMMY_SIG, DUMMY_SIG],
        );
      });

      // Live: a mint to a non-participating contract leaves an unclaimed output
      // the node rejects (no atomic cross-contract receive today).
      it.skipIf(isLiveBackend())(
        'should mint to a contract recipient',
        async () => {
          await multisig.mint(
            100n,
            CONTRACT_RECIPIENT,
            [PK1, PK2],
            [DUMMY_SIG, DUMMY_SIG],
          );
        },
      );

      it('should reject duplicate signer', async () => {
        await expect(
          multisig.mint(
            100n,
            USER_RECIPIENT,
            [PK1, PK1],
            [DUMMY_SIG, DUMMY_SIG],
          ),
        ).rejects.toThrow('Multisig: duplicate signer');
      });

      it('should reject a non-signer pubkey', async () => {
        await expect(
          multisig.mint(
            100n,
            USER_RECIPIENT,
            [PK1, NON_SIGNER_PK],
            [DUMMY_SIG, DUMMY_SIG],
          ),
        ).rejects.toThrow('Signer: not a signer');
      });

      it('should increment nonce after mint', async () => {
        expect(await multisig.getNonce()).toEqual(0n);
        await multisig.mint(
          100n,
          USER_RECIPIENT,
          [PK1, PK2],
          [DUMMY_SIG, DUMMY_SIG],
        );
        expect(await multisig.getNonce()).toEqual(1n);
      });

      it('should increment nonce on each mint', async () => {
        await multisig.mint(
          100n,
          USER_RECIPIENT,
          [PK1, PK2],
          [DUMMY_SIG, DUMMY_SIG],
        );
        await multisig.mint(
          200n,
          USER_RECIPIENT,
          [PK1, PK3],
          [DUMMY_SIG, DUMMY_SIG],
        );
        await multisig.mint(
          300n,
          USER_RECIPIENT,
          [PK2, PK3],
          [DUMMY_SIG, DUMMY_SIG],
        );
        expect(await multisig.getNonce()).toEqual(3n);
      });

      it('should accept zero amount', async () => {
        await multisig.mint(
          0n,
          USER_RECIPIENT,
          [PK1, PK2],
          [DUMMY_SIG, DUMMY_SIG],
        );
      });

      it('should prevent replay by incrementing nonce', async () => {
        await multisig.mint(
          100n,
          USER_RECIPIENT,
          [PK1, PK2],
          [DUMMY_SIG, DUMMY_SIG],
        );
        // Second mint with same params succeeds because nonce is different
        // (stub ver doesn't actually check signatures)
        await multisig.mint(
          100n,
          USER_RECIPIENT,
          [PK1, PK2],
          [DUMMY_SIG, DUMMY_SIG],
        );
        expect(await multisig.getNonce()).toEqual(2n);
      });
    });

    // A successful burn spends a real coin of the contract's own token. Its
    // nonce is derived inside the mint circuit, so the spec cannot reconstruct
    // it to recover the coin's `mt_index` on live (that is the wallet SDK's
    // ciphertext-discovery job, out of scope for the coin tracker). The
    // rejection paths below throw before the receive/spend, so they run on both
    // backends; the success paths are dry-only.
    describe('burn', () => {
      it.skipIf(isLiveBackend())(
        'should burn with valid coin and signers 0 and 1',
        async () => {
          const coin = makeQualifiedCoin(await multisig.getTokenType(), 100n);
          await multisig.burn(coin, 100n, [PK1, PK2], [DUMMY_SIG, DUMMY_SIG]);
        },
      );

      it.skipIf(isLiveBackend())(
        'should burn with signers 0 and 2',
        async () => {
          const coin = makeQualifiedCoin(await multisig.getTokenType(), 100n);
          await multisig.burn(coin, 100n, [PK1, PK3], [DUMMY_SIG, DUMMY_SIG]);
        },
      );

      it.skipIf(isLiveBackend())(
        'should burn with signers 1 and 2',
        async () => {
          const coin = makeQualifiedCoin(await multisig.getTokenType(), 100n);
          await multisig.burn(coin, 100n, [PK2, PK3], [DUMMY_SIG, DUMMY_SIG]);
        },
      );

      it.skipIf(isLiveBackend())('should burn partial amount', async () => {
        const coin = makeQualifiedCoin(await multisig.getTokenType(), 100n);
        await multisig.burn(coin, 50n, [PK1, PK2], [DUMMY_SIG, DUMMY_SIG]);
      });

      it.skipIf(isLiveBackend())('should handle zero burn amount', async () => {
        const coin = makeQualifiedCoin(await multisig.getTokenType(), 100n);
        await multisig.burn(coin, 0n, [PK1, PK2], [DUMMY_SIG, DUMMY_SIG]);
      });

      it('should reject duplicate signer', async () => {
        const coin = makeQualifiedCoin(await multisig.getTokenType(), 100n);
        await expect(
          multisig.burn(coin, 100n, [PK1, PK1], [DUMMY_SIG, DUMMY_SIG]),
        ).rejects.toThrow('Multisig: duplicate signer');
      });

      it('should reject a non-signer pubkey', async () => {
        const coin = makeQualifiedCoin(await multisig.getTokenType(), 100n);
        await expect(
          multisig.burn(
            coin,
            100n,
            [PK1, NON_SIGNER_PK],
            [DUMMY_SIG, DUMMY_SIG],
          ),
        ).rejects.toThrow('Signer: not a signer');
      });

      it('should reject wrong token color', async () => {
        const wrongColor = new Uint8Array(32).fill(0xde);
        const coin = makeQualifiedCoin(wrongColor, 100n);
        await expect(
          multisig.burn(coin, 100n, [PK1, PK2], [DUMMY_SIG, DUMMY_SIG]),
        ).rejects.toThrow('Multisig: coin not from this contract');
      });

      it('should reject insufficient coin value', async () => {
        const coin = makeQualifiedCoin(await multisig.getTokenType(), 10n);
        await expect(
          multisig.burn(coin, 100n, [PK1, PK2], [DUMMY_SIG, DUMMY_SIG]),
        ).rejects.toThrow('Multisig: insufficient coin value');
      });

      it('should reject when amount exceeds value by 1', async () => {
        const coin = makeQualifiedCoin(await multisig.getTokenType(), 99n);
        await expect(
          multisig.burn(coin, 100n, [PK1, PK2], [DUMMY_SIG, DUMMY_SIG]),
        ).rejects.toThrow('Multisig: insufficient coin value');
      });

      it.skipIf(isLiveBackend())(
        'should share nonce across mint and burn',
        async () => {
          await multisig.mint(
            100n,
            USER_RECIPIENT,
            [PK1, PK2],
            [DUMMY_SIG, DUMMY_SIG],
          );
          expect(await multisig.getNonce()).toEqual(1n);

          const coin = makeQualifiedCoin(await multisig.getTokenType(), 100n);
          await multisig.burn(coin, 50n, [PK1, PK3], [DUMMY_SIG, DUMMY_SIG]);
          expect(await multisig.getNonce()).toEqual(2n);
        },
      );
    });

    describe('domain separation', () => {
      it('should isolate signers across instances with different salts', async () => {
        const salt2 = new Uint8Array(32).fill(0xcc);
        const c1 = await multisig._calculateSignerId(PK1, INSTANCE_SALT);
        const c2 = await multisig._calculateSignerId(PK1, salt2);
        expect(c1).not.toEqual(c2);
      });

      it('should derive different token types with different domains', async () => {
        const altDomain = new Uint8Array(32);
        Buffer.from('alt:token:').copy(altDomain);

        const alt = await NativeShieldedTokenMultisigSimulator.create(
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
      it('should start at 0', async () => {
        expect(await multisig.getNonce()).toEqual(0n);
      });

      it('should increment monotonically', async () => {
        for (let i = 0; i < 5; i++) {
          await multisig.mint(
            1n,
            USER_RECIPIENT,
            [PK1, PK2],
            [DUMMY_SIG, DUMMY_SIG],
          );
          expect(await multisig.getNonce()).toEqual(BigInt(i + 1));
        }
      });
    });

    describe('cross-instance replay', () => {
      it('should derive different message hashes for different instances', async () => {
        const instance2 = await NativeShieldedTokenMultisigSimulator.create(
          INSTANCE_SALT,
          INIT_COIN_NONCE,
          TOKEN_DOMAIN,
          SIGNER_COMMITMENTS,
        );

        // With stub verification, both succeed independently.
        // Once real ECDSA is available, a signature produced for one
        // instance's message hash must not validate against the other's.
        await multisig.mint(
          100n,
          USER_RECIPIENT,
          [PK1, PK2],
          [DUMMY_SIG, DUMMY_SIG],
        );
        await instance2.mint(
          100n,
          USER_RECIPIENT,
          [PK1, PK2],
          [DUMMY_SIG, DUMMY_SIG],
        );

        expect(await multisig.getNonce()).toEqual(1n);
        expect(await instance2.getNonce()).toEqual(1n);
      });
    });
  });
});
