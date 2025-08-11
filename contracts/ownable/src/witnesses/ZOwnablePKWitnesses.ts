import { getRandomValues } from 'node:crypto';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type { Ledger } from '../artifacts/MockZOwnablePK/contract/index.cjs';
import type { IZOwnablePKWitnesses } from './interface.js';

/**
 * @description Represents the private state of an ownable contract, storing a secret nonce.
 */
export type ZOwnablePKPrivateState = {
  /** @description A 32-byte secret nonce used as a privacy additive. */
  offchainNonce: Buffer;
};

/**
 * @description Utility object for managing the private state of an Ownable contract.
 */
export const ZOwnablePKPrivateState = {
  /**
   * @description Generates a new private state with a random secret nonce.
   * @returns A fresh ZOwnablePKPrivateState instance.
   */
  generate: (): ZOwnablePKPrivateState => {
    return { offchainNonce: getRandomValues(Buffer.alloc(32)) };
  },
};

/**
 * @description Factory function creating witness implementations for Ownable operations.
 * @returns An object implementing the Witnesses interface for ZOwnablePKPrivateState.
 */
export const ZOwnablePKWitnesses =
  (): IZOwnablePKWitnesses<ZOwnablePKPrivateState> => ({
    offchainNonce(
      context: WitnessContext<Ledger, ZOwnablePKPrivateState>,
    ): [ZOwnablePKPrivateState, Uint8Array] {
      return [context.privateState, context.privateState.offchainNonce];
    },
  });
