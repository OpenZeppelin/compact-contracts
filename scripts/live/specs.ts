import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CONTRACTS, SRC } from './paths.ts';
import { INTEGRATION } from './targets.ts';

/**
 * Which spec files a live target would run, and which of them a file filter
 * selects.
 *
 * Two callers, one rule:
 *   - the runner resolves a file filter to the target's own matching files, so a
 *     filter cannot pull in another target's specs (vitest ORs positional
 *     filters, so passing the target directory *and* a name would run the whole
 *     target);
 *   - the CI plan job asks whether a filter matches anything under a target,
 *     since a target that runs no file is an infrastructure abort in the runner
 *     rather than a pass.
 */

const INTEGRATION_SPECS = path.join(CONTRACTS, 'test/integration/specs');

/** File suffix per live project: `unit-live` includes `src/**\/*.test.ts`,
 * `integration-live` the integration `*.spec.ts` (see vitest.config). */
const UNIT_SUFFIX = '.test.ts';
const INTEGRATION_SUFFIX = '.spec.ts';

/**
 * Directory `unit-live` excludes (`LIVE_EXCLUDE` in vitest.config).
 *
 * The witness specs build a fabricated `WitnessContext` and assert on the
 * private-state helpers directly, so a live backend changes nothing about them.
 * They have to be dropped HERE too, not just by vitest: a target-wide run let
 * vitest's own exclude filter them out silently, but CI gives each spec file its
 * own job, and a job whose only file is excluded matches nothing — which the
 * runner reports as an infrastructure abort, not a pass.
 */
const UNIT_EXCLUDED_DIR = `${path.sep}witnesses${path.sep}`;

/**
 * Spec files under `root`, as paths relative to `base`.
 *
 * Relative to `base` because that is what a vitest positional filter is matched
 * against: vitest runs a file when the filter appears anywhere in its path
 * relative to the project root, which for both live projects is `contracts/`.
 */
export function specFilesIn(
  root: string,
  base: string,
  suffix: string,
): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(suffix))
        found.push(path.relative(base, full));
    }
  };
  walk(root);
  return found.sort();
}

/** {@link specFilesIn} wired to where a target's specs live, matching the include
 * glob AND the exclude of the vitest project that would run them — a file this
 * reports has to be one that project actually runs. */
export function specFiles(target: string): string[] {
  if (target === INTEGRATION) {
    return specFilesIn(INTEGRATION_SPECS, CONTRACTS, INTEGRATION_SUFFIX);
  }
  return specFilesIn(path.join(SRC, target), CONTRACTS, UNIT_SUFFIX).filter(
    (file) => !file.includes(UNIT_EXCLUDED_DIR),
  );
}

/**
 * The files a set of vitest positional filters selects.
 *
 * Mirrors vitest's own rule: a **case-insensitive** substring of the path
 * relative to the project root (`TestProject.filterFiles`), ORed across filters.
 * Case matters here because a filter that works locally must not be rejected by
 * the plan job. `toLowerCase`, not vitest's `toLocaleLowerCase`, so the result
 * does not depend on the runner's locale.
 */
export function filterSpecFiles(
  files: readonly string[],
  filters: readonly string[],
): string[] {
  const wanted = filters.map((f) => f.toLowerCase());
  return files.filter((file) => {
    const lower = file.toLowerCase();
    return wanted.some((f) => lower.includes(f));
  });
}
