import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactCompiler } from '../ArtifactCompiler.ts';
import {
  DETERMINISTIC_FAILURES,
  deterministicCause,
} from '../deterministic.ts';
import {
  classify,
  INFRA_ABORT,
  LiveOrchestrator,
} from '../LiveOrchestrator.ts';
import type { LiveStack } from '../LiveStack.ts';
import { INTEGRATION_MOCKS, round2Report, SRC } from '../paths.ts';
import type { Reporter } from '../Reporter.ts';
import { RunLock } from '../RunLock.ts';
import { filterSpecFiles, specFiles, specFilesIn } from '../specs.ts';
import {
  compileScope,
  type LivePlan,
  type LiveTarget,
  listTargets,
  parseInvocation,
  resolvePlan,
} from '../targets.ts';
import { VitestRunner } from '../VitestRunner.ts';

/**
 * Dry unit tests for the live orchestrator's pure pieces (plan resolution, flake
 * classification, report naming), the two services that only touch the filesystem
 * (the run lock, and reading back a vitest JSON report), and a round driven
 * through stand-in collaborators. Nothing here touches docker, the node, or the
 * artifact tree.
 */

// The one collaborator the orchestrator does not take by injection is the
// harness-smoke spawn, so `run` is stubbed to succeed. Everything else in
// `shell.ts` stays real (`banner` prints through the console spies below).
// The stub records its argv so `VitestRunner.run` can be asserted on the
// arguments it builds (the `-t` pattern in particular) without spawning.
const spawned = vi.hoisted(
  () => [] as { cmd: string; args: readonly string[] }[],
);
vi.mock('../shell.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shell.ts')>()),
  run: async (cmd: string, args: readonly string[] = []) => {
    spawned.push({ cmd, args });
    return 0;
  },
}));

/** `liveCategories()` reads `src/`, so every case passes this explicitly to keep
 * the tests independent of the on-disk category set. */
const CATEGORIES = ['multisig', 'token'] as const;

describe('listTargets', () => {
  it('lists every category plus the integration target', () => {
    // CI builds its matrix from this (`test:live --list`), so a dropped entry
    // would surface only as a silently missing job — a live target nobody runs.
    expect(listTargets(CATEGORIES)).toStrictEqual([
      'multisig',
      'token',
      'integration',
    ]);
  });

  it('still offers the integration target when no category has tests', () => {
    // `integration` is not a `src/` category, so it does not come from the
    // discovered category set the way the unit targets do.
    expect(listTargets([])).toStrictEqual(['integration']);
  });
});

describe('resolvePlan', () => {
  it('scopes to the integration target', () => {
    const resolution = resolvePlan(['integration'], CATEGORIES);

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    // 'integration' is deliberately NOT in CATEGORIES: it is not a `src/`
    // category, so the guard has to match it before the category branch or the
    // run falls through to the unscoped path (the original INV-10 bug).
    expect(resolution.plan.targets).toStrictEqual([
      { name: 'integration', project: 'integration-live', defaultFilters: [] },
    ]);
    expect(resolution.plan.integration).toBe(true);
    expect(resolution.plan.fileFilters).toStrictEqual([]);
  });

  it('passes trailing args after the integration target as file filters', () => {
    const resolution = resolvePlan(
      ['integration', 'confidentialFungibleToken'],
      CATEGORIES,
    );

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.plan.fileFilters).toStrictEqual([
      'confidentialFungibleToken',
    ]);
    expect(resolution.plan.integration).toBe(true);
  });

  it('scopes to a unit category', () => {
    const resolution = resolvePlan(['multisig'], CATEGORIES);

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.plan.targets).toStrictEqual([
      {
        name: 'multisig',
        project: 'unit-live',
        defaultFilters: ['src/multisig'],
      },
    ]);
    expect(resolution.plan.integration).toBe(false);
  });

  it('passes trailing args after a category as file filters', () => {
    const resolution = resolvePlan(['multisig', 'Forwarder'], CATEGORIES);

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.plan.fileFilters).toStrictEqual(['Forwarder']);
  });

  it('rejects an excluded category by name', () => {
    // `archive` never reaches `liveCategories()`, so without the excluded-set
    // branch it would be reported as an unknown target — true but unhelpful.
    const resolution = resolvePlan(['archive'], CATEGORIES);

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.message).toContain(
      "'archive' is excluded from live runs",
    );
    expect(resolution.message).toContain('Live targets: multisig, token');
    expect(resolution.message).toContain("'integration'");
  });

  it('rejects an unknown first arg instead of running it as a file filter', () => {
    // Rejecting here is what keeps a typo from burning a compile / env-up /
    // harness-smoke cycle only to match no files.
    const resolution = resolvePlan(['someFileFilter'], CATEGORIES);

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.message).toContain(
      "'someFileFilter' is not a live target",
    );
    expect(resolution.message).toContain('Live targets: multisig, token');
  });

  it('runs every category when unscoped', () => {
    const resolution = resolvePlan([], CATEGORIES);

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.plan.targets).toStrictEqual([
      {
        name: 'multisig',
        project: 'unit-live',
        defaultFilters: ['src/multisig'],
      },
      { name: 'token', project: 'unit-live', defaultFilters: ['src/token'] },
    ]);
    expect(resolution.plan.fileFilters).toStrictEqual([]);
    expect(resolution.plan.integration).toBe(false);
  });
});

