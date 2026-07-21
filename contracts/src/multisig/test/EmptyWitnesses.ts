// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts v0.3.0-alpha.1 (multisig/test/EmptyWitnesses.ts)

/**
 * Shared empty private state and witnesses for the multisig test simulators.
 * None of the multisig contracts declare witnesses, so every simulator imports
 * this in place of a per-contract witness module.
 */
export type EmptyPrivateState = Record<string, never>;
export const EmptyPrivateState: EmptyPrivateState = {};
export const emptyWitnesses = () => ({});
