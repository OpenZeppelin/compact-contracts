import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setOutput } from '../actions.ts';
import { type Captured, type Exec, GhIssueTracker } from '../gh.ts';
import { ALL_TARGETS, LIVE_LABEL, legNames, resolveMatrix } from '../matrix.ts';
import {
  type IssueTracker,
  NIGHTLY_LABEL,
  nightlyAction,
  reportNightly,
  worstResult,
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

/** Stand-in for `specFiles()`, in the repo-relative shape it returns. */
const SPECS: Readonly<Record<string, readonly string[]>> = {
  access: ['src/access/test/Ownable.test.ts'],
  multisig: [
    'src/multisig/test/Forwarder.test.ts',
    'src/multisig/test/MultiSigWallet.test.ts',
  ],
  token: ['src/token/test/FungibleToken.test.ts'],
  integration: ['test/integration/specs/Forwarder.spec.ts'],
};

const specs = (target: string): readonly string[] => SPECS[target] ?? [];

/** A request with only the field under test set. */
const request = (fields: {
  target?: string;
  label?: string;
  filter?: string;
}) => ({ target: '', label: '', filter: '', ...fields });

const RUN_URL = 'https://github.com/o/r/actions/runs/1';

/**
 * The resolution expected for a target-to-files map: one leg per file, targets
 * in the order given. Spelled out rather than hand-written per case, because
 * every case now carries its legs and the interesting part of each is which
 * files survived, not the shape around them.
 */
const expected = (
  files: Readonly<Record<string, readonly string[]>>,
  dropped: readonly string[] = [],
) => ({
  ok: true,
  targets: Object.keys(files),
  legs: Object.entries(files).flatMap(([target, targetFiles]) =>
    targetFiles.map((file) => ({
      target,
      file,
      // Every fixture target keeps its specs in one directory, so the shared
      // prefix `legNames` strips leaves the bare file name.
      name: path.basename(file).replace(/\.(test|spec)\.ts$/, ''),
    })),
  ),
  dropped,
});

describe('legNames', () => {
  it('names a file by its base name when the specs share a directory', () => {
    expect(
      legNames([
        'src/token/test/FungibleToken.test.ts',
        'src/token/test/MultiToken.test.ts',
      ]),
    ).toStrictEqual(['FungibleToken', 'MultiToken']);
  });

  it('keeps a nested file distinct from its same-named sibling', () => {
    // Real collision: `multisig` holds both of these, and one name for two jobs
    // would mean two uploads under one artifact name.
    expect(
      legNames([
        'src/multisig/test/ForwarderPrivate.test.ts',
        'src/multisig/test/presets/ForwarderPrivate.test.ts',
      ]),
    ).toStrictEqual(['ForwarderPrivate', 'presets-ForwarderPrivate']);
  });

  it('strips the integration spec extension too', () => {
    expect(
      legNames(['test/integration/specs/confidentialFungibleToken.spec.ts']),
    ).toStrictEqual(['confidentialFungibleToken']);
  });

  it('keeps a compound file name intact', () => {
    // `.property` is part of the name, not an extension to strip.
    expect(
      legNames([
        'src/token/test/NativeShieldedTokenPublicSupply.property.test.ts',
      ]),
    ).toStrictEqual(['NativeShieldedTokenPublicSupply.property']);
  });

  it('reports nothing for no files', () => {
    expect(legNames([])).toStrictEqual([]);
  });
});

describe('resolveMatrix', () => {
  it('fans out over every spec file when nothing is requested', () => {
    // What the schedule trigger passes: no input at all.
    expect(resolveMatrix(request({}), TARGETS, specs)).toStrictEqual(
      expected(SPECS),
    );
  });

  it(`fans out over every target for '${ALL_TARGETS}'`, () => {
    expect(
      resolveMatrix(request({ target: ALL_TARGETS }), TARGETS, specs),
    ).toStrictEqual(expected(SPECS));
  });

  it('gives each spec file in a target its own leg', () => {
    // The point of the per-file matrix: `multisig` is two jobs, not one.
    const resolution = resolveMatrix(
      request({ target: 'multisig' }),
      TARGETS,
      specs,
    );

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.legs).toStrictEqual([
      {
        target: 'multisig',
        file: 'src/multisig/test/Forwarder.test.ts',
        name: 'Forwarder',
      },
      {
        target: 'multisig',
        file: 'src/multisig/test/MultiSigWallet.test.ts',
        name: 'MultiSigWallet',
      },
    ]);
    // One compile job for the target the two suite jobs share.
    expect(resolution.targets).toStrictEqual(['multisig']);
  });

  it('scopes to the integration target like any other', () => {
    // `integration` is a target but not a `src/` category, and the matrix makes
    // no distinction: same compile job, same runner invocation.
    expect(
      resolveMatrix(request({ target: 'integration' }), TARGETS, specs),
    ).toStrictEqual(
      expected({ integration: SPECS.integration as readonly string[] }),
    );
  });

  it('trims a padded input', () => {
    expect(
      resolveMatrix(request({ target: '  multisig  ' }), TARGETS, specs),
    ).toStrictEqual(
      expected({ multisig: SPECS.multisig as readonly string[] }),
    );
  });

  it('rejects an unknown target and names the valid ones', () => {
    const resolution = resolveMatrix(
      request({ target: 'multisigs' }),
      TARGETS,
      specs,
    );

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
    const resolution = resolveMatrix(request({}), [], specs);

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.message).toContain('no live targets');
  });

  it('rejects a target set whose spec files have all gone', () => {
    // Same failure as an empty target list, one layer down: targets exist but
    // hold no file, so the suite matrix would be empty.
    const resolution = resolveMatrix(request({}), TARGETS, () => []);

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.message).toContain('no spec file exists');
  });

  it('fans out over every target for the bare PR label', () => {
    expect(
      resolveMatrix(request({ label: LIVE_LABEL }), TARGETS, specs),
    ).toStrictEqual(expected(SPECS));
  });

  it('scopes to the target named by the PR label', () => {
    // A PR usually wants the target its change touches.
    expect(
      resolveMatrix(
        request({ label: `${LIVE_LABEL}:multisig` }),
        TARGETS,
        specs,
      ),
    ).toStrictEqual(
      expected({ multisig: SPECS.multisig as readonly string[] }),
    );
  });

  it('rejects a PR label naming an unknown target', () => {
    const resolution = resolveMatrix(
      request({ label: `${LIVE_LABEL}:nope` }),
      TARGETS,
      specs,
    );

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.message).toContain("'nope' is not a live target");
  });

  it('rejects a label whose scope is empty', () => {
    // `live-tests:` passes the workflow's `startsWith` gate. Reading it as "every
    // target" would queue the full fan-out off a malformed label.
    const resolution = resolveMatrix(
      request({ label: `${LIVE_LABEL}:` }),
      TARGETS,
      specs,
    );

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.message).toContain(
      `'${LIVE_LABEL}:' is not a live target`,
    );
  });

  it('ignores an unrelated label', () => {
    // The workflow gates on the label name, so this is belt and braces: an
    // unrelated label must not be read as a target.
    expect(
      resolveMatrix(request({ label: 'documentation' }), TARGETS, specs),
    ).toStrictEqual(expected(SPECS));
  });

  it('drops the targets a file filter matches nothing under', () => {
    // Not cosmetic: one live target that runs no file is an infrastructure abort
    // in the runner (exit 2, after `env-up`), so a full fan-out with a filter
    // would report a red job for every target it does not name.
    expect(
      resolveMatrix(request({ filter: 'MultiSigWallet' }), TARGETS, specs),
    ).toStrictEqual(
      expected({ multisig: ['src/multisig/test/MultiSigWallet.test.ts'] }, [
        'access',
        'token',
        'integration',
      ]),
    );
  });

  it('narrows a target to the files the filter selects', () => {
    // The filter reaches inside a target now, not just across targets: one of
    // multisig's two specs gets a job, and the other does not.
    const resolution = resolveMatrix(
      request({ target: 'multisig', filter: 'Forwarder' }),
      TARGETS,
      specs,
    );

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.legs).toStrictEqual([
      {
        target: 'multisig',
        file: 'src/multisig/test/Forwarder.test.ts',
        name: 'Forwarder',
      },
    ]);
  });

  it('keeps every target a filter matches under', () => {
    // `Forwarder` exists as a unit spec and an integration spec.
    expect(
      resolveMatrix(request({ filter: 'Forwarder' }), TARGETS, specs),
    ).toStrictEqual(
      expected(
        {
          multisig: ['src/multisig/test/Forwarder.test.ts'],
          integration: ['test/integration/specs/Forwarder.spec.ts'],
        },
        ['access', 'token'],
      ),
    );
  });

  it('matches a filter against the whole path, not the file name', () => {
    // How vitest reads a positional filter, and how the runner's own
    // `defaultFilters` (`src/<category>`) work.
    expect(
      resolveMatrix(request({ filter: 'src/token' }), TARGETS, specs),
    ).toStrictEqual(
      expected({ token: SPECS.token as readonly string[] }, [
        'access',
        'multisig',
        'integration',
      ]),
    );
  });

  it('matches a filter case-insensitively, as vitest does', () => {
    // A filter that runs the Forwarder specs locally must not be rejected here.
    expect(
      resolveMatrix(request({ filter: 'forwarder' }), TARGETS, specs),
    ).toStrictEqual(
      expected(
        {
          multisig: ['src/multisig/test/Forwarder.test.ts'],
          integration: ['test/integration/specs/Forwarder.spec.ts'],
        },
        ['access', 'token'],
      ),
    );
  });

  it('rejects a filter that matches nothing anywhere', () => {
    const resolution = resolveMatrix(
      request({ filter: 'Frowarder' }),
      TARGETS,
      specs,
    );

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.message).toContain("no spec file matches 'Frowarder'");
  });

  it('rejects a filter that matches nothing under the requested target', () => {
    const resolution = resolveMatrix(
      request({ target: 'token', filter: 'Forwarder' }),
      TARGETS,
      specs,
    );

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.message).toContain('under token');
  });

  it("reads each target's spec files exactly once", () => {
    // The per-file matrix needs the file list on every run, filter or not, but
    // the plan job runs without an install and the walk is real filesystem work.
    const lookup = vi.fn(specs);

    resolveMatrix(request({ target: ALL_TARGETS }), TARGETS, lookup);

    expect(lookup.mock.calls).toStrictEqual(TARGETS.map((t) => [t]));
  });
});

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

  it('throws with the output when the listing is not JSON', () => {
    // A bare SyntaxError from `JSON.parse` names neither the command nor what it
    // choked on, which is all the nightly log would carry.
    const { exec } = recorder([
      { status: 0, stdout: 'gh: something unexpected', stderr: '' },
    ]);

    expect(() =>
      new GhIssueTracker('o/r', exec).findOpen('live-nightly'),
    ).toThrow(/gh issue list returned unreadable JSON.*something unexpected/s);
  });
});

describe('setOutput', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'live-ci-'));
  });

  // `vi.stubEnv`, not a direct assignment: it scopes the change to the test even
  // if this file ever runs concurrently with another that reads the environment.
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('appends the pair to the outputs file', () => {
    const file = path.join(dir, 'output');
    writeFileSync(file, 'existing=1\n');
    vi.stubEnv('GITHUB_OUTPUT', file);

    setOutput('targets', '["multisig"]');

    // Appended, not written: a step may publish more than one output.
    expect(readFileSync(file, 'utf8')).toBe(
      'existing=1\ntargets=["multisig"]\n',
    );
  });

  it('prints the pair when run outside Actions', () => {
    vi.stubEnv('GITHUB_OUTPUT', undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    setOutput('targets', '["multisig"]');

    expect(log).toHaveBeenCalledWith('targets=["multisig"]');
  });

  it('refuses a multi-line value', () => {
    vi.stubEnv('GITHUB_OUTPUT', path.join(dir, 'output'));

    // `name=value` cannot express one, and writing it anyway corrupts every
    // later output in the file instead of failing here.
    expect(() => setOutput('targets', 'a\nb')).toThrow(/single line/);
  });
});
