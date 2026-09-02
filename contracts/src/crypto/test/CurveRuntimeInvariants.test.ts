import {
  constructJubjubPoint,
  ecMulGenerator,
} from '@midnight-ntwrk/compact-runtime';
import { beforeAll, describe, expect, it } from 'vitest';
import { CurveOpsSimulator } from './simulators/CurveOpsSimulator.js';

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

// Jubjub prime-order subgroup order ell. Valid ecMul scalars are [0, ell-1]; the
// runtime faults on scalars >= ell. crypto/ElGamal (negation by ell-1) and
// EcdhMask's ephemeral-point guard both lean on this range fault.
const L =
  6554484396890773809930967563523245729705921265872317281365359162392183254199n;

// (0, q-1) = (0, -1): on-curve, order 2 -> NOT in the prime-order subgroup.
const ORDER_2 = constructJubjubPoint(0n, Q - 1n);
// (1, 1): off-curve (fails the twisted Edwards equation).
const OFF_CURVE = constructJubjubPoint(1n, 1n);
// arbitrary coords < q, unknown structure.
const GARBAGE = constructJubjubPoint(12345n, 67890n);

const IN_SUBGROUP = ecMulGenerator(5n);

// MIXED-ORDER point of order 2*ℓ: an in-subgroup point plus the order-2 point.
// In twisted Edwards, (x,y) + (0,-1) = (-x,-y), so this is just coordinate
// negation of a real point. It is on-curve, NOT in the prime-order subgroup,
// and (crucially) NOT a low-order point, so it should not hit any
// addition-formula exception. This is the realistic attack vector.
const MIXED = constructJubjubPoint(Q - IN_SUBGROUP.x, Q - IN_SUBGROUP.y);

let contract: CurveOpsSimulator;

// A trap fires while the circuit is evaluated locally, before any proof, so
// the rejections below hold on the live backend too.
const traps = (call: Promise<unknown>): Promise<void> =>
  expect(call).rejects.toThrow();

describe('JubjubPoint subgroup enforcement (runtime invariant)', () => {
  beforeAll(async () => {
    contract = await CurveOpsSimulator.create();
  });

  it('FACT: a JubjubPoint is fabricable from arbitrary coordinates', () => {
    expect(ORDER_2).toEqual({ x: 0n, y: Q - 1n });
  });

  // -------------------------------------------------------------------------
  // MIXED-ORDER point: the case that distinguishes "real subgroup enforcement"
  // from "incidental low-order formula exception".
  // -------------------------------------------------------------------------
  describe('mixed-order point (order 2*ℓ) — the decisive case', () => {
    it('TRAPS ecMul on a mixed-order point (genuine subgroup enforcement)', async () => {
      await traps(contract.doEcMul(MIXED, 3n));
    });

    it('TRAPS ecAdd on a mixed-order point', async () => {
      await traps(contract.doEcAdd(MIXED, IN_SUBGROUP));
    });
  });

  // -------------------------------------------------------------------------
  // ecMul: does it reject non-subgroup / off-curve points?
  // -------------------------------------------------------------------------
  describe('ecMul input validation', () => {
    it('accepts an in-subgroup point', async () => {
      await expect(contract.doEcMul(IN_SUBGROUP, 3n)).resolves.toEqual(
        ecMulGenerator(15n),
      );
    });

    it('TRAPS on an on-curve order-2 point (off-subgroup)', async () => {
      await traps(contract.doEcMul(ORDER_2, 3n));
    });

    it('TRAPS on an off-curve point', async () => {
      await traps(contract.doEcMul(OFF_CURVE, 3n));
    });

    it('TRAPS on a garbage point', async () => {
      await traps(contract.doEcMul(GARBAGE, 3n));
    });
  });

  // -------------------------------------------------------------------------
  // ecAdd: THE linchpin for encryptPoint (m flows through ecAdd, not ecMul).
  // -------------------------------------------------------------------------
  describe('ecAdd input validation', () => {
    it('accepts two in-subgroup points', async () => {
      await expect(contract.doEcAdd(IN_SUBGROUP, IN_SUBGROUP)).resolves.toEqual(
        ecMulGenerator(10n),
      );
    });

    it('TRAPS when an order-2 point is added', async () => {
      await traps(contract.doEcAdd(ORDER_2, IN_SUBGROUP));
    });

    it('TRAPS when an off-curve point is added', async () => {
      await traps(contract.doEcAdd(OFF_CURVE, IN_SUBGROUP));
    });

    it('TRAPS when a garbage point is added', async () => {
      await traps(contract.doEcAdd(GARBAGE, IN_SUBGROUP));
    });
  });

  // -------------------------------------------------------------------------
  // Scalar-range fault: ecMulGenerator (and ecMul) must fault on scalars >= ell.
  // EcdhMask's "only two weak inputs" reasoning and ElGamal's negation-by-(ell-1)
  // both depend on it. Pinning it means a runtime that silently reduced mod ell
  // (letting e = ell pass as e = 0, yielding a publicly recomputable mask) fails
  // loudly here. Note EcdhMask's encrypt no longer relies on this: it guards the
  // ephemeral POINT (g^e != identity), which catches e = ell regardless.
  // -------------------------------------------------------------------------
  describe('scalar-range fault (ecMulGenerator)', () => {
    it('accepts the maximum valid scalar (ell - 1)', async () => {
      await expect(contract.genMul(L - 1n)).resolves.toEqual(
        ecMulGenerator(L - 1n),
      );
    });

    it('TRAPS on scalar == ell (out of range)', async () => {
      await traps(contract.genMul(L));
    });
  });
});
