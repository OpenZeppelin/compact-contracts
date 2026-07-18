import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  encodeShieldedCoinInfo,
  GENESIS_NATIVE_SHIELDED_TOKEN_COLORS,
  genesisNativeShieldedTokenColor,
} from '../nativeShieldedToken.js';

/**
 * The backend-aware shielded-coin fixtures. `encodeShieldedCoinInfo` branches on
 * `isLiveBackend()` (`MIDNIGHT_BACKEND=live`), so the tests drive both arms by
 * stubbing the environment. The color builders are pure.
 */

const color = new Uint8Array(32).fill(1);

describe('native shielded token fixtures', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('genesisNativeShieldedTokenColor', () => {
    it('should set the requested last byte of a 32-byte color', () => {
      const expected = new Uint8Array(32);
      expected[31] = 1;
      expect(genesisNativeShieldedTokenColor(1)).toStrictEqual(expected);
    });

    it('should be all zeros for the native token byte', () => {
      expect(genesisNativeShieldedTokenColor(0)).toStrictEqual(
        new Uint8Array(32),
      );
    });
  });

  describe('GENESIS_NATIVE_SHIELDED_TOKEN_COLORS', () => {
    it('should map each funded color to its genesis type byte', () => {
      expect(GENESIS_NATIVE_SHIELDED_TOKEN_COLORS).toStrictEqual({
        nativeShieldedToken1: genesisNativeShieldedTokenColor(1),
        nativeShieldedToken2: genesisNativeShieldedTokenColor(2),
      });
    });
  });

  describe('encodeShieldedCoinInfo (dry backend)', () => {
    it('should default the nonce to 32 zero bytes', () => {
      vi.stubEnv('MIDNIGHT_BACKEND', 'dry');
      expect(encodeShieldedCoinInfo(color, 500n)).toStrictEqual({
        nonce: new Uint8Array(32),
        color,
        value: 500n,
      });
    });

    it('should use the provided nonce verbatim', () => {
      vi.stubEnv('MIDNIGHT_BACKEND', 'dry');
      const nonce = new Uint8Array(32).fill(9);
      expect(encodeShieldedCoinInfo(color, 500n, nonce)).toStrictEqual({
        nonce,
        color,
        value: 500n,
      });
    });
  });

  describe('encodeShieldedCoinInfo (live backend)', () => {
    it('should generate a fresh 32-byte random nonce, passing color and value through', () => {
      vi.stubEnv('MIDNIGHT_BACKEND', 'live');
      const first = encodeShieldedCoinInfo(color, 500n);
      const second = encodeShieldedCoinInfo(color, 500n);
      expect(first.nonce).toHaveLength(32);
      expect(first.color).toBe(color);
      expect(first.value).toBe(500n);
      // Random per call: two coins must not share a nonce (would replay on live).
      expect(first.nonce).not.toStrictEqual(second.nonce);
    });

    it('should ignore a provided nonce on the live backend', () => {
      vi.stubEnv('MIDNIGHT_BACKEND', 'live');
      const nonce = new Uint8Array(32).fill(9);
      expect(
        encodeShieldedCoinInfo(color, 500n, nonce).nonce,
      ).not.toStrictEqual(nonce);
    });
  });
});
