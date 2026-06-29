import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { NativeShieldedTokenSupplySimulator } from '../simulators/NativeShieldedTokenSupplySimulator.js';

// Property-based invariant fuzzing over random mint/burn op sequences.
// Conservation (burned <= minted) is respected by construction: each op burns
// at most the amount it just minted, so the sequence never drives an over-value
// burn (which the `_addBurned` invariant would reject anyway).

describe('NativeShieldedTokenSupply — property: supply invariants under random op sequences', () => {
  it('should keep totalMinted exact, totalSupply = minted - burned, burned <= minted', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            mint: fc.bigInt({ min: 1n, max: 1_000_000n }),
            burnPct: fc.integer({ min: 0, max: 100 }),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        async (ops) => {
          const supply = await NativeShieldedTokenSupplySimulator.create();
          let expectedMinted = 0n;
          let expectedBurned = 0n;

          for (const op of ops) {
            await supply._addMinted(op.mint);
            expectedMinted += op.mint;
            const burn = (op.mint * BigInt(op.burnPct)) / 100n;
            if (burn > 0n) {
              await supply._addBurned(burn);
              expectedBurned += burn;
            }
          }

          expect(await supply.totalMinted()).toBe(expectedMinted);
          expect(await supply.totalBurned()).toBe(expectedBurned);
          expect(await supply.totalSupply()).toBe(expectedMinted - expectedBurned);
          expect(expectedBurned <= expectedMinted).toBe(true);
        },
      ),
      { numRuns: 15 },
    );
  }, 120_000);
});
