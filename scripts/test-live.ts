import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyKeyArtifacts } from './keyIntegrity.ts';

/**
 * Live-test orchestrator: runs each category (`src/<category>`) sequentially,
 * each on a freshly reset node, then verifies any failures with a second round.
 *
 * The live tests all run against one shared node, so state left by an earlier
 * test can make a later one fail (a coin re-spent against stale node state is
 * rejected with node "Custom error: 103"). A file that fails during a busy full
 * run may therefore pass in isolation on a fresh node. Hence two rounds:
 *
 *   Round 1: compile + harness smoke once, then per category: reset the stack
 *            and run that category's files (parallel workers). Collect the
 *            files that failed from the JSON reporter.
 *   Round 2: for each failed file, reset the stack and re-run just that file
 *            on its own (one worker), so no earlier round-2 file can dirty the
 *            node under a later one.
 *
 * A file that fails round 1 but passes round 2 is FLAKY (an environment
 * artifact); one that fails both — or never reports in round 2 — is a REAL
 * failure. Exit 0 unless there is a real failure, so an env flake never turns
 * the run red — but it is reported loudly.
 *
 * Why a script and not turbo tasks: turbo models a DAG of stateless,
 * cacheable tasks, and a live run needs stateful orchestration that a task
 * graph cannot express:
 *   - the two-round flake classification above (re-run failures, classify,
 *     exit 0 on flaky-only);
 *   - docker lifecycle between categories and rounds (`make env-up`) against
 *     ONE shared node — parallel turbo tasks would race over it;
 *   - ZK-key integrity self-heal (turbo's own poisoned cache, #675);
 *   - infra-vs-test exit codes (2 vs 1), the pid lock, CI verdict summaries.
 * Turbo still runs where the DAG helps: the compile and harness-smoke steps
 * below go through it (cached keygen, dependency ordering).
 *
 * Usage (via the root package.json scripts):
 *   yarn test:live                     # every live-ready category
 *   yarn test:live multisig            # one category
 *   yarn test:live multisig Forwarder  # files within a category
 *   yarn test:live --list              # live-ready categories (JSON)
 *
 * Node runs this .ts directly (type stripping); only `node:` builtins.
 */

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const CONTRACTS = path.join(REPO_ROOT, 'contracts');
const SRC = path.join(CONTRACTS, 'src');
const LOGS = path.join(REPO_ROOT, 'logs');
const VITEST = path.join(REPO_ROOT, 'node_modules', '.bin', 'vitest');
const PROGRESS_REPORTER = path.join(
  CONTRACTS,
  'test-utils/harness/liveProgressReporter.ts',
);
const VERIFY_LOCK = path.join(LOGS, '.live-verify.lock');

// `archive` is excluded from the unit/unit-live projects (see vitest.config).
const EXCLUDED_CATEGORIES = new Set(['archive']);

// Categories whose specs have been refactored for the live backend. The others
// still assume dry-only semantics (e.g. `.as()` identities derived from alias
// labels, which the live wallet pool cannot impersonate) and join this list as
// they are refactored, PR by PR.
const LIVE_READY = new Set(['multisig']);

interface JsonTestResult {
  readonly name: string;
  readonly status: string;
}
interface JsonReport {
  readonly testResults?: readonly JsonTestResult[];
}
interface LockInfo {
  readonly pid: number;
  readonly startedAt: string;
}

const rel = (abs: string): string => path.relative(REPO_ROOT, abs);
const r1Json = (category: string): string =>
  path.join(LOGS, `live-r1-${category}.json`);
const r2Json = (file: string): string =>
  path.join(
    LOGS,
    `live-r2-${path.basename(file).replace(/\.test\.ts$/, '')}.json`,
  );

function banner(message: string): void {
  const rule = '═'.repeat(64);
  console.log(`\n${rule}\n${message}\n${rule}`);
}

/** Append markdown to the GitHub Actions job summary (no-op outside CI). */
function appendJobSummary(markdown: string): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  appendFileSync(summaryPath, `${markdown}\n`);
}

