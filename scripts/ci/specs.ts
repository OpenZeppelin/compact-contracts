import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CONTRACTS, SRC } from '../live/paths.ts';
import { INTEGRATION } from '../live/targets.ts';

/**
 * Which spec files a live target would run.
 *
 * Only used to answer one question in the plan job: does a requested file filter
 * match anything under this target? A target where it matches nothing must not
 * get a job, because the runner treats "nothing ran" as an infrastructure abort
 * (exit 2, after `env-up` and a compile) rather than a pass.
 */

const INTEGRATION_SPECS = path.join(CONTRACTS, 'test/integration/specs');

/** Both live projects' file conventions: `*.test.ts` under `src/<category>`,
 * `*.spec.ts` under the integration specs. */
const SPEC_SUFFIXES = ['.test.ts', '.spec.ts'];

/**
 * Spec files under `root`, as paths relative to `base`.
 *
 * Relative to `base` because that is what a vitest positional filter is matched
 * against: vitest runs a file when the filter appears anywhere in its path
 * relative to the project root, which for both live projects is `contracts/`.
 */
export function specFilesIn(root: string, base: string): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (SPEC_SUFFIXES.some((s) => entry.name.endsWith(s))) {
        found.push(path.relative(base, full));
      }
    }
  };
  walk(root);
  return found.sort();
}

/** {@link specFilesIn} wired to where a target's specs actually live. */
export function specFiles(target: string): string[] {
  const root =
    target === INTEGRATION ? INTEGRATION_SPECS : path.join(SRC, target);
  return specFilesIn(root, CONTRACTS);
}
