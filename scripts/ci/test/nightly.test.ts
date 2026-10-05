import { describe, expect, it } from 'vitest';
import {
  type IssueTracker,
  NIGHTLY_LABEL,
  nightlyAction,
  reportNightly,
  worstResult,
} from '../nightly.ts';

/**
 * Unit tests for `nightly.ts`: deciding what a nightly result does to the
 * tracking issue. The tracker is a recording stub; nothing here spawns `gh`.
 */

const RUN_URL = 'https://github.com/o/r/actions/runs/1';

describe('worstResult', () => {
  it('reduces a single result to itself', () => {
    expect(worstResult('success')).toBe('success');
  });

  it('lets one failure outweigh six passing targets', () => {
    expect(worstResult('success success success failure success success')).toBe(
      'failure',
    );
  });

  it('prefers a failure over a cancellation', () => {
    // A cancelled sibling says nothing about the target that actually broke.
    expect(worstResult('cancelled failure success')).toBe('failure');
  });

  it('reports a cancellation when nothing failed', () => {
    expect(worstResult('success cancelled skipped')).toBe('cancelled');
  });

  it('reads a scoped run as a success', () => {
    // A run scoped to one target legitimately skips the other six, so skipped
    // siblings must not drag the verdict down.
    expect(worstResult('skipped skipped success skipped')).toBe('success');
  });

  it('stays skipped when every target was skipped', () => {
    // How "nothing ran at all" reaches `nightlyAction`.
    expect(worstResult('skipped skipped skipped')).toBe('skipped');
  });

  it('reads an empty list as skipped rather than as a pass', () => {
    expect(worstResult('')).toBe('skipped');
  });
});

describe('nightlyAction', () => {
  it('closes the open issue when the nightly is green', () => {
    expect(
      nightlyAction({
        suite: 'success',
        plan: 'success',
        compile: 'success',
        runUrl: RUN_URL,
        openIssue: 42,
      }),
    ).toStrictEqual({
      kind: 'close',
      issue: 42,
      comment: `Nightly live run is green again: ${RUN_URL}`,
    });
  });

  it('does nothing when the nightly is green and no issue is open', () => {
    const action = nightlyAction({
      suite: 'success',
      plan: 'success',
      compile: 'success',
      runUrl: RUN_URL,
    });

    expect(action.kind).toBe('none');
  });

  it('comments on the open issue when the nightly fails again', () => {
    // One issue for the whole flaky stretch, so the repeats stay in one thread
    // instead of opening a new issue per night.
    expect(
      nightlyAction({
        suite: 'failure',
        plan: 'success',
        compile: 'success',
        runUrl: RUN_URL,
        openIssue: 42,
      }),
    ).toStrictEqual({
      kind: 'comment',
      issue: 42,
      body: `Nightly live run failed again: ${RUN_URL}`,
    });
  });

  it('opens an issue on the first failure', () => {
    const action = nightlyAction({
      suite: 'failure',
      plan: 'success',
      compile: 'success',
      runUrl: RUN_URL,
    });

    expect(action.kind).toBe('create');
    if (action.kind !== 'create') return;
    expect(action.title).toBe('Nightly live test run is failing');
    // The run link is the only way back to the logs from the issue.
    expect(action.body).toContain(RUN_URL);
  });

  it('treats a suite skipped by a failed plan as a failed nightly', () => {
    // The suite job reports `skipped`, not `failure`, when the plan job died
    // before it. Nothing was tested, which is exactly what the nightly exists to
    // catch, so it must not be reported as a pass or silently dropped.
    const action = nightlyAction({
      suite: 'skipped',
      plan: 'failure',
      compile: 'success',
      runUrl: RUN_URL,
    });

    expect(action.kind).toBe('create');
  });

  it('reports nothing when the run was cancelled', () => {
    // Cancelled by the concurrency group or by hand: not a verdict about the
    // suite, so the issue state is left alone.
    expect(
      nightlyAction({
        suite: 'cancelled',
        plan: 'success',
        compile: 'success',
        runUrl: RUN_URL,
        openIssue: 42,
      }).kind,
    ).toBe('none');
  });

  it('reports nothing when a cancelled plan skipped the suite', () => {
    expect(
      nightlyAction({
        suite: 'skipped',
        plan: 'cancelled',
        compile: 'success',
        runUrl: RUN_URL,
      }).kind,
    ).toBe('none');
  });

  it('treats a suite skipped by a failed compile as a failed nightly', () => {
    // The compile matrix is the other way nothing gets tested. Reading that as
    // `skipped` would leave a build that cannot compile silent all night.
    const action = nightlyAction({
      suite: 'skipped',
      plan: 'success',
      compile: 'failure',
      runUrl: RUN_URL,
    });

    expect(action).toStrictEqual({
      kind: 'create',
      title: 'Nightly live test run is failing',
      body: expect.stringContaining(RUN_URL),
    });
  });

  it('fails the nightly when one target compile failed and the rest passed', () => {
    // A pipeline per target: the failed target's suite jobs are skipped, the
    // others run, and the suite aggregate collapses `success` + `skipped` to
    // `success`. The compile aggregate is what still carries the failure.
    const action = nightlyAction({
      suite: 'success',
      plan: 'success',
      compile: 'failure',
      runUrl: RUN_URL,
      openIssue: 42,
    });

    expect(action).toStrictEqual({
      kind: 'comment',
      issue: 42,
      body: expect.stringContaining(RUN_URL),
    });
  });

  it('reports nothing when a cancelled compile skipped the suite', () => {
    expect(
      nightlyAction({
        suite: 'skipped',
        plan: 'success',
        compile: 'cancelled',
        runUrl: RUN_URL,
      }),
    ).toStrictEqual({ kind: 'none', reason: 'suite result: cancelled' });
  });

  it('reports nothing for a skipped suite under a green plan and compile', () => {
    // Not reachable from the current workflow (the suite job has no `if` of its
    // own); pinned so a future condition on it cannot turn into a false green.
    expect(
      nightlyAction({
        suite: 'skipped',
        plan: 'success',
        compile: 'success',
        runUrl: RUN_URL,
        openIssue: 42,
      }).kind,
    ).toBe('none');
  });
});

