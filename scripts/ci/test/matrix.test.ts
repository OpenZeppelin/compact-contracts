import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ALL_TARGETS, LIVE_LABEL, legNames, resolveMatrix } from '../matrix.ts';
import { DEFAULT_TEST_MS, MAX_TESTS_PER_LEG } from '../split.ts';

/**
 * Unit tests for `matrix.ts`: resolving the matrix of live targets that
 * `live.yml` used to do in `run:` shell. Nothing here touches the network.
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
    // form is refused; both spelled-out forms stay reachable from a label.
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
    expect(resolution.message).toContain(`'${LIVE_LABEL}:${ALL_TARGETS}'`);
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

  it('runs every target from a `live-tests:all` label', () => {
    // The label form of the dispatch's `all`: the full fan-out in one label.
    expect(
      resolveMatrix(
        request({ label: `${LIVE_LABEL}:${ALL_TARGETS}` }),
        TARGETS,
        specs,
      ),
    ).toStrictEqual(expected(SPECS));
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
        testFilter: '^Big > one > ',
        estimatedMs: MAX_TESTS_PER_LEG * DEFAULT_TEST_MS,
      },
      {
        target: 'multisig',
        file: 'src/multisig/test/Forwarder.test.ts',
        name: 'Forwarder-2',
        testFilter: '^Big > two > ',
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
      Array.from(
        { length: 5 },
        (_, i) => [`M > ${d} > t${i}`, 300_000] as const,
      ),
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
        testFilter: '^M > a > ',
        estimatedMs: 1_500_000,
      },
      {
        target: 'token',
        file: 'src/token/test/FungibleToken.test.ts',
        name: 'FungibleToken-2',
        testFilter: '^M > b > ',
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
