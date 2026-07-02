import { beforeEach, describe, expect, it } from 'vitest';
import { NativeShieldedTokenSupplySimulator } from '../simulators/NativeShieldedTokenSupplySimulator.js';

// The supply extension imports no token module, so it is unit-tested by driving
// its accounting blocks (`_addMinted` / `_addBurned`) and getters directly.

let supply: NativeShieldedTokenSupplySimulator;

describe('NativeShieldedTokenSupply (extension)', () => {
  beforeEach(async () => {
    supply = await NativeShieldedTokenSupplySimulator.create();
  });

  describe('initial state', () => {
    it('should start with zero counters', async () => {
      expect(await supply.totalMinted()).toBe(0n);
      expect(await supply.totalBurned()).toBe(0n);
      expect(await supply.totalSupply()).toBe(0n);
    });
  });

  describe('_addMinted', () => {
    it('should increment totalMinted by amount', async () => {
      await supply._addMinted(1_000n);
      expect(await supply.totalMinted()).toBe(1_000n);
      await supply._addMinted(500n);
      expect(await supply.totalMinted()).toBe(1_500n);
    });
  });

  describe('_addBurned', () => {
    it('should increment totalBurned by amount (within minted)', async () => {
      await supply._addMinted(1_000n);
      await supply._addBurned(400n);
      expect(await supply.totalBurned()).toBe(400n);
    });

    it('should revert an unpaired burn (burned exceeds minted from zero)', async () => {
      await expect(supply._addBurned(1n)).rejects.toThrow(
        'NativeShieldedTokenSupply: burned exceeds minted',
      );
    });

    it('should revert a burn that exceeds the minted total', async () => {
      await supply._addMinted(1_000n);
      await expect(supply._addBurned(1_001n)).rejects.toThrow(
        'NativeShieldedTokenSupply: burned exceeds minted',
      );
    });

    it('should revert a duplicate burn that pushes past minted', async () => {
      await supply._addMinted(1_000n);
      await supply._addBurned(600n);
      await expect(supply._addBurned(600n)).rejects.toThrow(
        'NativeShieldedTokenSupply: burned exceeds minted',
      );
      // The rejected burn left the total unchanged.
      expect(await supply.totalBurned()).toBe(600n);
    });
  });

  describe('totalSupply', () => {
    it('should equal totalMinted - totalBurned after a mint/burn sequence', async () => {
      await supply._addMinted(1_000n);
      await supply._addMinted(500n);
      await supply._addBurned(400n);
      expect(await supply.totalMinted()).toBe(1_500n);
      expect(await supply.totalBurned()).toBe(400n);
      expect(await supply.totalSupply()).toBe(1_100n);
    });

    it('should never underflow, since the invariant bounds burned by minted', async () => {
      await supply._addMinted(1_000n);
      await supply._addBurned(1_000n);
      expect(await supply.totalSupply()).toBe(0n);
    });
  });

  describe('simulator wiring', () => {
    it('should surface the core supply ledger and return it verbatim from the getters', async () => {
      // The scalar flavor keys everything under one fixed slot: default<Bytes<32>>.
      const KEY = new Uint8Array(32);

      await supply._addMinted(1_500n);
      await supply._addBurned(400n);

      const state = await supply.getPublicState();

      // The re-exported ledger keys read cleanly as `_totalMinted` / `_totalBurned` ...
      expect(state._totalMinted.lookup(KEY)).toBe(1_500n);
      expect(state._totalBurned.lookup(KEY)).toBe(400n);

      // ... and each getter reads its slot straight from that ledger.
      expect(await supply.totalMinted()).toBe(state._totalMinted.lookup(KEY));
      expect(await supply.totalBurned()).toBe(state._totalBurned.lookup(KEY));
      expect(await supply.totalSupply()).toBe(
        state._totalMinted.lookup(KEY) - state._totalBurned.lookup(KEY),
      );
    });
  });
});
