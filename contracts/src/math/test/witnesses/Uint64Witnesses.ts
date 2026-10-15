// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Unaudited reference material that drives Compact circuits in
// off-chain tests. Not shipped as a consumable artifact. Production
// consumers must author and audit their own witnesses.

import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { sqrtBigint } from './sqrtBigint.js';

/**
 * @description Division result for 64-bit operations.
 */
export type DivResultU64 = {
  quotient: bigint;
  remainder: bigint;
};

/**
 * @description Interface defining the witness methods for the Uint64 module.
 * @template L - The ledger type.
 * @template P - The private state type.
 */
export interface IUint64Witnesses<L, P> {
  /**
   * Computes the quotient and remainder of dividing two 64-bit unsigned
   * integers.
   * @param context - The witness context containing the private state.
   * @param dividend - The dividend.
   * @param divisor - The divisor.
   * @returns A tuple of the private state and the quotient and remainder.
   */
  wit_divUint64(
    context: WitnessContext<L, P>,
    dividend: bigint,
    divisor: bigint,
  ): [P, DivResultU64];

  /**
   * Computes the square root of a 64-bit unsigned integer.
   * @param context - The witness context containing the private state.
   * @param radicand - The value to compute the square root of.
   * @returns A tuple of the private state and the floor of the square root
   * as a 32-bit result.
   */
  wit_sqrtUint64(context: WitnessContext<L, P>, radicand: bigint): [P, bigint];

  /**
   * Unpacks a 64-bit unsigned integer into 8 bytes (little-endian). This is
   * the witness for Uint64.toUnpackedBytes.
   * @param context - The witness context containing the private state.
   * @param value - The 64-bit value to unpack.
   * @returns A tuple of the private state and a vector of 8 bytes
   * [b0, b1, b2, b3, b4, b5, b6, b7] where b0 is the LSB.
   */
  wit_uint64ToUnpackedBytes(
    context: WitnessContext<L, P>,
    value: bigint,
  ): [P, bigint[]];
}

/**
 * @description The Uint64 module keeps no private state.
 */
export type Uint64PrivateState = Record<string, never>;
export const Uint64PrivateState: Uint64PrivateState = {};

/**
 * @description Factory function creating the honest witness implementations
 * for the Uint64 module.
 * @returns An object implementing the Uint64 witnesses.
 */
export const Uint64Witnesses = <L>(): IUint64Witnesses<
  L,
  Uint64PrivateState
> => ({
  wit_divUint64(
    context: WitnessContext<L, Uint64PrivateState>,
    dividend: bigint,
    divisor: bigint,
  ): [Uint64PrivateState, DivResultU64] {
    const quotient = dividend / divisor;
    const remainder = dividend % divisor;
    return [context.privateState, { quotient, remainder }];
  },

  wit_sqrtUint64(
    context: WitnessContext<L, Uint64PrivateState>,
    radicand: bigint,
  ): [Uint64PrivateState, bigint] {
    return [context.privateState, sqrtBigint(radicand)];
  },

  wit_uint64ToUnpackedBytes(
    context: WitnessContext<L, Uint64PrivateState>,
    value: bigint,
  ): [Uint64PrivateState, bigint[]] {
    const mask = 0xffn;
    const b0 = value & mask;
    const b1 = (value >> 8n) & mask;
    const b2 = (value >> 16n) & mask;
    const b3 = (value >> 24n) & mask;
    const b4 = (value >> 32n) & mask;
    const b5 = (value >> 40n) & mask;
    const b6 = (value >> 48n) & mask;
    const b7 = (value >> 56n) & mask;
    return [context.privateState, [b0, b1, b2, b3, b4, b5, b6, b7]];
  },
});
