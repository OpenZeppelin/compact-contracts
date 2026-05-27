import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'src/archive/**'],
    reporters: 'verbose',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/**/witnesses/*.ts',
        'src/**/test/simulators/*.ts',
        // Include compactc-generated JS so v8 can map executed lines
        // back to .compact source via the index.js.map files. The
        // forwarder presets are the focus here; expand as needed.
        'artifacts/ForwarderShielded/contract/index.js',
        'artifacts/ForwarderUnshielded/contract/index.js',
        'artifacts/ForwarderPrivate/contract/index.js',
      ],
      exclude: [
        ...(configDefaults.coverage?.exclude ?? []),
        'src/archive/**',
        'src/**/test/*.test.ts',
      ],
      // 95 % per-file is the closing gate of the test stage. Leaves
      // room for unavoidable TS-plumbing gaps (simulator factory
      // callbacks, witness stub bodies) without contorting tests
      // around test infrastructure. Subset runs (e.g.
      // `vitest run <one.test.ts>`) fail this gate — pass
      // `--coverage.thresholds.lines=0` etc. when iterating on one file.
      thresholds: {
        perFile: true,
        lines: 95,
        branches: 95,
        functions: 95,
        statements: 95,
      },
    },
  },
});
