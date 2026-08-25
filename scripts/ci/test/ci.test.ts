import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setOutput } from '../actions.ts';
import {
  type CacheEntry,
  GhCacheClient,
  pruneCaches,
  prunePlan,
} from '../caches.ts';
import { type Captured, type Exec, GhIssueTracker } from '../gh.ts';
import { fetchPreviousReports } from '../history.ts';
import { ALL_TARGETS, LIVE_LABEL, legNames, resolveMatrix } from '../matrix.ts';
import {
  type IssueTracker,
  NIGHTLY_LABEL,
  nightlyAction,
  reportNightly,
  worstResult,
} from '../nightly.ts';
import {
  DEFAULT_TEST_MS,
  estimateSpecMs,
  MAX_TESTS_PER_LEG,
  type SplitLeg,
  splitSpec,
} from '../split.ts';
import { collectDurations, durationsForFile } from '../weights.ts';

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

  it('rejects the bare PR label and points at the scoped form', () => {
    // Per-file legs made the bare label 60+ checks on a PR, so the unscoped
    // form is refused; the full fan-out stays reachable via dispatch 'all'.
    const resolution = resolveMatrix(
      request({ label: LIVE_LABEL }),
      TARGETS,
      specs,
    );

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.message).toContain(`'${LIVE_LABEL}:<target>'`);
    expect(resolution.message).toContain(
      'access, multisig, token, integration',
    );
    expect(resolution.message).toContain(`'${ALL_TARGETS}'`);
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

describe('splitSpec', () => {
  /** `n` test registrations, distinct names. */
  const its = (n: number, prefix = 't'): string =>
    Array.from(
      { length: n },
      (_, i) => `it('${prefix}${i}', () => {});\n`,
    ).join('');

  const block = (name: string, body: string): string =>
    `describe('${name}', () => {\n${body}});\n`;

  /** How vitest applies a leg's filter: `new RegExp(pattern)` against the
   * space-joined full name (see split.ts on the format). */
  const matches = (filter: string, fullName: string): boolean =>
    new RegExp(filter).test(fullName);

  it('does not split a file at or under the limit', () => {
    expect(splitSpec(block('A', its(3)), 3)).toBeNull();
  });

  it('splits sibling describes into anchored path patterns', () => {
    const legs = splitSpec(block('A', its(2)) + block('B', its(2)), 2);

    expect(legs).toStrictEqual([
      { testFilter: '^A ', tests: 2, estimatedMs: 2 * DEFAULT_TEST_MS },
      { testFilter: '^B ', tests: 2, estimatedMs: 2 * DEFAULT_TEST_MS },
    ]);
  });

  it('descends into a describe bigger than the limit', () => {
    const legs = splitSpec(
      block('P', block('x', its(2)) + block('y', its(2))),
      2,
    );

    expect(legs).toStrictEqual([
      { testFilter: '^P x ', tests: 2, estimatedMs: 2 * DEFAULT_TEST_MS },
      { testFilter: '^P y ', tests: 2, estimatedMs: 2 * DEFAULT_TEST_MS },
    ]);
  });

  it('keeps tests beside child describes in exactly one leg', () => {
    // P holds one direct test next to two child describes, so the direct test
    // gets a remainder alternative: P's path minus its children. Without the
    // lookahead it would run in every leg whose pattern starts with `^P `.
    const legs = splitSpec(
      block(
        'P',
        `${its(1, 'direct')}${block('x', its(2))}${block('y', its(2))}`,
      ),
      3,
    );

    expect(legs).toStrictEqual([
      {
        testFilter: '^P (?!x |y )|^P x ',
        tests: 3,
        estimatedMs: 3 * DEFAULT_TEST_MS,
      },
      { testFilter: '^P y ', tests: 2, estimatedMs: 2 * DEFAULT_TEST_MS },
    ]);
    if (legs === null) return;
    const first = legs[0] as SplitLeg;
    const second = legs[1] as SplitLeg;
    expect(matches(first.testFilter, 'P direct0')).toBe(true);
    expect(matches(second.testFilter, 'P direct0')).toBe(false);
    expect(matches(first.testFilter, 'P y t0')).toBe(false);
    expect(matches(second.testFilter, 'P y t0')).toBe(true);
  });

  it('anchors and space-bounds names against sibling near-misses', () => {
    // The classic hazard: an unanchored 'grantRole' matches '_grantRole', and
    // one without the trailing space matches 'grantRoleExtra'.
    const legs = splitSpec(
      block(
        'C',
        'grantRole _grantRole grantRoleExtra'
          .split(' ')
          .map((name) => block(name, its(2)))
          .join(''),
      ),
      2,
    );

    expect(legs).not.toBeNull();
    if (legs === null) return;
    const forName = (name: string) =>
      legs.filter((leg) => matches(leg.testFilter, `C ${name} t0`));
    for (const name of ['grantRole', '_grantRole', 'grantRoleExtra']) {
      // Each test lands in exactly one leg.
      expect(forName(name)).toHaveLength(1);
    }
    expect(forName('grantRole')).not.toStrictEqual(forName('_grantRole'));
    expect(forName('grantRole')).not.toStrictEqual(forName('grantRoleExtra'));
  });

  it('regex-escapes describe names', () => {
    const legs = splitSpec(
      block('A (v1.0) [x]', its(2)) + block('B $end', its(2)),
      2,
    );

    expect(legs).not.toBeNull();
    if (legs === null) return;
    for (const leg of legs)
      expect(() => new RegExp(leg.testFilter)).not.toThrow();
    const a = legs[0] as SplitLeg;
    const b = legs[1] as SplitLeg;
    expect(matches(a.testFilter, 'A (v1.0) [x] t0')).toBe(true);
    // The dot must not have become a wildcard.
    expect(matches(a.testFilter, 'A (v1X0) [x] t0')).toBe(false);
    expect(matches(b.testFilter, 'B $end t0')).toBe(true);
  });

  it('rides a dynamic-named child on the remainder leg', () => {
    // A `describe.each` (or template/variable name) cannot be named in a
    // pattern; its tests are addressed by excluding every literal sibling.
    const legs = splitSpec(
      block(
        'P',
        `${block('lit', its(2))}describe.each(rows)('with %s', () => {\n${its(2)}});\n`,
      ),
      2,
    );

    expect(legs).toStrictEqual([
      { testFilter: '^P (?!lit )', tests: 2, estimatedMs: 2 * DEFAULT_TEST_MS },
      { testFilter: '^P lit ', tests: 2, estimatedMs: 2 * DEFAULT_TEST_MS },
    ]);
  });

  it('does not split when a dynamic subtree alone exceeds the limit', () => {
    // The dynamic child cannot be subdivided (no names to pattern on), so the
    // rule cannot be met; a wrong filter would be worse than a long leg.
    const legs = splitSpec(
      block(
        'P',
        `${block('lit', its(2))}describe.each(rows)('with %s', () => {\n${its(3)}});\n`,
      ),
      2,
    );

    expect(legs).toBeNull();
  });

  it('treats a template name with an interpolation as dynamic', () => {
    const legs = splitSpec(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the placeholder is the fixture's point (an interpolated describe name must count as dynamic)
      'describe(`P ${suffix}`, () => {\n' +
        its(3) +
        '});\n' +
        block('B', its(2)),
      2,
    );

    expect(legs).toBeNull();
  });

  it('does not split when one describe exceeds the limit indivisibly', () => {
    expect(splitSpec(block('A', its(4)) + block('B', its(1)), 2)).toBeNull();
  });

  it('does not split colliding sibling prefixes', () => {
    // 'grant ' is a prefix of 'grant extra ', so the shorter pattern would run
    // the longer one's tests in two legs.
    const legs = splitSpec(
      block('P', block('grant', its(2)) + block('grant extra', its(2))),
      2,
    );

    expect(legs).toBeNull();
  });

  it('counts aliased test registrations', () => {
    // `const itDryOnly = it.skipIf(isLiveBackend())` registers tests under
    // another name (ShieldedAccessControl does this); missing them would both
    // undercount the packing and misjudge the split threshold.
    const source =
      'const itDryOnly = it.skipIf(isLiveBackend());\n' +
      block('A', `itDryOnly('a', () => {});\n${its(1)}`) +
      block('B', its(2));

    expect(splitSpec(source, 2)).toStrictEqual([
      { testFilter: '^A ', tests: 2, estimatedMs: 2 * DEFAULT_TEST_MS },
      { testFilter: '^B ', tests: 2, estimatedMs: 2 * DEFAULT_TEST_MS },
    ]);
  });

  it('counts modifier chains and .each tables as one test each', () => {
    const body =
      "it.each([1, 2, 3])('case %s', () => {});\n" + // one, however many rows
      "it.skipIf(cond)('conditional', () => {});\n" +
      "it.concurrent('parallel', () => {});\n";
    const legs = splitSpec(block('A', body) + block('B', its(3)), 3);

    expect(legs).toStrictEqual([
      { testFilter: '^A ', tests: 3, estimatedMs: 3 * DEFAULT_TEST_MS },
      { testFilter: '^B ', tests: 3, estimatedMs: 3 * DEFAULT_TEST_MS },
    ]);
  });

  it('ignores registrations in comments and strings', () => {
    const source =
      "// it('commented', () => {});\n" +
      "/* describe('block', () => {}); */\n" +
      'const s = "it(\'in a string\', x)";\n' +
      block('A', its(2)) +
      block('B', its(2));

    expect(splitSpec(source, 2)).toStrictEqual([
      { testFilter: '^A ', tests: 2, estimatedMs: 2 * DEFAULT_TEST_MS },
      { testFilter: '^B ', tests: 2, estimatedMs: 2 * DEFAULT_TEST_MS },
    ]);
  });

  it('puts top-level tests on the root remainder leg', () => {
    const legs = splitSpec(its(2, 'top') + block('A', its(2)), 2);

    expect(legs).toStrictEqual([
      { testFilter: '^(?!A )', tests: 2, estimatedMs: 2 * DEFAULT_TEST_MS },
      { testFilter: '^A ', tests: 2, estimatedMs: 2 * DEFAULT_TEST_MS },
    ]);
  });

  it('does not split a source it cannot scan to the end', () => {
    // An unbalanced scan means some construct was misread, and a filter built
    // on a misreading could silently skip tests.
    expect(splitSpec(`describe('A', () => {\n${its(4)}`, 2)).toBeNull();
  });

  it('splits the real worst offender within the limit', () => {
    // The rule exists for files like ShieldedAccessControl (85+ minutes as a
    // single live leg). Against the real source: every leg within the limit,
    // every filter a valid regex, and enough legs to matter.
    const source = readFileSync(
      path.join(
        import.meta.dirname,
        '../../../contracts/src/access/test/ShieldedAccessControl.test.ts',
      ),
      'utf8',
    );
    const legs = splitSpec(source, MAX_TESTS_PER_LEG);

    expect(legs).not.toBeNull();
    if (legs === null) return;
    expect(legs.length).toBeGreaterThanOrEqual(3);
    for (const leg of legs) {
      expect(leg.tests).toBeLessThanOrEqual(MAX_TESTS_PER_LEG);
      expect(() => new RegExp(leg.testFilter)).not.toThrow();
      expect(leg.testFilter.startsWith('^')).toBe(true);
    }
  });
});

describe('resolveMatrix splitting', () => {
  const OVER_LIMIT =
    `describe('Big', () => {\n` +
    `describe('one', () => {\n${Array.from({ length: MAX_TESTS_PER_LEG }, (_, i) => `it('a${i}', () => {});\n`).join('')}});\n` +
    `describe('two', () => {\n${Array.from({ length: 10 }, (_, i) => `it('b${i}', () => {});\n`).join('')}});\n` +
    '});\n';

  const sources: Record<string, string> = {
    'src/multisig/test/Forwarder.test.ts': OVER_LIMIT,
    'src/multisig/test/MultiSigWallet.test.ts':
      "describe('S', () => { it('t', () => {}); });\n",
  };
  const readSpec = (file: string): string | undefined => sources[file];

  it('splits a leg over the limit and leaves the others alone', () => {
    const resolution = resolveMatrix(
      request({ target: 'multisig' }),
      TARGETS,
      specs,
      readSpec,
    );

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.legs).toStrictEqual([
      {
        target: 'multisig',
        file: 'src/multisig/test/Forwarder.test.ts',
        name: 'Forwarder-1',
        testFilter: '^Big one ',
        estimatedMs: MAX_TESTS_PER_LEG * DEFAULT_TEST_MS,
      },
      {
        target: 'multisig',
        file: 'src/multisig/test/Forwarder.test.ts',
        name: 'Forwarder-2',
        testFilter: '^Big two ',
        estimatedMs: 10 * DEFAULT_TEST_MS,
      },
      {
        target: 'multisig',
        file: 'src/multisig/test/MultiSigWallet.test.ts',
        name: 'MultiSigWallet',
        estimatedMs: DEFAULT_TEST_MS,
      },
    ]);
    // One compile still serves all three legs.
    expect(resolution.targets).toStrictEqual(['multisig']);
  });

  it('still splits a file the dispatch filter selected', () => {
    // Splitting is about the file's size, not how it entered the matrix: a
    // dispatch that names the big file must not get one 40-test leg back.
    const resolution = resolveMatrix(
      request({ filter: 'Forwarder' }),
      TARGETS,
      specs,
      readSpec,
    );

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    const multisig = resolution.legs.filter((l) => l.target === 'multisig');
    expect(multisig.map((l) => l.name)).toStrictEqual([
      'Forwarder-1',
      'Forwarder-2',
    ]);
  });

  it('runs a file it cannot read as one unsplit leg', () => {
    const resolution = resolveMatrix(
      request({ target: 'multisig' }),
      TARGETS,
      specs,
      () => undefined,
    );

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.legs.map((l) => l.name)).toStrictEqual([
      'Forwarder',
      'MultiSigWallet',
    ]);
    expect(resolution.legs.every((l) => l.testFilter === undefined)).toBe(true);
  });
});

