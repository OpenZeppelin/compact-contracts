import { getRandomValues } from 'node:crypto';
import { IOwnableWitnesses } from './interface';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import {
    type Ledger,
  } from '../artifacts/MockOwnable/contract/index.cjs'; // Combined imports

/**
 * @description Represents the private state of an ownable contract, storing a secret key.
 */
export type OwnablePrivateState = {
    /** @description A 32-byte secret key used for cryptographic operations. */
    secretKey: Buffer;
  };

/**
 * @description Utility object for managing the private state of an ownable contract.
 */
export const OwnablePrivateState = {
    /**
     * @description Generates a new private state with a random secret key.
     * @returns A fresh OwnablePrivateState instance.
     */
    generate: (): OwnablePrivateState => {
      return { secretKey: getRandomValues(Buffer.alloc(32)) };
    },
}

/**
 * @description Factory function creating witness implementations for ownable operations.
 * @returns An object implementing the Witnesses interface for OwnablePrivateState.
 */
export const OwnableWitnesses =
  (): IOwnableWitnesses<OwnablePrivateState> => ({
    /**
     * @description Retrieves the secret key from the private state.
     * @param context - The witness context containing the private state.
     * @returns A tuple of the unchanged private state and the secret key as a Uint8Array.
     */
    localSecretKey(
        context: WitnessContext<Ledger, OwnablePrivateState>,
      ): [OwnablePrivateState, Uint8Array] {
        return [context.privateState, context.privateState.secretKey];
      },
});

export const SetWitnessContext =
  (sk: Uint8Array): IOwnableWitnesses<OwnablePrivateState> => ({
    /**
     * @description Retrieves the secret key from the private state.
     * @param context - The witness context containing the private state.
     * @returns A tuple of the unchanged private state and the passed `sk` as a Uint8Array.
     */
    localSecretKey(
        context: WitnessContext<Ledger, OwnablePrivateState>,
      ): [OwnablePrivateState, Uint8Array] {
        return [context.privateState, sk];
      },
});
