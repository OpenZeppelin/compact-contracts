// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Unaudited reference material that drives Compact circuits in
// off-chain tests. Not shipped as a consumable artifact. Production
// consumers must author and audit their own witnesses.

import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { sqrtBigint } from './sqrtBigint.js';

/**
 * @description Represents a 128-bit unsigned integer as two 64-bit components.
 */
export type U128 = {
  low: bigint;
  high: bigint;
};

/**
 * @description Division result for 128-bit operations (U128 struct).
 */
export type DivResultU128 = {
  quotient: U128;
  remainder: U128;
};

// Constants
export const UINT64_MASK = 0xffff_ffff_ffff_ffffn;

// Conversion helpers
export const toU128 = (value: bigint): U128 => ({
  low: value & UINT64_MASK,
  high: value >> 64n,
});

export const toBigint = (value: U128): bigint =>
  (BigInt(value.high) << 64n) + BigInt(value.low);

/**
 * @description Interface defining the witness methods for the Uint128 module.
 * @template L - The ledger type.
 * @template P - The private state type.
 */
export interface IUint128Witnesses<L, P> {
  /**
   * Computes the quotient and remainder of dividing two U128 values.
   * @param context - The witness context containing the private state.
   * @param a - The dividend as U128.
   * @param b - The divisor as U128.
   * @returns A tuple of the private state and the quotient and remainder as
   * U128 structs.
   */
  wit_divU128(
    context: WitnessContext<L, P>,
    a: U128,
    b: U128,
  ): [P, DivResultU128];

  /**
   * Computes the quotient and remainder of dividing two Uint<128> values
   * (bigint). Uint128.toU128 calls it with the divisor 2^64 to split a value
   * into its 64-bit limbs.
   * @param context - The witness context containing the private state.
   * @param a - The dividend as bigint.
   * @param b - The divisor as bigint.
   * @returns A tuple of the private state and the quotient and remainder as
   * U128 structs.
   */
  wit_divUint128(
    context: WitnessContext<L, P>,
    a: bigint,
    b: bigint,
  ): [P, DivResultU128];

  /**
   * Computes the square root of a 128-bit unsigned integer (U128 struct).
   * @param context - The witness context containing the private state.
   * @param radicand - The U128 value to compute the square root of.
   * @returns A tuple of the private state and the floor of the square root
   * as a 64-bit result.
   */
  wit_sqrtU128(context: WitnessContext<L, P>, radicand: U128): [P, bigint];
}

/**
 * @description The Uint128 module keeps no private state.
 */
export type Uint128PrivateState = Record<string, never>;
export const Uint128PrivateState: Uint128PrivateState = {};

/**
 * @description Factory function creating the honest witness implementations
 * for the Uint128 module.
 * @returns An object implementing the Uint128 witnesses.
 */
export const Uint128Witnesses = <L>(): IUint128Witnesses<
  L,
  Uint128PrivateState
> => ({
  wit_divU128(
    context: WitnessContext<L, Uint128PrivateState>,
    a: U128,
    b: U128,
  ): [Uint128PrivateState, DivResultU128] {
    const aValue = toBigint(a);
    const bValue = toBigint(b);
    const quotient = aValue / bValue;
    const remainder = aValue - quotient * bValue;
    return [
      context.privateState,
      { quotient: toU128(quotient), remainder: toU128(remainder) },
    ];
  },

  wit_divUint128(
    context: WitnessContext<L, Uint128PrivateState>,
    a: bigint,
    b: bigint,
  ): [Uint128PrivateState, DivResultU128] {
    const quotient = a / b;
    const remainder = a - quotient * b;
    return [
      context.privateState,
      { quotient: toU128(quotient), remainder: toU128(remainder) },
    ];
  },

  wit_sqrtU128(
    context: WitnessContext<L, Uint128PrivateState>,
    radicand: U128,
  ): [Uint128PrivateState, bigint] {
    return [context.privateState, sqrtBigint(toBigint(radicand))];
  },
});
