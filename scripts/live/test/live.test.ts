import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactCompiler } from '../ArtifactCompiler.ts';
import {
  classify,
  INFRA_ABORT,
  LiveOrchestrator,
} from '../LiveOrchestrator.ts';
import type { LiveStack } from '../LiveStack.ts';
import { round2Report } from '../paths.ts';
import type { Reporter } from '../Reporter.ts';
import { RunLock } from '../RunLock.ts';
import { listTargets, resolvePlan } from '../targets.ts';
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
vi.mock('../shell.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shell.ts')>()),
  run: async () => 0,
}));

/** `liveCategories()` reads `src/`, so every case passes this explicitly to keep
 * the tests independent of the on-disk category set. */
const CATEGORIES = ['multisig', 'token'] as const;

describe('listTargets', () => {
  it('lists the live-ready categories plus the integration target', () => {
    // CI builds its matrix from this (`test:live --list`), so a dropped entry
    // would surface only as a silently missing job — a live target nobody runs.
    expect(listTargets(CATEGORIES)).toStrictEqual(['multisig', 'integration']);
  });

  it('still offers the integration target when no category is live-ready', () => {
    // `integration` is not a `src/` category, so it does not depend on
    // LIVE_READY the way the unit categories do.
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
    expect(resolution.plan.skipped).toStrictEqual([]);
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

  it('scopes to a live-ready unit category', () => {
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
    expect(resolution.plan.skipped).toStrictEqual([]);
  });

  it('passes trailing args after a category as file filters', () => {
    const resolution = resolvePlan(['multisig', 'Forwarder'], CATEGORIES);

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.plan.fileFilters).toStrictEqual(['Forwarder']);
  });

  it('rejects a category that is not live-ready yet', () => {
    const resolution = resolvePlan(['token'], CATEGORIES);

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.message).toContain("'token' is not live-ready yet");
    expect(resolution.message).toContain('Ready categories: multisig');
    expect(resolution.message).toContain("'integration'");
  });

  it('runs only live-ready categories when unscoped, reporting the rest', () => {
    const resolution = resolvePlan([], CATEGORIES);

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.plan.targets).toStrictEqual([
      {
        name: 'multisig',
        project: 'unit-live',
        defaultFilters: ['src/multisig'],
      },
    ]);
    expect(resolution.plan.skipped).toStrictEqual(['token']);
    expect(resolution.plan.fileFilters).toStrictEqual([]);
    expect(resolution.plan.integration).toBe(false);
  });

  it('treats a non-category first arg as a file filter over every target', () => {
    const resolution = resolvePlan(['someFileFilter'], CATEGORIES);

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.plan.targets).toStrictEqual([
      {
        name: 'multisig',
        project: 'unit-live',
        defaultFilters: ['src/multisig'],
      },
    ]);
    expect(resolution.plan.fileFilters).toStrictEqual(['someFileFilter']);
    expect(resolution.plan.skipped).toStrictEqual(['token']);
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

describe('LiveOrchestrator', () => {
  // Deliberately not a real category, so clearing stale reports finds nothing.
  const TARGET = {
    name: 'faketarget',
    project: 'unit-live',
    defaultFilters: ['src/faketarget'],
  } as const;

  /** A round wired to stand-ins: every collaborator but the harness-smoke spawn
   * is constructor-injected, so a whole round runs without docker or vitest. */
  const roundOver = (
    fileStatuses: () => Map<string, string> | undefined,
    fileFilters: readonly string[] = [],
  ): LiveOrchestrator =>
    new LiveOrchestrator({
      plan: { targets: [TARGET], skipped: [], fileFilters, integration: false },
      stack: { up: async () => 0, stop: () => {} } as unknown as LiveStack,
      compiler: {
        compileVerified: async () => true,
      } as unknown as ArtifactCompiler,
      runner: { run: async () => 0, fileStatuses } as unknown as VitestRunner,
      reporter: {
        firstRunGreen: () => 0,
        verdict: () => 0,
      } as unknown as Reporter,
    });

  let logged: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
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
    const code = await roundOver(() => new Map(), ['multsig']).run();

    expect(code).toBe(INFRA_ABORT);
    expect(output()).toContain('no test file matched');
    expect(output()).toContain('filter: multsig');
  });

  it('aborts when a target wrote no report at all', async () => {
    const code = await roundOver(() => undefined).run();

    expect(code).toBe(INFRA_ABORT);
    expect(output()).toContain('produced no results file');
  });

  it('reports the first run green when every file passed', async () => {
    const code = await roundOver(
      () => new Map([['a.test.ts', 'passed']]),
    ).run();

    expect(code).toBe(0);
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
