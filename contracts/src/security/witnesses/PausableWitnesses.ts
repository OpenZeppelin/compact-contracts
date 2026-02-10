// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts v0.0.1-alpha.1 (security/witnesses/PausableWitnesses.ts)

/**
 * @description Interface defining the witness methods for Pausable operations.
 * @template P - The private state type.
 */
export type IPausableWitnesses<_P> = Record<string, never>;

export type PausablePrivateState = Record<string, never>;

/**
 * @description Utility object for managing the private state of a Pausable contract.
 */
export const PausablePrivateState = {
  /**
   * @description Generates a new private state
   * @returns An empty PausablePrivateState instance.
   */
  generate: (): PausablePrivateState => {
    return {};
  },
};

/**
 * @description Factory function creating witness implementations for Pausable operations.
 * @returns An object implementing the Witnesses interface for PausablePrivateState.
 */
export const PausableWitnesses =
  (): IPausableWitnesses<PausablePrivateState> => ({});
