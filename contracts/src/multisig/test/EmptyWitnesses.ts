// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts v0.2.0 (multisig/test/EmptyWitnesses.ts)

/**
 * Shared empty private state and witnesses for forwarder contracts, none
 * of which declare any witnesses. Imported by their simulators in place
 * of a per-contract witness module.
 */
export type EmptyPrivateState = Record<string, never>;
export const EmptyPrivateState: EmptyPrivateState = {};
export const emptyWitnesses = () => ({});
