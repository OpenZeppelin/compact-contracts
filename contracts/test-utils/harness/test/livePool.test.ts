import { afterEach, describe, expect, it } from 'vitest';
import {
  clearLivePool,
  publishLivePool,
  requireLivePool,
} from '../livePool.js';
import type { WalletPool } from '../WalletPool.js';

describe('live pool handoff', () => {
  afterEach(() => {
    clearLivePool();
  });

  it('should return the published pool', () => {
    const pool = {} as WalletPool;
    publishLivePool(pool);
    expect(requireLivePool()).toBe(pool);
  });

  it('should point at the missing live setup when nothing is published', () => {
    expect(() => requireLivePool()).toThrow(/live wallet pool not published/);
  });

  it('should forget the pool once cleared', () => {
    publishLivePool({} as WalletPool);
    clearLivePool();
    expect(() => requireLivePool()).toThrow();
  });
});
