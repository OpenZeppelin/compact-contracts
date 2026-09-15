import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactCompiler } from '../ArtifactCompiler.ts';
import {
  classify,
  INFRA_ABORT,
  LiveOrchestrator,
} from '../LiveOrchestrator.ts';
import type { LiveStack } from '../LiveStack.ts';
import type { Reporter } from '../Reporter.ts';
import type { LiveTarget } from '../targets.ts';
import type { VitestRunner } from '../VitestRunner.ts';

/**
 * Dry unit tests for `LiveOrchestrator.ts`: a round driven through stand-in
 * collaborators, plus the pure flake classification. Nothing here touches
 * docker, the node, or the artifact tree.
 */

// The one collaborator the orchestrator does not take by injection is the
// harness-smoke spawn, so `run` is stubbed to succeed. Everything else in
// `shell.ts` stays real (`banner` prints through the console spies below).
vi.mock('../shell.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shell.ts')>()),
  run: async () => 0,
}));

describe('LiveOrchestrator', () => {
  // Deliberately not a real category, so clearing stale reports finds nothing.
  const TARGET = {
    name: 'faketarget',
    project: 'unit-live',
    defaultFilters: ['src/faketarget'],
  } as const;

  /** The positional filters each `VitestRunner.run` call received, in order. */
  let ran: { target: string; filters: readonly string[] }[] = [];

  /** What the run handed `Reporter.verdict`, for the classification cases. */
  let verdicts: {
    flaky: readonly string[];
    real: readonly string[];
    causes: ReadonlyMap<string, string> | undefined;
  }[] = [];

  /** A round wired to stand-ins: every collaborator but the harness-smoke spawn
   * is constructor-injected, so a whole round runs without docker or vitest. */
  const roundOver = (opts: {
    readonly fileStatuses: () => Map<string, string> | undefined;
    readonly targets?: readonly LiveTarget[];
    readonly fileFilters?: readonly string[];
    readonly specFiles?: (target: string) => readonly string[];
    readonly testPattern?: string;
    readonly reportedTestNames?: () => string[] | undefined;
    readonly failedTestMessages?: () => Map<string, string[][]> | undefined;
  }): LiveOrchestrator => {
    const targets = opts.targets ?? [TARGET];
    return new LiveOrchestrator({
      plan: {
        targets,
        fileFilters: opts.fileFilters ?? [],
        integration: false,
      },
      stack: { up: async () => 0, stop: () => {} } as unknown as LiveStack,
      compiler: {
        compileVerified: async () => true,
      } as unknown as ArtifactCompiler,
      runner: {
        run: async (_project: string, report: string, filters: string[]) => {
          // The report path names the target (`live-r1-<target>.json`), so a
          // skipped target cannot be mistaken for the one that ran after it.
          ran.push({
            target: path.basename(report).replace(/^live-r1-|\.json$/g, ''),
            filters,
          });
          return 0;
        },
        fileStatuses: opts.fileStatuses,
        reportedTestNames: opts.reportedTestNames,
        failedTestMessages:
          opts.failedTestMessages ?? (() => new Map<string, string[][]>()),
      } as unknown as VitestRunner,
      reporter: {
        firstRunGreen: () => 0,
        verdict: (
          flaky: readonly string[],
          real: readonly string[],
          causes?: ReadonlyMap<string, string>,
        ) => {
          verdicts.push({ flaky, real, causes });
          return real.length === 0 ? 0 : 1;
        },
      } as unknown as Reporter,
      specFiles: opts.specFiles,
      testPattern: opts.testPattern,
    });
  };

  let logged: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    ran = [];
    verdicts = [];
    logged = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logged.mockRestore();
  });

  const output = (): string => logged.mock.calls.flat().join('\n');

  it('aborts when the run matched no test file', async () => {
    // A mistyped target is indistinguishable from a file filter, and
    // `--passWithNoTests` makes vitest exit 0 with an empty report — so without
    // this guard the run reports PASSED having executed nothing.
    const code = await roundOver({
      fileStatuses: () => new Map(),
      fileFilters: ['multsig'],
      specFiles: () => ['src/faketarget/test/Thing.test.ts'],
    }).run();

    expect(code).toBe(INFRA_ABORT);
    expect(output()).toContain('no test file matched');
    expect(output()).toContain('filter: multsig');
  });

  it('aborts when a target wrote no report at all', async () => {
    const code = await roundOver({ fileStatuses: () => undefined }).run();

    expect(code).toBe(INFRA_ABORT);
    expect(output()).toContain('produced no results file');
  });

  it('aborts when the test pattern matches no reported name', async () => {
    // A `-t` that matches nothing is silently green in vitest (the file
    // reports "passed" with every test skipped), so a stale split pattern
    // would pass a leg that ran zero tests.
    const code = await roundOver({
      fileStatuses: () => new Map([['a.test.ts', 'passed']]),
      testPattern: '^Renamed suite ',
      reportedTestNames: () => ['Suite one', 'Suite two'],
    }).run();

    expect(code).toBe(INFRA_ABORT);
    expect(output()).toContain('matched none');
  });

  it('passes a pattern whose matches are all runtime-skipped', async () => {
    // `.skipIf(isLiveBackend())` legitimately empties a slice on live; the
    // names are still reported, which is how this differs from a stale
    // pattern. Aborting here would turn a valid dry-only slice red.
    const code = await roundOver({
      fileStatuses: () => new Map([['a.test.ts', 'passed']]),
      testPattern: '^Suite one',
      reportedTestNames: () => ['Suite one dry-only check'],
    }).run();

    expect(code).toBe(0);
  });

  it('leaves a failing file to the flake rounds, pattern or not', async () => {
    // A failure already tells its own story; the pattern guard must not
    // reclassify it as an infrastructure abort.
    const code = await roundOver({
      fileStatuses: () => new Map([['a.test.ts', 'failed']]),
      testPattern: '^Nothing matches this ',
      reportedTestNames: () => ['Suite one'],
    }).run();

    expect(code).not.toBe(INFRA_ABORT);
    expect(output()).not.toContain('matched none');
  });

  it('reports the first run green when every file passed', async () => {
    const code = await roundOver({
      fileStatuses: () => new Map([['a.test.ts', 'passed']]),
    }).run();

    expect(code).toBe(0);
  });

  it('runs the whole target when no filter was given', async () => {
    await roundOver({
      fileStatuses: () => new Map([['a.test.ts', 'passed']]),
    }).run();

    expect(ran).toStrictEqual([
      { target: 'faketarget', filters: TARGET.defaultFilters },
    ]);
  });

  it('hands a file filter over as matching paths under the target', async () => {
    // Not the filter itself: vitest ORs positional filters against the whole
    // project include, so `Forwarder` alone would also run another target's
    // `Forwarder` spec — in CI, where each target is its own job, twice.
    await roundOver({
      fileStatuses: () => new Map([['a.test.ts', 'passed']]),
      fileFilters: ['forwarder'],
      specFiles: () => [
        'src/faketarget/test/Forwarder.test.ts',
        'src/faketarget/test/Other.test.ts',
      ],
    }).run();

    expect(ran).toStrictEqual([
      {
        target: 'faketarget',
        // Matched case-insensitively, as vitest matches it.
        filters: ['src/faketarget/test/Forwarder.test.ts'],
      },
    ]);
  });

  it('skips a target the filter matches nothing under', async () => {
    // An empty filter list would run the target's whole include glob, so this
    // has to skip rather than fall through.
    const other = {
      name: 'othertarget',
      project: 'unit-live',
      defaultFilters: ['src/othertarget'],
    } as const;

    await roundOver({
      fileStatuses: () => new Map([['a.test.ts', 'passed']]),
      targets: [TARGET, other],
      fileFilters: ['Forwarder'],
      specFiles: (target) =>
        target === 'faketarget'
          ? ['src/faketarget/test/Forwarder.test.ts']
          : ['src/othertarget/test/Unrelated.test.ts'],
    }).run();

    expect(ran).toStrictEqual([
      {
        target: 'faketarget',
        filters: ['src/faketarget/test/Forwarder.test.ts'],
      },
    ]);
    expect(output()).toContain('othertarget: no file matches Forwarder');
  });

  it('skips round 2 when every failure in a file is deterministic', async () => {
    // "1010: Invalid Transaction" on a deploy is a property of the tx, not of
    // node state — a fresh node returns the same rejection, so the re-run
    // would only double the loss (run 32831811290: 11 legs, all like this).
    const code = await roundOver({
      fileStatuses: () => new Map([['a.test.ts', 'failed']]),
      failedTestMessages: () =>
        new Map([
          [
            'a.test.ts',
            [
              [
                'Error: 1010: Invalid Transaction: Transaction would exhaust the block limits\n    at deploy…',
              ],
              ['Error: Custom error: 186\n    at _mint…'],
            ],
          ],
        ]),
    }).run();

    expect(code).toBe(1); // still a real failure
    expect(ran).toHaveLength(1); // round 1 only — no re-run
    expect(verdicts).toStrictEqual([
      {
        flaky: [],
        real: ['a.test.ts'],
        causes: new Map([
          ['a.test.ts', 'block limits + unclaimed shielded output (err 186)'],
        ]),
      },
    ]);
    expect(output()).toContain('skipping round 2 for 1 file(s)');
    expect(output()).toContain('a.test.ts — deterministic: block limits');
  });

  it('keeps round 2 for a file with any non-deterministic failure', async () => {
    // One matched failure next to an unknown one proves nothing about the
    // file as a whole; it keeps today's flake check exactly.
    const code = await roundOver({
      fileStatuses: () => new Map([['a.test.ts', 'failed']]),
      failedTestMessages: () =>
        new Map([
          [
            'a.test.ts',
            [
              ['Error: Transaction would exhaust the block limits'],
              ['AssertionError: expected 1 to be 2'],
            ],
          ],
        ]),
    }).run();

    expect(code).toBe(1);
    expect(ran).toHaveLength(2); // round 1, then the file alone in round 2
    expect(verdicts).toStrictEqual([
      { flaky: [], real: ['a.test.ts'], causes: new Map() },
    ]);
  });

  it('keeps round 2 when the failure reached no assertion', async () => {
    // A hook crash reports at file level with no failed tests; an empty list
    // proves nothing, so the file must not lose its flake check.
    await roundOver({
      fileStatuses: () => new Map([['a.test.ts', 'failed']]),
      failedTestMessages: () => new Map([['a.test.ts', []]]),
    }).run();

    expect(ran).toHaveLength(2);
  });
});