describe('parseInvocation', () => {
  /** The mode and the surviving positionals, which is all a caller reads. */
  const parse = (argv: string[]) => {
    const resolution = parseInvocation(argv);
    if (!resolution.ok) throw new Error(resolution.message);
    return resolution.invocation;
  };

  it('defaults to building, with every arg positional', () => {
    expect(parse(['multisig', 'Forwarder'])).toStrictEqual({
      mode: 'build',
      args: ['multisig', 'Forwarder'],
    });
  });

  it('reads --compile-only and keeps the target positional', () => {
    expect(parse(['token', '--compile-only'])).toStrictEqual({
      mode: 'build-only',
      args: ['token'],
    });
  });

  it('reads --prebuilt alongside a file filter', () => {
    expect(
      parse(['token', 'src/token/test/FungibleToken.test.ts', '--prebuilt']),
    ).toStrictEqual({
      mode: 'prebuilt',
      args: ['token', 'src/token/test/FungibleToken.test.ts'],
    });
  });

  it('drops the `--` yarn passes through', () => {
    expect(parse(['--', 'token'])).toStrictEqual({
      mode: 'build',
      args: ['token'],
    });
  });

  it('rejects the two modes together', () => {
    // One builds the artifacts and the other forbids building them, so there is
    // no run this could mean.
    const resolution = parseInvocation(['--compile-only', '--prebuilt']);

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.message).toContain('pass one or the other');
  });

  it('rejects an unknown flag by name', () => {
    // Left in, it would reach `resolvePlan` as a positional and come back as
    // "not a live target", which points at the wrong fix.
    const resolution = parseInvocation(['token', '--prebuild']);

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.message).toContain("unknown flag '--prebuild'");
    expect(resolution.message).toContain('--compile-only, --prebuilt');
  });

  it('accepts a flag repeated', () => {
    expect(parse(['--prebuilt', 'token', '--prebuilt'])).toStrictEqual({
      mode: 'prebuilt',
      args: ['token'],
    });
  });
});

describe('compileScope', () => {
  /** Resolve a plan the way `main()` does, failing the test on a rejection so
   * the scope cases stay about scoping. */
  const plan = (args: string[]): LivePlan => {
    const resolution = resolvePlan(args, CATEGORIES);
    if (!resolution.ok) throw new Error(resolution.message);
    return resolution.plan;
  };

  it('compiles only a scoped category, and verifies only its tree', () => {
    // turbo's `dependsOn` pulls in the categories the slice imports, and the
    // specs deploy only their own category's artifacts (composition is
    // compile-time), so both the build and the scan stay per-category.
    expect(compileScope(plan(['multisig']))).toStrictEqual({
      scripts: ['compile:multisig'],
      verifyRoots: [path.join(SRC, 'multisig')],
    });
  });

  it('widens the scan to a category whose mocks a target deploys', () => {
    // The token fixtures deploy `src/crypto` mocks (MockElGamal, MockEcdhMask),
    // so token's key scan covers crypto too — the build already does, through
    // turbo's `dependsOn`.
    expect(compileScope(plan(['token']))).toStrictEqual({
      scripts: ['compile:token'],
      verifyRoots: [path.join(SRC, 'token'), path.join(SRC, 'crypto')],
    });
  });

  it('compiles the integration mocks for the integration target', () => {
    // `compile:integration` depends on the full `compile`, so the src slices
    // the mocks import are built without being named here; the specs deploy
    // only the composed mocks, so only that tree is scanned.
    expect(compileScope(plan(['integration']))).toStrictEqual({
      scripts: ['compile:integration'],
      verifyRoots: [INTEGRATION_MOCKS],
    });
  });

  it('compiles everything for an unscoped run', () => {
    expect(compileScope(plan([]))).toStrictEqual({
      scripts: ['compile'],
      verifyRoots: [SRC],
    });
  });
});

