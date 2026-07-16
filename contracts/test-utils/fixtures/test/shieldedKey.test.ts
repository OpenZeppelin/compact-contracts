import { encodeCoinPublicKey } from '@midnight-ntwrk/compact-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  eitherUserFromCoinPublicKey,
  encodeToPK,
  toHexPadded,
} from '../address.js';
import {
  shieldedTestParentKey,
  shieldedTestRecipient,
  shieldedTestSigner,
} from '../shieldedKey.js';

/**
 * The backend-aware shielded recipient/signer-key fixtures. Each helper branches
 * on a published `MIDNIGHT_*_COIN_PK` env var, so the tests drive both arms by
 * stubbing the environment. The dry arm is asserted against the pure builders it
 * delegates to; the live arm (real wallet keys) is exercised by the live path, so
 * here we only assert the branch selection.
 */

/** A valid 64-hex coin public key (32 bytes of 0xab). */
const PK = 'ab'.repeat(32);

describe('shielded key fixtures', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('shieldedTestRecipient', () => {
    it('should build a synthetic recipient when no deployer key is published', () => {
      vi.stubEnv('MIDNIGHT_DEPLOYER_COIN_PK', undefined);
      expect(shieldedTestRecipient('BOB')).toStrictEqual(
        eitherUserFromCoinPublicKey(toHexPadded('BOB')),
      );
    });

    it('should bind to the deployer coin public key when published', () => {
      vi.stubEnv('MIDNIGHT_DEPLOYER_COIN_PK', PK);
      expect(shieldedTestRecipient('BOB')).toStrictEqual(
        eitherUserFromCoinPublicKey(PK),
      );
    });
  });

  describe('shieldedTestParentKey', () => {
    it('should build a synthetic key when no deployer key is published', () => {
      vi.stubEnv('MIDNIGHT_DEPLOYER_COIN_PK', undefined);
      expect(shieldedTestParentKey('PARENT')).toStrictEqual(
        encodeToPK('PARENT'),
      );
    });

    it('should bind to the deployer coin public key when published', () => {
      vi.stubEnv('MIDNIGHT_DEPLOYER_COIN_PK', PK);
      expect(shieldedTestParentKey('PARENT')).toStrictEqual({
        bytes: encodeCoinPublicKey(PK),
      });
    });
  });

  describe('shieldedTestSigner', () => {
    it("should build a synthetic key from the alias when the signer's key is unpublished", () => {
      vi.stubEnv('MIDNIGHT_SIGNER1_COIN_PK', undefined);
      expect(shieldedTestSigner('SIGNER1')).toStrictEqual(
        eitherUserFromCoinPublicKey(toHexPadded('SIGNER1')),
      );
    });

    it("should bind to the signer's published coin public key", () => {
      vi.stubEnv('MIDNIGHT_SIGNER1_COIN_PK', PK);
      expect(shieldedTestSigner('SIGNER1')).toStrictEqual(
        eitherUserFromCoinPublicKey(PK),
      );
    });
  });
});
