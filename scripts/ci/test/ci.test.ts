import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setOutput } from '../actions.ts';
import { type Captured, type Exec, GhIssueTracker } from '../gh.ts';
import { ALL_TARGETS, resolveMatrix } from '../matrix.ts';
import {
  type IssueTracker,
  NIGHTLY_LABEL,
  nightlyAction,
  reportNightly,
} from '../nightly.ts';

/**
 * Unit tests for what `live.yml` used to do in `run:` shell: resolving the matrix
 * of live targets, and deciding what a nightly result does to the tracking issue.
 * Nothing here spawns `gh` or touches the network. The CLI adapter is driven
 * through a recording `Exec`, so the argv it builds is asserted rather than run.
 */

/** Stand-in for `listTargets(liveCategories())`. Passed explicitly everywhere, so
 * these cases do not move when a category is added under `src/`. */
const TARGETS = ['access', 'multisig', 'token', 'integration'] as const;

const RUN_URL = 'https://github.com/o/r/actions/runs/1';

describe('resolveMatrix', () => {
  it('fans out over every target when nothing is requested', () => {
    // The schedule and label triggers pass no input at all.
    expect(resolveMatrix('', TARGETS)).toStrictEqual({
      ok: true,
      targets: TARGETS,
    });
  });

  it(`fans out over every target for '${ALL_TARGETS}'`, () => {
    expect(resolveMatrix(ALL_TARGETS, TARGETS)).toStrictEqual({
      ok: true,
      targets: TARGETS,
    });
  });

  it('scopes to one requested target', () => {
    expect(resolveMatrix('multisig', TARGETS)).toStrictEqual({
      ok: true,
      targets: ['multisig'],
    });
  });

  it('scopes to the integration target like any other', () => {
    // `integration` is a target but not a `src/` category, and the matrix makes
    // no distinction: one job, same runner invocation.
    expect(resolveMatrix('integration', TARGETS)).toStrictEqual({
      ok: true,
      targets: ['integration'],
    });
  });

  it('trims a padded input', () => {
    expect(resolveMatrix('  multisig  ', TARGETS)).toStrictEqual({
      ok: true,
      targets: ['multisig'],
    });
  });

  it('rejects an unknown target and names the valid ones', () => {
    const resolution = resolveMatrix('multisigs', TARGETS);

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    // The whole point of validating in the plan job: the message has to be
    // enough to re-dispatch correctly, without opening the runner's source.
    expect(resolution.message).toContain("'multisigs' is not a live target");
    expect(resolution.message).toContain(
      'access, multisig, token, integration',
    );
    expect(resolution.message).toContain(`'${ALL_TARGETS}'`);
  });

  it('rejects an empty target list rather than emitting an empty matrix', () => {
    // Actions fails a `matrix:` with no vectors with an opaque error and no
    // pointer at the cause, so this side refuses first.
    const resolution = resolveMatrix('', []);

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.message).toContain('no live targets');
  });
});