describe('prunePlan', () => {
  const HASH_A = 'a'.repeat(64);
  const HASH_B = 'b'.repeat(64);
  const NOW = Date.parse('2026-08-25T02:00:00Z');
  const DAYS = 24 * 60 * 60 * 1000;

  /** An entry accessed recently enough to survive the staleness rule. */
  const entry = (fields: Partial<CacheEntry> & { id: number }): CacheEntry => ({
    key: `Linux-deps-v1-${HASH_A}`,
    ref: 'refs/heads/main',
    createdAt: '2026-08-24T02:00:00Z',
    lastAccessedAt: '2026-08-25T01:00:00Z',
    sizeInBytes: 1024 * 1024,
    ...fields,
  });

  it('keeps a lone, recently used entry', () => {
    expect(prunePlan([entry({ id: 1 })], NOW)).toStrictEqual([]);
  });

  it('deletes every entry in a group but the newest', () => {
    // `actions/cache` restores the exact key or the newest prefix match, so an
    // older sibling can never be restored again once a newer one exists.
    const old = entry({
      id: 1,
      key: `Linux-deps-v1-${HASH_B}`,
      createdAt: '2026-08-20T02:00:00Z',
    });
    const newest = entry({ id: 2 });

    const doomed = prunePlan([old, newest], NOW);

    expect(doomed.map((d) => d.entry.id)).toStrictEqual([1]);
    expect(doomed[0]?.reason).toContain(`superseded by '${newest.key}'`);
  });

  it('groups by key prefix, not by exact key', () => {
    // Two different hashes under `Linux-live-token-` are one group; the deps
    // family is another. Only the older token entry goes.
    const doomed = prunePlan(
      [
        entry({
          id: 1,
          key: `Linux-live-token-${HASH_A}`,
          createdAt: '2026-08-20T02:00:00Z',
        }),
        entry({ id: 2, key: `Linux-live-token-${HASH_B}` }),
        entry({ id: 3 }),
      ],
      NOW,
    );

    expect(doomed.map((d) => d.entry.id)).toStrictEqual([1]);
  });

  it('never reads a newer entry on another ref as superseding', () => {
    // Cache restores are branch-scoped: a PR branch cannot restore main's
    // entry sideways, so deleting the branch's own entry would cost that
    // branch its cache entirely.
    const doomed = prunePlan(
      [
        entry({
          id: 1,
          ref: 'refs/pull/700/merge',
          createdAt: '2026-08-20T02:00:00Z',
        }),
        entry({ id: 2 }),
      ],
      NOW,
    );

    expect(doomed).toStrictEqual([]);
  });

  it('deletes an entry not restored in 7 days, even the newest', () => {
    const idle = entry({
      id: 1,
      lastAccessedAt: new Date(NOW - 8 * DAYS).toISOString(),
    });

    const doomed = prunePlan([idle], NOW);

    expect(doomed.map((d) => d.entry.id)).toStrictEqual([1]);
    expect(doomed[0]?.reason).toContain('not restored in 7 days');
  });

  it('keeps an entry idle for less than the threshold', () => {
    const idle = entry({
      id: 1,
      lastAccessedAt: new Date(NOW - 6 * DAYS).toISOString(),
    });

    expect(prunePlan([idle], NOW)).toStrictEqual([]);
  });

  it('treats a key without a hash tail as its own group', () => {
    // No prefix family to supersede within: only the staleness rule applies.
    const doomed = prunePlan(
      [
        entry({
          id: 1,
          key: 'Linux-adhoc',
          createdAt: '2026-08-20T02:00:00Z',
        }),
        entry({ id: 2, key: 'Linux-adhoc-two' }),
      ],
      NOW,
    );

    expect(doomed).toStrictEqual([]);
  });
});

