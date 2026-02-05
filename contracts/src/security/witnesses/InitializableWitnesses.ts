// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts v0.0.1-alpha.1 (security/witnesses/InitializableWitnesses.ts)

/**
 * @description Interface defining the witness methods for Initializable operations.
 * @template P - The private state type.
 */
export interface IInitializableWitnesses<P> { }


export type InitializablePrivateState = {};

/**
 * @description Utility object for managing the private state of a Initializable contract.
 */
export const InitializablePrivateState = {
  /**
   * @description Generates a new private state
   * @returns An empty InitializablePrivateState instance.
   */
  generate: (): InitializablePrivateState => {
    return {};
  },
};

/**
 * @description Factory function creating witness implementations for Initializable operations.
 * @returns An object implementing the Witnesses interface for InitializablePrivateState.
 */
export const InitializableWitnesses =
  (): IInitializableWitnesses<InitializablePrivateState> => ({});