describe('classify', () => {
  it('demotes a round-2 pass to flaky', () => {
    expect(
      classify(['a.test.ts'], new Map([['a.test.ts', 'passed']])),
    ).toStrictEqual({ flaky: ['a.test.ts'], real: [] });
  });

  it('keeps a file that failed round 2 as a real failure', () => {
    expect(
      classify(['a.test.ts'], new Map([['a.test.ts', 'failed']])),
    ).toStrictEqual({ flaky: [], real: ['a.test.ts'] });
  });

  it('keeps a file missing from the round-2 map as a real failure', () => {
    expect(classify(['a.test.ts'], new Map())).toStrictEqual({
      flaky: [],
      real: ['a.test.ts'],
    });
  });

  it('splits a mixed round-2 result', () => {
    const round2 = new Map([
      ['flake.test.ts', 'passed'],
      ['broken.test.ts', 'failed'],
      ['crashed.test.ts', 'skipped'],
    ]);

    expect(
      classify(
        ['flake.test.ts', 'broken.test.ts', 'crashed.test.ts', 'gone.test.ts'],
        round2,
      ),
    ).toStrictEqual({
      flaky: ['flake.test.ts'],
      real: ['broken.test.ts', 'crashed.test.ts', 'gone.test.ts'],
    });
  });
});
