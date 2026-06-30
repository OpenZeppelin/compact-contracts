import {
  constructJubjubPoint,
  type JubjubPoint,
} from '@midnight-ntwrk/compact-runtime';
import { describe, expect, it } from 'vitest';
import { pureCircuits } from '../../../artifacts/MockCurveOps/contract/index.js';

// ---------------------------------------------------------------------------
// RUNTIME-INVARIANTS REGRESSION TEST.
//
// The ElGamal module relies on every JubjubPoint reaching a curve operation
// being in the prime-order subgroup. The Midnight runtime guarantees this at
// the ZK-constraint level: the embedded-curve gadget (midnight-circuits
// `ecc::native::edwards_chip`) assigns points via cofactor clearing. It
// constrains the witnessed coordinates to a cofactor-cleared point, whose image
// is exactly the prime-order subgroup, with `q_mem`'s membership gate
// (-x^2 + y^2 = 1 + d*x^2*y^2) enforcing on-curve. So a point outside the
// subgroup (off-curve, low-order, or mixed-order) makes the circuit
// unsatisfiable, surfacing here as a runtime trap.
//
// This test pins that property. If a future runtime stops enforcing it, the
// trap-expectations below fail loudly as a signal that the module's check-free
// reliance on subgroup membership must be revisited.
// ---------------------------------------------------------------------------

// Jubjub base field modulus q = BLS12-381 scalar field order.
const Q =
  52435875175126190479447740508185965837690552500527637822603658699938581184513n;

// (0, q-1) = (0, -1): on-curve, order 2 -> NOT in the prime-order subgroup.
const ORDER_2 = constructJubjubPoint(0n, Q - 1n);
// (1, 1): off-curve (fails the twisted Edwards equation).
const OFF_CURVE = constructJubjubPoint(1n, 1n);
// arbitrary coords < q, unknown structure.
const GARBAGE = constructJubjubPoint(12345n, 67890n);

// Classify a runtime call as a returned value or a trap.
const classify = <T>(
  fn: () => T,
): { ok: true; value: T } | { ok: false; err: string } => {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, err: (e as Error).message };
  }
};

const threw = (p: JubjubPoint, fn: (p: JubjubPoint) => unknown): boolean =>
  !classify(() => fn(p)).ok;

describe('JubjubPoint subgroup enforcement (runtime invariant)', () => {
  const inSubgroup = pureCircuits.genMul(5n); // generator-derived -> in subgroup

  // MIXED-ORDER point of order 2*ℓ: an in-subgroup point plus the order-2 point.
  // In twisted Edwards, (x,y) + (0,-1) = (-x,-y), so this is just coordinate
  // negation of a real point. It is on-curve, NOT in the prime-order subgroup,
  // and (crucially) NOT a low-order point, so it should not hit any
  // addition-formula exception. This is the realistic attack vector.
  const MIXED = constructJubjubPoint(Q - inSubgroup.x, Q - inSubgroup.y);

  it('FACT: a JubjubPoint is fabricable from arbitrary coordinates', () => {
    expect(ORDER_2).toEqual({ x: 0n, y: Q - 1n });
  });

  // -------------------------------------------------------------------------
  // MIXED-ORDER point: the case that distinguishes "real subgroup enforcement"
  // from "incidental low-order formula exception".
  // -------------------------------------------------------------------------
  describe('mixed-order point (order 2*ℓ) — the decisive case', () => {
    it('TRAPS ecMul on a mixed-order point (genuine subgroup enforcement)', () => {
      expect(classify(() => pureCircuits.doEcMul(MIXED, 3n)).ok).toBe(false);
    });

    it('TRAPS ecAdd on a mixed-order point', () => {
      expect(classify(() => pureCircuits.doEcAdd(MIXED, inSubgroup)).ok).toBe(
        false,
      );
    });
  });

  // -------------------------------------------------------------------------
  // ecMul: does it reject non-subgroup / off-curve points?
  // -------------------------------------------------------------------------
  describe('ecMul input validation', () => {
    it('accepts an in-subgroup point', () => {
      expect(threw(inSubgroup, (p) => pureCircuits.doEcMul(p, 3n))).toBe(false);
    });

    it('TRAPS on an on-curve order-2 point (off-subgroup)', () => {
      expect(threw(ORDER_2, (p) => pureCircuits.doEcMul(p, 3n))).toBe(true);
    });

    it('TRAPS on an off-curve point', () => {
      expect(threw(OFF_CURVE, (p) => pureCircuits.doEcMul(p, 3n))).toBe(true);
    });

    it('TRAPS on a garbage point', () => {
      expect(threw(GARBAGE, (p) => pureCircuits.doEcMul(p, 3n))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // ecAdd: THE linchpin for encryptPoint (m flows through ecAdd, not ecMul).
  // -------------------------------------------------------------------------
  describe('ecAdd input validation', () => {
    it('accepts two in-subgroup points', () => {
      expect(
        classify(() => pureCircuits.doEcAdd(inSubgroup, inSubgroup)).ok,
      ).toBe(true);
    });

    it('TRAPS when an order-2 point is added', () => {
      expect(classify(() => pureCircuits.doEcAdd(ORDER_2, inSubgroup)).ok).toBe(
        false,
      );
    });

    it('TRAPS when an off-curve point is added', () => {
      expect(
        classify(() => pureCircuits.doEcAdd(OFF_CURVE, inSubgroup)).ok,
      ).toBe(false);
    });

    it('TRAPS when a garbage point is added', () => {
      expect(classify(() => pureCircuits.doEcAdd(GARBAGE, inSubgroup)).ok).toBe(
        false,
      );
    });
  });
});
