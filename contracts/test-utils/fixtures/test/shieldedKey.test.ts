import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEitherTestUser,
  eitherUserFromCoinPublicKey,
} from '../address.js';
import { shieldedTestKey } from '../shieldedKey.js';

/**
 * The backend-aware shielded key fixture. It branches on a published
 * `MIDNIGHT_*_COIN_PK` env var, so the tests drive both arms by stubbing the
 * environment. The dry arm is asserted against the pure builder it delegates to;
 * the live arm (real wallet keys) is exercised by the live path, so here we only
 * assert the branch selection and the env-var mapping.
 */

/** A valid 64-hex coin public key (32 bytes of 0xab). */
const PK = 'ab'.repeat(32);

describe('shieldedTestKey', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('deployer (default)', () => {
    it('should build a synthetic deployer key when none is published', () => {
      vi.stubEnv('MIDNIGHT_DEPLOYER_COIN_PK', undefined);
      expect(shieldedTestKey()).toStrictEqual(createEitherTestUser('deployer'));
    });

    it('should bind to the published deployer coin public key', () => {
      vi.stubEnv('MIDNIGHT_DEPLOYER_COIN_PK', PK);
      expect(shieldedTestKey()).toStrictEqual(eitherUserFromCoinPublicKey(PK));
    });
  });

  describe('signer alias', () => {
    it("should build a synthetic key from the alias when the signer's key is unpublished", () => {
      vi.stubEnv('MIDNIGHT_SIGNER1_COIN_PK', undefined);
      expect(shieldedTestKey('SIGNER1')).toStrictEqual(
        createEitherTestUser('SIGNER1'),
      );
    });

    it("should bind to the signer's published coin public key", () => {
      vi.stubEnv('MIDNIGHT_SIGNER1_COIN_PK', PK);
      expect(shieldedTestKey('SIGNER1')).toStrictEqual(
        eitherUserFromCoinPublicKey(PK),
      );
    });
  });

  describe('.left (bare coin public key)', () => {
    it('should expose the bare coin public key as the Either left arm', () => {
      vi.stubEnv('MIDNIGHT_DEPLOYER_COIN_PK', PK);
      expect(shieldedTestKey().left).toStrictEqual(
        eitherUserFromCoinPublicKey(PK).left,
      );
    });
  });
});
