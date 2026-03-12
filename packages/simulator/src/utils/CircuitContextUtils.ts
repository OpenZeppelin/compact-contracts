import {
  type ChargedState,
  type CircuitContext,
  type CoinPublicKey,
  type ContractAddress,
  CostModel,
  emptyZswapLocalState,
  QueryContext,
} from '@midnight-ntwrk/compact-runtime';
import type { IContractSimulator } from '../types/index.js';

/**
 * Constructs a `CircuitContext` from the given state and sender information.
 *
 * This is typically used at runtime to provide the necessary context
 * for executing circuits, including contract state, private state,
 * sender identity, and transaction data.
 * @param privateState - The private state data specific to the contract
 * @param chargedState - The charged state (wraps StateValue with cost tracking)
 * @param sender - The public key of the transaction sender
 * @param contractAddress - The address of the contract being executed
 * @returns A complete CircuitContext ready for circuit execution
 */
export function useCircuitContext<P>(
  privateState: P,
  chargedState: ChargedState,
  sender: CoinPublicKey,
  contractAddress: ContractAddress,
): CircuitContext<P> {
  return {
    currentPrivateState: privateState,
    currentQueryContext: new QueryContext(chargedState, contractAddress),
    currentZswapLocalState: emptyZswapLocalState(sender),
    costModel: CostModel.initialCostModel(),
  };
}

/**
 * Prepares a new `CircuitContext` using the given sender and contract.
 *
 * Useful for mocking or updating the circuit context with a custom sender.
 * @param contract - The contract simulator instance to extract state from
 * @param sender - The public key of the new sender to use in the context
 * @returns A CircuitContext configured with the contract's current state and the specified sender
 */
export function useCircuitContextSender<
  P,
  L,
  C extends IContractSimulator<P, L>,
>(contract: C, sender: CoinPublicKey): CircuitContext<P> {
  const currentCircuitContext = contract.circuitContext;
  const currentPrivateState = contract.getPrivateState();
  const existingChargedState = currentCircuitContext.currentQueryContext.state;
  const contractAddress = contract.contractAddress;

  return {
    currentPrivateState,
    currentQueryContext: new QueryContext(
      existingChargedState,
      contractAddress,
    ),
    currentZswapLocalState: emptyZswapLocalState(sender),
    costModel: currentCircuitContext.costModel,
    gasLimit: currentCircuitContext.gasLimit,
  };
}
