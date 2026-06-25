import { configDefaults, defineConfig } from 'vitest/config';

// Live-backend run of the unit specs against the local stack (`make env-up`).
// Same spec files as the default dry `test`; only the backend (via
// `MIDNIGHT_BACKEND=live`) and this config differ — each `await Sim.create()`
// deploys + attaches a real contract through the registered live harness.
//
// Single fork + no parallelism: every deploy is signed by the one genesis-funded
// account, so specs must run sequentially to avoid nonce races. Generous
// timeouts: each deploy + impure call is a real proof + on-chain tx.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'src/archive/**'],
    setupFiles: ['./test/integration/_harness/live.setup.ts'],
    reporters: 'verbose',
    testTimeout: 180_000,
    hookTimeout: 300_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
