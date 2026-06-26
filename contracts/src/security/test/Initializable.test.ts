import { beforeEach, describe, expect, it } from 'vitest';
import { InitializableSimulator } from './simulators/InitializableSimulator.js';

let initializable: InitializableSimulator;

describe('Initializable', () => {
  beforeEach(async () => {
    initializable = await InitializableSimulator.create();
  });

  it('should generate the initial ledger state deterministically', async () => {
    const initializable2 = await InitializableSimulator.create();
    expect(await initializable.getPublicState()).toEqual(
      await initializable2.getPublicState(),
    );
  });

  describe('initialize', () => {
    it('should not be initialized', async () => {
      expect(
        (await initializable.getPublicState()).Initializable__isInitialized,
      ).toEqual(false);
    });

    it('should initialize', async () => {
      await initializable.initialize();
      expect(
        (await initializable.getPublicState()).Initializable__isInitialized,
      ).toEqual(true);
    });
  });

  it('should fail when re-initialized', async () => {
    await initializable.initialize();
    await expect(initializable.initialize()).rejects.toThrow(
      'Initializable: contract already initialized',
    );
  });

  describe('assertInitialized', () => {
    it('should fail when not initialized', async () => {
      await expect(initializable.assertInitialized()).rejects.toThrow(
        'Initializable: contract not initialized',
      );
    });

    it('should not fail when initialized', async () => {
      await initializable.initialize();
      await initializable.assertInitialized();
    });
  });

  describe('assertNotInitialized', () => {
    it('should fail when initialized', async () => {
      await initializable.initialize();
      await expect(initializable.assertNotInitialized()).rejects.toThrow(
        'Initializable: contract already initialized',
      );
    });

    it('should not fail when not initialied', async () => {
      await initializable.assertNotInitialized();
    });
  });
});
