// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Unaudited reference material that drives Compact circuits in
// off-chain tests. Not shipped as a consumable artifact. Production
// consumers must author and audit their own witnesses.

import { getRandomValues } from 'node:crypto';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

/**
 * @description Interface defining the witness methods for FungibleToken operations.
 * @template P - The private state type.
 */
export interface IFungibleTokenWitnesses<L, P> {
  /**
   * Retrieves the secret key from the private state.
   * @param context - The witness context containing the private state.
   * @returns A tuple of the private state and the secret key as a Uint8Array.
   */
  wit_FungibleTokenSK(context: WitnessContext<L, P>): [P, Uint8Array];
}

/**
 * @description Represents the private state of a FungibleToken contract, storing a secret key.
 */
export type FungibleTokenPrivateState = {
  /** @description A 32-byte secret key used for creating a public user identifier. */
  secretKey: Uint8Array;
};

/**
 * @description Utility object for managing the private state of an FungibleToken contract.
 */
export const FungibleTokenPrivateState = {
  /**
   * @description Generates a new private state with a random secret key.
   * @returns A fresh FungibleTokenPrivateState instance.
   */
  generate: (): FungibleTokenPrivateState => {
    return { secretKey: getRandomValues(new Uint8Array(32)) };
  },

  /**
   * @description Generates a new private state with a user-defined secret key.
   * Useful for deterministic key generation or advanced use cases.
   *
   * @param sk - The 32-byte secret key to use.
   * @returns A fresh FungibleTokenPrivateState instance with the provided key.
   *
   * @example
   * ```typescript
   * // For deterministic keys (user-defined scheme)
   * const deterministicKey = myDeterministicScheme(...);
   * const privateState = FungibleTokenPrivateState.withSecretKey(deterministicKey);
   * ```
   */
  withSecretKey: (sk: Uint8Array): FungibleTokenPrivateState => {
    if (sk.length !== 32) {
      throw new Error(
        `withSecretKey: expected 32-byte secret key, received ${sk.length} bytes`,
      );
    }
    return { secretKey: Uint8Array.from(sk) };
  },
};

/**
 * @description Factory function creating witness implementations for FungibleToken operations.
 * @returns An object implementing the Witnesses interface for FungibleTokenPrivateState.
 */
export const FungibleTokenWitnesses = <L>(): IFungibleTokenWitnesses<
  L,
  FungibleTokenPrivateState
> => ({
  wit_FungibleTokenSK(
    context: WitnessContext<L, FungibleTokenPrivateState>,
  ): [FungibleTokenPrivateState, Uint8Array] {
    return [
      context.privateState,
      Uint8Array.from(context.privateState.secretKey),
    ];
  },
});
