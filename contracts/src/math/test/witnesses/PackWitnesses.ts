// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Unaudited reference material that drives Compact circuits in
// off-chain tests. Not shipped as a consumable artifact. Production
// consumers must author and audit their own witnesses.

import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

/**
 * @description Interface defining the witness methods for the Pack module.
 * One witness name serves every `Pack<N>` instance, so the implementation
 * accepts a byte array of any length.
 * @template L - The ledger type.
 * @template P - The private state type.
 */
export interface IPackWitnesses<L, P> {
  /**
   * Unpacks a byte array into a vector of bytes (little-endian).
   * @param context - The witness context containing the private state.
   * @param bytes - The byte array to unpack.
   * @returns A tuple of the private state and a vector of bytes where
   * element 0 is the LSB.
   */
  wit_unpackBytes(
    context: WitnessContext<L, P>,
    bytes: Uint8Array,
  ): [P, bigint[]];
}

/**
 * @description The Pack module keeps no private state.
 */
export type PackPrivateState = Record<string, never>;
export const PackPrivateState: PackPrivateState = {};

/**
 * @description Factory function creating the honest witness implementations
 * for the Pack module.
 * @returns An object implementing the Pack witnesses.
 */
export const PackWitnesses = <L>(): IPackWitnesses<L, PackPrivateState> => ({
  wit_unpackBytes(
    context: WitnessContext<L, PackPrivateState>,
    bytes: Uint8Array,
  ): [PackPrivateState, bigint[]] {
    return [context.privateState, Array.from(bytes, (b) => BigInt(b))];
  },
});
