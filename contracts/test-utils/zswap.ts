/**
 * @description Test helpers for inspecting the Zswap inputs (coin spends /
 * nullifiers) and outputs (coin commitments) a circuit produces in the
 * simulator.
 *
 * The dry (in-memory) simulator does NOT enforce the ledger's nullifier set,
 * so it will happily let a circuit spend the same coin twice — a node would
 * reject that as a double spend. But the simulator DOES record every spend and
 * every created coin in the circuit's `currentZswapLocalState`. Reading that
 * lets a unit test catch a whole class of coin-handling bugs without a node:
 * in particular, a circuit that emits a change coin, immediately re-spends it
 * (revealing its nullifier), and then persists/returns that same coin as if it
 * were still spendable. See the `ShieldedTreasury` / `ForwarderPrivate`
 * "change coin is spendable" tests.
 */

type ShieldedCoinInfo = { nonce: Uint8Array; color: Uint8Array; value: bigint };

/** A coin consumed (spent) by a circuit; carries the Merkle-tree index. */
export type ZswapInput = ShieldedCoinInfo & { mt_index: bigint };

/** A coin produced by a circuit, together with its recipient. */
export type ZswapOutput = {
  coinInfo: ShieldedCoinInfo;
  recipient: {
    is_left: boolean;
    left: { bytes: Uint8Array };
    right: { bytes: Uint8Array };
  };
};

/** The coins consumed and produced so far in a simulator's session. */
export type ZswapLocalState = {
  inputs: ZswapInput[];
  outputs: ZswapOutput[];
};

/**
 * @description Reads the accumulated Zswap local state out of a simulator.
 *
 * The state accumulates across circuit calls in a session (it is only reset
 * when a per-call caller override is used), so callers that want the effect of
 * a single circuit invocation should snapshot lengths before the call and slice
 * off the newly appended entries (see {@link zswapDelta}).
 *
 * @param sim - A simulator produced by `createSimulator`.
 * @returns The current `{ inputs, outputs }`.
 */
export function zswapLocalState(sim: unknown): ZswapLocalState {
  // The circuit context lives on the wrapped synchronous simulator inside the
  // backend; the public simulator surface intentionally does not re-export it.
  const state = (
    sim as {
      _backend?: {
        sim?: { circuitContext?: { currentZswapLocalState?: ZswapLocalState } };
      };
    }
  )?._backend?.sim?.circuitContext?.currentZswapLocalState;
  if (!state) {
    throw new Error(
      'Could not read currentZswapLocalState from simulator. This helper ' +
        'targets the dry (in-memory) backend produced by createSimulator.',
    );
  }
  return state as ZswapLocalState;
}

/** Hex-encodes a byte string — handy for comparing coin/recipient bytes. */
export const bytesToHex = (b: Uint8Array): string =>
  Buffer.from(b).toString('hex');

const toHex = bytesToHex;

/**
 * @description Captures a snapshot of the current input/output counts so a
 * later {@link zswapDelta} can isolate the coins a single call produced.
 *
 * @param sim - A simulator produced by `createSimulator`.
 * @returns The counts to pass to {@link zswapDelta}.
 */
export function zswapSnapshot(sim: unknown): {
  inputs: number;
  outputs: number;
} {
  const { inputs, outputs } = zswapLocalState(sim);
  return { inputs: inputs.length, outputs: outputs.length };
}

/**
 * @description Returns the inputs and outputs appended since a snapshot — i.e.
 * the coins consumed and produced by the call(s) made in between.
 *
 * @param sim - A simulator produced by `createSimulator`.
 * @param snapshot - A snapshot from {@link zswapSnapshot} taken before the call.
 * @returns The newly added `{ inputs, outputs }`.
 */
export function zswapDelta(
  sim: unknown,
  snapshot: { inputs: number; outputs: number },
): ZswapLocalState {
  const { inputs, outputs } = zswapLocalState(sim);
  return {
    inputs: inputs.slice(snapshot.inputs),
    outputs: outputs.slice(snapshot.outputs),
  };
}

/**
 * @description Whether a coin with the given nonce appears among the spent
 * inputs. A coin a contract intends to keep (a stored or returned change coin)
 * must never be spent in the same transaction that creates it — if it is, its
 * nullifier is already revealed and a node rejects the next spend as a double
 * spend.
 *
 * @param inputs - The Zswap inputs to search (typically a {@link zswapDelta}).
 * @param nonce - The nonce of the coin that is supposed to remain unspent.
 * @returns `true` if the coin was spent.
 */
export function isNonceSpent(inputs: ZswapInput[], nonce: Uint8Array): boolean {
  const target = toHex(nonce);
  return inputs.some((i) => toHex(i.nonce) === target);
}
