import { UtilsContractSimulator } from './UtilsSimulator';
import * as utils from './utils.js';

const Z_OWNER = utils.createEitherTestUser('OWNER');
const SOME_CONTRACT = utils.createEitherTestContractAddress('SOME_CONTRACT');

let contract: UtilsContractSimulator;

describe('Utils', () => {
  contract = new UtilsContractSimulator();

  describe('isZero', () => {
    it('should return zero for the zero address', () => {
      expect(contract.isZero(utils.ZERO_KEY)).toBeTruthy;
      expect(contract.isZero(utils.ZERO_ADDRESS)).toBeTruthy;
    });

    it('should not return zero for nonzero addresses', () => {
      expect(contract.isZero(Z_OWNER)).toBeFalsy;
      expect(contract.isZero(SOME_CONTRACT)).toBeFalsy;
    });
  });
});
