// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Unaudited reference material that drives Compact circuits in
// off-chain tests. Not shipped as a consumable artifact. Production
// consumers must author and audit their own witnesses.

import { getRandomValues } from 'node:crypto';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

/**
 * @description The witness the Authority mock reads through `AuthPrfPseudonym`.
 * @template L - The ledger type.
 * @template P - The private state type.
 */
export interface IConfidentialNoteFungibleTokenAuthorityWitnesses<L, P> {
  /**
   * @param context - The witness context holding the private state.
   * @returns The private state and the caller's secret key.
   */
  wit_AuthPrfPseudonymSK(context: WitnessContext<L, P>): [P, Uint8Array];
}

/**
 * @description The caller's secret. Its account under the mock's salt is the
 * identifier `assertOnlyAuthority` compares.
 */
export type ConfidentialNoteFungibleTokenAuthorityPrivateState = {
  /** @description A 32-byte secret key. */
  secretKey: Uint8Array;
};

export const ConfidentialNoteFungibleTokenAuthorityPrivateState = {
  /**
   * @returns A private state with a random secret key.
   */
  generate: (): ConfidentialNoteFungibleTokenAuthorityPrivateState => {
    return { secretKey: getRandomValues(new Uint8Array(32)) };
  },

  /**
   * @param sk - The 32-byte secret key to use.
   * @returns A private state holding a copy of `sk`.
   * @throws If `sk` is not 32 bytes.
   */
  withSecretKey: (
    sk: Uint8Array,
  ): ConfidentialNoteFungibleTokenAuthorityPrivateState => {
    if (sk.length !== 32) {
      throw new Error(
        `withSecretKey: expected 32-byte secret key, received ${sk.length} bytes`,
      );
    }
    return { secretKey: Uint8Array.from(sk) };
  },
};

/**
 * @description Witness implementations over
 * {@link ConfidentialNoteFungibleTokenAuthorityPrivateState}.
 */
export const ConfidentialNoteFungibleTokenAuthorityWitnesses = <
  L,
>(): IConfidentialNoteFungibleTokenAuthorityWitnesses<
  L,
  ConfidentialNoteFungibleTokenAuthorityPrivateState
> => ({
  wit_AuthPrfPseudonymSK(
    context: WitnessContext<
      L,
      ConfidentialNoteFungibleTokenAuthorityPrivateState
    >,
  ): [ConfidentialNoteFungibleTokenAuthorityPrivateState, Uint8Array] {
    return [
      context.privateState,
      Uint8Array.from(context.privateState.secretKey),
    ];
  },
});
