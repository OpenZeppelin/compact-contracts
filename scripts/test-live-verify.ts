import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Two-round live-test runner that separates real failures from environment
 * flakes. The live tests all run against one shared node, so state left by an
 * earlier test can make a later one fail (a coin re-spent against stale node
 * state is rejected with node "Custom error: 103"). A file that fails during a
 * busy full run may therefore pass in isolation on a fresh node.
 *
 *   Round 1: reset the stack, run the whole live suite (all workers). Collect
 *            the files that failed from the JSON reporter.
 *   Round 2: reset the stack again, re-run only those files, one worker.
 *
 * A file that fails round 1 but passes round 2 is FLAKY (an environment
 * artifact); a file that fails both is a REAL failure. Exit 0 unless there is a
 * real failure, so an env flake never turns the run red — but it is reported
 * loudly.
 *
 * Run: `corepack yarn test:live:verify [-- <file filters>]`. Node runs this .ts
 * directly (type stripping); it uses only `node:` builtins, no deps.
 */

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const CONTRACTS = path.join(REPO_ROOT, 'contracts');
const LOGS = path.join(REPO_ROOT, 'logs');
const VITEST = path.join(REPO_ROOT, 'node_modules', '.bin', 'vitest');
const VERIFY_LOCK = path.join(LOGS, '.live-verify.lock');
const R1_JSON = path.join(LOGS, 'live-verify-r1.json');
const R2_JSON = path.join(LOGS, 'live-verify-r2.json');

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

function banner(message: string): void {
  const rule = '═'.repeat(64);
  console.log(`\n${rule}\n${message}\n${rule}`);
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
      '--reporter=verbose',
      '--reporter=json',
      `--outputFile.json=${jsonPath}`,
      ...fileFilters,
    ],
    { ...process.env, MIDNIGHT_BACKEND: 'live', ...extraEnv },
    CONTRACTS,
  );
}

/** Absolute paths of the files that failed, or undefined if no report exists. */
function failedFiles(jsonPath: string): string[] | undefined {
  if (!existsSync(jsonPath)) return undefined;
  const report = JSON.parse(readFileSync(jsonPath, 'utf8')) as JsonReport;
  return (report.testResults ?? [])
    .filter((r) => r.status === 'failed')
    .map((r) => r.name);
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
        `another test:live:verify is already running (pid ${info.pid}, ` +
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
  return real.length === 0 ? 0 : 1;
}

async function main(): Promise<number> {
  const fileFilters = process.argv.slice(2).filter((a) => a !== '--');
  acquireVerifyLock();
  try {
    for (const f of [R1_JSON, R2_JSON]) rmSync(f, { force: true });

    banner('ROUND 1 — full live run on a fresh node');
    if (run('make', ['env-up']) !== 0) {
      console.log('env-up failed — cannot start round 1.');
      return 2;
    }
    if (run('corepack', ['yarn', 'test:harness:live']) !== 0) {
      console.log(
        '\nlive harness smoke (or compile) failed — this is an infrastructure ' +
          'problem, not a spec flake. Fix the stack and retry.',
      );
      return 2;
    }
    const r1Status = runLiveVitest(R1_JSON, fileFilters, {});
    const failed1 = failedFiles(R1_JSON);
    if (failed1 === undefined) {
      console.log(
        '\nround 1 produced no results file — unit-live was blocked ' +
          '(dirty node / lock) or crashed before finishing.',
      );
      return 2;
    }
    if (failed1.length === 0) {
      if (r1Status !== 0) {
        console.log(
          '\nround 1 exited non-zero but reported no failing files — ' +
            'aborting to be safe.',
        );
        return 2;
      }
      banner('VERDICT: PASSED — all live specs green on the first run.');
      return 0;
    }

    banner(`ROUND 1 found ${failed1.length} failing file(s)`);
    for (const f of failed1) console.log(`  ✗ ${rel(f)}`);

    banner('ROUND 2 — re-run only the failed files, fresh node, one worker');
    if (run('make', ['env-up']) !== 0) {
      console.log('env-up failed — cannot start round 2.');
      return 2;
    }
    runLiveVitest(R2_JSON, failed1, { MIDNIGHT_LIVE_WORKERS: '1' });
    const failed2 = failedFiles(R2_JSON);
    if (failed2 === undefined) {
      console.log('\nround 2 produced no results file — cannot classify.');
      return 2;
    }

    const real = failed1.filter((f) => failed2.includes(f));
    const flaky = failed1.filter((f) => !failed2.includes(f));
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
