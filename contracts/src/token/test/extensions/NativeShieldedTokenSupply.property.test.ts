import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { NativeShieldedTokenFamilySupplySimulator } from '../simulators/NativeShieldedTokenFamilySupplySimulator.js';
import { NativeShieldedTokenSupplySimulator } from '../simulators/NativeShieldedTokenSupplySimulator.js';

// Property-based invariant fuzzing over random mint/burn op sequences for the
// supply extension. Both flavors are covered in one file: the scalar
// `NativeShieldedTokenSupply` and the per-domain `NativeShieldedTokenFamilySupply`.
// Both delegate to the shared `NativeShieldedTokenSupplyCore`, so the core
// accounting is exercised transitively through each.
//
// Conservation (burned <= minted) is respected by construction: each op burns
// at most the amount it just minted, so the sequence never drives an over-value
// burn (which the `_addBurned` invariant would reject anyway).

const b32 = (label: string): Uint8Array => {
  const u = new Uint8Array(32);
  u.set(new TextEncoder().encode(label).slice(0, 32));
  return u;
};

const opArb = fc.record({
  mint: fc.bigInt({ min: 1n, max: 1_000_000n }),
  burnPct: fc.integer({ min: 0, max: 100 }),
});

describe('NativeShieldedTokenSupply(Core/Family) — property: supply invariants under random op sequences', () => {
  it('should keep totalMinted exact, totalSupply = minted - burned, and burned <= minted (scalar)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(opArb, { minLength: 1, maxLength: 6 }),
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
          expect(await supply.totalSupply()).toBe(
            expectedMinted - expectedBurned,
          );
          expect(expectedBurned <= expectedMinted).toBe(true);
        },
      ),
      { numRuns: 15 },
    );
  }, 120_000);

  it('should keep those same invariants per domain across interleaved domains (family)', async () => {
    const DOMAINS = [b32('domain-A'), b32('domain-B'), b32('domain-C')];

    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            domainIdx: fc.integer({ min: 0, max: DOMAINS.length - 1 }),
            mint: fc.bigInt({ min: 1n, max: 1_000_000n }),
            burnPct: fc.integer({ min: 0, max: 100 }),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        async (ops) => {
          const supply =
            await NativeShieldedTokenFamilySupplySimulator.create();
          const expectedMinted = DOMAINS.map(() => 0n);
          const expectedBurned = DOMAINS.map(() => 0n);

          for (const op of ops) {
            const domain = DOMAINS[op.domainIdx];
            await supply._addMinted(domain, op.mint);
            expectedMinted[op.domainIdx] += op.mint;
            const burn = (op.mint * BigInt(op.burnPct)) / 100n;
            if (burn > 0n) {
              await supply._addBurned(domain, burn);
              expectedBurned[op.domainIdx] += burn;
            }
          }

          for (let i = 0; i < DOMAINS.length; i++) {
            const domain = DOMAINS[i];
            expect(await supply.totalMinted(domain)).toBe(expectedMinted[i]);
            expect(await supply.totalBurned(domain)).toBe(expectedBurned[i]);
            expect(await supply.totalSupply(domain)).toBe(
              expectedMinted[i] - expectedBurned[i],
            );
            expect(expectedBurned[i] <= expectedMinted[i]).toBe(true);
          }
        },
      ),
      { numRuns: 15 },
    );
  }, 120_000);
});