describe('nightlyAction', () => {
  it('closes the open issue when the nightly is green', () => {
    expect(
      nightlyAction({
        suite: 'success',
        plan: 'success',
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
        runUrl: RUN_URL,
        openIssue: 42,
      }).kind,
    ).toBe('none');
  });

  it('reports nothing when a cancelled plan skipped the suite', () => {
    expect(
      nightlyAction({ suite: 'skipped', plan: 'cancelled', runUrl: RUN_URL })
        .kind,
    ).toBe('none');
  });

  it('reports nothing for a skipped suite under a green plan', () => {
    // Not reachable from the current workflow (the suite job has no `if` of its
    // own); pinned so a future condition on it cannot turn into a false green.
    expect(
      nightlyAction({
        suite: 'skipped',
        plan: 'success',
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
      { suite: 'success', plan: 'success', runUrl: RUN_URL },
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
      { suite: 'failure', plan: 'success', runUrl: RUN_URL },
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
      { suite: 'cancelled', plan: 'success', runUrl: RUN_URL },
      tracker,
    );

    expect(tracker.calls).toStrictEqual([`findOpen ${NIGHTLY_LABEL}`]);
    expect(summary).toContain('nothing to report');
  });
});

describe('GhIssueTracker', () => {
  /** Captures every argv and replays canned stdout, so the tests assert on the
   * command line without a `gh` binary or a network. */
  const recorder = (results: readonly Captured[] = []) => {
    const argv: string[][] = [];
    const exec: Exec = (cmd, args) => {
      argv.push([cmd, ...args]);
      return results[argv.length - 1] ?? { status: 0, stdout: '', stderr: '' };
    };
    return { argv, exec };
  };

  it('reads the open issue number out of the JSON listing', () => {
    const { argv, exec } = recorder([
      { status: 0, stdout: '[{"number":42}]\n', stderr: '' },
    ]);

    expect(new GhIssueTracker('o/r', exec).findOpen('live-nightly')).toBe(42);
    expect(argv[0]).toStrictEqual([
      'gh',
      'issue',
      'list',
      '--label',
      'live-nightly',
      '--state',
      'open',
      '--limit',
      '1',
      '--json',
      'number',
      // Always explicit, so the adapter does not depend on the checkout's remotes.
      '--repo',
      'o/r',
    ]);
  });

  it('reports no open issue for an empty listing', () => {
    const { exec } = recorder([{ status: 0, stdout: '[]', stderr: '' }]);

    expect(
      new GhIssueTracker('o/r', exec).findOpen('live-nightly'),
    ).toBeUndefined();
  });

  it('reports no open issue when gh printed nothing at all', () => {
    const { exec } = recorder();

    expect(
      new GhIssueTracker('o/r', exec).findOpen('live-nightly'),
    ).toBeUndefined();
  });

  it('passes a multi-line body as a single argument', () => {
    const { argv, exec } = recorder();
    const body = 'line one\n\n* `backtick` and $dollar';

    new GhIssueTracker('o/r', exec).comment(42, body);

    // The reason the adapter builds argv instead of a shell string: the body is
    // markdown with characters a shell would expand.
    expect(argv[0]).toStrictEqual([
      'gh',
      'issue',
      'comment',
      '42',
      '--body',
      body,
      '--repo',
      'o/r',
    ]);
  });

  it('closes with a comment in one call', () => {
    const { argv, exec } = recorder();

    new GhIssueTracker('o/r', exec).close(42, 'green again');

    expect(argv).toStrictEqual([
      [
        'gh',
        'issue',
        'close',
        '42',
        '--comment',
        'green again',
        '--repo',
        'o/r',
      ],
    ]);
  });

  it('creates the label before the issue that carries it', () => {
    const { argv, exec } = recorder();

    new GhIssueTracker('o/r', exec).create('live-nightly', 'title', 'body');

    // `gh issue create --label` fails on a label the repo does not have yet, so
    // the label call has to come first, and `--force` keeps it idempotent.
    expect(argv[0]?.slice(0, 5)).toStrictEqual([
      'gh',
      'label',
      'create',
      'live-nightly',
      '--force',
    ]);
    expect(argv[1]?.slice(0, 4)).toStrictEqual([
      'gh',
      'issue',
      'create',
      '--label',
    ]);
  });

  it('throws with gh stderr when a call fails', () => {
    const { exec } = recorder([
      { status: 1, stdout: '', stderr: 'HTTP 403: Resource not accessible\n' },
    ]);

    expect(() => new GhIssueTracker('o/r', exec).comment(42, 'x')).toThrow(
      /gh issue comment failed \(exit 1\): HTTP 403/,
    );
  });
});

describe('setOutput', () => {
  let dir: string;
  const original = process.env.GITHUB_OUTPUT;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'live-ci-'));
  });

  afterEach(() => {
    if (original === undefined) delete process.env.GITHUB_OUTPUT;
    else process.env.GITHUB_OUTPUT = original;
    vi.restoreAllMocks();
  });

  it('appends the pair to the outputs file', () => {
    const file = path.join(dir, 'output');
    writeFileSync(file, 'existing=1\n');
    process.env.GITHUB_OUTPUT = file;

    setOutput('targets', '["multisig"]');

    // Appended, not written: a step may publish more than one output.
    expect(readFileSync(file, 'utf8')).toBe(
      'existing=1\ntargets=["multisig"]\n',
    );
  });

  it('prints the pair when run outside Actions', () => {
    delete process.env.GITHUB_OUTPUT;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    setOutput('targets', '["multisig"]');

    expect(log).toHaveBeenCalledWith('targets=["multisig"]');
  });

  it('refuses a multi-line value', () => {
    process.env.GITHUB_OUTPUT = path.join(dir, 'output');

    // `name=value` cannot express one, and writing it anyway corrupts every
    // later output in the file instead of failing here.
    expect(() => setOutput('targets', 'a\nb')).toThrow(/single line/);
  });
});
