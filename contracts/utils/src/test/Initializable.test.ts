import { it, describe, expect } from '@jest/globals';
import { InitializableSimulator } from './simulators/InitializableSimulator';

let initializable: InitializableSimulator;

describe('Initializable', () => {
  beforeEach(() => {
    initializable = new InitializableSimulator();
  });

  it('should generate the initial ledger state deterministically', () => {
    const initializable2 = new InitializableSimulator();
    expect(initializable.getCurrentPublicState()).toEqual(initializable2.getCurrentPublicState());
  });

  describe('initialize', () => {})
  //  it('should not be initialized', () => {
  //    expect(initializable.isInitialized()).toEqual(false);
  //    expect(initializable.getCurrentPublicState().initializableState).toEqual(STATE.uninitialized);
  //  });
//
  //  it('should initialize', () => {
  //    initializable.initialize();
  //    expect(initializable.isInitialized()).toEqual(true);
  //    expect(initializable.getCurrentPublicState().initializableState).toEqual(STATE.initialized);
  //    });
  //  });

    it('should fail when re-initialized', () => {
      expect(() => {
        initializable.initialize();
        initializable.initialize();
      }).toThrow('Contract already initialized');
  });
});
