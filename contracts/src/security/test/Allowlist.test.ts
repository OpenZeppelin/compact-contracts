import { beforeEach, describe, expect, it } from 'vitest';
import { AllowlistSimulator } from './simulators/AllowlistSimulator.js';

// Deterministic 32-byte account identifier seeded from a label.
const account = (label: string): Uint8Array => {
  const a = new Uint8Array(32);
  a.set(new TextEncoder().encode(label).slice(0, 32));
  return a;
};

const ALICE = account('ALICE');
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
