// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts v0.0.1-alpha.1 (access/witnesses/OwnableWitnesses.ts)

/**
 * @description Interface defining the witness methods for Ownable operations.
 * @template P - The private state type.
 */
export type IOwnableWitnesses<_P> = Record<string, never>;

export type OwnablePrivateState = Record<string, never>;

/**
 * @description Utility object for managing the private state of a Ownable contract.
 */
export const OwnablePrivateState = {
  /**
   * @description Generates a new private state
   * @returns An empty OwnablePrivateState instance.
   */
  generate: (): OwnablePrivateState => {
    return {};
  },
};

/**
 * @description Factory function creating witness implementations for Ownable operations.
 * @returns An object implementing the Witnesses interface for OwnablePrivateState.
 */
export const OwnableWitnesses =
  (): IOwnableWitnesses<OwnablePrivateState> => ({});
