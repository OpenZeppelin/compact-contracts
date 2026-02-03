import type { StateValue } from '@midnight-ntwrk/compact-runtime';
import type { IMinimalContract } from '../types/Contract.js';
/**
 * Configuration interface for the simulator factory.
 * @template P - Private state type
 * @template L - Ledger state type
 * @template W - Witnesses type
 * @template TContract - The contract type that extends IMinimalContract
 * @template TArgs - Tuple type of contract-specific arguments passed to CircuitContextManager
 */
export interface SimulatorConfig<
  P,
  L,
  W,
  TContract extends IMinimalContract,
  TArgs extends readonly any[] = readonly any[],
> {
  /** Factory function to create the contract instance */
  contractFactory: (witnesses: W) => TContract;
  /** Function to generate default private state */
  defaultPrivateState: () => P;
  /**
   * Function to process contract-specific arguments for CircuitContextManager initialization.
   * Receives the arguments as spread parameters and returns them as an array
   * to be passed to CircuitContextManager after the standard parameters (contract, privateState, coinPK, contractAddress).
   *
   * @example
   * // For a contract with owner and salt arguments:
   * contractArgs: (owner, instanceSalt) => [owner, instanceSalt]
   *
   * // For a contract with no additional arguments:
   * contractArgs: () => []
   */
  contractArgs: (...args: TArgs) => any[];
  /** Function to extract ledger state from contract state */
  ledgerExtractor: (state: StateValue) => L;
  /** Factory function to create default witnesses */
  witnessesFactory: () => W;
}
