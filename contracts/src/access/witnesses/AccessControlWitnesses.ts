import { getRandomValues } from 'node:crypto';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

/**
 * @description Interface defining the witness methods for AccessControl operations.
 * @template P - The private state type.
 */
export interface IAccessControlWitnesses<L, P> {
  /**
   * Retrieves the secret key from the private state.
   * @param context - The witness context containing the private state.
   * @returns A tuple of the private state and the secret key as a Uint8Array.
   */
  wit_AccessControlSK(context: WitnessContext<L, P>): [P, Uint8Array];
}

/**
 * @description Represents the private state of an AccessControl contract, storing a secret key.
 */
export type AccessControlPrivateState = {
  /** @description A 32-byte secret key used for creating a public user identifier. */
  secretKey: Uint8Array;
};

/**
 * @description Utility object for managing the private state of an AccessControl contract.
 */
export const AccessControlPrivateState = {
  /**
   * @description Generates a new private state with a random secret key.
   * @returns A fresh AccessControlPrivateState instance.
   */
  generate: (): AccessControlPrivateState => {
    return { secretKey: getRandomValues(new Uint8Array(32)) };
  },

  /**
   * @description Generates a new private state with a user-defined secret key.
   * Useful for deterministic nonce generation or advanced use cases.
   *
   * @param sk - The 32-byte secret nonce to use.
   * @returns A fresh AccessControlPrivateState instance with the provided nonce.
   *
   * @example
   * ```typescript
   * // For deterministic keys (user-defined scheme)
   * const deterministicKey = myDeterministicScheme(...);
   * const privateState = AccessControlPrivateState.withSecretKey(deterministicKey);
   * ```
   */
  withSecretKey: (sk: Uint8Array): AccessControlPrivateState => {
    if (sk.length !== 32) {
      throw new Error(
        `withSecretKey: expected 32-byte secret key, received ${sk.length} bytes`,
      );
    }
    return { secretKey: Uint8Array.from(sk) };
  },
};

/**
 * @description Factory function creating witness implementations for Ownable operations.
 * @returns An object implementing the Witnesses interface for AccessControlPrivateState.
 */
export const AccessControlWitnesses = <L>(): IAccessControlWitnesses<
  L,
  AccessControlPrivateState
> => ({
  wit_AccessControlSK(
    context: WitnessContext<L, AccessControlPrivateState>,
  ): [AccessControlPrivateState, Uint8Array] {
    return [context.privateState, context.privateState.secretKey];
  },
});
