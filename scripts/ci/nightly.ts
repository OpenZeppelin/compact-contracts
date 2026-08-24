/**
 * What a nightly live run reports back to the repository.
 *
 * A failed scheduled run only emails the workflow author, which is easy to miss,
 * so the nightly state is mirrored into a single `live-nightly` tracking issue:
 * opened on the first failure, commented on each repeat, closed on the next green
 * run. One issue, not one per night, so the history of a flaky stretch stays in
 * one thread.
 *
 * The decision ({@link nightlyAction}) is pure and exhaustively tested; the GitHub
 * side of it is an {@link IssueTracker} the caller supplies (`gh.ts` in CI, a
 * recorder in the tests).
 */

/** Label that identifies the tracking issue. Also created on demand, since a
 * fresh clone of the repo has no such label yet. */
export const NIGHTLY_LABEL = 'live-nightly';

const ISSUE_TITLE = 'Nightly live test run is failing';

/** GitHub issue operations {@link reportNightly} needs. Narrow on purpose: the
 * adapter is a `gh` CLI wrapper, and everything it can do beyond these four is
 * something this module must not reach for. */
export interface IssueTracker {
  /** The open issue carrying `label`, or `undefined` when there is none. */
  findOpen(label: string): number | undefined;
  close(issue: number, comment: string): void;
  comment(issue: number, body: string): void;
  create(label: string, title: string, body: string): void;
}

/** The two `needs.*.result` values the report is derived from, plus the run being
 * reported. */
export interface NightlyState {
  /** `needs.run-live-suite.result`: the aggregate over the matrix jobs. */
  readonly suite: string;
  /** `needs.plan.result`: distinguishes "the suite never ran" from "it passed". */
  readonly plan: string;
  /** Link back to the workflow run, for the issue body. */
  readonly runUrl: string;
  /** The open tracking issue, when one exists. */
  readonly openIssue?: number;
}

export type NightlyAction =
  | { readonly kind: 'close'; readonly issue: number; readonly comment: string }
  | { readonly kind: 'comment'; readonly issue: number; readonly body: string }
  | { readonly kind: 'create'; readonly title: string; readonly body: string }
  | { readonly kind: 'none'; readonly reason: string };

/**
 * Collapse the two job results into the one verdict the report is about.
 *
 * The suite job reports `skipped` whenever it never started, which covers both
 * "the plan job failed" (a failed nightly: nothing was tested) and "the run was
 * cancelled" (nothing to report). The plan result is what tells them apart, so a
 * skipped suite inherits it.
 */
function verdict(state: NightlyState): string {
  if (state.suite !== 'skipped') return state.suite;
  return state.plan === 'success' ? 'skipped' : state.plan;
}

function failureBody(runUrl: string): string {
  return [
    'The scheduled live test run failed.',
    '',
    `* Run: ${runUrl}`,
    '* Per-target verdicts are in each job summary. JSON reports and service logs are attached to the run as artifacts.',
    '',
    'Managed by `live.yml`: each failing nightly adds a comment here, and the issue closes automatically on the next green run.',
  ].join('\n');
}

/** Decide what the nightly run should do to the tracking issue. Pure. */
export function nightlyAction(state: NightlyState): NightlyAction {
  const result = verdict(state);

  if (result === 'success') {
    return state.openIssue === undefined
      ? { kind: 'none', reason: 'nightly is green and no issue is open' }
      : {
          kind: 'close',
          issue: state.openIssue,
          comment: `Nightly live run is green again: ${state.runUrl}`,
        };
  }

  if (result === 'failure') {
    return state.openIssue === undefined
      ? {
          kind: 'create',
          title: ISSUE_TITLE,
          body: failureBody(state.runUrl),
        }
      : {
          kind: 'comment',
          issue: state.openIssue,
          body: `Nightly live run failed again: ${state.runUrl}`,
        };
  }

  // Cancelled (superseded by the next nightly, or stopped by hand) and any
  // result Actions may add later: neither a pass nor a failure, so the issue
  // state is left exactly as it was.
  return { kind: 'none', reason: `suite result: ${result}` };
}

/**
 * Run the report: look up the open issue, decide, apply.
 *
 * @returns a one-line summary of what was done, for the job log
 */
export function reportNightly(
  state: Omit<NightlyState, 'openIssue'>,
  issues: IssueTracker,
): string {
  const action = nightlyAction({
    ...state,
    openIssue: issues.findOpen(NIGHTLY_LABEL),
  });

  switch (action.kind) {
    case 'close':
      issues.close(action.issue, action.comment);
      return `closed #${action.issue}: nightly is green again.`;
    case 'comment':
      issues.comment(action.issue, action.body);
      return `commented on #${action.issue}: nightly failed again.`;
    case 'create':
      issues.create(NIGHTLY_LABEL, action.title, action.body);
      return 'opened a tracking issue for the failing nightly.';
    case 'none':
      return `nothing to report (${action.reason}).`;
  }
}
