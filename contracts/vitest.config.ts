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
      ],
      // Only TS sources are gated (95 % perFile). `.compact` coverage
      // is surfaced in the report for visibility but not gated:
      // compactc source maps are too noisy for thresholds to be
      // meaningful — pragmas count as uncovered functions, doc
      // comments and ledger declarations count as uncovered statements
      // / branches, and some files surface uncovered "line numbers"
      // past EOF. Tracking upstream:
      // https://github.com/LFDT-Minokawa/compact/issues/465
      thresholds: {
        perFile: true,
        '**/*.ts': {
          lines: 95,
          branches: 95,
          functions: 95,
          statements: 95,
        },
      },
    },
  },
});
