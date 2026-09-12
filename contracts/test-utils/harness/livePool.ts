import type { WalletPool } from './WalletPool.js';

/**
 * The worker's live {@link WalletPool}, published by `live.setup` once its
 * wallets are built and readable by any spec in the same worker.
 *
 * Specs that deploy through the simulator never need this — `Sim.create()`
 * routes to the pool inside {@link LiveSimulatorBackend}. It exists for the
 * few that must hold a raw midnight-js `DeployedContract` (CMA maintenance
 * txs), which the simulator's `LiveContext` does not expose. Borrowing the
 * built wallets keeps those specs on the same UTXO view as everything else;
 * a second wallet on the same seed would race it.
 */

let pool: WalletPool | undefined;

/** Publish the worker's pool. Called by `live.setup` after `ensureReady()`. */
export function publishLivePool(livePool: WalletPool): void {
  pool = livePool;
}

/** Clear the published pool (for the harness' own unit tests). */
export function clearLivePool(): void {
  pool = undefined;
}

/** The worker's pool, or a pointer to the missing live setup. */
export function requireLivePool(): WalletPool {
  if (!pool) {
    throw new Error(
      'live wallet pool not published — this spec needs MIDNIGHT_BACKEND=live ' +
        'and a project whose setupFiles include live.setup.ts',
    );
  }
  return pool;
}
