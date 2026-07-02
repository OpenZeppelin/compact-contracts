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
  it('should keep totalMinted exact, totalSupply = minted - burned, burned <= minted (INV-2, INV-5)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            mint: fc.bigInt({ min: 1n, max: 1_000_000n }),
            burnPct: fc.integer({ min: 0, max: 100 }),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        (ops) => {
          const token = new NativeShieldedTokenSimulator(
            b32('domain'),
            b32('seed'),
            'N',
            'S',
            6n,
            true,
          );
          const color = token.tokenColor();
          let expectedMinted = 0n;
          let expectedBurned = 0n;

          ops.forEach((op, i) => {
            token._mint(RECIPIENT, op.mint, b32(`m${i}`));
            expectedMinted += op.mint;
            const burn = (op.mint * BigInt(op.burnPct)) / 100n;
            if (burn > 0n) {
              token._burn({ nonce: b32(`c${i}`), color, value: op.mint }, burn, REFUND_TO);
              expectedBurned += burn;
            }
          });

          expect(token.totalMinted()).toBe(expectedMinted);
          expect(token.totalBurned()).toBe(expectedBurned);
          expect(token.totalSupply()).toBe(expectedMinted - expectedBurned);
          expect(expectedBurned <= expectedMinted).toBe(true);
        },
      ),
      { numRuns: 15 },
    );
  }, 120_000);
});
