import { resetSharedWalletPool } from '../fixtures/walletPool.js';

// Wired into `vitest.integration.config.ts` as a `globalSetup` entry.
// Vitest invokes the default export once before the whole suite (no setup
// work needed) and the returned function once after every spec finishes —
// at which point we stop every wallet the process-shared pool built so
// their indexer/node websocket subscriptions close cleanly. Without this
// the suite exits with dangling sockets and a noisy "subscribeRuntimeVersion
// disconnected" line per wallet.
export default async function setup(): Promise<() => Promise<void>> {
  return async () => {
    await resetSharedWalletPool();
  };
}