describe('GhCacheClient and pruneCaches', () => {
  const recorder = (results: readonly Captured[] = []) => {
    const argv: string[][] = [];
    const exec: Exec = (cmd, args) => {
      argv.push([cmd, ...args]);
      return results[argv.length - 1] ?? { status: 0, stdout: '', stderr: '' };
    };
    return { argv, exec };
  };

  const apiEntry = (id: number, key: string) => ({
    id,
    key,
    ref: 'refs/heads/main',
    created_at: '2026-08-24T02:00:00Z',
    last_accessed_at: '2026-08-25T01:00:00Z',
    size_in_bytes: 2 * 1024 * 1024,
  });

  it('lists entries through the caches endpoint', () => {
    const { argv, exec } = recorder([
      {
        status: 0,
        stdout: JSON.stringify({
          total_count: 1,
          actions_caches: [apiEntry(7, 'Linux-adhoc')],
        }),
        stderr: '',
      },
    ]);

    expect(new GhCacheClient('o/r', exec).list()).toStrictEqual([
      {
        id: 7,
        key: 'Linux-adhoc',
        ref: 'refs/heads/main',
        createdAt: '2026-08-24T02:00:00Z',
        lastAccessedAt: '2026-08-25T01:00:00Z',
        sizeInBytes: 2 * 1024 * 1024,
      },
    ]);
    expect(argv[0]).toStrictEqual([
      'gh',
      'api',
      '/repos/o/r/actions/caches?per_page=100&page=1',
    ]);
  });

  it('walks pages until one comes back short', () => {
    // `--paginate` concatenates page objects into invalid JSON for this
    // endpoint, so the adapter pages explicitly.
    const fullPage = Array.from({ length: 100 }, (_, i) =>
      apiEntry(i, `k${i}`),
    );
    const { argv, exec } = recorder([
      {
        status: 0,
        stdout: JSON.stringify({ actions_caches: fullPage }),
        stderr: '',
      },
      {
        status: 0,
        stdout: JSON.stringify({ actions_caches: [apiEntry(100, 'last')] }),
        stderr: '',
      },
    ]);

    expect(new GhCacheClient('o/r', exec).list()).toHaveLength(101);
    expect(argv[1]?.[2]).toBe('/repos/o/r/actions/caches?per_page=100&page=2');
  });

  it('deletes by id with an explicit method', () => {
    const { argv, exec } = recorder();

    new GhCacheClient('o/r', exec).delete(42);

    expect(argv[0]).toStrictEqual([
      'gh',
      'api',
      '--method',
      'DELETE',
      '/repos/o/r/actions/caches/42',
    ]);
  });

  it('throws with gh stderr when a call fails', () => {
    const { exec } = recorder([
      { status: 1, stdout: '', stderr: 'HTTP 403\n' },
    ]);

    expect(() => new GhCacheClient('o/r', exec).list()).toThrow(
      /gh api .*caches.* failed \(exit 1\): HTTP 403/,
    );
  });

  it('prunes what the plan doomed and reports the freed size', () => {
    const deleted: number[] = [];
    const HASH_A = 'a'.repeat(64);
    const HASH_B = 'b'.repeat(64);
    const client = {
      list: (): CacheEntry[] => [
        {
          id: 1,
          key: `Linux-deps-v1-${HASH_A}`,
          ref: 'refs/heads/main',
          createdAt: '2026-08-20T02:00:00Z',
          lastAccessedAt: '2026-08-25T01:00:00Z',
          sizeInBytes: 3 * 1024 * 1024,
        },
        {
          id: 2,
          key: `Linux-deps-v1-${HASH_B}`,
          ref: 'refs/heads/main',
          createdAt: '2026-08-24T02:00:00Z',
          lastAccessedAt: '2026-08-25T01:00:00Z',
          sizeInBytes: 3 * 1024 * 1024,
        },
      ],
      delete: (id: number): void => {
        deleted.push(id);
      },
    };
    const logged = vi.spyOn(console, 'log').mockImplementation(() => {});

    const summary = pruneCaches(client, Date.parse('2026-08-25T02:00:00Z'));

    expect(deleted).toStrictEqual([1]);
    expect(summary).toBe('pruned 1 of 2 cache entries (3 MB freed).');
    expect(logged.mock.calls.flat().join('\n')).toContain('Linux-deps-v1-');

    logged.mockRestore();
  });
});
describe('splitSpec weighting', () => {
  const its = (n: number, prefix = 't'): string =>
    Array.from(
      { length: n },
      (_, i) => `it('${prefix}${i}', () => {});\n`,
    ).join('');
  const block = (name: string, body: string): string =>
    `describe('${name}', () => {\n${body}});\n`;

  /** History for every test the fixtures register: `<describe> <prefix><i>`,
   * the space-joined form the leg patterns match. */
  const history = (
    perTest: Readonly<Record<string, number>>,
    tests: number,
    prefix = 't',
  ): Map<string, number> => {
    const map = new Map<string, number>();
    for (const [name, ms] of Object.entries(perTest)) {
      for (let i = 0; i < tests; i++) map.set(`${name} ${prefix}${i}`, ms);
    }
    return map;
  };

  // The MultiToken shape: few tests, each several minutes. 20 tests over four
  // describes is far under the 30-test cap, but at 3 min/test the file is a
  // ~1h leg — the exact under-split run 32831811290 measured.
  const HEAVY =
    block('A', its(5)) +
    block('B', its(5)) +
    block('C', its(5)) +
    block('D', its(5));
  const HEAVY_MS = history(
    { A: 180_000, B: 180_000, C: 180_000, D: 180_000 },
    5,
  );

  it('splits a heavy file that count packing leaves whole', () => {
    // 20 tests ≤ 30: the count rule sees nothing to do.
    expect(splitSpec(HEAVY, MAX_TESTS_PER_LEG)).toBeNull();

    // 20 × 180s = 60 minutes of measured history: over the ~27.5 min budget,
    // so the same file now fans out, each leg within it.
    const legs = splitSpec(HEAVY, MAX_TESTS_PER_LEG, HEAVY_MS);

    expect(legs).not.toBeNull();
    if (legs === null) return;
    expect(legs.length).toBeGreaterThanOrEqual(2);
    for (const leg of legs) {
      expect(leg.estimatedMs).toBeLessThanOrEqual(
        MAX_TESTS_PER_LEG * DEFAULT_TEST_MS,
      );
    }
    // Every test still runs exactly once.
    expect(legs.reduce((sum, leg) => sum + leg.tests, 0)).toBe(20);
  });

  it('packs exactly as the count rule when no test matches the history', () => {
    // The equivalence the fallback promises: uniform default weights make
    // every weight comparison the count comparison scaled by the default, so
    // no history, an empty history, and another file's history all produce
    // the same legs the count-based rule did.
    const source = block('A', its(2)) + block('B', its(2)) + block('C', its(1));
    const byCount = splitSpec(source, 2);

    expect(byCount).not.toBeNull();
    expect(splitSpec(source, 2, new Map())).toStrictEqual(byCount);
    expect(
      splitSpec(source, 2, history({ 'Other file suite': 999_000 }, 2)),
    ).toStrictEqual(byCount);
  });

  it('matches history names the way the leg patterns are built', () => {
    // The lookup keys are full names in the split's own convention —
    // space-joined describe path plus test name. A measured describe carries
    // its duration; an unmeasured sibling weighs the default per test.
    const source = block('A', its(2)) + block('B', its(2));
    const legs = splitSpec(source, 2, history({ A: 50_000 }, 2));

    expect(legs).toStrictEqual([
      { testFilter: '^A ', tests: 2, estimatedMs: 100_000 },
      { testFilter: '^B ', tests: 2, estimatedMs: 2 * DEFAULT_TEST_MS },
    ]);
  });

  it('gives a measured, indivisible, over-budget describe its own leg', () => {
    // A cannot be subdivided (no child describes) and its MEASURED weight
    // exceeds the budget. Its filter is still exact, so it stands alone as an
    // oversized leg — refusing here would collapse the whole file into one
    // even longer leg (the exact way MultiToken degraded in the first cut).
    const source = block('A', its(2)) + block('B', its(2));
    const legs = splitSpec(source, 2, history({ A: 400_000 }, 2));

    expect(legs).toStrictEqual([
      { testFilter: '^A ', tests: 2, estimatedMs: 800_000 },
      { testFilter: '^B ', tests: 2, estimatedMs: 2 * DEFAULT_TEST_MS },
    ]);
  });

  it('still refuses an over-budget indivisible unit assumed from defaults', () => {
    // Without a measurement the overrun is a guess, so the old count rule
    // stands: a 4-test leaf describe at limit 2 does not split, history or
    // not — this is the count-equivalence corner, pinned on purpose.
    const source = block('A', its(4)) + block('B', its(1));

    expect(splitSpec(source, 2, history({ B: 10_000 }, 1))).toBeNull();
  });

  it('descends into a heavy describe with splittable children', () => {
    // P as a whole (160s) is over the 110s budget, but each child fits: the
    // walk recurses into P instead of giving up on it.
    const source = block('P', block('x', its(2)) + block('y', its(2)));
    const legs = splitSpec(
      source,
      2,
      history({ 'P x': 40_000, 'P y': 40_000 }, 2),
    );

    expect(legs).toStrictEqual([
      { testFilter: '^P x ', tests: 2, estimatedMs: 80_000 },
      { testFilter: '^P y ', tests: 2, estimatedMs: 80_000 },
    ]);
  });
});

