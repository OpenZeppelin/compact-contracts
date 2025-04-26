import { UtilsSimulator } from './simulators/UtilsSimulator';
import * as contractUtils from './utils/address';

const Z_SOME_KEY = contractUtils.createEitherTestUser('SOME_KEY');
const Z_OTHER_KEY = contractUtils.createEitherTestUser('OTHER_KEY');
const SOME_CONTRACT = contractUtils.createEitherTestContractAddress('SOME_CONTRACT');
const OTHER_CONTRACT = contractUtils.createEitherTestContractAddress('OTHER_CONTRACT');

let contract: UtilsSimulator;

describe('Utils', () => {
  contract = new UtilsSimulator();

  describe('isKeyOrAddressZero', () => {
    it('should return zero for the zero address', () => {
      expect(contract.isKeyOrAddressZero(contractUtils.ZERO_KEY)).toBeTruthy;
      expect(contract.isKeyOrAddressZero(contractUtils.ZERO_ADDRESS)).toBeTruthy;
    });

    it('should not return zero for nonzero addresses', () => {
      expect(contract.isKeyOrAddressZero(Z_SOME_KEY)).toBe(false);
      expect(contract.isKeyOrAddressZero(SOME_CONTRACT)).toBe(false);
    });

    it('should return false for two different address types', () => {
      expect(contract.isKeyOrAddressEqual(Z_SOME_KEY, SOME_CONTRACT)).toBe(false);
      expect(contract.isKeyOrAddressZero(contractUtils.ZERO_KEY)).toBe(true);
      expect(contract.isKeyOrAddressZero(contractUtils.ZERO_ADDRESS)).toBe(true);
    });
  });

  describe('isKeyOrAddressEqual', () => {
    it('should return true for two matching pubkeys', () => {
      expect(contract.isKeyOrAddressEqual(Z_SOME_KEY, Z_SOME_KEY)).toBeTruthy();
    });

    it('should return true for two matching contract addresses', () => {
      expect(contract.isKeyOrAddressEqual(SOME_CONTRACT, SOME_CONTRACT)).toBeTruthy();
    });

    it('should return false for two different pubkeys', () => {
      expect(contract.isKeyOrAddressEqual(Z_SOME_KEY, Z_OTHER_KEY)).toBeFalsy();
    });

    it('should return false for two different contract addresses', () => {
      expect(contract.isKeyOrAddressEqual(SOME_CONTRACT, OTHER_CONTRACT)).toBeFalsy();
    });
  });
});
