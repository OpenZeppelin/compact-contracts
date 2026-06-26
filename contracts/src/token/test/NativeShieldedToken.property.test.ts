import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import { NativeShieldedTokenSimulator } from './simulators/NativeShieldedTokenSimulator.js';

// Property-based invariant fuzzing over random mint/burn op sequences
// (MIP §Integration "Invariant fuzzing"). Conservation (burned <= minted) is
// respected by construction: each op burns at most the amount it just minted,
// so the sequence never fabricates an over-value burn (the simulator does not
// model coin conservation; see MED-1).

const b32 = (label: string): Uint8Array => {
  const u = new Uint8Array(32);
  u.set(new TextEncoder().encode(label).slice(0, 32));
  return u;
};
const RECIPIENT = utils.createEitherTestUser('RECIPIENT');
const REFUND_TO = utils.createEitherTestUser('REFUND_TO');

describe('NativeShieldedToken — property: supply invariants under random op sequences', () => {
  it('should keep totalMinted exact, totalSupply = minted - burned, burned <= minted (INV-2, INV-5)', async () => {
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
          const token = await NativeShieldedTokenSimulator.create(
            b32('domain'),
            b32('seed'),
            'N',
            'S',
            6n,
            true,
          );
          const color = await token.tokenColor();
          let expectedMinted = 0n;
          let expectedBurned = 0n;

          for (let i = 0; i < ops.length; i++) {
            const op = ops[i];
            await token._mint(RECIPIENT, op.mint, b32(`m${i}`));
            expectedMinted += op.mint;
            const burn = (op.mint * BigInt(op.burnPct)) / 100n;
            if (burn > 0n) {
              await token._burn(
                { nonce: b32(`c${i}`), color, value: op.mint },
                burn,
                REFUND_TO,
              );
              expectedBurned += burn;
            }
          }

          expect(await token.totalMinted()).toBe(expectedMinted);
          expect(await token.totalBurned()).toBe(expectedBurned);
          expect(await token.totalSupply()).toBe(expectedMinted - expectedBurned);
          expect(expectedBurned <= expectedMinted).toBe(true);
        },
      ),
      { numRuns: 15 },
    );
  }, 120_000);
});
