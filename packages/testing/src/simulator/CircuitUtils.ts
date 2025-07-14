import type { CircuitContext } from '@midnight-ntwrk/compact-runtime';

/**
 * Utility type that removes the context argument from circuits,
 * returning a version callable without the CircuitContext.
 */
export type ContextlessCircuits<Circuits, TState> = {
  [K in keyof Circuits]: Circuits[K] extends (
    ctx: CircuitContext<TState>,
    ...args: infer P
  ) => { result: infer R; context: CircuitContext<TState> }
    ? (...args: P) => R
    : never;
};
