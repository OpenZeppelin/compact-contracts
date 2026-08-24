import { beforeEach, describe, expect, it } from 'vitest';
import { NativeShieldedTokenFamilyPublicSupplySimulator } from '../simulators/NativeShieldedTokenFamilyPublicSupplySimulator.js';

const b32 = (label: string): Uint8Array => {
  const u = new Uint8Array(32);
  u.set(new TextEncoder().encode(label).slice(0, 32));
  return u;
};

const DOMAIN_A = b32('domain-A');
const DOMAIN_B = b32('domain-B');

// The per-domain supply extension imports no token module, so it is unit-tested
// by driving its accounting blocks and getters directly.

let supply: NativeShieldedTokenFamilyPublicSupplySimulator;

describe('NativeShieldedTokenFamilyPublicSupply (extension)', () => {
  beforeEach(async () => {
    supply = await NativeShieldedTokenFamilyPublicSupplySimulator.create();
  });

  describe('initial state', () => {
    it('should return 0 for an unknown domain', async () => {
      expect(await supply.totalMinted(DOMAIN_A)).toBe(0n);
      expect(await supply.totalBurned(DOMAIN_A)).toBe(0n);
      expect(await supply.totalSupply(DOMAIN_A)).toBe(0n);
    });
  });

  describe('per-domain accounting', () => {
    it('should increment totalMinted(domain) by amount', async () => {
      await supply._addMinted(DOMAIN_A, 1_000n);
      expect(await supply.totalMinted(DOMAIN_A)).toBe(1_000n);
    });

    it('should report totalSupply(domain) == minted - burned', async () => {
      await supply._addMinted(DOMAIN_A, 1_000n);
      await supply._addBurned(DOMAIN_A, 400n);
      expect(await supply.totalSupply(DOMAIN_A)).toBe(600n);
    });
  });

  describe('multi-domain isolation', () => {
    it('should accumulate independent supplies for distinct domains', async () => {
      await supply._addMinted(DOMAIN_A, 1_000n);
      await supply._addMinted(DOMAIN_B, 250n);
      expect(await supply.totalMinted(DOMAIN_A)).toBe(1_000n);
      expect(await supply.totalMinted(DOMAIN_B)).toBe(250n);
    });

    it('should keep domain B unaffected by a burn under domain A', async () => {
      await supply._addMinted(DOMAIN_A, 1_000n);
      await supply._addMinted(DOMAIN_B, 1_000n);
      await supply._addBurned(DOMAIN_A, 400n);
      expect(await supply.totalBurned(DOMAIN_A)).toBe(400n);
      expect(await supply.totalBurned(DOMAIN_B)).toBe(0n);
      expect(await supply.totalSupply(DOMAIN_A)).toBe(600n);
      expect(await supply.totalSupply(DOMAIN_B)).toBe(1_000n);
    });
  });

  describe('per-domain burned <= minted invariant', () => {
    it('should revert an unpaired burn under a never-minted domain', async () => {
      await supply._addMinted(DOMAIN_A, 1_000n);
      // DOMAIN_B was never minted; burning under it must revert.
      await expect(supply._addBurned(DOMAIN_B, 1n)).rejects.toThrow(
        'NativeShieldedTokenPublicSupply: burn exceeds available supply',
      );
    });

    it('should revert a burn that exceeds the domain minted total', async () => {
      await supply._addMinted(DOMAIN_A, 1_000n);
      await expect(supply._addBurned(DOMAIN_A, 1_001n)).rejects.toThrow(
        'NativeShieldedTokenPublicSupply: burn exceeds available supply',
      );
    });

    it('should revert with the underflow-guard message when burned already exceeds minted for a domain', async () => {
      await supply._addMinted(DOMAIN_A, 1_000n);
      // Corrupt DOMAIN_A past the invariant so the first guard (not the
      // available-supply check) is what fires.
      await supply.unsafeSetBurned(DOMAIN_A, 1_500n);
      await expect(supply._addBurned(DOMAIN_A, 1n)).rejects.toThrow(
        'NativeShieldedTokenPublicSupply: burned total exceeds minted',
      );
    });
  });

  describe('totalSupply clamp', () => {
    it('should clamp to 0 when burned somehow exceeds minted for a domain', async () => {
      await supply._addMinted(DOMAIN_A, 1_000n);
      // Corrupt DOMAIN_A past the invariant the accounting API enforces.
      await supply.unsafeSetBurned(DOMAIN_A, 1_500n);
      expect(await supply.totalBurned(DOMAIN_A)).toBe(1_500n);
      // The getter reads cleanly as 0 instead of reverting on the underflow.
      expect(await supply.totalSupply(DOMAIN_A)).toBe(0n);
      // A healthy domain is unaffected.
      await supply._addMinted(DOMAIN_B, 250n);
      expect(await supply.totalSupply(DOMAIN_B)).toBe(250n);
    });
  });

  describe('simulator wiring', () => {
    it('should surface the per-domain supply ledger and return it verbatim from the getters', async () => {
      await supply._addMinted(DOMAIN_A, 1_500n);
      await supply._addBurned(DOMAIN_A, 400n);
      await supply._addMinted(DOMAIN_B, 250n);

      const state = await supply.getPublicState();

      // The re-exported ledger keys read cleanly as `_totalMinted` /
      // `_totalBurned`, each keyed by domain ...
      expect(state._totalMinted.lookup(DOMAIN_A)).toBe(1_500n);
      expect(state._totalBurned.lookup(DOMAIN_A)).toBe(400n);
      expect(state._totalMinted.lookup(DOMAIN_B)).toBe(250n);
      // ... an unburned domain has no burned slot, which the getter reads as 0.
      expect(state._totalBurned.member(DOMAIN_B)).toBe(false);

      // ... and each getter reads its slot straight from that ledger.
      expect(await supply.totalMinted(DOMAIN_A)).toBe(
        state._totalMinted.lookup(DOMAIN_A),
      );
      expect(await supply.totalBurned(DOMAIN_A)).toBe(
        state._totalBurned.lookup(DOMAIN_A),
      );
      expect(await supply.totalSupply(DOMAIN_A)).toBe(
        state._totalMinted.lookup(DOMAIN_A) -
          state._totalBurned.lookup(DOMAIN_A),
      );
      expect(await supply.totalBurned(DOMAIN_B)).toBe(0n);
    });
  });
});
