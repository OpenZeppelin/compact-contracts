/**
 * The vocabulary a concurrency spec writes against, shared by every backend.
 *
 * A Compact transaction does not carry "call this circuit with these
 * arguments". It carries a fixed public transcript, an Impact program built
 * against the state the wallet saw, which the node re-executes against whatever
 * state is current when the transaction lands. Two things tie that transcript
 * to the state it was built on:
 *
 *   1. every ledger read the circuit consumed is a `popeq` with the expected
 *      value baked in, so a divergent read is a hard rejection,
 *   2. the declared effects must equal the ones the replay recomputes.
 *
 * So a conflict is not a race in wall-clock time. It is a divergence between
 * the state a transcript was built on and the state it is applied to, which is
 * why {@link ConcurrencyHarness} separates `build` from `land`: a spec pins two
 * builds to one snapshot, then applies them in order. No same-block trickery on
 * either backend.
 *
 * Which of the two couplings a backend can see differs, so a claim that depends
 * on (2) belongs in a live spec. See the SCOPE note on `DryReplayHarness`.
 */

import type {
  CircuitContext,
  CircuitResults,
  ContractAddress,
  ContractState,
} from '@midnight-ntwrk/compact-runtime';

/** How a pair of calls built on one snapshot turned out. */
export type Outcome = 'both-landed' | 'second-rejected';

/** One circuit invocation, named the same way on either backend. */
export interface Call {
  /** Which party's keys and notes answer the witnesses. */
  readonly actor: string;
  /** Circuit name, exactly as the contract exports it. */
  readonly circuitId: string;
  readonly args: readonly unknown[];
}

/** A call already built against some snapshot, not yet applied. */
export interface Pending<R = unknown> {
  readonly call: Call;
  readonly result: R;
}

/** What applying a pending call did. */
export type Attempt =
  | { readonly outcome: 'landed' }
  | { readonly outcome: 'rejected'; readonly reason: string };

/**
 * The four operations a concurrency claim needs, so a spec reads the same
 * whether it is replaying transcripts in memory or submitting transactions to a
 * node.
 *
 * @typeParam S - The backend's snapshot handle, opaque to specs.
 */
export interface ConcurrencyHarness<S = unknown> {
  /** The current state, to pin subsequent builds to. */
  snapshot(): Promise<S>;
  /** Builds and applies `call` at the current state. Must succeed. */
  apply<R>(call: Call): Promise<R>;
  /** Builds `call` against `at` without applying it. */
  build<R>(call: Call, at: S): Promise<Pending<R>>;
  /** Applies a pending call that is required to succeed. */
  land(pending: Pending): Promise<void>;
  /** Applies a pending call that is allowed to be rejected. */
  attempt(pending: Pending): Promise<Attempt>;
}

/** A circuit as the generated contract exposes it. */
export type ImpureCircuit<P> = (
  context: CircuitContext<P>,
  ...args: never[]
) => CircuitResults<P, unknown>;

/** The slice of a generated contract a harness drives. */
export interface ReplayableContract<P> {
  initialState: (
    context: never,
    ...args: never[]
  ) => {
    currentPrivateState: P;
    currentContractState: ContractState;
    currentZswapLocalState: unknown;
  };
  impureCircuits: Record<string, ImpureCircuit<P>>;
}

export interface HarnessOptions<P> {
  /**
   * One contract instance per actor. Each instance closes over that actor's
   * witnesses, which is how the harness gives two parties different secrets
   * while they share one ledger.
   */
  readonly contracts: Readonly<Record<string, ReplayableContract<P>>>;
  /** Private state handed to every circuit context. */
  readonly privateState: P;
  /** Constructor arguments, if the contract takes any. */
  readonly constructorArgs?: readonly unknown[];
  readonly contractAddress?: ContractAddress;
  readonly coinPublicKey?: string;
}
