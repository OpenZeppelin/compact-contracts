// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts v0.0.1-alpha.1 (token/witnesses/MultiTokenWitnesses.ts)

/**
 * @description Interface defining the witness methods for MultiToken operations.
 * @template P - The private state type.
 */
export interface IMultiTokenWitnesses<P> { }


export type MultiTokenPrivateState = {};

/**
 * @description Utility object for managing the private state of a MultiToken contract.
 */
export const MultiTokenPrivateState = {
  /**
   * @description Generates a new private state
   * @returns An empty MultiTokenPrivateState instance.
   */
  generate: (): MultiTokenPrivateState => {
    return {};
  },
};

/**
 * @description Factory function creating witness implementations for MultiToken operations.
 * @returns An object implementing the Witnesses interface for MultiTokenPrivateState.
 */
export const MultiTokenWitnesses =
  (): IMultiTokenWitnesses<MultiTokenPrivateState> => ({});
