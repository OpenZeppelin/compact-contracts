// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Drives the RandPrfExpand circuit in off-chain tests.

import { getRandomValues } from 'node:crypto';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

/**
 * @description Interface defining the witness methods for RandPrfExpand.
 * @template L - The ledger type.
 * @template P - The private state type.
 */
export interface IRandPrfExpandWitnesses<L, P> {
  /**
   * Retrieves the seed from the private state.
   * @param context - The witness context containing the private state.
   * @returns A tuple of the private state and the seed as a Uint8Array.
   */
  wit_RandPrfExpandSeed(context: WitnessContext<L, P>): [P, Uint8Array];
}

/**
 * @description The private state of a RandPrfExpand caller. The seed is held
 * so a spec can predict the derived values. A wallet returns a fresh seed
 * from a CSPRNG for each circuit call.
 */
export type RandPrfExpandPrivateState = {
  /** @description The 32-byte seed `derive` expands. */
  seed: Uint8Array;
};

/**
 * @description Utility object for managing the private state of a
 * RandPrfExpand caller.
 */
export const RandPrfExpandPrivateState = {
  /**
   * @description Generates a new private state with a random seed.
   * @returns A fresh RandPrfExpandPrivateState instance.
   */
  generate: (): RandPrfExpandPrivateState => {
    return { seed: getRandomValues(new Uint8Array(32)) };
  },

  /**
   * @description Generates a new private state with a user-defined seed. Any
   * 32-byte value is accepted, the zero seed included.
   *
   * @param seed - The 32-byte seed to use.
   * @returns A fresh RandPrfExpandPrivateState instance with the provided seed.
   */
  withSeed: (seed: Uint8Array): RandPrfExpandPrivateState => {
    if (seed.length !== 32) {
      throw new Error(
        `withSeed: expected 32-byte seed, received ${seed.length} bytes`,
      );
    }
    return { seed: Uint8Array.from(seed) };
  },
};

/**
 * @description Factory function creating witness implementations for
 * RandPrfExpand.
 * @template L - The ledger type, supplied by the simulator.
 * @returns An object implementing the Witnesses interface for RandPrfExpandPrivateState.
 */
export const RandPrfExpandWitnesses = <L>(): IRandPrfExpandWitnesses<
  L,
  RandPrfExpandPrivateState
> => ({
  wit_RandPrfExpandSeed(
    context: WitnessContext<L, RandPrfExpandPrivateState>,
  ): [RandPrfExpandPrivateState, Uint8Array] {
    return [context.privateState, Uint8Array.from(context.privateState.seed)];
  },
});