describe('estimateSpecMs', () => {
  it('weighs an unmeasured file at the default per test', () => {
    expect(estimateSpecMs("describe('A', () => { it('t', () => {}); });")).toBe(
      DEFAULT_TEST_MS,
    );
  });

  it('prefers measured durations and defaults the rest', () => {
    expect(
      estimateSpecMs(
        "describe('A', () => { it('t0', () => {}); it('t1', () => {}); });",
        new Map([['A t0', 120_000]]),
      ),
    ).toBe(120_000 + DEFAULT_TEST_MS);
  });

  it('reports no estimate for a source it cannot scan', () => {
    expect(estimateSpecMs("describe('A', () => {")).toBeUndefined();
  });
});

describe('collectDurations', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'live-weights-'));
  });

  const write = (relPath: string, body: unknown): void => {
    const file = path.join(dir, relPath);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(body));
  };

  const report = (file: string, tests: Record<string, number | undefined>) => ({
    testResults: [
      {
        name: file,
        status: 'passed',
        assertionResults: Object.entries(tests).map(([fullName, duration]) => ({
          fullName,
          status: duration === undefined ? 'skipped' : 'passed',
          ...(duration === undefined ? {} : { duration }),
        })),
      },
    ],
  });

  it('walks the artifact subdirectories gh run download creates', () => {
    write(
      'live-reports-token-MultiToken-1/live-r1-token.json',
      report('/ci/contracts/src/token/test/MultiToken.test.ts', {
        'M a': 1000,
      }),
    );
    write(
      'live-reports-access-Ownable/live-r1-access.json',
      report('/ci/contracts/src/access/test/Ownable.test.ts', { 'O b': 2000 }),
    );

    const collected = collectDurations(dir);

    expect([...collected.keys()].sort()).toStrictEqual([
      '/ci/contracts/src/access/test/Ownable.test.ts',
      '/ci/contracts/src/token/test/MultiToken.test.ts',
    ]);
  });

  it('keeps the maximum duration seen for a name across reports', () => {
    // A round-2 re-run reports the same names; the pessimistic estimate is
    // the one that keeps a leg under its budget.
    write('a/live-r1-token.json', report('/ci/f.test.ts', { 'S t': 1000 }));
    write('b/live-r2-f.json', report('/ci/f.test.ts', { 'S t': 5000 }));

    expect(collectDurations(dir).get('/ci/f.test.ts')).toStrictEqual(
      new Map([['S t', 5000]]),
    );
  });

  it('skips tests that report no duration', () => {
    // A `-t`-skipped or `.skipIf`-ed test has no measurement to contribute.
    write(
      'a/live-r1-token.json',
      report('/ci/f.test.ts', { ran: 1000, skipped: undefined }),
    );

    expect(collectDurations(dir).get('/ci/f.test.ts')).toStrictEqual(
      new Map([['ran', 1000]]),
    );
  });

  it('ignores files that are not reports, and unreadable reports', () => {
    write('a/notes.json', report('/ci/f.test.ts', { 'S t': 1000 }));
    writeFileSync(path.join(dir, 'live-r1-token.json'), '{"testResults":[');

    expect(collectDurations(dir)).toStrictEqual(new Map());
  });

  it('collects nothing from a directory that does not exist', () => {
    expect(collectDurations(path.join(dir, 'absent'))).toStrictEqual(new Map());
  });
});

