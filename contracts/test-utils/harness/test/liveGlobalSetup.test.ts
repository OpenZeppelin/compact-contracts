import { describe, expect, it, vi } from 'vitest';
import { countCoinEvents, lockHolderState } from '../live.globalSetup.js';

describe('live.globalSetup', () => {
  describe('lockHolderState', () => {
    const alive = () => true;
    const dead = () => false;

    it('is reentrant when the lock holds our own pid', () => {
      expect(lockHolderState({ pid: 42, startedAt: 'x' }, 42, dead)).toBe(
        'reentrant',
      );
    });

    it('is held when a live process owns the lock', () => {
      expect(lockHolderState({ pid: 7, startedAt: 'x' }, 42, alive)).toBe(
        'held',
      );
    });

    it('is stale when the owning pid is gone', () => {
      expect(lockHolderState({ pid: 7, startedAt: 'x' }, 42, dead)).toBe(
        'stale',
      );
    });
  });

  describe('countCoinEvents', () => {
    it('scans every block when the node is clean', async () => {
      const fetchWindow = vi.fn(async () => 0);
      const count = await countCoinEvents(fetchWindow, 1, 100, 0, {
        chunk: 10,
        concurrency: 4,
      });
      expect(count).toBe(0);
      expect(fetchWindow).toHaveBeenCalledTimes(10); // 100 blocks / chunk 10
    });

    it('early-exits as soon as the count exceeds the threshold', async () => {
      const fetchWindow = vi.fn(async (from: number) => (from === 1 ? 3 : 0));
      const count = await countCoinEvents(fetchWindow, 1, 1000, 0, {
        chunk: 10,
        concurrency: 1,
      });
      expect(count).toBe(3);
      expect(fetchWindow).toHaveBeenCalledTimes(1); // stopped after batch 1
    });

    it('does not trip when the count only reaches the threshold', async () => {
      const fetchWindow = vi.fn(async (from: number) => (from === 1 ? 2 : 0));
      const count = await countCoinEvents(fetchWindow, 1, 30, 2, {
        chunk: 10,
        concurrency: 1,
      });
      expect(count).toBe(2); // == threshold, no early exit
      expect(fetchWindow).toHaveBeenCalledTimes(3);
    });

    it('returns 0 for an empty range (head before from)', async () => {
      const fetchWindow = vi.fn(async () => 0);
      expect(await countCoinEvents(fetchWindow, 1, 0, 0)).toBe(0);
      expect(fetchWindow).not.toHaveBeenCalled();
    });
  });
});
