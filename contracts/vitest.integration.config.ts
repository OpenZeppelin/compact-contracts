import { configDefaults, defineConfig } from 'vitest/config';

// Integration specs compose multiple production modules into a single contract
// and drive them through the simulator. Kept separate from the unit `test`
// config (which scans `src/**/*.test.ts`).
//
// The `nativeShieldedToken/` subtree is a network suite (full proof loop
// against a live stack) and is excluded here — it runs under
// `vitest.integration-net.config.ts` via `test:integration:net`.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/integration/specs/**/*.spec.ts'],
    exclude: [
      ...configDefaults.exclude,
      'test/integration/specs/nativeShieldedToken/**',
    ],
    reporters: 'verbose',
  },
});
