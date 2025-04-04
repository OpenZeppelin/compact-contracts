import { UtilsContractSimulator } from './UtilsSimulator';
import * as contractUtils from './utils';

const Z_SOME_KEY = contractUtils.createEitherTestUser('SOME_KEY');
const SOME_CONTRACT = contractUtils.createEitherTestContractAddress('SOME_CONTRACT');

let contract: UtilsContractSimulator;

describe('Utils', () => {
  contract = new UtilsContractSimulator();

  describe('isZero', () => {
    it('should return zero for the zero address', () => {
      expect(contract.isZero(contractUtils.ZERO_KEY)).toBeTruthy;
      expect(contract.isZero(contractUtils.ZERO_ADDRESS)).toBeTruthy;
    });

    it('should not return zero for nonzero addresses', () => {
      expect(contract.isZero(Z_SOME_KEY)).toBeFalsy;
      expect(contract.isZero(SOME_CONTRACT)).toBeFalsy;
    });
  });
});