/** Emit a GitHub Actions warning annotation (no-op outside CI). */
function ciWarn(file: string, message: string): void {
  if (process.env.GITHUB_ACTIONS !== 'true') return;
  console.log(`::warning file=${file}::${message}`);
}

/** `src/` subdirectories that contain test files (future categories join
 * automatically; no hardcoded list to maintain). */
function liveCategories(): string[] {
  const hasTests = (dir: string): boolean =>
    readdirSync(dir, { withFileTypes: true }).some((entry) =>
      entry.isDirectory()
        ? hasTests(path.join(dir, entry.name))
        : entry.name.endsWith('.test.ts'),
    );
  return readdirSync(SRC, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !EXCLUDED_CATEGORIES.has(d.name))
    .map((d) => d.name)
    .filter((name) => hasTests(path.join(SRC, name)))
    .sort();
}

/** Run a command with inherited stdio (streams live). Returns its exit status. */
function run(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = REPO_ROOT,
): number {
  const res = spawnSync(cmd, args, { cwd, env, stdio: 'inherit' });
  if (res.error) {
    console.log(`could not run ${cmd}: ${res.error.message}`);
    return 1;
  }
  return res.status ?? 1;
}

function runLiveVitest(
  jsonPath: string,
  fileFilters: string[],
  extraEnv: Record<string, string>,
): number {
  return run(
    VITEST,
    [
      'run',
      '--project',
      'unit-live',
      // A category filtered down to zero matching files is a pass, not an error.
      '--passWithNoTests',
      // `default` prints one line per file (piped) plus failures/summary; the
      // progress reporter adds the worker-tagged, counted per-test line.
      '--reporter=default',
      `--reporter=${PROGRESS_REPORTER}`,
      '--reporter=json',
      `--outputFile.json=${jsonPath}`,
      ...fileFilters,
    ],
    { ...process.env, MIDNIGHT_BACKEND: 'live', ...extraEnv },
    CONTRACTS,
  );
}

/** name → status for every file in the report, or undefined if none exists. */
function fileStatuses(jsonPath: string): Map<string, string> | undefined {
  if (!existsSync(jsonPath)) return undefined;
  const report = JSON.parse(readFileSync(jsonPath, 'utf8')) as JsonReport;
  return new Map(
    (report.testResults ?? []).map((r) => [r.name, r.status] as const),
  );
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readLock(): LockInfo | undefined {
  try {
    return JSON.parse(readFileSync(VERIFY_LOCK, 'utf8')) as LockInfo;
  } catch {
    return undefined;
  }
}

function acquireVerifyLock(): void {
  mkdirSync(LOGS, { recursive: true });
  const stamp = JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });
  try {
    writeFileSync(VERIFY_LOCK, stamp, { flag: 'wx' });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    const info = readLock();
    if (info && pidAlive(info.pid)) {
      throw new Error(
        `another test:live run is already in progress (pid ${info.pid}, ` +
          `started ${info.startedAt}). Wait for it, or remove ${VERIFY_LOCK}.`,
      );
    }
    writeFileSync(VERIFY_LOCK, stamp); // stale — reclaim
  }
}

function releaseVerifyLock(): void {
  if (readLock()?.pid === process.pid) {
    try {
      unlinkSync(VERIFY_LOCK);
    } catch {
      // already gone
    }
  }
}

const truncatedKeys = (): string[] =>
  emptyKeyArtifacts(path.join(CONTRACTS, 'artifacts'), SRC);

/**
 * Compile, then verify no truncated (0-byte) ZK key was left behind. A killed
 * compile (or machine crash) can poison the turbo cache so that every later
 * cache hit re-extracts a truncated key, and a concurrent compile racing this
 * one over the shared `artifacts/` tree can truncate keys directly
 * (OpenZeppelin/compact-contracts#675). Both repairs are mechanical, so
 * self-heal once — drain the cache and recompile serially (a parallel
 * recompile can re-poison it) — and only abort if keys are still truncated
 * after the rebuild.
 */
