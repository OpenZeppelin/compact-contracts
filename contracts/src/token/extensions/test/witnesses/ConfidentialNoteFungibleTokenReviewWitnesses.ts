// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Drives the ConfidentialNoteFungibleTokenReview extension in off-chain tests.

import { getRandomValues } from 'node:crypto';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

/**
 * The review witness's private input. The extension has one witness and no
 * private state, so this holds only the knob a spec may turn.
 */
export type ReviewWallet = {
  /**
   * Fixed review-randomness seed. Leave undefined for a fresh secret seed per
   * witness call; set one only to test what a reused seed does.
   */
  reviewSeed?: Uint8Array;
};

export const createReviewWallet = (): ReviewWallet => ({});

/** The extension declares no private state. */
export type ConfidentialNoteFungibleTokenReviewPrivateState = Record<
  string,
  never
>;
export const ConfidentialNoteFungibleTokenReviewPrivateState = {
  generate: (): ConfidentialNoteFungibleTokenReviewPrivateState => ({}),
};

export interface IConfidentialNoteFungibleTokenReviewWitnesses<L, P> {
  wit_RandPrfExpandSeed(context: WitnessContext<L, P>): [P, Uint8Array];
}

/**
 * `L` and `P` are the composing contract's ledger and private state, so the
 * same factory serves the standalone mock and a composition.
 */
export const ConfidentialNoteFungibleTokenReviewWitnesses = <
  L,
  P = ConfidentialNoteFungibleTokenReviewPrivateState,
>(
  wallet: ReviewWallet,
): IConfidentialNoteFungibleTokenReviewWitnesses<L, P> => ({
  wit_RandPrfExpandSeed(context) {
    return [
      context.privateState,
      wallet.reviewSeed ?? new Uint8Array(getRandomValues(Buffer.alloc(32))),
    ];
  },
});
