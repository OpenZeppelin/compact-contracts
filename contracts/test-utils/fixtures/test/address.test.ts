import { describe, expect, it } from 'vitest';
import {
  createEitherTestContractAddress,
  createEitherTestUnshieldedContract,
  createEitherTestUserAddress,
  eitherUserFromCoinPublicKey,
  encodeToAddress,
  encodeToPK,
  encodeToUserAddress,
  generateEitherPubKeyPair,
  generatePubKeyPair,
  toHexPadded,
  ZERO_ADDRESS,
  ZERO_KEY,
  ZERO_UNSHIELDED_CONTRACT,
  ZERO_USER_ADDRESS,
  zeroUint8Array,
} from '../address.js';

/**
 * The pure address/key encoding fixtures. Every encoder here is a deterministic
 * hex→bytes transform (an ASCII string is hexified, left-padded to 32 bytes, and
 * decoded), so a single ASCII char lands in the final byte. That lets each case
 * assert a fully pinned `Uint8Array` rather than a recomputed value.
 */

/** A 32-byte zero array — the padded encoding of the empty string. */
const zeros = (n = 32) => new Uint8Array(n);

/** A 32-byte array whose only non-zero byte is the last (a single ASCII char). */
const lastByte = (byte: number) => {
  const b = new Uint8Array(32);
  b[31] = byte;
  return b;
};

const A = 0x41; // ASCII 'A'

describe('address fixtures', () => {
  describe('toHexPadded', () => {
    it('should hexify ASCII and left-pad to 64 chars by default', () => {
      expect(toHexPadded('AB')).toBe(`${'0'.repeat(60)}4142`);
    });

    it('should pad to a custom length', () => {
      expect(toHexPadded('A', 4)).toBe('0041');
    });

    it('should not truncate input longer than the target length', () => {
      expect(toHexPadded('AAAA', 2)).toBe('41414141');
    });

    it('should encode the empty string as all-zero padding', () => {
      expect(toHexPadded('')).toBe('0'.repeat(64));
    });
  });

  describe('encodeToPK', () => {
    it('should encode the empty string to a 32-byte zero key', () => {
      expect(encodeToPK('')).toStrictEqual({ bytes: zeros() });
    });

    it('should place a single ASCII char in the final byte', () => {
      expect(encodeToPK('A')).toStrictEqual({ bytes: lastByte(A) });
    });

    it('should be deterministic for the same input', () => {
      expect(encodeToPK('A')).toStrictEqual(encodeToPK('A'));
    });

    it('should produce distinct keys for distinct inputs', () => {
      expect(encodeToPK('A')).not.toStrictEqual(encodeToPK('B'));
    });
  });

  describe('encodeToAddress', () => {
    it('should encode the empty string to a 32-byte zero address', () => {
      expect(encodeToAddress('')).toStrictEqual({ bytes: zeros() });
    });

    it('should place a single ASCII char in the final byte', () => {
      expect(encodeToAddress('A')).toStrictEqual({ bytes: lastByte(A) });
    });

    it('should throw when the input is not a valid contract address', () => {
      // A 40-char string hexifies to 80 chars — too long to be a 32-byte address.
      expect(() => encodeToAddress('x'.repeat(40))).toThrow(
        'must be a valid `ContractAddress`',
      );
    });
  });

  describe('encodeToUserAddress', () => {
    it('should place a single ASCII char in the final byte', () => {
      expect(encodeToUserAddress('A')).toStrictEqual({ bytes: lastByte(A) });
    });

    it('should throw when the encoded value is not exactly 32 bytes', () => {
      expect(() => encodeToUserAddress('x'.repeat(40))).toThrow(
        'must be exactly 32 bytes',
      );
    });
  });

  describe('eitherUserFromCoinPublicKey', () => {
    it('should build a left (coin-public-key) Either from a raw hex key', () => {
      const pk = 'ab'.repeat(32); // 64 hex chars → 32 bytes of 0xab
      expect(eitherUserFromCoinPublicKey(pk)).toStrictEqual({
        is_left: true,
        left: { bytes: new Uint8Array(32).fill(0xab) },
        right: { bytes: zeros() },
      });
    });
  });

  describe('createEitherTestContractAddress', () => {
    it('should build a right Either bound to the contract address', () => {
      expect(createEitherTestContractAddress('A')).toStrictEqual({
        is_left: false,
        left: { bytes: zeros() },
        right: { bytes: lastByte(A) },
      });
    });
  });

  describe('createEitherTestUserAddress', () => {
    it('should build a right Either bound to the user address', () => {
      expect(createEitherTestUserAddress('A')).toStrictEqual({
        is_left: false,
        left: { bytes: zeros() },
        right: { bytes: lastByte(A) },
      });
    });
  });

  describe('createEitherTestUnshieldedContract', () => {
    it('should build a left Either bound to the contract address', () => {
      expect(createEitherTestUnshieldedContract('A')).toStrictEqual({
        is_left: true,
        left: { bytes: lastByte(A) },
        right: { bytes: zeros() },
      });
    });
  });

  describe('generatePubKeyPair', () => {
    it('should return the padded hex alongside the encoded key', () => {
      expect(generatePubKeyPair('A')).toStrictEqual([
        `${'0'.repeat(62)}41`,
        { bytes: lastByte(A) },
      ]);
    });
  });

  describe('generateEitherPubKeyPair', () => {
    it('should return the padded hex alongside the Either-wrapped key', () => {
      expect(generateEitherPubKeyPair('A')).toStrictEqual([
        `${'0'.repeat(62)}41`,
        {
          is_left: true,
          left: { bytes: lastByte(A) },
          right: { bytes: zeros() },
        },
      ]);
    });
  });

  describe('zeroUint8Array', () => {
    it('should return 32 zero bytes by default', () => {
      expect(zeroUint8Array()).toStrictEqual(zeros());
    });

    it('should return the requested number of zero bytes', () => {
      expect(zeroUint8Array(16)).toStrictEqual(zeros(16));
    });
  });

  describe('zero constants', () => {
    it('should expose a zero coin-public-key Either', () => {
      expect(ZERO_KEY).toStrictEqual({
        is_left: true,
        left: { bytes: zeros() },
        right: { bytes: zeros() },
      });
    });

    it('should expose a zero contract-address Either', () => {
      expect(ZERO_ADDRESS).toStrictEqual({
        is_left: false,
        left: { bytes: zeros() },
        right: { bytes: zeros() },
      });
    });

    it('should expose a zero user-address Either', () => {
      expect(ZERO_USER_ADDRESS).toStrictEqual({
        is_left: false,
        left: { bytes: zeros() },
        right: { bytes: zeros() },
      });
    });

    it('should expose a zero unshielded-contract Either', () => {
      expect(ZERO_UNSHIELDED_CONTRACT).toStrictEqual({
        is_left: true,
        left: { bytes: zeros() },
        right: { bytes: zeros() },
      });
    });
  });
});
