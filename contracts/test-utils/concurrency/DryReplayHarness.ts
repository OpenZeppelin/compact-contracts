/**
 * A {@link ConcurrencyHarness} that replays transcripts in memory.
 *
 * Not an approximation of the node: `QueryContext.runTranscript` is the same
 * verifying-mode entry point in the same WASM onchain runtime the node runs, so
 * a rejection here is the rejection the node would issue for the same reason.
 *
 * SCOPE. `run_transcript` forwards the program and the gas budget to `query` and
 * ignores `transcript.effects` (onchain-runtime/src/context.rs:990), so this
 * covers exactly ONE of the two couplings between a transcript and its
 * snapshot: pinned reads. The declared-vs-recomputed effects check runs in the
 * ledger after the transcript does (ledger/src/semantics.rs:1400), as do mempool
 * ordering, block inclusion, and fee treatment on a failed segment. All of those
 * are live-backend properties.
 */

import {
  type AlignedValue,
  type ChargedState,
  type ContractAddress,
  CostModel,
  createCircuitContext,
  dummyContractAddress,
  type Effects,
  type Op,
  QueryContext,
  type RunningCost,
  type StateValue,
} from '@midnight-ntwrk/compact-runtime';
import { CircuitContextManager } from '@openzeppelin/compact-simulator';
import type {
  Attempt,
  Call,
  ConcurrencyHarness,
  HarnessOptions,
  Pending,
  ReplayableContract,
} from './types.js';

/**
 * A transcript's gas field is a budget the program must not exceed, not a
 * measurement. Passing the cost the build actually reported fails with
 * `OutOfGas`, because verifying mode re-charges the whole program against it.
 * Nothing here is testing fees, so the budget is simply large.
 */
const BUDGET: RunningCost = {
  readTime: 2n ** 60n,
  computeTime: 2n ** 60n,
  bytesWritten: 2n ** 60n,
  bytesDeleted: 2n ** 60n,
};

const DEFAULT_COIN_PUBLIC_KEY = '0'.repeat(64);

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** A built call, plus the snapshot it was built against. */
interface DryPending<R> extends Pending<R> {
  readonly transcript: Op<AlignedValue>[];
  /**
   * Declared effects. `run_transcript` ignores them today, but a transcript is
   * the pair, so they are carried and passed rather than stubbed.
   */
  readonly effects: Effects;
  readonly builtOn: ChargedState;
}

export class DryReplayHarness<P> implements ConcurrencyHarness<ChargedState> {
  private current: ChargedState;
  private readonly contracts: Readonly<Record<string, ReplayableContract<P>>>;
  private readonly privateState: P;
  private readonly address: ContractAddress;
  private readonly coinPublicKey: string;
  private readonly costModel = CostModel.initialCostModel();

  constructor(options: HarnessOptions<P>) {
    this.contracts = options.contracts;
    this.privateState = options.privateState;
    this.address = options.contractAddress ?? dummyContractAddress();
    this.coinPublicKey = options.coinPublicKey ?? DEFAULT_COIN_PUBLIC_KEY;
    this.current = this.deploy(options.constructorArgs ?? []);
  }

  /** The ledger as it stands, for a spec that wants to read it. */
  get state(): StateValue {
    return this.current.state;
  }

  async snapshot(): Promise<ChargedState> {
    return this.current;
  }

  async build<R>(call: Call, at: ChargedState): Promise<Pending<R>> {
    const circuit = this.circuitFor(call);
    const context = createCircuitContext(
      this.address,
      this.coinPublicKey,
      at,
      this.privateState,
    );
    const results = circuit(context, ...(call.args as never[]));

    const pending: DryPending<R> = {
      call,
      result: results.result as R,
      transcript: results.proofData.publicTranscript,
      effects: results.context.currentQueryContext.effects,
      builtOn: at,
    };
    return pending;
  }

  async land(pending: Pending): Promise<void> {
    this.current = this.replay(pending as DryPending<unknown>, this.current);
  }

  async attempt(pending: Pending): Promise<Attempt> {
    const built = pending as DryPending<unknown>;
    try {
      this.current = this.replay(built, this.current);
      return { outcome: 'landed' };
    } catch (error) {
      return this.classify(built, error);
    }
  }

  async apply<R>(call: Call): Promise<R> {
    const pending = await this.build<R>(call, this.current);
    await this.land(pending);
    return pending.result;
  }

  /**
   * Decides whether a failed replay is a state divergence or a bug, by
   * definition rather than by inspecting the message.
   *
   * A conflict IS "valid against the state it was built on, invalid against the
   * state it is applied to". So replay the same transcript against its own build
   * snapshot: if that succeeds, the only thing that changed is the state, which
   * is a conflict. If it fails there too, the transcript was never valid and the
   * fault is in the spec or the harness (a mis-set gas budget, a bad program),
   * so the original error is rethrown rather than scored.
   *
   * Matching on upstream error text would be the alternative, and a worse one:
   * `runTranscript` surfaces `OnchainProgramError` through wasm-bindgen as a
   * plain `Error` carrying only its `Display` string, so there is no error type
   * to import and any pattern here would be a copy of a string we do not own.
   */
  private classify(pending: DryPending<unknown>, error: unknown): Attempt {
    try {
      this.replay(pending, pending.builtOn);
    } catch {
      throw error;
    }
    return { outcome: 'rejected', reason: messageOf(error) };
  }

  /**
   * Applies a built transcript the way the node does: re-execute it in
   * verifying mode against `against`. Deliberately NOT the state the build
   * itself produced, which would skip the pinned-read checks entirely and score
   * every case as landed.
   */
  private replay(
    pending: DryPending<unknown>,
    against: ChargedState,
  ): ChargedState {
    return new QueryContext(against, this.address).runTranscript(
      {
        gas: BUDGET,
        effects: pending.effects,
        program: pending.transcript,
      },
      this.costModel,
    ).state;
  }

  /** Every actor shares one deployed ledger; it lives here, not on them. */
  private deploy(constructorArgs: readonly unknown[]): ChargedState {
    const [deployer] = Object.values(this.contracts);
    if (deployer === undefined) {
      throw new Error('concurrency harness: no contracts given');
    }
    const manager = new CircuitContextManager(
      deployer,
      this.privateState,
      this.coinPublicKey,
      this.address,
      ...constructorArgs,
    );
    return manager.getContext().currentQueryContext.state;
  }

  private circuitFor(call: Call) {
    const contract = this.contracts[call.actor];
    if (contract === undefined) {
      throw new Error(`concurrency harness: unknown actor '${call.actor}'`);
    }
    const circuit = contract.impureCircuits[call.circuitId];
    if (circuit === undefined) {
      throw new Error(
        `concurrency harness: '${call.actor}' has no circuit '${call.circuitId}'`,
      );
    }
    return circuit;
  }
}

/** A harness that replays transcripts in memory. */
export function createDryHarness<P>(
  options: HarnessOptions<P>,
): DryReplayHarness<P> {
  return new DryReplayHarness(options);
}
