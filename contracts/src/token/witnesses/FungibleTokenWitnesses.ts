// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts v0.0.1-alpha.1 (token/witnesses/FungibleTokenWitnesses.ts)

/**
 * @description Interface defining the witness methods for FungibleToken operations.
 * @template P - The private state type.
 */
export interface IFungibleTokenWitnesses<P> { }


export type FungibleTokenPrivateState = {};

/**
 * @description Utility object for managing the private state of a FungibleToken contract.
 */
export const FungibleTokenPrivateState = {
  /**
   * @description Generates a new private state
   * @returns An empty FungibleTokenPrivateState instance.
   */
  generate: (): FungibleTokenPrivateState => {
    return {};
  },
};

/**
 * @description Factory function creating witness implementations for FungibleToken operations.
 * @returns An object implementing the Witnesses interface for FungibleTokenPrivateState.
 */
export const FungibleTokenWitnesses =
  (): IFungibleTokenWitnesses<FungibleTokenPrivateState> => ({});
