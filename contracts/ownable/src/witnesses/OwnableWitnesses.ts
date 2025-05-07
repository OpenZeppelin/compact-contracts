import { getRandomValues } from 'node:crypto';
import { IOwnableWitnesses } from './interface';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import {
    type Ledger,
  } from '../artifacts/MockOwnable/contract/index.cjs'; // Combined imports

/**
 * @description Represents the private state of an access control contract, storing a secret key and role assignments.
 */
export type OwnablePrivateState = {
    /** @description A 32-byte secret key used for cryptographic operations, such as nullifier generation. */
    secretKey: Buffer;
  };

/**
 * @description Utility object for managing the private state of an ownable contract.
 */
export const OwnablePrivateState = {
    /**
     * @description Generates a new private state with a random secret key and empty roles.
     * @returns A fresh OwnablePrivateState instance.
     */
    generate: (): OwnablePrivateState => {
      return { secretKey: getRandomValues(Buffer.alloc(32)) };
    },
}

/**
 * @description Factory function creating witness implementations for access control operations.
 * @returns An object implementing the Witnesses interface for AccessContractPrivateState.
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