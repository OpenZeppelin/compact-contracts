import { defineConfig } from 'vitest/config';

// Integration specs compose multiple production modules into a single contract
// and drive them through the simulator. Kept separate from the unit `test`
// config (which scans `src/**/*.test.ts`).
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/integration/specs/**/*.spec.ts'],
    reporters: 'verbose',
  },
});