function compileVerified(): boolean {
  if (run('yarn', ['compile']) !== 0) {
    console.log('compile failed — a compile error is real, not a flake.');
    return false;
  }
  const empty = truncatedKeys();
  if (empty.length === 0) return true;

  console.log(
    '\ncompile reported success but left truncated (0-byte) ZK key(s):',
  );
  for (const k of empty) console.log(`  ✗ ${rel(k)}`);
  console.log(
    '\nPoisoned turbo cache or artifact tree ' +
      '(OpenZeppelin/compact-contracts#675) — draining the cache and ' +
      'recompiling serially...',
  );
  rmSync(path.join(REPO_ROOT, '.turbo', 'cache'), {
    recursive: true,
    force: true,
  });
  if (run('yarn', ['compile', '--concurrency=1']) !== 0) {
    console.log('serial recompile failed.');
    return false;
  }
  const stillEmpty = truncatedKeys();
  if (stillEmpty.length === 0) {
    console.log('recovered — ZK keys intact after the serial recompile.');
    return true;
  }
  console.log(
    '\nstill truncated after a serial recompile — needs investigation:',
  );
  for (const k of stillEmpty) console.log(`  ✗ ${rel(k)}`);
  return false;
}

function reportVerdict(flaky: string[], real: string[]): number {
  const headline =
    real.length === 0
      ? `VERDICT: PASSED${flaky.length ? ` (with ${flaky.length} flaky file(s))` : ''}`
      : `VERDICT: FAILED — ${real.length} real failure(s), ${flaky.length} flaky`;
  banner(headline);
  if (flaky.length > 0) {
    console.log('\nFLAKY (failed round 1, passed round 2 on a fresh node):');
    for (const f of flaky) console.log(`  ~ ${rel(f)}`);
  }
  if (real.length > 0) {
    console.log('\nREAL (failed both rounds — investigate):');
    for (const f of real) console.log(`  ✗ ${rel(f)}`);
  }
  // A flaky-only run exits 0, so without these a green CI run would swallow
  // the flake report entirely.
  for (const f of flaky) {
    ciWarn(
      rel(f),
      'flaky live spec — failed round 1, passed round 2 on a fresh node',
    );
  }
  appendJobSummary(
    [
      `### ${headline}`,
      ...(flaky.length > 0
        ? [
            '',
            'Flaky (failed round 1, passed round 2 on a fresh node):',
            ...flaky.map((f) => `- ~ \`${rel(f)}\``),
          ]
        : []),
      ...(real.length > 0
        ? [
            '',
            'Real failures (failed both rounds — investigate):',
            ...real.map((f) => `- ✗ \`${rel(f)}\``),
          ]
        : []),
    ].join('\n'),
  );
  return real.length === 0 ? 0 : 1;
}

