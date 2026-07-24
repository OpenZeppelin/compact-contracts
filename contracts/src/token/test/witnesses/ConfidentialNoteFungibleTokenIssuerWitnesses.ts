// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Drives ConfidentialNoteFungibleTokenIssuer (issuer gating) circuits in
// off-chain tests.

import { getRandomValues } from 'node:crypto';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type { Ledger } from '../../../../artifacts/MockConfidentialNoteFungibleTokenIssuer/contract/index.js';

export type ConfidentialNoteFungibleTokenIssuerPrivateState = {
  /** Issuer secret (issuerPk = Hf(issuerSecret)). */
  issuerSecret: Uint8Array;
};

export const ConfidentialNoteFungibleTokenIssuerPrivateState = {
  generate: (): ConfidentialNoteFungibleTokenIssuerPrivateState => ({
    issuerSecret: new Uint8Array(getRandomValues(Buffer.alloc(32))),
  }),
};

export interface IConfidentialNoteFungibleTokenIssuerWitnesses<P> {
  wit_IssuerSecret(context: WitnessContext<Ledger, P>): [P, Uint8Array];
}

export const ConfidentialNoteFungibleTokenIssuerWitnesses =
  (): IConfidentialNoteFungibleTokenIssuerWitnesses<ConfidentialNoteFungibleTokenIssuerPrivateState> => ({
    wit_IssuerSecret(context) {
      return [context.privateState, context.privateState.issuerSecret];
    },
  });
