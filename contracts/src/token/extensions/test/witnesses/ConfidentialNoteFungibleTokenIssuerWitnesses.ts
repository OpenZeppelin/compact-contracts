// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Drives the ConfidentialNoteFungibleTokenIssuer extension in off-chain tests.

import { getRandomValues } from 'node:crypto';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

/**
 * The issuer witness's private input, held in a plain object the spec mutates
 * between calls. Closing over it instead of private state keeps one spec
 * runnable on both backends: `setPrivateState` throws on the live one.
 */
export type IssuerWallet = {
  /** Issuer secret; `issuerPk = derivePk(secretKey, _instanceSalt)`. */
  secretKey: Uint8Array;
};

export const createIssuerWallet = (): IssuerWallet => ({
  secretKey: new Uint8Array(getRandomValues(Buffer.alloc(32))),
});

/** The extension declares no private state; the wallet carries the secret. */
export type ConfidentialNoteFungibleTokenIssuerPrivateState = Record<
  string,
  never
>;
export const ConfidentialNoteFungibleTokenIssuerPrivateState = {
  generate: (): ConfidentialNoteFungibleTokenIssuerPrivateState => ({}),
};

export interface IConfidentialNoteFungibleTokenIssuerWitnesses<L, P> {
  wit_ConfidentialNoteIssuerSK(context: WitnessContext<L, P>): [P, Uint8Array];
}

/**
 * `L` and `P` are the composing contract's ledger and private state, so the
 * same factory serves the standalone mock and a core + issuer composition
 * (spread it next to the core's witnesses).
 */
export const ConfidentialNoteFungibleTokenIssuerWitnesses = <
  L,
  P = ConfidentialNoteFungibleTokenIssuerPrivateState,
>(
  wallet: IssuerWallet,
): IConfidentialNoteFungibleTokenIssuerWitnesses<L, P> => ({
  wit_ConfidentialNoteIssuerSK(context) {
    return [context.privateState, wallet.secretKey];
  },
});
