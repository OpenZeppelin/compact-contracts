// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts v0.0.1-alpha.1 (access/witnesses/AccessControlWitnesses.ts)

/**
 * @description Interface defining the witness methods for AccessControl operations.
 * @template P - The private state type.
 */
export type IAccessControlWitnesses<_P> = Record<string, never>;

export type AccessControlPrivateState = Record<string, never>;

/**
 * @description Utility object for managing the private state of a AccessControl contract.
 */
export const AccessControlPrivateState = {
  /**
   * @description Generates a new private state
   * @returns An empty AccessControlPrivateState instance.
   */
  generate: (): AccessControlPrivateState => {
    return {};
  },
};

/**
 * @description Factory function creating witness implementations for AccessControl operations.
 * @returns An object implementing the Witnesses interface for AccessControlPrivateState.
 */
export const AccessControlWitnesses =
  (): IAccessControlWitnesses<AccessControlPrivateState> => ({});
