import { it, describe, expect } from '@jest/globals';
import { InitializableSimulator } from './InitializableSimulator.js';
import { Initializable_STATE as STATE } from '../artifacts/MockInitializable/contract/index.cjs';

const contract = new InitializableSimulator();

describe('Initializable', () => {
  it('should generate the initial ledger state deterministically', () => {
    const contract2 = new InitializableSimulator();
    expect(contract.getCurrentPublicState()).toEqual(contract2.getCurrentPublicState());
  });

  describe('initialize', () => {
    it('should not be initialized', () => {
      expect(contract.isInitialized()).toEqual(false);
      expect(contract.getCurrentPublicState().initializableState).toEqual(STATE.uninitialized);
    });

    it('should initialize', () => {
      contract.initialize();
      expect(contract.isInitialized()).toEqual(true);
      expect(contract.getCurrentPublicState().initializableState).toEqual(STATE.initialized);
      });
    });

    it('should fail when re-initialized', () => {
      expect(() => {
          contract.initialize();
          contract.initialize();
      }).toThrow('Contract already initialized');
  });
});
