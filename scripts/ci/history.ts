import { type Exec, spawnCapture } from './gh.ts';

/**
 * Download the previous run's `live-reports-*` artifacts, for the duration
 * lookup in `weights.ts`.
 *
 * "Previous run" is the most recent COMPLETED run of the workflow, whatever
 * its conclusion: a failed nightly still carries timing reports (they upload
 * on every run), and a red run's durations are as real as a green run's.
 *
 * Best-effort end to end: no completed run yet, artifacts expired past their
 * 14-day retention, a `gh` outage — each just means the plan packs by count,
 * exactly as it did before history existed. Nothing here may fail the plan
 * job, so every outcome is a summary string and the command always exits 0
 * (the workflow step carries `continue-on-error` as belt and braces).
 */

interface RunRef {
  readonly databaseId: number;
}

/** @returns a one-line summary of what was (or was not) downloaded */
export function fetchPreviousReports(
  opts: {
    readonly repo: string;
    readonly workflow: string;
    readonly outDir: string;
  },
  exec: Exec = spawnCapture,
): string {
  const list = exec('gh', [
    'run',
    'list',
    '--workflow',
    opts.workflow,
    '--status',
    'completed',
    '--limit',
    '1',
    '--json',
    'databaseId',
    '--repo',
    opts.repo,
  ]);
  if (list.status !== 0) {
    return `no timing history: gh run list failed (${list.stderr.trim()}).`;
  }
  let runs: readonly RunRef[];
  try {
    runs = JSON.parse(list.stdout || '[]') as readonly RunRef[];
  } catch {
    return `no timing history: gh run list returned unreadable JSON: ${list.stdout.trim()}`;
  }
  const run = runs[0];
  if (run === undefined) {
    return `no timing history: no completed '${opts.workflow}' run exists yet.`;
  }

  const download = exec('gh', [
    'run',
    'download',
    String(run.databaseId),
    '--pattern',
    'live-reports-*',
    '--dir',
    opts.outDir,
    '--repo',
    opts.repo,
  ]);
  if (download.status !== 0) {
    // The usual cause: the run's artifacts expired (14-day retention).
    return (
      'no timing history: could not download reports of run ' +
      `${run.databaseId} (${download.stderr.trim()}).`
    );
  }
  return `downloaded run ${run.databaseId}'s timing reports into ${opts.outDir}.`;
}
