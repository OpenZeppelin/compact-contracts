import type {
  CircuitContext,
  CoinPublicKey,
  StateValue,
} from '@midnight-ntwrk/compact-runtime';
import type {
  ContextlessCircuits,
  IContractSimulator,
} from '../types/index.js';

/**
 * Abstract base class for simulating contract behavior.
 *
 * Provides common functionality for managing circuit contexts and creating proxies
 * for pure and impure circuit functions.
 */
export abstract class AbstractSimulator<P, L>
  implements IContractSimulator<P, L>
{
  /**
   * Single-use caller override (cleared after each circuit call).
   * Set via `as(caller)` for one-time caller context switching.
   */
  public callerOverride: CoinPublicKey | null = null;

  /**
   * Persistent caller override (until explicitly cleared).
   * Set via `setPersistentCaller(caller)` for ongoing caller context.
   */
  public persistentCallerOverride: CoinPublicKey | null = null;

  /** The deployed contract's address */
  abstract readonly contractAddress: string;

  /** The current circuit context */
  abstract circuitContext: CircuitContext<P>;

  /** Retrieves the current public ledger state */
  abstract getPublicState(): L;

  /**
   * Sets the caller context for the next circuit call only (auto-resets).
   *
   * @param caller - The public key to use as the caller for the next circuit execution
   * @returns This simulator instance for method chaining
   */
  public as(caller: CoinPublicKey): this {
    this.callerOverride = caller;
    return this;
  }

  /**
   * Sets a persistent caller that will be used for all subsequent circuit calls.
   *
   * @param caller - The public key to use as the caller for all future calls, or null to clear
   */
  public setPersistentCaller(caller: CoinPublicKey | null): void {
    this.persistentCallerOverride = caller;
  }

  /**
   * Clears persistent caller overrides.
   *
   * @returns This simulator instance for method chaining
   */
  public resetCaller(): this {
    this.callerOverride = null;
    this.persistentCallerOverride = null;
    return this;
  }

  /**
   * Retrieves the current private state from the circuit context.
   *
   * @returns The current private state of type P
   */
  public getPrivateState(): P {
    return this.circuitContext.currentPrivateState;
  }

  /**
   * Retrieves the current contract state data.
   *
   * @returns The current state value containing the ledger data
   */
  public getContractState(): StateValue {
    return this.circuitContext.currentQueryContext.state.state;
  }

  /**
   * Creates a proxy wrapper around pure circuits.
   * Pure circuits do not modify contract state, so only the result is returned.
   *
   * @param circuits - The pure circuit functions to wrap
   * @param context - Function that provides the current circuit context
   * @returns A contextless proxy that automatically injects context and extracts results
   */
  public createPureCircuitProxy<Circuits extends object>(
    circuits: Circuits,
    context: () => CircuitContext<P>,
  ): ContextlessCircuits<Circuits, P> {
    return new Proxy(circuits, {
      /**
       * Proxy getter that wraps circuit functions to handle context injection.
       *
       * @param target - The original circuits object
       * @param prop - The property being accessed
       * @param receiver - The proxy object
       * @returns The original property or a wrapped function
       */
      get: (target, prop, receiver) => {
        const original = Reflect.get(target, prop, receiver);
        if (typeof original !== 'function') return original;

        return (...args: unknown[]) => {
          const fn = original as (
            ctx: CircuitContext<P>,
            ...args: unknown[]
          ) => { result: unknown };
          const result = fn(context(), ...args).result;

          // Auto-reset single-use caller override
          this.callerOverride = null;
          return result;
        };
      },
    }) as ContextlessCircuits<Circuits, P>;
  }

  /**
   * Creates a proxy wrapper around impure circuits.
   * Impure circuits can modify contract state, so the circuit context is updated accordingly.
   *
   * @param circuits - The impure circuit functions to wrap
   * @param context - Function that provides the current circuit context
   * @param updateContext - Function to update the circuit context after execution
   * @returns A contextless proxy that handles context injection and state updates
   */
  public createImpureCircuitProxy<Circuits extends object>(
    circuits: Circuits,
    context: () => CircuitContext<P>,
    updateContext: (ctx: CircuitContext<P>) => void,
  ): ContextlessCircuits<Circuits, P> {
    return new Proxy(circuits, {
      /**
       * Proxy getter that wraps circuit functions to handle context injection and updates.
       *
       * @param target - The original circuits object
       * @param prop - The property being accessed
       * @param receiver - The proxy object
       * @returns The original property or a wrapped function
       */
      get: (target, prop, receiver) => {
        const original = Reflect.get(target, prop, receiver);
        if (typeof original !== 'function') return original;

        return (...args: unknown[]) => {
          const fn = original as (
            ctx: CircuitContext<P>,
            ...args: unknown[]
          ) => { result: unknown; context: CircuitContext<P> };

          const { result, context: newCtx } = fn(context(), ...args);
          updateContext(newCtx);

          // Auto-reset single-use caller override
          this.callerOverride = null;
          return result;
        };
      },
    }) as ContextlessCircuits<Circuits, P>;
  }

  /**
   * Optional method to reset any cached circuit proxies.
   * Implementations can override this to clear cached proxy instances.
   */
  public resetCircuitProxies?(): void {}
}
