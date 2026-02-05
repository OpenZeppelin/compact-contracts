// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts v0.0.1-alpha.1 (token/witnesses/NonFungibleToken.ts)

/**
 * @description Interface defining the witness methods for NonFungibleToken operations.
 * @template P - The private state type.
 */
export interface INonFungibleTokenWitnesses<P> { }


export type NonFungibleTokenPrivateState = {};

/**
 * @description Utility object for managing the private state of a NonFungibleToken contract.
 */
export const NonFungibleTokenPrivateState = {
  /**
   * @description Generates a new private state
   * @returns An empty NonFungibleTokenPrivateState instance.
   */
  generate: (): NonFungibleTokenPrivateState => {
    return {};
  },
};

/**
 * @description Factory function creating witness implementations for NonFungibleToken operations.
 * @returns An object implementing the Witnesses interface for NonFungibleTokenPrivateState.
 */
export const NonFungibleTokenWitnesses =
  (): INonFungibleTokenWitnesses<NonFungibleTokenPrivateState> => ({});
