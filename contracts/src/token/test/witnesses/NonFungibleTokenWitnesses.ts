// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Unaudited reference material that drives Compact circuits in
// off-chain tests. Not shipped as a consumable artifact. Production
// consumers must author and audit their own witnesses.

import { getRandomValues } from 'node:crypto';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

/**
 * @description Interface defining the witness methods for NonFungibleToken operations.
 * @template P - The private state type.
 */
export interface INonFungibleTokenWitnesses<L, P> {
  /**
   * Retrieves the secret key from the private state.
   * @param context - The witness context containing the private state.
   * @returns A tuple of the private state and the secret key as a Uint8Array.
   */
  wit_NonFungibleTokenSK(context: WitnessContext<L, P>): [P, Uint8Array];
}

/**
 * @description Represents the private state of an NonFungibleToken contract, storing a secret key.
 */
export type NonFungibleTokenPrivateState = {
  /** @description A 32-byte secret key used for creating a public user identifier. */
  secretKey: Uint8Array;
};

/**
 * @description Utility object for managing the private state of an NonFungibleToken contract.
 */
export const NonFungibleTokenPrivateState = {
  /**
   * @description Generates a new private state with a random secret key.
   * @returns A fresh NonFungibleTokenPrivateState instance.
   */
  generate: (): NonFungibleTokenPrivateState => {
    return { secretKey: getRandomValues(new Uint8Array(32)) };
  },

  /**
   * @description Generates a new private state with a user-defined secret key.
   * Useful for deterministic key generation or advanced use cases.
   *
   * @param sk - The 32-byte secret key to use.
   * @returns A fresh NonFungibleTokenPrivateState instance with the provided key.
   *
   * @example
   * ```typescript
   * // For deterministic keys (user-defined scheme)
   * const deterministicKey = myDeterministicScheme(...);
   * const privateState = NonFungibleTokenPrivateState.withSecretKey(deterministicKey);
   * ```
   */
  withSecretKey: (sk: Uint8Array): NonFungibleTokenPrivateState => {
    if (sk.length !== 32) {
      throw new Error(
        `withSecretKey: expected 32-byte secret key, received ${sk.length} bytes`,
      );
    }
    return { secretKey: Uint8Array.from(sk) };
  },
};

/**
 * @description Factory function creating witness implementations for NonFungibleToken operations.
 * @returns An object implementing the Witnesses interface for NonFungibleTokenPrivateState.
 */
export const NonFungibleTokenWitnesses = <L>(): INonFungibleTokenWitnesses<
  L,
  NonFungibleTokenPrivateState
> => ({
  wit_NonFungibleTokenSK(
    context: WitnessContext<L, NonFungibleTokenPrivateState>,
  ): [NonFungibleTokenPrivateState, Uint8Array] {
    return [
      context.privateState,
      Uint8Array.from(context.privateState.secretKey),
    ];
  },
});