describe('RunLock', () => {
  /** Out of every kernel's pid range, so `process.kill(pid, 0)` can only report
   * "no such process" — a stale lock without having to kill a real one. */
  const DEAD_PID = 2 ** 31 - 1;

  let dir: string;
  let lockPath: string;

  const stamp = (pid: number): void => {
    writeFileSync(lockPath, JSON.stringify({ pid, startedAt: 'earlier' }));
  };
  const holder = (): number =>
    (JSON.parse(readFileSync(lockPath, 'utf8')) as { pid: number }).pid;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'runlock-'));
    lockPath = path.join(dir, '.live-verify.lock');
  });

  afterEach(() => {
    new RunLock(lockPath).release();
  });

  it('stamps the lock with our pid when it is free', () => {
    new RunLock(lockPath).acquire();

    expect(holder()).toBe(process.pid);
  });

  it('refuses a lock held by a live process', () => {
    // Our parent is alive by construction, and is not us.
    stamp(process.ppid);

    expect(() => new RunLock(lockPath).acquire()).toThrow(
      `another test:live run is already in progress (pid ${process.ppid}, started earlier)`,
    );
    expect(holder()).toBe(process.ppid);
  });

  it('reclaims a lock left behind by a dead process', () => {
    stamp(DEAD_PID);

    new RunLock(lockPath).acquire();

    expect(holder()).toBe(process.pid);
  });

  it('leaves nothing behind when it reclaims', () => {
    stamp(DEAD_PID);

    new RunLock(lockPath).acquire();

    // The reclaim moves the stale file aside to win it atomically; that copy is
    // a step, not an artifact.
    expect(readdirSync(dir)).toStrictEqual([path.basename(lockPath)]);
  });

  it('releases a lock it owns', () => {
    const lock = new RunLock(lockPath);
    lock.acquire();

    lock.release();

    expect(readdirSync(dir)).toStrictEqual([]);
  });

  it('leaves a lock owned by another run alone', () => {
    stamp(DEAD_PID);

    // A run that lost a stale-lock race must not delete the winner's lock on the
    // way out, so `release` checks ownership rather than just unlinking.
    new RunLock(lockPath).release();

    expect(holder()).toBe(DEAD_PID);
  });
});

describe('VitestRunner.fileStatuses', () => {
  let dir: string;
  const report = (name: string, body: string): string => {
    const p = path.join(dir, name);
    writeFileSync(p, body);
    return p;
  };

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'live-report-'));
  });

  it('maps each file in the report to its status', () => {
    const p = report(
      'ok.json',
      JSON.stringify({
        testResults: [
          { name: 'a.test.ts', status: 'passed' },
          { name: 'b.test.ts', status: 'failed' },
        ],
      }),
    );

    expect(new VitestRunner().fileStatuses(p)).toStrictEqual(
      new Map([
        ['a.test.ts', 'passed'],
        ['b.test.ts', 'failed'],
      ]),
    );
  });

  it('returns an empty map when the run matched no files', () => {
    // vitest still writes a report under `--passWithNoTests`, with no results.
    const p = report('empty.json', JSON.stringify({ testResults: [] }));

    expect(new VitestRunner().fileStatuses(p)).toStrictEqual(new Map());
  });

  it('reports no result when the report is missing', () => {
    expect(
      new VitestRunner().fileStatuses(path.join(dir, 'absent.json')),
    ).toBeUndefined();
  });

  it('reports no result when the report is truncated', () => {
    // A killed vitest leaves a partial file that still exists, so parsing has to
    // fail into the same graceful abort rather than throwing through the caller.
    const p = report('partial.json', '{"testResults":[{"name":"a.test.ts"');
    const logged = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(new VitestRunner().fileStatuses(p)).toBeUndefined();
    expect(logged.mock.calls.flat().join('\n')).toContain('partial.json');

    logged.mockRestore();
  });
});

