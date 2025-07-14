import type {
  CircuitContext,
  ContractState,
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
   *
   * @returns The current ledger state of type L.
   */
  getCurrentPublicState(): L;

  /**
   * Returns the current private contract state.
   *
   * @returns The current private state of type P.
   */
  getCurrentPrivateState(): P;

  /**
   * Returns the original contract state.
   *
   * @returns The current contract state.
   */
  getCurrentContractState(): ContractState;
}
