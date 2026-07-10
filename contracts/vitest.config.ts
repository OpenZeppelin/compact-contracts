import { configDefaults, defineConfig } from 'vitest/config';

/**
 * One config, one project per test flavour. Select with `--project <name>`:
 *
 *   - `unit`         — dry simulator run of the per-module specs (`src/**`).
 *   - `unit-live`    — the same specs against the local stack (`make env-up`),
 *                      via the live backend registered in `live.setup`. Driven
 *                      by `MIDNIGHT_BACKEND=live` (set by the `test:live` script).
 *   - `integration`  — composed-contract specs (`test/integration/specs`).
 *   - `harness`      — dry unit tests for the live harness itself (`test-utils`).
 *   - `harness-live` — live smoke that the real wallet pool funds + resolves on
 *                      the node, before the expensive contract live specs.
 *
 * Coverage is a root-level concern (applies to whichever project runs with
 * `--coverage`); the `unit` project is the one gated in CI.
 */

const NODE = { globals: true, environment: 'node' as const };
const ARCHIVE_EXCLUDE = [...configDefaults.exclude, 'src/archive/**'];
// Live projects: one funded genesis account + one node, so run sequentially
// (no nonce/UTXO races) with generous timeouts (real proofs + on-chain txs).
const LIVE = {
  fileParallelism: false,
  sequence: { concurrent: false },
  testTimeout: 600_000,
  hookTimeout: 300_000,
} as const;

export default defineConfig({
  test: {
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
    projects: [
      {
        test: {
          ...NODE,
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ARCHIVE_EXCLUDE,
        },
      },
      {
        test: {
          ...NODE,
          ...LIVE,
          name: 'unit-live',
          include: ['src/**/*.test.ts'],
          exclude: ARCHIVE_EXCLUDE,
          setupFiles: ['./test-utils/harness/live.setup.ts'],
        },
      },
      {
        test: {
          ...NODE,
          name: 'integration',
          include: ['test/integration/specs/**/*.spec.ts'],
        },
      },
      {
        test: {
          ...NODE,
          name: 'harness',
          include: ['test-utils/**/*.test.ts'],
        },
      },
      {
        // Same files as `harness`; `MIDNIGHT_BACKEND=live` (set by the
        // `test:harness:live` script) flips the `isLiveBackend()`-gated blocks
        // (e.g. the WalletPool live smoke) on. LIVE timeouts + sequential.
        test: {
          ...NODE,
          ...LIVE,
          name: 'harness-live',
          include: ['test-utils/**/*.test.ts'],
        },
      },
    ],
  },
});