describe('durationsForFile', () => {
  const collected = new Map([
    [
      '/home/runner/work/repo/contracts/src/token/test/MultiToken.test.ts',
      new Map([['M a', 1000]]),
    ],
    [
      '/home/runner/work/repo/contracts/src/access/test/MultiToken.test.ts',
      new Map([['M a', 9000]]),
    ],
  ]);

  it('finds a report path by its contracts-relative suffix', () => {
    // Reports carry the absolute path of the runner that wrote them; the plan
    // works in contracts/-relative paths.
    expect(
      durationsForFile(collected, 'src/token/test/MultiToken.test.ts'),
    ).toStrictEqual(new Map([['M a', 1000]]));
  });

  it('never lets a same-named file in another directory answer', () => {
    expect(
      durationsForFile(collected, 'src/access/test/MultiToken.test.ts'),
    ).toStrictEqual(new Map([['M a', 9000]]));
  });

  it('reports no history for a file no report covers', () => {
    expect(
      durationsForFile(collected, 'src/token/test/New.test.ts'),
    ).toBeUndefined();
  });
});

describe('resolveMatrix weighting', () => {
  const heavySource =
    `describe('M', () => {\n` +
    `describe('a', () => {\n${Array.from({ length: 5 }, (_, i) => `it('t${i}', () => {});\n`).join('')}});\n` +
    `describe('b', () => {\n${Array.from({ length: 5 }, (_, i) => `it('t${i}', () => {});\n`).join('')}});\n` +
    '});\n';
  const readSpec = (file: string): string | undefined =>
    file === 'src/token/test/FungibleToken.test.ts' ? heavySource : undefined;
  const heavyDurations = new Map(
    ['a', 'b'].flatMap((d) =>
      Array.from({ length: 5 }, (_, i) => [`M ${d} t${i}`, 300_000] as const),
    ),
  );

  it('splits by measured weight and estimates every leg', () => {
    // 10 tests would never split by count; 10 × 5 min of history fans the
    // file out and surfaces the estimate the plan job logs.
    const resolution = resolveMatrix(
      request({ target: 'token' }),
      TARGETS,
      specs,
      readSpec,
      (file) =>
        file === 'src/token/test/FungibleToken.test.ts'
          ? heavyDurations
          : undefined,
    );

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.legs).toStrictEqual([
      {
        target: 'token',
        file: 'src/token/test/FungibleToken.test.ts',
        name: 'FungibleToken-1',
        testFilter: '^M a ',
        estimatedMs: 1_500_000,
      },
      {
        target: 'token',
        file: 'src/token/test/FungibleToken.test.ts',
        name: 'FungibleToken-2',
        testFilter: '^M b ',
        estimatedMs: 1_500_000,
      },
    ]);
  });

  it('keeps the count behaviour for the same file without history', () => {
    const resolution = resolveMatrix(
      request({ target: 'token' }),
      TARGETS,
      specs,
      readSpec,
    );

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.legs).toStrictEqual([
      {
        target: 'token',
        file: 'src/token/test/FungibleToken.test.ts',
        name: 'FungibleToken',
        estimatedMs: 10 * DEFAULT_TEST_MS,
      },
    ]);
  });
});

