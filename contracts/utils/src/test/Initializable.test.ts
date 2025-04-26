<<<<<<< HEAD
import { beforeEach, describe, expect, it } from 'vitest';
import { InitializableSimulator } from './simulators/InitializableSimulator.js';
=======
import { it, describe, expect } from '@jest/globals';
import { InitializableSimulator } from './simulators/InitializableSimulator';
>>>>>>> b6f5215 (Add pausable (#22))

let initializable: InitializableSimulator;

describe('Initializable', () => {
  beforeEach(() => {
    initializable = new InitializableSimulator();
  });

  it('should generate the initial ledger state deterministically', () => {
    const initializable2 = new InitializableSimulator();
<<<<<<< HEAD
    expect(initializable.getCurrentPublicState()).toEqual(
      initializable2.getCurrentPublicState(),
    );
=======
    expect(initializable.getCurrentPublicState()).toEqual(initializable2.getCurrentPublicState());
>>>>>>> b6f5215 (Add pausable (#22))
  });

  describe('initialize', () => {
    it('should not be initialized', () => {
<<<<<<< HEAD
      expect(
        initializable.getCurrentPublicState().initializable_IsInitialized,
      ).toEqual(false);
=======
      expect(initializable.getCurrentPublicState().initializable_IsInitialized).toEqual(false);
>>>>>>> b6f5215 (Add pausable (#22))
    });

    it('should initialize', () => {
      initializable.initialize();
<<<<<<< HEAD
      expect(
        initializable.getCurrentPublicState().initializable_IsInitialized,
      ).toEqual(true);
    });
  });

  it('should fail when re-initialized', () => {
    expect(() => {
      initializable.initialize();
      initializable.initialize();
    }).toThrow('Initializable: contract already initialized');
=======
      expect(initializable.getCurrentPublicState().initializable_IsInitialized).toEqual(true);
      });
    });

    it('should fail when re-initialized', () => {
      expect(() => {
        initializable.initialize();
        initializable.initialize();
      }).toThrow('Initializable: contract already initialized');
>>>>>>> b6f5215 (Add pausable (#22))
  });

  describe('assertInitialized', () => {
    it('should fail when not initialized', () => {
      expect(() => {
        initializable.assertInitialized();
      }).toThrow('Initializable: contract not initialized');
    });

    it('should not fail when initialized', () => {
      initializable.initialize();
      initializable.assertInitialized();
    });
  });

  describe('assertNotInitialized', () => {
    it('should fail when initialized', () => {
      initializable.initialize();
      expect(() => {
        initializable.assertNotInitialized();
      }).toThrow('Initializable: contract already initialized');
    });

    it('should not fail when not initialied', () => {
      initializable.assertNotInitialized();
    });
  });
});
