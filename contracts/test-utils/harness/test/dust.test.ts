import { describe, expect, it } from 'vitest';
import { assertFunded, DustFundingError, MIN_WALLET_NIGHT } from '../dust.js';

describe('dust policy', () => {
  describe('DustFundingError', () => {
    it('should carry the alias and balance and name both in the message', () => {
      const err = new DustFundingError('SIGNER2', 0n);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('DustFundingError');
      expect(err.alias).toBe('SIGNER2');
      expect(err.nightBalance).toBe(0n);
      expect(err.message).toContain('SIGNER2');
      expect(err.message).toContain('0');
    });
  });

  describe('assertFunded', () => {
    it('should throw for a zero-NIGHT wallet', () => {
      expect(() => assertFunded('SIGNER1', 0n)).toThrow(DustFundingError);
    });

    it('should throw just below the minimum', () => {
      expect(() => assertFunded('SIGNER1', MIN_WALLET_NIGHT - 1n)).toThrow(
        DustFundingError,
      );
    });

    it('should not throw exactly at the minimum', () => {
      expect(() => assertFunded('deployer', MIN_WALLET_NIGHT)).not.toThrow();
    });

    it('should not throw for a well-funded wallet', () => {
      expect(() =>
        assertFunded('deployer', 250_000_000_000_000n),
      ).not.toThrow();
    });
  });
});
