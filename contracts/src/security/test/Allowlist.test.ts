import { beforeEach, describe, expect, it } from 'vitest';
import { AllowlistSimulator } from './simulators/AllowlistSimulator.js';

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

let allowlist: AllowlistSimulator;

describe('Allowlist', () => {
  beforeEach(async () => {
    allowlist = await AllowlistSimulator.create();
  });

  describe('default state', () => {
    it('is empty: no account is allowed', async () => {
      expect(await allowlist.isAllowed(ALICE)).toBe(false);
      expect(await allowlist.isAllowed(BOB)).toBe(false);
    });

    it('assertAllowed throws for a non-member', async () => {
      await expect(allowlist.assertAllowed(ALICE)).rejects.toThrow(
        'Allowlist: account not allowed',
      );
    });
  });

  describe('allow', () => {
    it('adds an account to the allowlist', async () => {
      await allowlist.allow(ALICE);
      expect(await allowlist.isAllowed(ALICE)).toBe(true);
    });

    it('does not affect other accounts', async () => {
      await allowlist.allow(ALICE);
      expect(await allowlist.isAllowed(BOB)).toBe(false);
    });

    it('assertAllowed passes for a member', async () => {
      await allowlist.allow(ALICE);
      await allowlist.assertAllowed(ALICE);
    });

    it('is idempotent', async () => {
      await allowlist.allow(ALICE);
      await allowlist.allow(ALICE);
      expect(await allowlist.isAllowed(ALICE)).toBe(true);
    });

    it('clears with a single disallow after being allowed multiple times', async () => {
      await allowlist.allow(ALICE);
      await allowlist.allow(ALICE);
      expect(await allowlist.isAllowed(ALICE)).toBe(true);
      await allowlist.disallow(ALICE);
      // Membership is binary, not a counter: one disallow clears it regardless
      // of how many times it was allowed.
      expect(await allowlist.isAllowed(ALICE)).toBe(false);
    });
  });

  describe('disallow', () => {
    it('removes an account from the allowlist', async () => {
      await allowlist.allow(ALICE);
      await allowlist.disallow(ALICE);
      expect(await allowlist.isAllowed(ALICE)).toBe(false);
    });

    it('assertAllowed throws again after disallow', async () => {
      await allowlist.allow(ALICE);
      await allowlist.disallow(ALICE);
      await expect(allowlist.assertAllowed(ALICE)).rejects.toThrow(
        'Allowlist: account not allowed',
      );
    });

    it('is a no-op for a non-member', async () => {
      await allowlist.disallow(BOB);
      expect(await allowlist.isAllowed(BOB)).toBe(false);
    });
  });

  describe('multiple operations', () => {
    it('handles allow -> disallow -> allow', async () => {
      await allowlist.allow(ALICE);
      expect(await allowlist.isAllowed(ALICE)).toBe(true);

      await allowlist.disallow(ALICE);
      expect(await allowlist.isAllowed(ALICE)).toBe(false);

      await allowlist.allow(ALICE);
      expect(await allowlist.isAllowed(ALICE)).toBe(true);
    });

    it('tracks several accounts independently', async () => {
      await allowlist.allow(ALICE);
      expect(await allowlist.isAllowed(ALICE)).toBe(true);
      expect(await allowlist.isAllowed(BOB)).toBe(false);

      await allowlist.allow(BOB);
      await allowlist.disallow(ALICE);
      expect(await allowlist.isAllowed(ALICE)).toBe(false);
      expect(await allowlist.isAllowed(BOB)).toBe(true);
    });
  });

  describe('contract accounts', () => {
    it('adds and removes a contract account', async () => {
      await allowlist.allow(ALICE_CONTRACT);
      expect(await allowlist.isAllowed(ALICE_CONTRACT)).toBe(true);

      await allowlist.disallow(ALICE_CONTRACT);
      expect(await allowlist.isAllowed(ALICE_CONTRACT)).toBe(false);
    });

    it('treats a key account and a contract account with the same bytes as two entries', async () => {
      await allowlist.allow(ALICE);
      expect(await allowlist.isAllowed(ALICE_CONTRACT)).toBe(false);

      await allowlist.allow(ALICE_CONTRACT);
      await allowlist.disallow(ALICE);
      expect(await allowlist.isAllowed(ALICE)).toBe(false);
      expect(await allowlist.isAllowed(ALICE_CONTRACT)).toBe(true);
    });
  });

  describe('inactive arm', () => {
    // The same key account with data left in its contract arm.
    const ALICE_PADDED = { ...ALICE, right: { bytes: BOB.left } };

    it('reads an account by its active arm only', async () => {
      await allowlist.allow(ALICE);
      expect(await allowlist.isAllowed(ALICE_PADDED)).toBe(true);
    });

    it('writes an account by its active arm only', async () => {
      await allowlist.allow(ALICE_PADDED);
      expect(await allowlist.isAllowed(ALICE)).toBe(true);

      await allowlist.disallow(ALICE_PADDED);
      expect(await allowlist.isAllowed(ALICE)).toBe(false);
    });
  });

  describe('simulator wiring', () => {
    it('exposes the public ledger via getPublicState', async () => {
      const sim = await AllowlistSimulator.create();

      expect(
        (await sim.getPublicState()).Allowlist__allowed.member(ALICE),
      ).toBe(false);

      await sim.allow(ALICE);

      expect(
        (await sim.getPublicState()).Allowlist__allowed.member(ALICE),
      ).toBe(true);
    });
  });
});
