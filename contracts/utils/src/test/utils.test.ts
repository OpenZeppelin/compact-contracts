import { describe, expect, it } from 'vitest';
import { UtilsSimulator } from './simulators/UtilsSimulator';
import * as contractUtils from './utils/address';

const Z_SOME_KEY = contractUtils.createEitherTestUser('SOME_KEY');
const SOME_CONTRACT =
  contractUtils.createEitherTestContractAddress('SOME_CONTRACT');

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
      expect(contract.isKeyOrAddressZero(contractUtils.ZERO_ADDRESS)).toBe(false);
    });
  });
});
