import type { CircuitContext } from '@midnight-ntwrk/compact-runtime';
import type {
  ContextlessCircuits,
  ExtractImpureCircuits,
  ExtractPureCircuits
} from '../types/test.js';

/**
 * Creates lazily-initialized circuit proxies for pure and impure contract functions.
 */
export function createCircuitProxies<P, ContractType extends { circuits: any; impureCircuits: any }>(
  contract: ContractType,
  getContext: () => CircuitContext<P>,
  getCallerContext: () => CircuitContext<P>,
  updateContext: (ctx: CircuitContext<P>) => void,
  createPureProxy: <C extends object>(
    circuits: C,
    context: () => CircuitContext<P>,
  ) => ContextlessCircuits<C, P>,
  createImpureProxy: <C extends object>(
    circuits: C,
    context: () => CircuitContext<P>,
    updateContext: (ctx: CircuitContext<P>) => void,
  ) => ContextlessCircuits<C, P>,
) {
  let pureProxy: ContextlessCircuits<ExtractPureCircuits<ContractType>, P> | undefined;
  let impureProxy: ContextlessCircuits<ExtractImpureCircuits<ContractType>, P> | undefined;

  return {
    get circuits() {
      return {
        pure:
          pureProxy ??
          (pureProxy = createPureProxy(contract.circuits, getContext)),
        impure:
          impureProxy ??
          (impureProxy = createImpureProxy(
            contract.impureCircuits,
            getCallerContext,
            updateContext,
          )),
      };
    },
    resetProxies() {
      pureProxy = undefined;
      impureProxy = undefined;
    },
  };
}
