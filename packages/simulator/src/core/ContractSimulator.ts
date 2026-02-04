import {
  type CircuitContext,
  emptyZswapLocalState,
} from '@midnight-ntwrk/compact-runtime';
import { AbstractSimulator } from './AbstractSimulator.js';
import type { CircuitContextManager } from './CircuitContextManager.js';

/**
 * Enhanced base class for simulating Compact contract behavior with state management.
 *
 * Extends `AbstractSimulator` with:
 * - Simplified state management through `CircuitContextManager`
 * - Circuit context getters/setters that delegate to the state manager
 * - Caller context handling that respects both single-use and persistent overrides
 */
export abstract class ContractSimulator<P, L> extends AbstractSimulator<P, L> {
  /**
   * State manager that handles circuit context, private state, and contract state lifecycle.
   * Must be initialized by concrete subclasses in their constructor.
   */
  public circuitContextManager!: CircuitContextManager<P>;

  /** Retrieves the current public ledger state */
  abstract getPublicState(): L;

  /**
   * Constructs a circuit context with appropriate caller information.
   *
   * Checks for caller overrides in priority order:
   * 1. Single-use override (set via `as(caller)`)
   * 2. Persistent override (set via `setPersistentCaller(caller)`)
   * 3. Default caller context
   *
   * @returns A CircuitContext with the appropriate caller information applied
   */
  public getCallerContext(): CircuitContext<P> {
    const activeCaller = this.callerOverride || this.persistentCallerOverride;
    const baseCtx = this.circuitContext;

    return {
      currentPrivateState: baseCtx.currentPrivateState,
      currentQueryContext: baseCtx.currentQueryContext,
      currentZswapLocalState: activeCaller
        ? emptyZswapLocalState(activeCaller)
        : baseCtx.currentZswapLocalState,
      costModel: baseCtx.costModel,
      gasLimit: baseCtx.gasLimit,
    };
  }

  /**
   * Gets the current circuit context from the state manager
   *
   * @returns The current circuit context
   */
  get circuitContext(): CircuitContext<P> {
    return this.circuitContextManager.getContext();
  }

  /** Updates the circuit context in the state manager */
  set circuitContext(ctx: CircuitContext<P>) {
    this.circuitContextManager.setContext(ctx);
  }
}
