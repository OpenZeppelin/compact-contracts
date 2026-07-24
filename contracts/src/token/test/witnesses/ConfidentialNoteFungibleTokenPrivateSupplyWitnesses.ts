// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Drives ConfidentialNoteFungibleTokenPrivateSupply (confidential supply) circuits in
// off-chain tests.

import { getRandomValues } from 'node:crypto';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type { Ledger } from '../../../../artifacts/MockConfidentialNoteFungibleTokenPrivateSupply/contract/index.js';

export type ConfidentialNoteFungibleTokenPrivateSupplyPrivateState = {
  /** Supply-key secret (supplyKey = derivePk(secret)); consumed by attestSupply. */
  supplyKeySecret: Uint8Array;
  /**
   * Optional fixed randomness seed. Leave undefined for the production-correct
   * behavior (a fresh secret seed per witness call).
   */
  randomnessSeed?: Uint8Array;
};

export const ConfidentialNoteFungibleTokenPrivateSupplyPrivateState = {
  generate: (): ConfidentialNoteFungibleTokenPrivateSupplyPrivateState => ({
    supplyKeySecret: new Uint8Array(getRandomValues(Buffer.alloc(32))),
  }),
};

export interface IConfidentialNoteFungibleTokenPrivateSupplyWitnesses<P> {
  wit_SupplyRandomness(context: WitnessContext<Ledger, P>): [P, Uint8Array];
  wit_SupplyKeySecret(context: WitnessContext<Ledger, P>): [P, Uint8Array];
}

export const ConfidentialNoteFungibleTokenPrivateSupplyWitnesses =
  (): IConfidentialNoteFungibleTokenPrivateSupplyWitnesses<ConfidentialNoteFungibleTokenPrivateSupplyPrivateState> => ({
    // Fresh + secret per call, as the extension requires; a fixed seed is only
    // honored when a test explicitly plants one.
    wit_SupplyRandomness(context) {
      return [
        context.privateState,
        context.privateState.randomnessSeed ??
          new Uint8Array(getRandomValues(Buffer.alloc(32))),
      ];
    },
    wit_SupplyKeySecret(context) {
      return [context.privateState, context.privateState.supplyKeySecret];
    },
  });
