import type { CircuitContext } from '@midnight-ntwrk/compact-runtime';
import type {
  ContextlessCircuits,
  ExtractImpureCircuits,
  ExtractPureCircuits,
} from '../types/index.js';

/**
 * Creates lazily-initialized circuit proxies for pure and impure contract functions.
 *
 * This utility function helps create consistent circuit proxies across different
 * simulator implementations while providing lazy initialization for performance.
 * @param contract - The contract instance containing circuits and impureCircuits
 * @param getContext - Function to retrieve the current circuit context
 * @param getCallerContext - Function to retrieve the caller's circuit context
 * @param updateContext - Function to update the circuit context after impure operations
 * @param createPureProxy - Factory function for creating pure circuit proxies
 * @param createImpureProxy - Factory function for creating impure circuit proxies
 * @returns Object with lazy circuit proxies and reset functionality
 */
export function createCircuitProxies<
  P,
  ContractType extends {
    circuits: Record<PropertyKey, unknown>;
    impureCircuits: Record<PropertyKey, unknown>;
  },
>(
  contract: ContractType,
  getContext: () => CircuitContext<P>,
  getCallerContext: () => CircuitContext<P>,
  updateContext: (ctx: CircuitContext<P>) => void,
  createPureProxy: <C extends Record<PropertyKey, unknown>>(
    circuits: C,
    context: () => CircuitContext<P>,
  ) => ContextlessCircuits<C, P>,
  createImpureProxy: <C extends Record<PropertyKey, unknown>>(
    circuits: C,
    context: () => CircuitContext<P>,
    updateContext: (ctx: CircuitContext<P>) => void,
  ) => ContextlessCircuits<C, P>,
) {
  let pureProxy:
    | ContextlessCircuits<ExtractPureCircuits<ContractType>, P>
    | undefined;
  let impureProxy:
    | ContextlessCircuits<ExtractImpureCircuits<ContractType>, P>
    | undefined;

  return {
    /**
     * Gets the circuit proxies, creating them lazily if they don't exist.
     * @returns Object containing pure and impure circuit proxies
     */
    get circuits() {
      if (!pureProxy) {
        pureProxy = createPureProxy(
          contract.circuits as ExtractPureCircuits<ContractType>,
          getContext,
        );
      }
      if (!impureProxy) {
        impureProxy = createImpureProxy(
          contract.impureCircuits as ExtractImpureCircuits<ContractType>,
          getCallerContext,
          updateContext,
        );
      }
      return {
        pure: pureProxy,
        impure: impureProxy,
      };
    },
    /**
     * Resets the cached circuit proxies, forcing re-initialization on next access.
     */
    resetProxies() {
      pureProxy = undefined;
      impureProxy = undefined;
    },
  };
}
