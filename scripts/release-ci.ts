import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  changelogVerdict,
  contractChange,
  PACKAGE_JSON,
  releaseNotes,
  rollUnreleased,
  unreleasedEntries,
} from './ci/changelog.ts';
import { spawnCapture } from './ci/gh.ts';
import { REPO_ROOT } from './live/paths.ts';

/**
 * The `CHANGELOG.md` steps of the release flow.
 *
 * The workflows call this instead of embedding the logic in `run:` blocks,
 * where it is unreachable from a test and unrunnable locally. The rules live in
 * `scripts/ci/changelog.ts` (pure); their tests are in `scripts/ci/test/`
 * (`yarn test:scripts`).
 *
 * Usage, with the inputs each command reads from the environment:
 *   node scripts/release-ci.ts roll-changelog   # NEW_VERSION, ALLOW_EMPTY
 *   node scripts/release-ci.ts release-notes    # VERSION, NOTES_FILE
 *   node scripts/release-ci.ts changelog-check  # SKIP_CHANGELOG, HEAD_REF
 *
 * `roll-changelog` runs in `prepare-release.yml`, `release-notes` in
 * `create-release.yml`, `changelog-check` in `changelog.yml`.
 *
 * Node runs this .ts directly (type stripping) and it imports only `node:`
 * builtins, so the jobs that call it need a checkout and a Node, not an install.
 *
 * Exit codes: 0 done, 1 a bad input, a failed rule, or a failed `git` call.
 */

const USAGE =
  'usage: node scripts/release-ci.ts <roll-changelog|release-notes|changelog-check>';

const CHANGELOG = path.join(REPO_ROOT, 'CHANGELOG.md');

/** A required input. Missing one is a workflow bug, so it fails the step rather
 * than defaulting to something plausible. */
function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** An optional input. Absent and empty mean the same thing: a `workflow_dispatch`
 * input is an empty string on every other trigger. */
function optionalEnv(name: string): string {
  return process.env[name] ?? '';
}

/** Roll `## Unreleased` into the bump's version section, dated today (UTC). */
function rollChangelog(): number {
  const version = env('NEW_VERSION');
  const result = rollUnreleased(readFileSync(CHANGELOG, 'utf8'), {
    version,
    date: new Date().toISOString().slice(0, 10),
    allowEmpty: optionalEnv('ALLOW_EMPTY') === 'true',
  });
  if (!result.ok) {
    console.log(result.message);
    return 1;
  }
  writeFileSync(CHANGELOG, result.text);
  console.log(`rolled ## Unreleased into ## ${version}.`);
  return 0;
}

/** Write the version's section to NOTES_FILE for `gh release create`. */
function notes(): number {
  const result = releaseNotes(readFileSync(CHANGELOG, 'utf8'), env('VERSION'));
  if (!result.ok) {
    console.log(result.message);
    return 1;
  }
  writeFileSync(env('NOTES_FILE'), result.notes ? `${result.notes}\n` : '');
  return 0;
}

/** stdout of a `git` call in the repo. A failure throws, which fails the step:
 * a guessed answer would let the check pass or fail for the wrong reason. */
function git(...args: string[]): string {
  const result = spawnCapture('git', ['-C', REPO_ROOT, ...args]);
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

/** Both sides of `file` across the PR, or `undefined` when the PR leaves it
 * alone. */
function bothSides(
  changed: readonly string[],
  file: string,
): { before: string; after: string } | undefined {
  if (!changed.includes(file)) return undefined;
  return {
    before: git('show', `HEAD^1:${file}`),
    after: git('show', `HEAD:${file}`),
  };
}

/** Fail a PR that changes contract sources without an Unreleased entry. */
function changelogCheck(): number {
  // On `pull_request` HEAD is the PR merge commit and HEAD^1 the base tip, so
  // this is the PR's own change set even after the base has moved on.
  const changed = git('diff', '--name-only', '--no-renames', 'HEAD^1', 'HEAD')
    .split('\n')
    .filter((f) => f !== '');
  const changelog = bothSides(changed, 'CHANGELOG.md');
  const known = new Set(changelog ? unreleasedEntries(changelog.before) : []);
  const verdict = changelogVerdict({
    contractChange: contractChange(changed, bothSides(changed, PACKAGE_JSON)),
    entryAdded:
      changelog !== undefined &&
      unreleasedEntries(changelog.after).some((e) => !known.has(e)),
    skipLabel: optionalEnv('SKIP_CHANGELOG') === 'true',
    // prepare-release.yml opens its version bump PR from `chore/bump-<version>`.
    bumpBranch: optionalEnv('HEAD_REF').startsWith('chore/bump-'),
  });
  console.log(verdict.message);
  return verdict.ok ? 0 : 1;
}

function main(): number {
  const command = process.argv[2];
  switch (command) {
    case 'roll-changelog':
      return rollChangelog();
    case 'release-notes':
      return notes();
    case 'changelog-check':
      return changelogCheck();
    default:
      console.log(command ? `unknown command '${command}'. ${USAGE}` : USAGE);
      return 1;
  }
}

// `process.exitCode` rather than `process.exit()`, so a queued stdout write under
// CI is not discarded (see the same note in `test-live.ts`).
try {
  process.exitCode = main();
} catch (e) {
  console.log(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
