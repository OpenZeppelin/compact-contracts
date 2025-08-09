import { getRandomValues } from 'node:crypto';
import type { Ledger } from '../artifacts/MockZ_OwnablePK/contract/index.cjs';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { IZ_OwnablePKWitnesses } from './interface.js'

/**
 * @description Represents the private state of an ownable contract, storing a secret nonce.
 */
export type Z_OwnablePKPrivateState = {
  /** @description A 32-byte secret nonce used as a privacy additive. */
  offchainNonce: Buffer;
};

/**
 * @description Utility object for managing the private state of an Ownable contract.
 */
export const Z_OwnablePKPrivateState = {
  /**
   * @description Generates a new private state with a random secret nonce.
   * @returns A fresh Z_OwnablePKPrivateState instance.
   */
  generate: (): Z_OwnablePKPrivateState => {
    return { offchainNonce: getRandomValues(Buffer.alloc(32))};
  }
};

/**
 * @description Factory function creating witness implementations for Ownable operations.
 * @returns An object implementing the Witnesses interface for Z_OwnablePKPrivateState.
 */
export const Z_OwnablePKWitnesses = (): IZ_OwnablePKWitnesses<Z_OwnablePKPrivateState> => ({
    offchainNonce(
      context: WitnessContext<Ledger, Z_OwnablePKPrivateState>,
    ): [Z_OwnablePKPrivateState, Uint8Array] {
      return [context.privateState, context.privateState.offchainNonce];
    },
});