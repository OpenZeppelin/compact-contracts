// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Drives the AuthPrfAddr authenticator in off-chain tests.

import { getRandomValues } from 'node:crypto';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

/**
 * @description Interface defining the witness methods for AuthPrfAddr operations.
 * @template L - The ledger type.
 * @template P - The private state type.
 */
export interface IAuthPrfAddrWitnesses<L, P> {
  /**
   * Retrieves the secret key from the private state.
   * @param context - The witness context containing the private state.
   * @returns A tuple of the private state and the secret key as a Uint8Array.
   */
  wit_AuthPrfAddrSK(context: WitnessContext<L, P>): [P, Uint8Array];
}

/**
 * @description Represents the private state of an AuthPrfAddr caller, storing a secret key.
 */
export type AuthPrfAddrPrivateState = {
  /** @description A 32-byte secret key the caller's account is derived from. */
  secretKey: Uint8Array;
};

/**
 * @description Utility object for managing the private state of an AuthPrfAddr caller.
 */
export const AuthPrfAddrPrivateState = {
  /**
   * @description Generates a new private state with a random secret key.
   * @returns A fresh AuthPrfAddrPrivateState instance.
   */
  generate: (): AuthPrfAddrPrivateState => {
    return { secretKey: getRandomValues(new Uint8Array(32)) };
  },

  /**
   * @description Generates a new private state with a user-defined secret key.
   *
   * @param sk - The 32-byte secret key to use.
   * @returns A fresh AuthPrfAddrPrivateState instance with a copy of the key.
   */
  withSecretKey: (sk: Uint8Array): AuthPrfAddrPrivateState => {
    if (sk.length !== 32) {
      throw new Error(
        `withSecretKey: expected 32-byte secret key, received ${sk.length} bytes`,
      );
    }
    return { secretKey: Uint8Array.from(sk) };
  },
};

/**
 * @description Factory function creating witness implementations for AuthPrfAddr operations.
 * @returns An object implementing the Witnesses interface for AuthPrfAddrPrivateState.
 */
export const AuthPrfAddrWitnesses = <L>(): IAuthPrfAddrWitnesses<
  L,
  AuthPrfAddrPrivateState
> => ({
  wit_AuthPrfAddrSK(
    context: WitnessContext<L, AuthPrfAddrPrivateState>,
  ): [AuthPrfAddrPrivateState, Uint8Array] {
    return [
      context.privateState,
      Uint8Array.from(context.privateState.secretKey),
    ];
  },
});
