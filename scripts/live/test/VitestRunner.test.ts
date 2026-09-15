import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VitestRunner } from '../VitestRunner.ts';

/**
 * Dry unit tests for `VitestRunner.ts`: reading back a vitest JSON report, and
 * the argv `run` builds. Nothing here spawns vitest.
 */

// The stub records its argv so `VitestRunner.run` can be asserted on the
// arguments it builds (the `-t` pattern in particular) without spawning.
// Everything else in `shell.ts` stays real.
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
