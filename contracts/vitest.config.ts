import { configDefaults, defineConfig } from 'vitest/config';

/**
 * One config, one project per test flavour. Select with `--project <name>`:
 *
 *   - `unit`         — dry simulator run of the per-module specs (`src/**`).
 *   - `unit-live`    — the same specs against the local stack (`make env-up`),
 *                      via the live backend registered in `live.setup`. Driven
 *                      by `MIDNIGHT_BACKEND=live` (set by the `test:live` script).
 *   - `integration`  — composed-contract specs (`test/integration/specs`).
 *   - `integration-live` — the same specs against the local stack, through the
 *                      same harness as `unit-live`. Only the blocks a spec marks
 *                      `runIf(isLiveBackend())` run; see `test:live integration`.
 *   - `harness`      — dry unit tests for the live harness itself (`test-utils`).
 *   - `harness-live` — live smoke that the real wallet pool funds + resolves on
 *                      the node, before the expensive contract live specs.
 *   - `scripts`      — dry unit tests for the live orchestrator (`scripts/live`).
 *
 * Only ONE live project may run per vitest invocation: each derives its wallets
 * from `walletSeedsFor(VITEST_POOL_ID)`, so worker 1 of two live projects would
 * resolve to the same genesis deployer. `live.globalSetup` enforces this.
 *
 * Coverage is a root-level concern (applies to whichever project runs with
 * `--coverage`); the `unit` project is the one gated in CI.
 */

const NODE = { globals: true, environment: 'node' as const };
const ARCHIVE_EXCLUDE = [...configDefaults.exclude, 'src/archive/**'];

// Generous timeouts every live project shares (real proofs + on-chain finality
// are slow). Split out from the sequential/parallel knobs below.
const LIVE_TIMEOUTS = {
  testTimeout: 600_000,
  hookTimeout: 300_000,
} as const;

// Fully-sequential live run: no file parallelism, no concurrent tests. Used by
// `harness-live` (a single shared node, no per-worker wallet partition).
const LIVE_SEQUENTIAL = {
  ...LIVE_TIMEOUTS,
  fileParallelism: false,
  sequence: { concurrent: false },
} as const;

// `unit-live` parallelism. Each vitest worker drives a disjoint wallet
// partition (see WalletPool.walletSeedsFor), so up to MIDNIGHT_LIVE_WORKERS
// spec files run concurrently against the shared node. Tests WITHIN a file stay
// sequential (`sequence.concurrent: false`). Bounded by the 3 genesis-funded
// deployer seeds; forced to 1 when MIDNIGHT_WALLET_SEED pins a custom deployer
// (it would collide across workers).
const MAX_LIVE_WORKERS = 3;
const liveWorkers = process.env.MIDNIGHT_WALLET_SEED
  ? 1
  : Math.min(
      MAX_LIVE_WORKERS,
      Math.max(
        1,
        Number(process.env.MIDNIGHT_LIVE_WORKERS ?? MAX_LIVE_WORKERS) || 1,
      ),
    );

// Publish the resolved count as the process-wide fallback. Each live project
// ALSO sets it per-project below (see `liveWorkerCount`), because the two differ:
// a global value would make `integration-live` (one worker) print `w1/3`.
process.env.MIDNIGHT_LIVE_WORKERS = String(liveWorkers);

// Per-project worker total, handed to `live.setup` so its `w<n>/<total>` banner
// matches that project's own `maxWorkers` rather than `unit-live`'s.
const liveWorkerCount = (workers: number) => ({
  MIDNIGHT_LIVE_WORKERS: String(workers),
});

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
          ...LIVE_TIMEOUTS,
          name: 'unit-live',
          include: ['src/**/*.test.ts'],
          exclude: ARCHIVE_EXCLUDE,
          // Fail fast (before any wallet build) if the node is dirty or another
          // live run holds the lock. See `live.globalSetup`.
          globalSetup: ['./test-utils/harness/live.globalSetup.ts'],
          setupFiles: ['./test-utils/harness/live.setup.ts'],
          // Run up to `liveWorkers` spec files concurrently (fileParallelism
          // defaults to true). `groupOrder` keeps this project in its own
          // scheduler group: a multi-project run otherwise rejects two projects
          // that share a group but differ in `maxWorkers`.
          maxWorkers: liveWorkers,
          env: liveWorkerCount(liveWorkers),
          sequence: { concurrent: false, groupOrder: 1 },
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
        // Same files as `integration`, run with `MIDNIGHT_BACKEND=live` (set by
        // `test:live integration`). That turns on the `isLiveBackend()`-gated
        // blocks and skips the dry functional ones. Today the only live-gated
        // block is the composed-deploy block-limit canary.
        //
        // Reuses `unit-live`'s globalSetup (freshness + run lock) and setup
        // (wallet pool + backend register) verbatim.
        test: {
          ...NODE,
          ...LIVE_TIMEOUTS,
          name: 'integration-live',
          include: ['test/integration/specs/**/*.spec.ts'],
          globalSetup: ['./test-utils/harness/live.globalSetup.ts'],
          setupFiles: ['./test-utils/harness/live.setup.ts'],
          // Only the deployer wallet is in play (the canary is a single rejected
          // deploy, no `.as(alias)` impersonation), so no wallet partition is
          // needed. Widen to `unit-live`-style per-worker partitioning once
          // green functional live integration specs exist.
          maxWorkers: 1,
          env: liveWorkerCount(1),
          // Own scheduler group: `unit-live` holds group 1 with a different
          // `maxWorkers`, and a multi-project run rejects two projects that
          // share a group but differ in it.
          sequence: { concurrent: false, groupOrder: 2 },
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
          ...LIVE_SEQUENTIAL,
          name: 'harness-live',
          include: ['test-utils/**/*.test.ts'],
          globalSetup: ['./test-utils/harness/live.globalSetup.ts'],
        },
      },
      {
        // Dry unit tests for the live-orchestrator services (scripts/live). The
        // scripts tree sits at the repo root, one level above this config's
        // root, hence the `../` include. A per-project `root: '..'` override was
        // tried first and discovered no files under vitest 4.1.10.
        test: {
          ...NODE,
          name: 'scripts',
          include: ['../scripts/**/*.test.ts'],
        },
      },
    ],
  },
});
