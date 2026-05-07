import { describe, expect, it } from 'vitest';
import * as contractUtils from '#test-utils/address.js';
import { UtilsSimulator } from './simulators/UtilsSimulator.js';

const Z_SOME_KEY = contractUtils.createEitherTestUser('SOME_KEY');
const Z_OTHER_KEY = contractUtils.createEitherTestUser('OTHER_KEY');
const SOME_CONTRACT =
  contractUtils.createEitherTestContractAddress('SOME_CONTRACT');
const OTHER_CONTRACT =
  contractUtils.createEitherTestContractAddress('OTHER_CONTRACT');

const EMPTY_STRING = '';

let contract: UtilsSimulator;

describe('Utils', () => {
  contract = new UtilsSimulator();

  describe('isKeyOrAddressZero', () => {
    it('should return zero for the zero address', () => {
      expect(contract.isKeyOrAddressZero(contractUtils.ZERO_KEY)).toBe(true);
    });

    it('should not return zero for nonzero addresses', () => {
      expect(contract.isKeyOrAddressZero(Z_SOME_KEY)).toBe(false);
      expect(contract.isKeyOrAddressZero(SOME_CONTRACT)).toBe(false);
    });

    it('should not return zero for a zero contract address', () => {
      expect(contract.isKeyOrAddressZero(contractUtils.ZERO_ADDRESS)).toBe(
        true,
      );
    });
  });

  describe('isKeyOrAddressEqual', () => {
    it('should return true for two matching pubkeys', () => {
      expect(contract.isKeyOrAddressEqual(Z_SOME_KEY, Z_SOME_KEY)).toBe(true);
    });

    it('should return true for two matching contract addresses', () => {
      expect(contract.isKeyOrAddressEqual(SOME_CONTRACT, SOME_CONTRACT)).toBe(
        true,
      );
    });

    it('should return false for two different pubkeys', () => {
      expect(contract.isKeyOrAddressEqual(Z_SOME_KEY, Z_OTHER_KEY)).toBe(false);
    });

    it('should return false for two different contract addresses', () => {
      expect(contract.isKeyOrAddressEqual(SOME_CONTRACT, OTHER_CONTRACT)).toBe(
        false,
      );
    });

    it('should return false for two different address types', () => {
      expect(contract.isKeyOrAddressEqual(Z_SOME_KEY, SOME_CONTRACT)).toBe(
        false,
      );
    });

    it('should return false for two different address types of equal value', () => {
      expect(
        contract.isKeyOrAddressEqual(
          contractUtils.ZERO_KEY,
          contractUtils.ZERO_ADDRESS,
        ),
      ).toBe(false);
    });
  });

  describe('isKeyZero', () => {
    it('should return zero for the zero address', () => {
      expect(contract.isKeyZero(contractUtils.ZERO_KEY.left)).toBe(true);
    });

    it('should not return zero for nonzero addresses', () => {
      expect(contract.isKeyZero(Z_SOME_KEY.left)).toBe(false);
    });
  });

  describe('isContractAddress', () => {
    it('should return true if ContractAddress', () => {
      expect(contract.isContractAddress(SOME_CONTRACT)).toBe(true);
    });

    it('should return false ZswapCoinPublicKey', () => {
      expect(contract.isContractAddress(Z_SOME_KEY)).toBe(false);
    });
  });

  describe('emptyString', () => {
    it('should return the empty string', () => {
      expect(contract.emptyString()).toBe(EMPTY_STRING);
    });
  });

  describe('canonicalizeKeyOrAddress', () => {
    it('should zero the right side when is_left is true', () => {
      const crafted = {
        is_left: true,
        left: Z_SOME_KEY.left,
        right: SOME_CONTRACT.right,
      };
      const canonical = contract.canonicalizeKeyOrAddress(crafted);
      expect(canonical.is_left).toBe(true);
      expect(canonical.left).toEqual(Z_SOME_KEY.left);
      expect(canonical.right).toEqual(contractUtils.ZERO_ADDRESS.right);
    });

    it('should zero the left side when is_left is false', () => {
      const crafted = {
        is_left: false,
        left: Z_SOME_KEY.left,
        right: SOME_CONTRACT.right,
      };
      const canonical = contract.canonicalizeKeyOrAddress(crafted);
      expect(canonical.is_left).toBe(false);
      expect(canonical.left).toEqual(contractUtils.ZERO_KEY.left);
      expect(canonical.right).toEqual(SOME_CONTRACT.right);
    });

    it('should be idempotent for canonical pubkey', () => {
      const canonical = contract.canonicalizeKeyOrAddress(Z_SOME_KEY);
      expect(canonical).toEqual(Z_SOME_KEY);
    });

    it('should be idempotent for canonical contract address', () => {
      const canonical = contract.canonicalizeKeyOrAddress(SOME_CONTRACT);
      expect(canonical).toEqual(SOME_CONTRACT);
    });

    it('should be idempotent for already-zero pubkey', () => {
      const canonical = contract.canonicalizeKeyOrAddress(
        contractUtils.ZERO_KEY,
      );
      expect(canonical).toEqual(contractUtils.ZERO_KEY);
    });

    it('should be idempotent for already-zero contract address', () => {
      const canonical = contract.canonicalizeKeyOrAddress(
        contractUtils.ZERO_ADDRESS,
      );
      expect(canonical).toEqual(contractUtils.ZERO_ADDRESS);
    });
  });
});
