// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Drives the RandBlinding module in off-chain tests.

import { getRandomValues } from 'node:crypto';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

/**
 * @description Interface defining the witness methods for RandBlinding operations.
 * @template L - The ledger type.
 * @template P - The private state type.
 */
export interface IRandBlindingWitnesses<L, P> {
  /**
   * Retrieves the blinding factor from the private state.
   * @param context - The witness context containing the private state.
   * @returns A tuple of the private state and the blinding factor as a Uint8Array.
   */
  wit_RandBlindingFactor(context: WitnessContext<L, P>): [P, Uint8Array];
}

/**
 * @description Represents the private state of a RandBlinding caller, storing a blinding factor.
 */
export type RandBlindingPrivateState = {
  /** @description A 32-byte blinding factor. */
  blinding: Uint8Array;
};

/**
 * @description Utility object for managing the private state of a RandBlinding caller.
 */
export const RandBlindingPrivateState = {
  /**
   * @description Generates a new private state with a random blinding factor.
   * @returns A fresh RandBlindingPrivateState instance.
   */
  generate: (): RandBlindingPrivateState => {
    return { blinding: getRandomValues(new Uint8Array(32)) };
  },

  /**
   * @description Generates a new private state with a user-defined blinding
   * factor. Accepts zero: the circuit is what rejects it.
   *
   * @param blinding - The 32-byte blinding factor to use.
   * @returns A fresh RandBlindingPrivateState instance with a copy of the value.
   */
  withBlinding: (blinding: Uint8Array): RandBlindingPrivateState => {
    if (blinding.length !== 32) {
      throw new Error(
        `withBlinding: expected 32-byte blinding factor, received ${blinding.length} bytes`,
      );
    }
    return { blinding: Uint8Array.from(blinding) };
  },
};

/**
 * @description Factory function creating witness implementations for RandBlinding operations.
 * @returns An object implementing the Witnesses interface for RandBlindingPrivateState.
 */
export const RandBlindingWitnesses = <L>(): IRandBlindingWitnesses<
  L,
  RandBlindingPrivateState
> => ({
  wit_RandBlindingFactor(
    context: WitnessContext<L, RandBlindingPrivateState>,
  ): [RandBlindingPrivateState, Uint8Array] {
    return [
      context.privateState,
      Uint8Array.from(context.privateState.blinding),
    ];
  },
});
