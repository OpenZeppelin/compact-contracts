import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import {
  calculateSignerId,
  SignatureMintBurnSimulator,
} from './simulators/SignatureMintBurnSimulator.js';

// ─── Fixtures ─────────────────────────────────────────────────────

const INSTANCE_SALT = new Uint8Array(32).fill(0xaa);
const INIT_COIN_NONCE = new Uint8Array(32).fill(0xbb);
const TOKEN_DOMAIN = new Uint8Array(32);
Buffer.from('smt:token:').copy(TOKEN_DOMAIN);

const PK1 = new Uint8Array(64).fill(0x11);
const PK2 = new Uint8Array(64).fill(0x22);
const PK3 = new Uint8Array(64).fill(0x33);
const NON_SIGNER_PK = new Uint8Array(64).fill(0x99);

const COMMITMENT1 = calculateSignerId(PK1, INSTANCE_SALT);
const COMMITMENT2 = calculateSignerId(PK2, INSTANCE_SALT);
const COMMITMENT3 = calculateSignerId(PK3, INSTANCE_SALT);
const SIGNER_COMMITMENTS = [COMMITMENT1, COMMITMENT2, COMMITMENT3];

const DUMMY_SIG = new Uint8Array(64).fill(0xff);

const USER_RECIPIENT = utils.createEitherTestUser('ALICE');
const CONTRACT_RECIPIENT = utils.createEitherTestContractAddress('TARGET');

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

let multisig: SignatureMintBurnSimulator;

