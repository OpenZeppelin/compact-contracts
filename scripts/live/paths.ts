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
export const INTEGRATION_MOCKS = path.join(
  CONTRACTS,
  'test/integration/_mocks',
);
/** `compile:integration` builds the integration mocks here (`--out`). */
export const INTEGRATION_ARTIFACTS = path.join(ARTIFACTS, 'integration');

/** A source tree and the artifact tree it compiles into. The compiler runs
 * with `--hierarchical`, so `<src>/<rel>.compact` builds `<artifacts>/<rel>/`. */
export interface ArtifactRoot {
  readonly src: string;
  readonly artifacts: string;
}
export const LOGS = path.join(REPO_ROOT, 'logs');
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
