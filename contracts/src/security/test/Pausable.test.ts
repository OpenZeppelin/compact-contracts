import { beforeEach, describe, expect, it } from 'vitest';
import { PausableSimulator } from './simulators/PausableSimulator.js';

let pausable: PausableSimulator;

describe('Pausable', () => {
  beforeEach(async () => {
    pausable = await PausableSimulator.create();
  });

  describe('when not paused', () => {
    it('should not be paused in initial state', async () => {
      expect(await pausable.isPaused()).toBe(false);
    });

    it('should throw when calling assertPaused', async () => {
      await expect(pausable.assertPaused()).rejects.toThrow(
        'Pausable: not paused',
      );
    });

    it('should not throw when calling assertNotPaused', async () => {
      await pausable.assertNotPaused();
    });

    it('should pause from unpaused state', async () => {
      await pausable.pause();
      expect(await pausable.isPaused()).toBe(true);
    });

    it('should throw when unpausing in an unpaused state', async () => {
      await expect(pausable.unpause()).rejects.toThrow('Pausable: not paused');
    });
  });

  describe('when paused', () => {
    beforeEach(async () => {
      await pausable.pause();
    });

    it('should not throw when calling assertPaused', async () => {
      await pausable.assertPaused();
    });

    it('should throw when calling assertNotPaused', async () => {
      await expect(pausable.assertNotPaused()).rejects.toThrow(
        'Pausable: paused',
      );
    });

    it('should unpause from paused state', async () => {
      await pausable.unpause();
      expect(await pausable.isPaused()).toBe(false);
    });

    it('should throw when pausing in an paused state', async () => {
      await expect(pausable.pause()).rejects.toThrow('Pausable: paused');
    });
  });

  describe('Multiple Operations', () => {
    it('should handle pause → unpause → pause sequence', async () => {
      await pausable.pause();
      expect(await pausable.isPaused()).toBe(true);

      await pausable.unpause();
      expect(await pausable.isPaused()).toBe(false);

      await pausable.pause();
      expect(await pausable.isPaused()).toBe(true);
    });
  });

  describe('simulator wiring', () => {
    it('should expose the public ledger via getPublicState', async () => {
      const sim = await PausableSimulator.create();

      expect((await sim.getPublicState()).Pausable__isPaused).toBe(false);

      await sim.pause();

      expect((await sim.getPublicState()).Pausable__isPaused).toBe(true);
    });
  });
});