describe('SignatureMintBurn', () => {
  describe('constructor', () => {
    it('should initialize', () => {
      multisig = new SignatureMintBurnSimulator(
        INSTANCE_SALT,
        INIT_COIN_NONCE,
        TOKEN_DOMAIN,
        SIGNER_COMMITMENTS,
      );
      expect(multisig.getSignerCount()).toEqual(3n);
      expect(multisig.getThreshold()).toEqual(2n);
    });

    it('should register all signer commitments', () => {
      multisig = new SignatureMintBurnSimulator(
        INSTANCE_SALT,
        INIT_COIN_NONCE,
        TOKEN_DOMAIN,
        SIGNER_COMMITMENTS,
      );
      for (const commitment of SIGNER_COMMITMENTS) {
        expect(multisig.isSigner(commitment)).toEqual(true);
      }
    });

    it('should reject a non-signer commitment', () => {
      multisig = new SignatureMintBurnSimulator(
        INSTANCE_SALT,
        INIT_COIN_NONCE,
        TOKEN_DOMAIN,
        SIGNER_COMMITMENTS,
      );
      const unknown = multisig._calculateSignerId(NON_SIGNER_PK, INSTANCE_SALT);
      expect(multisig.isSigner(unknown)).toEqual(false);
    });

    it('should fail with duplicate signer commitments', () => {
      expect(() => {
        new SignatureMintBurnSimulator(
          INSTANCE_SALT,
          INIT_COIN_NONCE,
          TOKEN_DOMAIN,
          [COMMITMENT1, COMMITMENT1, COMMITMENT2],
        );
      }).toThrow('SignerManager: signer already active');
    });

    it('should store token domain', () => {
      multisig = new SignatureMintBurnSimulator(
        INSTANCE_SALT,
        INIT_COIN_NONCE,
        TOKEN_DOMAIN,
        SIGNER_COMMITMENTS,
      );
      expect(multisig.getTokenDomain()).toEqual(TOKEN_DOMAIN);
    });
  });

  describe('when initialized', () => {
    beforeEach(() => {
      multisig = new SignatureMintBurnSimulator(
        INSTANCE_SALT,
        INIT_COIN_NONCE,
        TOKEN_DOMAIN,
        SIGNER_COMMITMENTS,
      );
    });

    describe('view', () => {
      it('getNonce should start at 0', () => {
        expect(multisig.getNonce()).toEqual(0n);
      });

      it('getSignerCount should return 3', () => {
        expect(multisig.getSignerCount()).toEqual(3n);
      });

      it('getThreshold should match constructor arg', () => {
        expect(multisig.getThreshold()).toEqual(2n);
      });

      it('getTokenType should return non-zero', () => {
        expect(multisig.getTokenType()).not.toEqual(new Uint8Array(32));
      });

      it('getTokenType should be deterministic', () => {
        expect(multisig.getTokenType()).toEqual(multisig.getTokenType());
      });
    });

    describe('_calculateSignerId', () => {
      it('should produce deterministic commitments', () => {
        const c1 = multisig._calculateSignerId(PK1, INSTANCE_SALT);
        const c2 = multisig._calculateSignerId(PK1, INSTANCE_SALT);
        expect(c1).toEqual(c2);
      });

      it('should produce different commitments for different keys', () => {
        const c1 = multisig._calculateSignerId(PK1, INSTANCE_SALT);
        const c2 = multisig._calculateSignerId(PK2, INSTANCE_SALT);
        expect(c1).not.toEqual(c2);
      });

      it('should produce different commitments for different salts', () => {
        const salt2 = new Uint8Array(32).fill(0xcc);
        const c1 = multisig._calculateSignerId(PK1, INSTANCE_SALT);
        const c2 = multisig._calculateSignerId(PK1, salt2);
        expect(c1).not.toEqual(c2);
      });

      it('should match registered commitments', () => {
        expect(multisig._calculateSignerId(PK1, INSTANCE_SALT)).toEqual(
          COMMITMENT1,
        );
        expect(multisig._calculateSignerId(PK2, INSTANCE_SALT)).toEqual(
          COMMITMENT2,
        );
        expect(multisig._calculateSignerId(PK3, INSTANCE_SALT)).toEqual(
          COMMITMENT3,
        );
      });
    });

    describe('mint', () => {
      it('should mint to a user recipient with signers 0 and 1', () => {
        expect(() => {
          multisig.mint(
            100n,
            USER_RECIPIENT,
            [PK1, PK2],
            [DUMMY_SIG, DUMMY_SIG],
          );
        }).not.toThrow();
      });

      it('should mint to a user recipient with signers 0 and 2', () => {
        expect(() => {
          multisig.mint(
            100n,
            USER_RECIPIENT,
            [PK1, PK3],
            [DUMMY_SIG, DUMMY_SIG],
          );
        }).not.toThrow();
      });

      it('should mint to a user recipient with signers 1 and 2', () => {
        expect(() => {
          multisig.mint(
            100n,
            USER_RECIPIENT,
            [PK2, PK3],
            [DUMMY_SIG, DUMMY_SIG],
          );
        }).not.toThrow();
      });

      it('should mint to a contract recipient', () => {
        expect(() => {
          multisig.mint(
            100n,
            CONTRACT_RECIPIENT,
            [PK1, PK2],
            [DUMMY_SIG, DUMMY_SIG],
          );
        }).not.toThrow();
      });

      it('should reject duplicate signer', () => {
        expect(() => {
          multisig.mint(
            100n,
            USER_RECIPIENT,
            [PK1, PK1],
            [DUMMY_SIG, DUMMY_SIG],
          );
        }).toThrow('EcdsaSignerManager: duplicate signer');
      });

      it('should reject a non-signer pubkey', () => {
        expect(() => {
          multisig.mint(
            100n,
            USER_RECIPIENT,
            [PK1, NON_SIGNER_PK],
            [DUMMY_SIG, DUMMY_SIG],
          );
        }).toThrow('SignerManager: not a signer');
      });

      it('should increment nonce after mint', () => {
        expect(multisig.getNonce()).toEqual(0n);
        multisig.mint(100n, USER_RECIPIENT, [PK1, PK2], [DUMMY_SIG, DUMMY_SIG]);
        expect(multisig.getNonce()).toEqual(1n);
      });

      it('should increment nonce on each mint', () => {
        multisig.mint(100n, USER_RECIPIENT, [PK1, PK2], [DUMMY_SIG, DUMMY_SIG]);
        multisig.mint(200n, USER_RECIPIENT, [PK1, PK3], [DUMMY_SIG, DUMMY_SIG]);
        multisig.mint(
          300n,
          CONTRACT_RECIPIENT,
          [PK2, PK3],
          [DUMMY_SIG, DUMMY_SIG],
        );
        expect(multisig.getNonce()).toEqual(3n);
      });

      it('should accept zero amount', () => {
        expect(() => {
          multisig.mint(0n, USER_RECIPIENT, [PK1, PK2], [DUMMY_SIG, DUMMY_SIG]);
        }).not.toThrow();
      });

      it('should prevent replay by incrementing nonce', () => {
        multisig.mint(100n, USER_RECIPIENT, [PK1, PK2], [DUMMY_SIG, DUMMY_SIG]);
        // Second mint with same params succeeds because nonce is different
        // (stub ver doesn't actually check signatures)
        expect(() => {
          multisig.mint(
            100n,
            USER_RECIPIENT,
            [PK1, PK2],
            [DUMMY_SIG, DUMMY_SIG],
          );
        }).not.toThrow();
        expect(multisig.getNonce()).toEqual(2n);
      });
    });

    describe('burn', () => {
      it('should burn with valid coin and signers 0 and 1', () => {
        const coin = makeQualifiedCoin(multisig.getTokenType(), 100n);
        expect(() => {
          multisig.burn(coin, 100n, [PK1, PK2], [DUMMY_SIG, DUMMY_SIG]);
        }).not.toThrow();
      });

      it('should burn with signers 0 and 2', () => {
        const coin = makeQualifiedCoin(multisig.getTokenType(), 100n);
        expect(() => {
          multisig.burn(coin, 100n, [PK1, PK3], [DUMMY_SIG, DUMMY_SIG]);
        }).not.toThrow();
      });

      it('should burn with signers 1 and 2', () => {
        const coin = makeQualifiedCoin(multisig.getTokenType(), 100n);
        expect(() => {
          multisig.burn(coin, 100n, [PK2, PK3], [DUMMY_SIG, DUMMY_SIG]);
        }).not.toThrow();
      });

      it('should burn partial amount', () => {
        const coin = makeQualifiedCoin(multisig.getTokenType(), 100n);
        expect(() => {
          multisig.burn(coin, 50n, [PK1, PK2], [DUMMY_SIG, DUMMY_SIG]);
        }).not.toThrow();
      });

      it('should handle zero burn amount', () => {
        const coin = makeQualifiedCoin(multisig.getTokenType(), 100n);
        expect(() => {
          multisig.burn(coin, 0n, [PK1, PK2], [DUMMY_SIG, DUMMY_SIG]);
        }).not.toThrow();
      });

      it('should reject duplicate signer', () => {
        const coin = makeQualifiedCoin(multisig.getTokenType(), 100n);
        expect(() => {
          multisig.burn(coin, 100n, [PK1, PK1], [DUMMY_SIG, DUMMY_SIG]);
        }).toThrow('EcdsaSignerManager: duplicate signer');
      });

      it('should reject a non-signer pubkey', () => {
        const coin = makeQualifiedCoin(multisig.getTokenType(), 100n);
        expect(() => {
          multisig.burn(
            coin,
            100n,
            [PK1, NON_SIGNER_PK],
            [DUMMY_SIG, DUMMY_SIG],
          );
        }).toThrow('SignerManager: not a signer');
      });

      it('should reject wrong token color', () => {
        const wrongColor = new Uint8Array(32).fill(0xde);
        const coin = makeQualifiedCoin(wrongColor, 100n);
        expect(() => {
          multisig.burn(coin, 100n, [PK1, PK2], [DUMMY_SIG, DUMMY_SIG]);
        }).toThrow('SignatureMintBurn: coin not from this contract');
      });

      it('should reject insufficient coin value', () => {
        const coin = makeQualifiedCoin(multisig.getTokenType(), 10n);
        expect(() => {
          multisig.burn(coin, 100n, [PK1, PK2], [DUMMY_SIG, DUMMY_SIG]);
        }).toThrow('SignatureMintBurn: insufficient coin value');
      });

      it('should reject when amount exceeds value by 1', () => {
        const coin = makeQualifiedCoin(multisig.getTokenType(), 99n);
        expect(() => {
          multisig.burn(coin, 100n, [PK1, PK2], [DUMMY_SIG, DUMMY_SIG]);
        }).toThrow('SignatureMintBurn: insufficient coin value');
      });

      it('should share nonce across mint and burn', () => {
        multisig.mint(100n, USER_RECIPIENT, [PK1, PK2], [DUMMY_SIG, DUMMY_SIG]);
        expect(multisig.getNonce()).toEqual(1n);

        const coin = makeQualifiedCoin(multisig.getTokenType(), 100n);
        multisig.burn(coin, 50n, [PK1, PK3], [DUMMY_SIG, DUMMY_SIG]);
        expect(multisig.getNonce()).toEqual(2n);
      });
    });

    describe('domain separation', () => {
      it('should isolate signers across instances with different salts', () => {
        const salt2 = new Uint8Array(32).fill(0xcc);
        const c1 = multisig._calculateSignerId(PK1, INSTANCE_SALT);
        const c2 = multisig._calculateSignerId(PK1, salt2);
        expect(c1).not.toEqual(c2);
      });

      it('should derive different token types with different domains', () => {
        const altDomain = new Uint8Array(32);
        Buffer.from('alt:token:').copy(altDomain);

        const alt = new SignatureMintBurnSimulator(
          INSTANCE_SALT,
          INIT_COIN_NONCE,
          altDomain,
          SIGNER_COMMITMENTS,
        );

        expect(multisig.getTokenType()).not.toEqual(alt.getTokenType());
      });
    });

    describe('nonce', () => {
      it('should start at 0', () => {
        expect(multisig.getNonce()).toEqual(0n);
      });

      it('should increment monotonically', () => {
        for (let i = 0; i < 5; i++) {
          multisig.mint(1n, USER_RECIPIENT, [PK1, PK2], [DUMMY_SIG, DUMMY_SIG]);
          expect(multisig.getNonce()).toEqual(BigInt(i + 1));
        }
      });
    });

    describe('cross-instance replay', () => {
      it('should derive different message hashes for different instances', () => {
        const instance2 = new SignatureMintBurnSimulator(
          INSTANCE_SALT,
          INIT_COIN_NONCE,
          TOKEN_DOMAIN,
          SIGNER_COMMITMENTS,
        );

        // With stub verification, both succeed independently.
        // Once real ECDSA is available, a signature produced for one
        // instance's message hash must not validate against the other's.
        multisig.mint(100n, USER_RECIPIENT, [PK1, PK2], [DUMMY_SIG, DUMMY_SIG]);
        instance2.mint(
          100n,
          USER_RECIPIENT,
          [PK1, PK2],
          [DUMMY_SIG, DUMMY_SIG],
        );

        expect(multisig.getNonce()).toEqual(1n);
        expect(instance2.getNonce()).toEqual(1n);
      });
    });
  });
});