describe('VitestRunner.run arguments', () => {
  beforeEach(() => {
    spawned.length = 0;
  });

  it('appends -t when built with a test pattern', async () => {
    // Round 2 goes through this same instance, so the flake re-run of a split
    // leg inherits the slice — a plain re-run would widen back to the file.
    await new VitestRunner('^Big one ').run('unit-live', '/tmp/r.json', [
      'src/x/test/Big.test.ts',
    ]);

    const args = spawned[0]?.args ?? [];
    const at = args.indexOf('-t');
    expect(at).toBeGreaterThan(-1);
    // One argv element, exactly as built: no shell ever re-tokenizes it.
    expect(args[at + 1]).toBe('^Big one ');
  });

  it('passes no -t without a pattern', async () => {
    await new VitestRunner().run('unit-live', '/tmp/r.json', []);

    expect(spawned[0]?.args).not.toContain('-t');
  });
});

describe('VitestRunner.reportedTestNames', () => {
  let dir: string;
  const report = (name: string, body: string): string => {
    const p = path.join(dir, name);
    writeFileSync(p, body);
    return p;
  };

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'live-names-'));
  });

  it('lists every test name in the report, skipped ones included', () => {
    // vitest lists the tests a `-t` pattern skipped too; that is what lets the
    // orchestrator tell "the pattern matches nothing" apart from "everything
    // it matches is runtime-skipped".
    const p = report(
      'ok.json',
      JSON.stringify({
        testResults: [
          {
            name: 'a.test.ts',
            status: 'passed',
            assertionResults: [
              { fullName: 'Top ran', status: 'passed' },
              { fullName: 'Top skipped by pattern', status: 'skipped' },
            ],
          },
        ],
      }),
    );

    expect(new VitestRunner().reportedTestNames(p)).toStrictEqual([
      'Top ran',
      'Top skipped by pattern',
    ]);
  });

  it('reports no result when the report is missing', () => {
    expect(
      new VitestRunner().reportedTestNames(path.join(dir, 'absent.json')),
    ).toBeUndefined();
  });
});

describe('VitestRunner.failedTestMessages', () => {
  let dir: string;
  const report = (name: string, body: string): string => {
    const p = path.join(dir, name);
    writeFileSync(p, body);
    return p;
  };

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'live-messages-'));
  });

  it('collects one message list per failed test, per file', () => {
    const p = report(
      'ok.json',
      JSON.stringify({
        testResults: [
          {
            name: 'a.test.ts',
            status: 'failed',
            assertionResults: [
              { fullName: 'A passes', status: 'passed', failureMessages: [] },
              {
                fullName: 'A fails once',
                status: 'failed',
                failureMessages: ['Error: boom'],
              },
              {
                fullName: 'A fails twice',
                status: 'failed',
                failureMessages: ['Error: one', 'Error: two'],
              },
            ],
          },
          // A hook crash: file failed, but nothing at assertion level did.
          { name: 'b.test.ts', status: 'failed', assertionResults: [] },
        ],
      }),
    );

    expect(new VitestRunner().failedTestMessages(p)).toStrictEqual(
      new Map([
        ['a.test.ts', [['Error: boom'], ['Error: one', 'Error: two']]],
        ['b.test.ts', []],
      ]),
    );
  });

  it('reports no result when the report is missing', () => {
    expect(
      new VitestRunner().failedTestMessages(path.join(dir, 'absent.json')),
    ).toBeUndefined();
  });
});

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

describe('deterministicCause', () => {
  it('names the cause when every failed test matches a pattern', () => {
    expect(
      deterministicCause([
        ['Error: Transaction would exhaust the block limits'],
      ]),
    ).toBe('block limits');
  });

  it('joins distinct causes in pattern order', () => {
    expect(
      deterministicCause([
        ['Error: Custom error: 186'],
        ['Error: Transaction would exhaust the block limits'],
      ]),
    ).toBe('block limits + unclaimed shielded output (err 186)');
  });

  it('reports nothing when any failed test does not match', () => {
    expect(
      deterministicCause([
        ['Error: Transaction would exhaust the block limits'],
        ['AssertionError: expected 1 to be 2'],
      ]),
    ).toBeUndefined();
  });

  it('reports nothing for a message-less failure', () => {
    expect(deterministicCause([[]])).toBeUndefined();
  });

  it('reports nothing when no test failed at assertion level', () => {
    expect(deterministicCause([])).toBeUndefined();
  });

  it('keeps every pattern paired with a cause name', () => {
    // The verdict line prints the cause, so an unnamed pattern would render
    // as `deterministic: undefined`.
    for (const d of DETERMINISTIC_FAILURES) {
      expect(d.cause.length).toBeGreaterThan(0);
      expect(d.pattern).toBeInstanceOf(RegExp);
    }
  });
});