async function main(): Promise<number> {
  // `--list` prints the live-ready categories as JSON and exits — CI derives
  // its per-category matrix from this, so LIVE_READY stays the single source
  // of truth.
  if (process.argv.includes('--list')) {
    console.log(
      JSON.stringify(liveCategories().filter((c) => LIVE_READY.has(c))),
    );
    return 0;
  }
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const allCategories = liveCategories();
  // First arg naming a category (the test:live:<category> scripts pass one)
  // scopes the run; everything else is a vitest file filter.
  const scoped = args.length > 0 && allCategories.includes(args[0]);
  if (scoped && !LIVE_READY.has(args[0])) {
    console.log(
      `'${args[0]}' is not live-ready yet — its specs still assume dry-only ` +
        `semantics. Ready categories: ${[...LIVE_READY].join(', ')}.`,
    );
    return 2;
  }
  const categories = scoped
    ? [args[0]]
    : allCategories.filter((c) => LIVE_READY.has(c));
  const skipped = scoped ? [] : allCategories.filter((c) => !LIVE_READY.has(c));
  const fileFilters = scoped ? args.slice(1) : args;

  acquireVerifyLock();
  try {
    for (const c of categories) rmSync(r1Json(c), { force: true });
    if (existsSync(LOGS)) {
      for (const f of readdirSync(LOGS)) {
        if (f.startsWith('live-r2-') && f.endsWith('.json')) {
          rmSync(path.join(LOGS, f), { force: true });
        }
      }
    }

    banner(
      `ROUND 1 — categories: ${categories.join(', ')}` +
        (fileFilters.length ? ` (filter: ${fileFilters.join(' ')})` : ''),
    );
    if (skipped.length > 0) {
      console.log(`skipped (not yet live-ready): ${skipped.join(', ')}`);
    }
    if (!compileVerified()) return 2;
    if (run('make', ['env-up']) !== 0) {
      console.log('env-up failed — cannot start the live stack.');
      return 2;
    }
    if (run('yarn', ['test:harness:live']) !== 0) {
      console.log(
        '\nlive harness smoke failed — this is an infrastructure problem, ' +
          'not a spec flake. Fix the stack and retry.',
      );
      return 2;
    }

    // Each category gets a freshly reset node: smaller coin tree, no
    // cross-category state interactions. The smoke above already validated the
    // stack, and its only on-chain footprint (NIGHT/dust) does not trip the
    // freshness guard — so the first category reuses its node.
    const failed: string[] = [];
    for (const [i, category] of categories.entries()) {
      banner(`ROUND 1 · ${category} (${i + 1}/${categories.length})`);
      if (i > 0 && run('make', ['env-up']) !== 0) {
        console.log(`env-up failed before '${category}'.`);
        return 2;
      }
      // vitest ORs positional filters, so passing the category dir *and* a name
      // filter would match the whole category (every file is under the dir).
      // Use the name filters when given — they scope to the matching files;
      // otherwise the category dir runs the whole set.
      const round1Filters =
        fileFilters.length > 0 ? fileFilters : [`src/${category}`];
      const status = runLiveVitest(r1Json(category), round1Filters, {});
      const statuses = fileStatuses(r1Json(category));
      if (statuses === undefined) {
        console.log(
          `\n'${category}' produced no results file — the run was blocked ` +
            '(dirty node / lock) or crashed before finishing.',
        );
        return 2;
      }
      const categoryFailed = [...statuses.entries()]
        .filter(([, s]) => s === 'failed')
        .map(([name]) => name);
      if (status !== 0 && categoryFailed.length === 0) {
        console.log(
          `\n'${category}' exited non-zero without reporting failing files — ` +
            'aborting to be safe.',
        );
        return 2;
      }
      failed.push(...categoryFailed);
      console.log(
        `\n${category}: ${statuses.size} file(s), ${categoryFailed.length} failed`,
      );
    }

    if (failed.length === 0) {
      banner('VERDICT: PASSED — all live specs green on the first run.');
      appendJobSummary(
        '### VERDICT: PASSED — all live specs green on the first run.',
      );
      return 0;
    }

    banner(`ROUND 1 found ${failed.length} failing file(s)`);
    for (const f of failed) console.log(`  ✗ ${rel(f)}`);

    banner('ROUND 2 — re-run each failed file alone on a fresh node');
    // Reset the node before each file so state left by an earlier round-2 file
    // can never fail a later one (which would misclassify a flake as REAL).
    const round2 = new Map<string, string>();
    for (const [i, file] of failed.entries()) {
      banner(`ROUND 2 · ${rel(file)} (${i + 1}/${failed.length})`);
      if (run('make', ['env-up']) !== 0) {
        console.log(`env-up failed before round 2 of '${rel(file)}'.`);
        return 2;
      }
      const jsonPath = r2Json(file);
      runLiveVitest(jsonPath, [file], { MIDNIGHT_LIVE_WORKERS: '1' });
      const statuses = fileStatuses(jsonPath);
      if (statuses === undefined) {
        console.log(
          `\nround 2 produced no results for '${rel(file)}' — cannot classify.`,
        );
        return 2;
      }
      // No entry means the file crashed without reporting; treat as not-passed.
      round2.set(file, statuses.get(file) ?? 'failed');
    }

    // Only an explicit round-2 pass demotes a failure to FLAKY; a file that
    // failed again — or never reported (crashed) — stays REAL.
    const flaky = failed.filter((f) => round2.get(f) === 'passed');
    const real = failed.filter((f) => round2.get(f) !== 'passed');
    return reportVerdict(flaky, real);
  } finally {
    releaseVerifyLock();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.log(e instanceof Error ? e.message : String(e));
    process.exit(2);
  });
