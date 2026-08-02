// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Drives ConfidentialNoteFungibleTokenReview (selective disclosure) circuits
// in off-chain tests.

import { getRandomValues } from 'node:crypto';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type { Ledger } from '../../../../artifacts/MockConfidentialNoteFungibleTokenReview/contract/index.js';

export type ConfidentialNoteFungibleTokenReviewPrivateState = {
  /**
   * Optional fixed randomness seed. Leave undefined for the production-correct
   * behavior (a fresh secret seed per witness call); set it only in tests that
   * need deterministic ephemerals.
   */
  randomnessSeed?: Uint8Array;
};

export const ConfidentialNoteFungibleTokenReviewPrivateState = {
  generate: (): ConfidentialNoteFungibleTokenReviewPrivateState => ({}),
};

export interface IConfidentialNoteFungibleTokenReviewWitnesses<P> {
  wit_ReviewRandomness(context: WitnessContext<Ledger, P>): [P, Uint8Array];
}

export const ConfidentialNoteFungibleTokenReviewWitnesses =
  (): IConfidentialNoteFungibleTokenReviewWitnesses<ConfidentialNoteFungibleTokenReviewPrivateState> => ({
    // Fresh + secret per call, as the extension requires; a fixed seed is only
    // honored when a test explicitly plants one.
    wit_ReviewRandomness(context) {
      return [
        context.privateState,
        context.privateState.randomnessSeed ??
          new Uint8Array(getRandomValues(Buffer.alloc(32))),
      ];
    },
  });
