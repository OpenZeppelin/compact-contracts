import { beforeEach, describe, expect, it } from 'vitest';
import { ConfidentialFungibleTokenPublicSupplySimulator } from '../simulators/ConfidentialFungibleTokenPublicSupplySimulator.js';

// The supply extension imports no token module, so it is unit-tested by driving
// its accounting blocks (`_addSupply` / `_subSupply`) and the `totalSupply`
// getter directly. Composition with the token base (pairing each supply delta
// with the matching value op) is exercised by the integration suite.

const MAX_UINT128 = 340282366920938463463374607431768211455n;

let supply: ConfidentialFungibleTokenPublicSupplySimulator;

describe('ConfidentialFungibleTokenPublicSupply (extension)', () => {
  beforeEach(async () => {
    supply = await ConfidentialFungibleTokenPublicSupplySimulator.create();
  });

  describe('initial state', () => {
    it('should start with zero supply', async () => {
      expect(await supply.totalSupply()).toBe(0n);
    });
  });

  describe('_addSupply', () => {
    it('should increase totalSupply by value', async () => {
      await supply._addSupply(1_000n);
      expect(await supply.totalSupply()).toBe(1_000n);
      await supply._addSupply(500n);
      expect(await supply.totalSupply()).toBe(1_500n);
    });

    it('should accept an add up to the Uint<128> ceiling', async () => {
      await supply._addSupply(MAX_UINT128);
      expect(await supply.totalSupply()).toBe(MAX_UINT128);
    });

    it('should revert when the add overflows Uint<128>', async () => {
      await supply._addSupply(MAX_UINT128);
      await expect(supply._addSupply(1n)).rejects.toThrow(
        'ConfidentialFungibleTokenPublicSupply: overflow',
      );
      // The rejected add left the total unchanged.
      expect(await supply.totalSupply()).toBe(MAX_UINT128);
    });
  });

  describe('_subSupply', () => {
    it('should decrease totalSupply by value', async () => {
      await supply._addSupply(1_000n);
      await supply._subSupply(400n);
      expect(await supply.totalSupply()).toBe(600n);
    });

    it('should allow burning the entire supply back to zero', async () => {
      await supply._addSupply(1_000n);
      await supply._subSupply(1_000n);
      expect(await supply.totalSupply()).toBe(0n);
    });

    it('should revert an unpaired sub (from zero supply)', async () => {
      await expect(supply._subSupply(1n)).rejects.toThrow(
        'ConfidentialFungibleTokenPublicSupply: supply underflow',
      );
    });

    it('should revert a sub that exceeds the current supply', async () => {
      await supply._addSupply(1_000n);
      await expect(supply._subSupply(1_001n)).rejects.toThrow(
        'ConfidentialFungibleTokenPublicSupply: supply underflow',
      );
      // The rejected sub left the total unchanged.
      expect(await supply.totalSupply()).toBe(1_000n);
    });
  });

  describe('totalSupply', () => {
    it('should reflect an add/sub sequence (mint then partial burn)', async () => {
      await supply._addSupply(1_000n);
      await supply._addSupply(500n);
      await supply._subSupply(400n);
      expect(await supply.totalSupply()).toBe(1_100n);
    });
  });

  describe('simulator wiring', () => {
    it('should surface the supply ledger cell and return it verbatim from the getter', async () => {
      await supply._addSupply(1_500n);
      await supply._subSupply(400n);

      const state = await supply.getPublicState();

      // The re-exported scalar ledger reads cleanly as `_totalSupply` ...
      expect(state._totalSupply).toBe(1_100n);
      // ... and the getter reads that slot straight from the ledger.
      expect(await supply.totalSupply()).toBe(state._totalSupply);
    });
  });
});
