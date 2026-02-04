// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts v0.0.1-alpha.1 (utils/witnesses/UtilsWitnesses.ts)

/**
 * @description Interface defining the witness methods for Utils operations.
 * @template P - The private state type.
 */
export interface IUtilsWitnesses<P> { }


export type UtilsPrivateState = {};

/**
 * @description Utility object for managing the private state of a Utils contract.
 */
export const UtilsPrivateState = {
  /**
   * @description Generates a new private state
   * @returns An empty UtilsPrivateState instance.
   */
  generate: (): UtilsPrivateState => {
    return {};
  },
};

/**
 * @description Factory function creating witness implementations for Utils operations.
 * @returns An object implementing the Witnesses interface for UtilsPrivateState.
 */
export const UtilsWitnesses =
  (): IUtilsWitnesses<UtilsPrivateState> => ({});

