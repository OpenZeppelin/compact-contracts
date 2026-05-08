import { constructJubjubPoint, ecMulGenerator } from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  fitInJubjubScalar,
  isIdentity,
  JUBJUB_SCALAR_ORDER,
  JUBJUB_TRUNCATION_BITS,
  modJubjubOrder,
} from '../utils/jubjub.js';
import { JubjubSimulator } from './simulators/JubjubSimulator.js';

/**
 * crypto/Jubjub — primitive helpers shared by every Jubjub-based crypto module.
 *
 * Pins:
 *  - Off-chain `isIdentity` / `fitInJubjubScalar` / `modJubjubOrder` agree
 *    bit-for-bit with the on-chain circuits.
 *  - `pointsEqual` distinguishes equal vs distinct Jubjub points.
 *  - `fitInJubjubScalar` always returns a value < 2^248 < Jubjub scalar order.
 *  - `assertNonIdentity` reverts on `(0, 1)` with the documented error.
 */
describe('crypto/Jubjub — primitives', () => {
  let sim: JubjubSimulator;

  beforeEach(() => {
    sim = new JubjubSimulator();
  });

  describe('isIdentity', () => {
    it('off-chain returns true for (0, 1)', () => {
      expect(isIdentity(constructJubjubPoint(0n, 1n))).toBe(true);
    });

    it('off-chain returns false for the generator', () => {
      const G = ecMulGenerator(1n);
      expect(isIdentity(G)).toBe(false);
    });

    it('on-chain isIdentity matches the off-chain result for the identity', () => {
      const identity = constructJubjubPoint(0n, 1n);
      sim.testIsIdentity(identity);
      expect(sim.getLedger()._lastIsIdentity).toBe(true);
    });

    it('on-chain isIdentity matches the off-chain result for a non-identity', () => {
      const G = ecMulGenerator(1n);
      sim.testIsIdentity(G);
      expect(sim.getLedger()._lastIsIdentity).toBe(false);
    });
  });

  describe('assertNonIdentity', () => {
    it('passes silently for a non-identity point', () => {
      const G = ecMulGenerator(1n);
      expect(() => sim.testAssertNonIdentity(G)).not.toThrow();
    });

    it('reverts on the identity with the documented error', () => {
      const identity = constructJubjubPoint(0n, 1n);
      expect(() => sim.testAssertNonIdentity(identity)).toThrow(
        /Jubjub: identity point not allowed/,
      );
    });
  });

  describe('pointsEqual', () => {
    it('returns true for two derivations of the same point', () => {
      const a = ecMulGenerator(7n);
      const b = ecMulGenerator(7n);
      sim.testPointsEqual(a, b);
      expect(sim.getLedger()._lastPointsEqual).toBe(true);
    });

    it('returns false for distinct points', () => {
      const a = ecMulGenerator(7n);
      const b = ecMulGenerator(8n);
      sim.testPointsEqual(a, b);
      expect(sim.getLedger()._lastPointsEqual).toBe(false);
    });
  });

  describe('fitInJubjubScalar', () => {
    it('is a no-op for inputs already < 2^248', () => {
      const small = 0x42n;
      expect(fitInJubjubScalar(small)).toBe(small);
    });

    it('zeros bits >= 2^248 (off-chain)', () => {
      // Set bit 250 so the value is > 2^248. Off-chain truncation should
      // strip every bit at index >= 248.
      const c = (1n << 250n) | 0xdeadbeefn;
      const expected = c & ((1n << BigInt(JUBJUB_TRUNCATION_BITS)) - 1n);
      expect(fitInJubjubScalar(c)).toBe(expected);
      expect(fitInJubjubScalar(c)).toBeLessThan(1n << 248n);
    });

    it('off-chain matches on-chain bit-for-bit on a large hash-like input', () => {
      // A value > 2^248, < Fq — the realistic case for transientHash output.
      const c = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffff0123456789n;
      const offChain = fitInJubjubScalar(c);
      sim.testFitInJubjubScalar(c);
      expect(sim.getLedger()._lastFitInJubjubScalar).toBe(offChain);
    });

    it('output is always strictly less than the Jubjub scalar order', () => {
      // Worst case: all 248 low bits set.
      const worst = (1n << 248n) - 1n;
      expect(worst).toBeLessThan(JUBJUB_SCALAR_ORDER);
      const fit = fitInJubjubScalar(worst);
      expect(fit).toBe(worst);
      expect(fit).toBeLessThan(JUBJUB_SCALAR_ORDER);
    });
  });

  describe('modJubjubOrder', () => {
    it('is a no-op for inputs already in [0, JUBJUB_SCALAR_ORDER)', () => {
      const x = JUBJUB_SCALAR_ORDER - 1n;
      expect(modJubjubOrder(x)).toBe(x);
    });

    it('reduces inputs >= JUBJUB_SCALAR_ORDER', () => {
      const x = JUBJUB_SCALAR_ORDER + 5n;
      expect(modJubjubOrder(x)).toBe(5n);
    });

    it('handles negative inputs correctly', () => {
      const x = -1n;
      expect(modJubjubOrder(x)).toBe(JUBJUB_SCALAR_ORDER - 1n);
    });
  });
});
