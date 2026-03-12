import { getRandomValues } from 'node:crypto';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type { Ledger } from '../../artifacts/SampleZOwnable/contract/index.js';

/**
 * @description Interface defining the witness methods for SampleZOwnable operations.
 * @template P - The private state type.
 */
export interface ISampleZOwnableWitnesses<P> {
  /**
   * Retrieves the secret nonce from the private state.
   * @param context - The witness context containing the private state.
   * @returns A tuple of the private state and the secret nonce as a Uint8Array.
   */
  secretNonce(context: WitnessContext<Ledger, P>): [P, Uint8Array];
}

/**
 * @description Represents the private state of an ownable contract, storing a secret nonce.
 */
export type SampleZOwnablePrivateState = {
  /** @description A 32-byte secret nonce used as a privacy additive. */
  secretNonce: Buffer;
};

/**
 * @description Utility object for managing the private state of an Ownable contract.
 */
export const SampleZOwnablePrivateState = {
  /**
   * @description Generates a new private state with a random secret nonce.
   * @returns A fresh SampleZOwnablePrivateState instance.
   */
  generate: (): SampleZOwnablePrivateState => {
    return { secretNonce: getRandomValues(Buffer.alloc(32)) };
  },

  /**
   * @description Generates a new private state with a user-defined secret nonce.
   * Useful for deterministic nonce generation or advanced use cases.
   *
   * @param nonce - The 32-byte secret nonce to use.
   * @returns A fresh SampleZOwnablePrivateState instance with the provided nonce.
   *
   * @example
   * ```typescript
   * // For deterministic nonces (user-defined scheme)
   * const deterministicNonce = myDeterministicScheme(...);
   * const privateState = SampleZOwnablePrivateState.withNonce(deterministicNonce);
   * ```
   */
  withNonce: (nonce: Buffer): SampleZOwnablePrivateState => {
    return { secretNonce: nonce };
  },
};

/**
 * @description Factory function creating witness implementations for Ownable operations.
 * @returns An object implementing the Witnesses interface for SampleZOwnablePrivateState.
 */
export const SampleZOwnableWitnesses =
  (): ISampleZOwnableWitnesses<SampleZOwnablePrivateState> => ({
    secretNonce(
      context: WitnessContext<Ledger, SampleZOwnablePrivateState>,
    ): [SampleZOwnablePrivateState, Uint8Array] {
      return [context.privateState, context.privateState.secretNonce];
    },
  });