describe('specFiles', () => {
  it('drops the witness specs `unit-live` excludes', () => {
    // Reads the real `src/` tree: these files exist, and vitest's `unit-live`
    // project excludes `src/**/test/witnesses/**`. A leg for one would run no
    // file, which the runner reports as an infrastructure abort rather than a
    // pass — observed on run 32811648017 before this filter existed.
    const files = specFiles('token');

    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((f) => f.includes('/witnesses/'))).toStrictEqual([]);
    expect(files).toContain('src/token/test/FungibleToken.test.ts');
  });

  it('keeps the integration specs, which have no such exclude', () => {
    expect(specFiles('integration')).toStrictEqual([
      'test/integration/specs/confidentialFungibleToken.spec.ts',
      'test/integration/specs/initStateIsolation.spec.ts',
    ]);
  });
});

describe('filterSpecFiles', () => {
  const FILES = [
    'src/multisig/test/Forwarder.test.ts',
    'src/token/test/FungibleToken.test.ts',
  ];

  it('matches a substring of the path, case-insensitively', () => {
    // vitest lowercases both sides (`TestProject.filterFiles`), so a filter that
    // runs locally must not be rejected as unmatched here.
    expect(filterSpecFiles(FILES, ['forwarder'])).toStrictEqual([
      'src/multisig/test/Forwarder.test.ts',
    ]);
  });

  it('matches a directory prefix as well as a file name', () => {
    expect(filterSpecFiles(FILES, ['src/token'])).toStrictEqual([
      'src/token/test/FungibleToken.test.ts',
    ]);
  });

  it('ORs several filters', () => {
    expect(filterSpecFiles(FILES, ['Forwarder', 'Fungible'])).toStrictEqual(
      FILES,
    );
  });

  it('matches nothing for a filter no path contains', () => {
    expect(filterSpecFiles(FILES, ['Frowarder'])).toStrictEqual([]);
  });
});

describe('specFilesIn', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'live-specs-'));
  });

  /** Write `name` under `dir`, creating its parent directories. */
  const touch = (name: string): void => {
    const file = path.join(dir, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '');
  };

  it('finds the suffix at any depth', () => {
    touch('src/multisig/test/Forwarder.test.ts');
    touch('src/multisig/test/witnesses/Deep.test.ts');

    expect(specFilesIn(dir, dir, '.test.ts')).toStrictEqual([
      'src/multisig/test/Forwarder.test.ts',
      'src/multisig/test/witnesses/Deep.test.ts',
    ]);
  });

  it('takes only the suffix asked for', () => {
    // One suffix per live project: `unit-live` includes `*.test.ts`, so a
    // `*.spec.ts` under `src/` would be handed to vitest as a path it never runs.
    touch('src/multisig/test/Forwarder.test.ts');
    touch('src/multisig/test/Forwarder.spec.ts');
    touch('src/multisig/MultiSigWallet.compact');

    expect(specFilesIn(dir, dir, '.test.ts')).toStrictEqual([
      'src/multisig/test/Forwarder.test.ts',
    ]);
  });

  it('reports paths relative to the given base', () => {
    // The base is the vitest root, because that is what a positional filter is
    // matched against.
    touch('contracts/src/token/test/FungibleToken.test.ts');

    expect(
      specFilesIn(path.join(dir, 'contracts'), dir, '.test.ts'),
    ).toStrictEqual(['contracts/src/token/test/FungibleToken.test.ts']);
  });

  it('reports nothing for a directory that does not exist', () => {
    // A target with no `src/` directory cannot be in the target list, so this is
    // only about not throwing on one.
    expect(specFilesIn(path.join(dir, 'nope'), dir, '.test.ts')).toStrictEqual(
      [],
    );
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

describe('round2Report', () => {
  it('strips the unit `.test.ts` extension', () => {
    expect(path.basename(round2Report('/repo/src/multisig/Foo.test.ts'))).toBe(
      'live-r2-Foo.json',
    );
  });

  it('strips the integration `.spec.ts` extension', () => {
    expect(
      path.basename(round2Report('/repo/test/integration/specs/Bar.spec.ts')),
    ).toBe('live-r2-Bar.json');
  });

  it('writes the report under the repo logs directory', () => {
    const report = round2Report('/repo/src/multisig/Foo.test.ts');

    expect(path.basename(path.dirname(report))).toBe('logs');
    expect(path.isAbsolute(report)).toBe(true);
  });
});
