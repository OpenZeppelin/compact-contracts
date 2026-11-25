// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Drives the AuthPrfPseudonym authenticator in off-chain tests.

import { getRandomValues } from 'node:crypto';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

/**
 * @description Interface defining the witness methods for AuthPrfPseudonym operations.
 * @template L - The ledger type.
 * @template P - The private state type.
 */
export interface IAuthPrfPseudonymWitnesses<L, P> {
  /**
   * Retrieves the secret key from the private state.
   * @param context - The witness context containing the private state.
   * @returns A tuple of the private state and the secret key as a Uint8Array.
   */
  wit_AuthPrfPseudonymSK(context: WitnessContext<L, P>): [P, Uint8Array];
}

/**
 * @description Represents the private state of an AuthPrfPseudonym caller, storing a secret key.
 */
export type AuthPrfPseudonymPrivateState = {
  /** @description A 32-byte secret key the caller's account is derived from. */
  secretKey: Uint8Array;
};

/**
 * @description Utility object for managing the private state of an AuthPrfPseudonym caller.
 */
export const AuthPrfPseudonymPrivateState = {
  /**
   * @description Generates a new private state with a random secret key.
   * @returns A fresh AuthPrfPseudonymPrivateState instance.
   */
  generate: (): AuthPrfPseudonymPrivateState => {
    return { secretKey: getRandomValues(new Uint8Array(32)) };
  },

  /**
   * @description Generates a new private state with a user-defined secret key.
   *
   * @param sk - The 32-byte secret key to use.
   * @returns A fresh AuthPrfPseudonymPrivateState instance with a copy of the
   * key.
   */
  withSecretKey: (sk: Uint8Array): AuthPrfPseudonymPrivateState => {
    if (sk.length !== 32) {
      throw new Error(
        `withSecretKey: expected 32-byte secret key, received ${sk.length} bytes`,
      );
    }
    return { secretKey: Uint8Array.from(sk) };
  },
};

/**
 * @description Factory function creating witness implementations for AuthPrfPseudonym operations.
 * @returns An object implementing the Witnesses interface for AuthPrfPseudonymPrivateState.
 */
export const AuthPrfPseudonymWitnesses = <L>(): IAuthPrfPseudonymWitnesses<
  L,
  AuthPrfPseudonymPrivateState
> => ({
  wit_AuthPrfPseudonymSK(
    context: WitnessContext<L, AuthPrfPseudonymPrivateState>,
  ): [AuthPrfPseudonymPrivateState, Uint8Array] {
    return [
      context.privateState,
      Uint8Array.from(context.privateState.secretKey),
    ];
  },
});