describe('reportNightly', () => {
  /** Records what the decision asked GitHub to do. */
  class RecordingTracker implements IssueTracker {
    readonly calls: string[] = [];
    readonly #open?: number;
    constructor(open?: number) {
      this.#open = open;
    }
    findOpen(label: string): number | undefined {
      this.calls.push(`findOpen ${label}`);
      return this.#open;
    }
    close(issue: number, comment: string): void {
      this.calls.push(`close ${issue} ${comment}`);
    }
    comment(issue: number, body: string): void {
      this.calls.push(`comment ${issue} ${body}`);
    }
    create(label: string, title: string, _body: string): void {
      this.calls.push(`create ${label} ${title}`);
    }
  }

  it('looks the issue up by label and closes it on a green run', () => {
    const tracker = new RecordingTracker(42);

    const summary = reportNightly(
      {
        suite: 'success',
        plan: 'success',
        compile: 'success',
        runUrl: RUN_URL,
      },
      tracker,
    );

    expect(tracker.calls).toStrictEqual([
      `findOpen ${NIGHTLY_LABEL}`,
      `close 42 Nightly live run is green again: ${RUN_URL}`,
    ]);
    expect(summary).toContain('closed #42');
  });

  it('opens an issue when a failure finds none open', () => {
    const tracker = new RecordingTracker();

    const summary = reportNightly(
      {
        suite: 'failure',
        plan: 'success',
        compile: 'success',
        runUrl: RUN_URL,
      },
      tracker,
    );

    expect(tracker.calls).toStrictEqual([
      `findOpen ${NIGHTLY_LABEL}`,
      `create ${NIGHTLY_LABEL} Nightly live test run is failing`,
    ]);
    expect(summary).toContain('opened a tracking issue');
  });

  it('writes nothing when there is nothing to report', () => {
    const tracker = new RecordingTracker();

    const summary = reportNightly(
      {
        suite: 'cancelled',
        plan: 'success',
        compile: 'success',
        runUrl: RUN_URL,
      },
      tracker,
    );

    expect(tracker.calls).toStrictEqual([`findOpen ${NIGHTLY_LABEL}`]);
    expect(summary).toContain('nothing to report');
  });
});
