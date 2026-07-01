import { configDefaults, defineConfig } from 'vitest/config';

// Network integration specs for the native shielded token. Unlike the
// simulator-only `vitest.integration.config.ts` suite, these drive the full
// prove -> verify -> apply loop against the local stack (proof-server +
// indexer + node) brought up by `make env-up` / `local-env.yml`.
//
// Kept separate so the simulator integration suite (`test:integration`) needs
// no running node.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/integration/specs/nativeShieldedToken/**/*.spec.ts'],
    exclude: [...configDefaults.exclude],
    reporters: 'verbose',
    // One funded genesis wallet and one local node are shared across specs —
    // run one file at a time so nonces and wallet UTXOs don't race.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 180_000,
    hookTimeout: 300_000,
    // Stop the process-shared `WalletPool` once the suite finishes.
    globalSetup: ['./test/integration/_harness/globalTeardown.ts'],
  },
});
