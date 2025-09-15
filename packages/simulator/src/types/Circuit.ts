import type { CircuitContext } from '@midnight-ntwrk/compact-runtime';

/**
 * Extracts pure circuits from a contract type.
 * Pure circuits are those in `circuits` but not in `impureCircuits`.
 */
export type ExtractPureCircuits<TContract> = TContract extends {
  circuits: infer TCircuits;
  impureCircuits: infer TImpureCircuits;
}
  ? Omit<TCircuits, keyof TImpureCircuits>
  : never;

/**
 * Extracts impure circuits from a contract type.
 * Impure circuits are those in `impureCircuits`.
 */
export type ExtractImpureCircuits<TContract> = TContract extends {
  impureCircuits: infer TImpureCircuits;
}
  ? TImpureCircuits
  : never;

/**
 * Transforms circuit functions by removing the explicit `CircuitContext` parameter.
 *
 * Each original circuit function has signature:
 * `(ctx: CircuitContext<TState>, ...args) => { result: R; context?: CircuitContext<TState> }`
 *
 * The transformed function takes the same parameters except the context,
 * and returns the `result` directly.
 */
export type ContextlessCircuits<Circuits, TState> = {
  [K in keyof Circuits]: Circuits[K] extends (
    ctx: CircuitContext<TState>,
    ...args: infer P
  ) => { result: infer R; context?: CircuitContext<TState> }
    ? (...args: P) => R
    : never;
};
