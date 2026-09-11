/**
 * Block-time control for the dry backend.
 *
 * `blockTimeLt` and `blockTimeGte` compile to a query against the block info in
 * the simulator's `QueryContext`, reading its `secondsSinceEpoch`. The dry
 * backend initializes that to `0` and never advances it, so a spec that needs a
 * particular chain time sets it here.
 *
 * DRY ONLY. The live backend holds no in-memory context to write to (the node
 * supplies the real block time) so `setBlockTime` throws there rather than
 * silently doing nothing. Gate callers with `skipIf(isLiveBackend())`.
 *
 * The context is reached through fields the simulator package does not export,
 * so this is coupled to its internals. Every step of that reach is checked, and
 * the write is read back afterwards, so a shape change throws.
 */

type BlockInfo = { secondsSinceEpoch: bigint };
type QueryContext = { block: BlockInfo };
type DrySimulator = {
  _backend?: {
    sim?: {
      circuitContext?: {
        currentQueryContext?: QueryContext;
      };
    };
  };
};

function queryContext(sim: unknown): QueryContext {
  const qc = (sim as DrySimulator)._backend?.sim?.circuitContext
    ?.currentQueryContext;
  if (qc === undefined) {
    throw new Error(
      'setBlockTime: no in-memory query context. This is dry-only; gate the spec with skipIf(isLiveBackend()).',
    );
  }

  // Reaching the context proves nothing about the field being written. Check
  // the shape too, or a rename downstream of `currentQueryContext` turns the
  // write into a no-op instead of an error.
  const block = (qc as { block?: { secondsSinceEpoch?: unknown } }).block;
  if (typeof block?.secondsSinceEpoch !== 'bigint') {
    throw new Error(
      'setBlockTime: the query context has no bigint `block.secondsSinceEpoch`. ' +
        "The simulator's internal shape has changed; update this fixture.",
    );
  }
  return qc;
}

/**
 * Sets the block time the dry backend reports to circuits. Persists across
 * subsequent circuit calls on the same simulator.
 *
 * @param sim - A dry-backend simulator instance.
 * @param secondsSinceEpoch - The chain time to report.
 */
export function setBlockTime(sim: unknown, secondsSinceEpoch: bigint): void {
  const qc = queryContext(sim);
  qc.block = { ...qc.block, secondsSinceEpoch };

  // `block` is backed by a wasm object, so an assignment that is dropped would
  // be invisible. Read it back rather than assume it landed.
  if (qc.block.secondsSinceEpoch !== secondsSinceEpoch) {
    throw new Error(
      `setBlockTime: wrote ${secondsSinceEpoch} but the context reports ` +
        `${qc.block.secondsSinceEpoch}. The write did not take effect.`,
    );
  }
}
