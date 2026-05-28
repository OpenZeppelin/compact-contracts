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
        'src/**/witnesses/**/*.ts',
        'src/**/test/simulators/**/*.ts',
        // compactc-generated JS for every compiled contract.
        'artifacts/*/contract/index.js',
      ],
      exclude: [
        ...(configDefaults.coverage?.exclude ?? []),
        'src/archive/**',
        'src/**/test/**/*.test.ts',
        // Drop `.compact` after source-map remap: compactc emits
        // function-entry-granularity maps, so branch / line attribution
        // on `.compact` lines is unreliable even when both legs of an
        // `if` are exercised. Tracking upstream:
        // https://github.com/LFDT-Minokawa/compact/issues/465
        'src/**/*.compact',
      ],
      excludeAfterRemap: true,
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
