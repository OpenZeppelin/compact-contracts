import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type { Ledger } from '../artifacts/MockZOwnablePK/contract/index.cjs'; // Combined imports

/**
 * @description Interface defining the witness methods for Ownable operations.
 * @template P - The private state type.
 */
export interface IZOwnablePKWitnesses<P> {
  /**
   * Retrieves the secret nonce from the private state.
   * @param context - The witness context containing the private state.
   * @returns A tuple of the private state and the secret nonce as a Uint8Array.
   */
  offchainNonce(context: WitnessContext<Ledger, P>): [P, Uint8Array];
}
