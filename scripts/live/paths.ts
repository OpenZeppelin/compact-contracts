import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every filesystem location the live orchestrator touches, and the naming rules
 * for its report files. Pure data — no side effects, nothing read at import.
 */

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
export const CONTRACTS = path.join(REPO_ROOT, 'contracts');
export const SRC = path.join(CONTRACTS, 'src');
export const ARTIFACTS = path.join(CONTRACTS, 'artifacts');
/** Integration mocks compile into the same `artifacts/` tree as `src`, so the
 * truncated-key scan has to be told about them explicitly. */
export const INTEGRATION_MOCKS = path.join(
  CONTRACTS,
  'test/integration/_mocks',
);
export const LOGS = path.join(REPO_ROOT, 'logs');
export const TURBO_CACHE = path.join(REPO_ROOT, '.turbo', 'cache');
export const VITEST_BIN = path.join(
  REPO_ROOT,
  'node_modules',
  '.bin',
  'vitest',
);
export const PROGRESS_REPORTER = path.join(
  CONTRACTS,
  'test-utils/harness/liveProgressReporter.ts',
);
export const VERIFY_LOCK = path.join(LOGS, '.live-verify.lock');

/** Repo-relative path, for readable console output. */
export const rel = (abs: string): string => path.relative(REPO_ROOT, abs);

/** Round-1 JSON report for a target (one per target, kept for the whole run). */
export const round1Report = (target: string): string =>
  path.join(LOGS, `live-r1-${target}.json`);

export const ROUND2_REPORT_PREFIX = 'live-r2-';

/** Round-2 JSON report for one re-run file. Unit specs are `*.test.ts`,
 * integration specs `*.spec.ts` — both extensions are stripped. */
export const round2Report = (file: string): string =>
  path.join(
    LOGS,
    `${ROUND2_REPORT_PREFIX}${path
      .basename(file)
      .replace(/\.(test|spec)\.ts$/, '')}.json`,
  );
