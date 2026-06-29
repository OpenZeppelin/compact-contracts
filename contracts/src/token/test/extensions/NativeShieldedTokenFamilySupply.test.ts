import { beforeEach, describe, expect, it } from 'vitest';
import { NativeShieldedTokenFamilySupplySimulator } from '../simulators/NativeShieldedTokenFamilySupplySimulator.js';

const b32 = (label: string): Uint8Array => {
  const u = new Uint8Array(32);
  u.set(new TextEncoder().encode(label).slice(0, 32));
  return u;
};

const DOMAIN_A = b32('domain-A');
const DOMAIN_B = b32('domain-B');

// The per-domain supply extension imports no token module, so it is unit-tested
// by driving its accounting blocks and getters directly.

let supply: NativeShieldedTokenFamilySupplySimulator;

describe('NativeShieldedTokenFamilySupply (extension)', () => {
  beforeEach(async () => {
    supply = await NativeShieldedTokenFamilySupplySimulator.create();
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
        'NativeShieldedTokenSupply: burned exceeds minted',
      );
    });

    it('should revert a burn that exceeds the domain minted total', async () => {
      await supply._addMinted(DOMAIN_A, 1_000n);
      await expect(supply._addBurned(DOMAIN_A, 1_001n)).rejects.toThrow(
        'NativeShieldedTokenSupply: burned exceeds minted',
      );
    });
  });
});
