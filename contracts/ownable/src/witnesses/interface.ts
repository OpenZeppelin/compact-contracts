import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type { Ledger } from '../artifacts/MockOwnablePK/contract/index.cjs'; // Combined imports

/**
 * @description Interface defining the witness methods for ownable operations.
 * @template P - The private state type.
 */
export interface IOwnableWitnesses<P> {
  /**
   * Retrieves the secret key from the private state.
   * @param context - The witness context containing the private state.
   * @returns A tuple of the private state and the secret key as a Uint8Array.
   */
  localSecretKey(context: WitnessContext<Ledger, P>): [P, Uint8Array];
}
