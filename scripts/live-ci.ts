import { setOutput } from './ci/actions.ts';
import { GhIssueTracker } from './ci/gh.ts';
import { resolveMatrix } from './ci/matrix.ts';
import { reportNightly } from './ci/nightly.ts';
import { specFiles } from './live/specs.ts';
import { listTargets, liveCategories } from './live/targets.ts';

/**
 * Everything `.github/workflows/live.yml` needs to do beyond invoking the runner.
 *
 * The workflow calls this instead of embedding shell in `run:` blocks, for the
 * reason the live runner itself is a script (see `test-live.ts`): logic inside a
 * workflow is unreachable from a test and unrunnable locally, and the pieces here
 * are exactly the ones a mistake stays hidden in for a night. Each concern lives
 * in `scripts/ci/`:
 *   - `matrix.ts`  — which live targets the run fans out into (pure)
 *   - `nightly.ts` — what the nightly reports to the tracking issue (pure)
 *   - `gh.ts`      — the `gh` CLI adapter behind the issue operations
 *   - `actions.ts` — the runner's step-output protocol
 * Their tests are in `scripts/ci/test/` (`yarn test:scripts`).
 *
 * Usage, with the inputs each command reads from the environment:
 *   node scripts/live-ci.ts matrix    # TARGET, LABEL, FILTER
 *   node scripts/live-ci.ts nightly   # REPO, SUITE_RESULT, PLAN_RESULT, RUN_URL
 *
 * Node runs this .ts directly (type stripping) and it imports only `node:`
 * builtins, so the jobs that call it need a checkout and a Node, not an install.
 *
 * Exit codes: 0 done, 1 a bad input or a failed `gh` call.
 */

const USAGE = 'usage: node scripts/live-ci.ts <matrix|nightly>';

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

/** Publish the matrix the suite job fans out over. */
function matrix(): number {
  const filter = optionalEnv('FILTER');
  const resolution = resolveMatrix(
    {
      target: optionalEnv('TARGET'),
      label: optionalEnv('LABEL'),
      filter,
    },
    listTargets(liveCategories()),
    specFiles,
  );
  if (!resolution.ok) {
    console.log(resolution.message);
    return 1;
  }
  if (resolution.dropped.length > 0) {
    console.log(
      `no file matches '${filter}' under ${resolution.dropped.join(', ')}: ` +
        'no job for those.',
    );
  }
  console.log(`live targets: ${resolution.targets.join(', ')}`);
  setOutput('targets', JSON.stringify(resolution.targets));
  return 0;
}

/** Mirror the nightly result into the `live-nightly` tracking issue. */
function nightly(): number {
  console.log(
    reportNightly(
      {
        suite: env('SUITE_RESULT'),
        plan: env('PLAN_RESULT'),
        runUrl: env('RUN_URL'),
      },
      new GhIssueTracker(env('REPO')),
    ),
  );
  return 0;
}

function main(): number {
  const command = process.argv[2];
  switch (command) {
    case 'matrix':
      return matrix();
    case 'nightly':
      return nightly();
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
