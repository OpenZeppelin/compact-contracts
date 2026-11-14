import { beforeEach, describe, expect, it } from 'vitest';
import { BlocklistSimulator } from './simulators/BlocklistSimulator.js';

// Deterministic key account seeded from a label.
const account = (label: string) => {
  const a = new Uint8Array(32);
  a.set(new TextEncoder().encode(label).slice(0, 32));
  return { is_left: true, left: a, right: { bytes: new Uint8Array(32) } };
};

// Contract account over the same 32 bytes as `account(label)`.
const contract = (label: string) => ({
  is_left: false,
  left: new Uint8Array(32),
  right: { bytes: account(label).left },
});

const ALICE = account('ALICE');
const ALICE_CONTRACT = contract('ALICE');
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

  describe('contract accounts', () => {
    it('adds and removes a contract account', async () => {
      await blocklist.block(ALICE_CONTRACT);
      expect(await blocklist.isBlocked(ALICE_CONTRACT)).toBe(true);

      await blocklist.unblock(ALICE_CONTRACT);
      expect(await blocklist.isBlocked(ALICE_CONTRACT)).toBe(false);
    });

    it('treats a key account and a contract account with the same bytes as two entries', async () => {
      await blocklist.block(ALICE);
      expect(await blocklist.isBlocked(ALICE_CONTRACT)).toBe(false);

      await blocklist.block(ALICE_CONTRACT);
      await blocklist.unblock(ALICE);
      expect(await blocklist.isBlocked(ALICE)).toBe(false);
      expect(await blocklist.isBlocked(ALICE_CONTRACT)).toBe(true);
    });
  });

  describe('inactive arm', () => {
    // The same key account with data left in its contract arm.
    const ALICE_PADDED = { ...ALICE, right: { bytes: BOB.left } };

    it('reads an account by its active arm only', async () => {
      await blocklist.block(ALICE);
      expect(await blocklist.isBlocked(ALICE_PADDED)).toBe(true);
    });

    it('writes an account by its active arm only', async () => {
      await blocklist.block(ALICE_PADDED);
      expect(await blocklist.isBlocked(ALICE)).toBe(true);

      await blocklist.unblock(ALICE_PADDED);
      expect(await blocklist.isBlocked(ALICE)).toBe(false);
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
