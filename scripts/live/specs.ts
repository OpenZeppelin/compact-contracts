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
 * glob of the vitest project that would run them. */
export function specFiles(target: string): string[] {
  return target === INTEGRATION
    ? specFilesIn(INTEGRATION_SPECS, CONTRACTS, INTEGRATION_SUFFIX)
    : specFilesIn(path.join(SRC, target), CONTRACTS, UNIT_SUFFIX);
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
