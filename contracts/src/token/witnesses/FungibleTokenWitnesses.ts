// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts v0.0.1-alpha.1 (token/witnesses/FungibleTokenWitnesses.ts)

import { getRandomValues } from 'node:crypto';

/**
 * @description Represents the private state of a FungibleToken contract, storing a Zswap coin secret key.
 */
export type FungibleTokenPrivateState = {
  /** @description A 32-byte secret key used for deriving a Zswap coin public key. */
  zswapCoinSecretKey: Uint8Array;
};

/**
 * @description Utility object for managing the private state of an FungibleToken contract.
 */
export const FungibleTokenPrivateState = {
  /**
   * @description Generates a new private state with a random Zswap coin secret key.
   * @returns A fresh FungibleTokenPrivateState instance.
   */
  generate: (): FungibleTokenPrivateState => {
    return { zswapCoinSecretKey: getRandomValues(new Uint8Array(32)) };
  },

  /**
   * @description Generates a new private state with a user-defined Zswap coin secret key.
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
    return { zswapCoinSecretKey: Uint8Array.from(sk) };
  },
};

/**
 * @description Factory function creating the witness object for FungibleToken simulation.
 * Caller authorization is provided through explicit circuit inputs, so no token-specific
 * witness methods are required.
 * @returns An empty witness object for FungibleTokenPrivateState.
 */
export const FungibleTokenWitnesses = () => ({});
