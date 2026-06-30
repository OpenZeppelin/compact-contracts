import { beforeEach, describe, expect, it } from 'vitest';
import { BlocklistSimulator } from './simulators/BlocklistSimulator.js';

// Deterministic 32-byte account identifier seeded from a label.
const account = (label: string): Uint8Array => {
  const a = new Uint8Array(32);
  a.set(new TextEncoder().encode(label).slice(0, 32));
  return a;
};

const ALICE = account('ALICE');
const BOB = account('BOB');

let blocklist: BlocklistSimulator;

describe('Blocklist', () => {
  beforeEach(async () => {
    blocklist = await BlocklistSimulator.create();
  });

  describe('default state', () => {
    it('is empty: no account is blocked', async () => {
      expect(await blocklist.isBlocked(ALICE)).toBe(false);
      expect(await blocklist.isBlocked(BOB)).toBe(false);
    });

    it('assertNotBlocked passes for a non-member', async () => {
      await blocklist.assertNotBlocked(ALICE);
    });
  });

  describe('block', () => {
    it('adds an account to the blocklist', async () => {
      await blocklist.block(ALICE);
      expect(await blocklist.isBlocked(ALICE)).toBe(true);
    });

    it('does not affect other accounts', async () => {
      await blocklist.block(ALICE);
      expect(await blocklist.isBlocked(BOB)).toBe(false);
    });

    it('assertNotBlocked throws for a member', async () => {
      await blocklist.block(ALICE);
      await expect(blocklist.assertNotBlocked(ALICE)).rejects.toThrow(
        'Blocklist: account blocked',
      );
    });

    it('is idempotent', async () => {
      await blocklist.block(ALICE);
      await blocklist.block(ALICE);
      expect(await blocklist.isBlocked(ALICE)).toBe(true);
    });

    it('clears with a single unblock after being blocked multiple times', async () => {
      await blocklist.block(ALICE);
      await blocklist.block(ALICE);
      expect(await blocklist.isBlocked(ALICE)).toBe(true);
      await blocklist.unblock(ALICE);
      // Membership is binary, not a counter: one unblock clears it regardless
      // of how many times it was blocked.
      expect(await blocklist.isBlocked(ALICE)).toBe(false);
    });
  });

  describe('unblock', () => {
    it('removes an account from the blocklist', async () => {
      await blocklist.block(ALICE);
      await blocklist.unblock(ALICE);
      expect(await blocklist.isBlocked(ALICE)).toBe(false);
    });

    it('assertNotBlocked passes again after unblock', async () => {
      await blocklist.block(ALICE);
      await blocklist.unblock(ALICE);
      await blocklist.assertNotBlocked(ALICE);
    });

    it('is a no-op for a non-member', async () => {
      await blocklist.unblock(BOB);
      expect(await blocklist.isBlocked(BOB)).toBe(false);
    });
  });

  describe('multiple operations', () => {
    it('handles block -> unblock -> block', async () => {
      await blocklist.block(ALICE);
      expect(await blocklist.isBlocked(ALICE)).toBe(true);

      await blocklist.unblock(ALICE);
      expect(await blocklist.isBlocked(ALICE)).toBe(false);

      await blocklist.block(ALICE);
      expect(await blocklist.isBlocked(ALICE)).toBe(true);
    });

    it('tracks several accounts independently', async () => {
      await blocklist.block(ALICE);
      expect(await blocklist.isBlocked(ALICE)).toBe(true);
      expect(await blocklist.isBlocked(BOB)).toBe(false);

      await blocklist.block(BOB);
      await blocklist.unblock(ALICE);
      expect(await blocklist.isBlocked(ALICE)).toBe(false);
      expect(await blocklist.isBlocked(BOB)).toBe(true);
    });
  });

  describe('simulator wiring', () => {
    it('exposes the public ledger via getPublicState', async () => {
      const sim = await BlocklistSimulator.create();

      expect(
        (await sim.getPublicState()).Blocklist__blocked.member(ALICE),
      ).toBe(false);

      await sim.block(ALICE);

      expect(
        (await sim.getPublicState()).Blocklist__blocked.member(ALICE),
      ).toBe(true);
    });
  });
});