describe('fetchPreviousReports', () => {
  const recorder = (results: readonly Captured[] = []) => {
    const argv: string[][] = [];
    const exec: Exec = (cmd, args) => {
      argv.push([cmd, ...args]);
      return results[argv.length - 1] ?? { status: 0, stdout: '', stderr: '' };
    };
    return { argv, exec };
  };
  const OPTS = { repo: 'o/r', workflow: 'live.yml', outDir: '/tmp/history' };

  it('downloads the newest completed run, whatever its conclusion', () => {
    const { argv, exec } = recorder([
      { status: 0, stdout: '[{"databaseId":123}]', stderr: '' },
    ]);

    const summary = fetchPreviousReports(OPTS, exec);

    expect(argv[0]).toStrictEqual([
      'gh',
      'run',
      'list',
      '--workflow',
      'live.yml',
      // Completed, not successful: a failed nightly's timings are as real as
      // a green run's, and the reports upload on every run.
      '--status',
      'completed',
      '--limit',
      '1',
      '--json',
      'databaseId',
      '--repo',
      'o/r',
    ]);
    expect(argv[1]).toStrictEqual([
      'gh',
      'run',
      'download',
      '123',
      '--pattern',
      'live-reports-*',
      '--dir',
      '/tmp/history',
      '--repo',
      'o/r',
    ]);
    expect(summary).toContain("downloaded run 123's timing reports");
  });

  it('reports, never throws, when no completed run exists', () => {
    const { argv, exec } = recorder([{ status: 0, stdout: '[]', stderr: '' }]);

    expect(fetchPreviousReports(OPTS, exec)).toContain('no completed');
    expect(argv).toHaveLength(1); // no download attempted
  });

  it('reports, never throws, when the listing fails', () => {
    const { exec } = recorder([{ status: 1, stdout: '', stderr: 'HTTP 500' }]);

    expect(fetchPreviousReports(OPTS, exec)).toContain('gh run list failed');
  });

  it('reports, never throws, when the artifacts are gone', () => {
    // The usual cause: 14-day retention expired the previous run's reports.
    const { exec } = recorder([
      { status: 0, stdout: '[{"databaseId":123}]', stderr: '' },
      {
        status: 1,
        stdout: '',
        stderr: 'no artifact matches any of the names',
      },
    ]);

    expect(fetchPreviousReports(OPTS, exec)).toContain(
      'could not download reports of run 123',
    );
  });
});
