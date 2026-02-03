import type {
  CircuitContext,
  StateValue,
} from '@midnight-ntwrk/compact-runtime';

/**
 * Interface defining a generic contract simulator.
 *
 * @template P - Type representing the private contract state.
 * @template L - Type representing the public ledger state.
 */
export interface IContractSimulator<P, L> {
  /**
   * The deployed contract's address.
   */
  readonly contractAddress: string;

  /**
   * The current circuit context holding the contract state.
   */
  circuitContext: CircuitContext<P>;

  /**
   * Returns the current public ledger state.
   */
  getPublicState(): L;

  /**
   * Returns the current private contract state.
   */
  getPrivateState(): P;

  /**
   * Returns the current contract state.
   */
  getContractState(): StateValue;
}
