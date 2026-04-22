import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/integration/**/*.{spec,prop}.ts'],
    exclude: [...configDefaults.exclude],
    reporters: 'verbose',
    // Integration tests share one funded genesis wallet and one local node —
    // run one file at a time so nonces and wallet UTXOs don't race.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 180_000,
    hookTimeout: 300_000,
  },
});
