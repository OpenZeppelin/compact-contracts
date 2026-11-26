// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Drives the ConfidentialNoteFungibleTokenAudit extension in off-chain tests.

import { getRandomValues } from 'node:crypto';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

/**
 * The audit witness's private input. The extension has one witness and no
 * private state, so this holds only the knob a spec may turn.
 */
export type AuditWallet = {
  /**
   * Fixed audit-randomness seed. Leave undefined for a fresh secret seed per
   * witness call; set one only to test what a reused seed does.
   */
  auditSeed?: Uint8Array;
};

export const createAuditWallet = (): AuditWallet => ({});

/** The extension declares no private state. */
export type ConfidentialNoteFungibleTokenAuditPrivateState = Record<
  string,
  never
>;
export const ConfidentialNoteFungibleTokenAuditPrivateState = {
  generate: (): ConfidentialNoteFungibleTokenAuditPrivateState => ({}),
};

export interface IConfidentialNoteFungibleTokenAuditWitnesses<L, P> {
  wit_RandPrfExpandSeed(context: WitnessContext<L, P>): [P, Uint8Array];
}

/**
 * `L` and `P` are the composing contract's ledger and private state, so the
 * same factory serves the standalone mock and a composition.
 */
export const ConfidentialNoteFungibleTokenAuditWitnesses = <
  L,
  P = ConfidentialNoteFungibleTokenAuditPrivateState,
>(
  wallet: AuditWallet,
): IConfidentialNoteFungibleTokenAuditWitnesses<L, P> => ({
  wit_RandPrfExpandSeed(context) {
    return [
      context.privateState,
      wallet.auditSeed ?? new Uint8Array(getRandomValues(Buffer.alloc(32))),
    ];
  },
});
