import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../live/paths.ts';

/**
 * Each `compile:*` task owns one artifact subtree: its turbo `outputs` name
 * it, and its script clears it, then compiles into it. Two tasks sharing a
 * path race over it through the cache, and an orphan left in the tree is
 * packed into the cache with the rest.
 */

const TURBO = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'turbo.json'), 'utf8'),
) as { tasks: Record<string, { outputs?: string[] }> };

const SCRIPTS = (
  JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'contracts/package.json'), 'utf8'),
  ) as { scripts: Record<string, string> }
).scripts;

const TASKS = Object.keys(TURBO.tasks).filter((t) => t.startsWith('compile:'));

/** The subtree a task's outputs name, when they are one `artifacts/<slice>/**`. */
const slice = (task: string): string | undefined => {
  const outputs = TURBO.tasks[task].outputs ?? [];
  return outputs.length === 1
    ? /^artifacts\/([^/*]+)\/\*\*$/.exec(outputs[0])?.[1]
    : undefined;
};

const flag = (argv: string[], name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};

/** Whether a `compact-compiler` call writes only under `artifacts/<slice>`. */
const compilesInto = (argv: string[], into: string): boolean => {
  if (!argv.includes('--hierarchical')) return false;
  const dir = flag(argv, '--dir');
  if (dir !== undefined) return dir === into || dir.startsWith(`${into}/`);
  return flag(argv, '--out') === `artifacts/${into}`;
};

describe('compile task outputs', () => {
  it.each(TASKS)('%s names one artifact subtree', (task) => {
    expect(slice(task)).toBeDefined();
  });

  it('gives every task a subtree of its own', () => {
    const slices = TASKS.map(slice);

    expect(new Set(slices).size).toBe(slices.length);
  });

  it.each(TASKS)('%s clears its subtree, then compiles into it', (task) => {
    const into = slice(task) as string;
    const [clear, ...compiles] = SCRIPTS[task]
      .split('&&')
      .map((call) => call.trim().split(' '));

    expect(clear).toStrictEqual(['rm', '-rf', `artifacts/${into}`]);
    expect(compiles.length).toBeGreaterThan(0);
    expect(compiles.filter((argv) => !compilesInto(argv, into))).toStrictEqual(
      [],
    );
  });
});
