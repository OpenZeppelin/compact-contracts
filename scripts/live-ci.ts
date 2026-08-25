import { setOutput } from './ci/actions.ts';
import { GhIssueTracker } from './ci/gh.ts';
import { resolveMatrix } from './ci/matrix.ts';
import { reportNightly, worstResult } from './ci/nightly.ts';
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
 *   node scripts/live-ci.ts matrix    # TARGET, LABEL, FILTER, KNOWN_TARGETS
 *   node scripts/live-ci.ts nightly   # REPO, SUITE_RESULT, PLAN_RESULT,
 *                                     # COMPILE_RESULT, RUN_URL
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

/** Publish the matrices the compile and suite jobs fan out over. */
function matrix(): number {
  const missing = unpaired(env('KNOWN_TARGETS'));
  if (missing.length > 0) {
    console.log(
      `live target(s) with no job pair in live.yml: ${missing.join(', ')}.\n` +
        'Add a `compile-<target>` job and a `live-<target>` job for each, plus ' +
        'its `legs-<target>` plan output, and list it in KNOWN_TARGETS.',
    );
    return 1;
  }

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
  console.log(
    `compile: ${resolution.targets.join(', ')}\n` +
      `live: ${resolution.legs.length} spec file(s)`,
  );
  for (const leg of resolution.legs) {
    console.log(`  ${leg.target} · ${leg.name}  (${leg.file})`);
  }

  // One `legs-<target>` output per target, because the workflow pairs a compile
  // job with its own suite matrix so each target's specs start as soon as THAT
  // target is built (`needs` is job-level, so one shared suite matrix would wait
  // for the slowest compile of all). Actions output names have to be literals,
  // so the workflow declares the pairs it knows and KNOWN_TARGETS below is what
  // keeps that list honest.
  setOutput('targets', JSON.stringify(resolution.targets));
  for (const target of listTargets(liveCategories())) {
    setOutput(
      `legs-${target}`,
      JSON.stringify(resolution.legs.filter((l) => l.target === target)),
    );
  }
  return 0;
}

/**
 * Fail when a discovered live target has no job pair in the workflow.
 *
 * The dynamic target list was the whole point of resolving the matrix here, and
 * the per-target pipeline gives part of it back: a compile job and a suite matrix
 * per target have to exist as literal YAML. Without this check a new `src/`
 * category would simply never run live — a silently missing job nobody notices.
 * With it, the plan job goes red in seconds naming what to add.
 */
function unpaired(known: string): string[] {
  const declared = new Set(known.split(/[\s,]+/).filter((t) => t !== ''));
  return listTargets(liveCategories()).filter((t) => !declared.has(t));
}

/** Mirror the nightly result into the `live-nightly` tracking issue. */
function nightly(): number {
  console.log(
    reportNightly(
      {
        // Both aggregates arrive as a whitespace-joined list, one entry per
        // target pipeline, since the workflow pairs a compile job with a suite
        // matrix per target rather than running one matrix of each.
        suite: worstResult(env('SUITE_RESULT')),
        plan: env('PLAN_RESULT'),
        compile: worstResult(env('COMPILE_RESULT')),
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
