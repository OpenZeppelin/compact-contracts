// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Drives the CustodialConfidentialNoteFungibleToken preset in off-chain tests.

import { getRandomValues } from 'node:crypto';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

/** Compact's `pad(32, label)`. */
const pad32 = (label: string): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(label));
  return bytes;
};

/** The `_issuerSalt` every test deployment is initialized with. */
export const ISSUER_SALT: Uint8Array = pad32('ISSUER-SALT');

/** The `_noteSalt` every test deployment is initialized with. */
export const NOTE_SALT: Uint8Array = pad32('NOTE-SALT');

/**
 * The private inputs the witnesses answer with, held in a plain object the
 * spec mutates between calls. Closing over it instead of private state keeps
 * one spec runnable on both backends: `setPrivateState` throws on the live one.
 */
export type CustodialWallet = {
  /**
   * The caller's secret. The issuer's id is its account under `_issuerSalt`,
   * a holder's note key its account under `_noteSalt`.
   */
  secretKey: Uint8Array;
  /**
   * Fixed nonce seed. Leave undefined for a fresh secret seed per witness
   * call; set one only to make a derived nonce reproducible.
   */
  nonceSeed?: Uint8Array;
};

export const createCustodialWallet = (): CustodialWallet => ({
  secretKey: new Uint8Array(getRandomValues(Buffer.alloc(32))),
});

/** The preset declares no private state; the wallet carries the secrets. */
export type CustodialConfidentialNoteFungibleTokenPrivateState = Record<
  string,
  never
>;
export const CustodialConfidentialNoteFungibleTokenPrivateState = {
  generate: (): CustodialConfidentialNoteFungibleTokenPrivateState => ({}),
};

export interface ICustodialConfidentialNoteFungibleTokenWitnesses<L, P> {
  wit_AuthPrfAddrSK(context: WitnessContext<L, P>): [P, Uint8Array];
  wit_RandPrfExpandSeed(context: WitnessContext<L, P>): [P, Uint8Array];
}

/**
 * `L` and `P` are the deploying contract's ledger and private state, so the
 * same factory serves the mock and the example.
 */
export const CustodialConfidentialNoteFungibleTokenWitnesses = <
  L,
  P = CustodialConfidentialNoteFungibleTokenPrivateState,
>(
  wallet: CustodialWallet,
): ICustodialConfidentialNoteFungibleTokenWitnesses<L, P> => ({
  wit_AuthPrfAddrSK(context) {
    return [context.privateState, wallet.secretKey];
  },
  wit_RandPrfExpandSeed(context) {
    return [
      context.privateState,
      wallet.nonceSeed ?? new Uint8Array(getRandomValues(Buffer.alloc(32))),
    ];
  },
});
