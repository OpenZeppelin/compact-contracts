import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { collectDurations, durationsForFile } from '../weights.ts';

/** Unit tests for `weights.ts`, against JUnit reports written to a temp dir. */

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

  /** A report for `" > "`-joined test names, carrying the space-joined
   * `fullName` vitest writes beside the title fields. */
  const report = (file: string, tests: Record<string, number | undefined>) => ({
    testResults: [
      {
        name: file,
        status: 'passed',
        assertionResults: Object.entries(tests).map(([name, duration]) => {
          const titles = name.split(' > ');
          return {
            ancestorTitles: titles.slice(0, -1),
            title: titles.at(-1),
            fullName: titles.join(' '),
            status: duration === undefined ? 'skipped' : 'passed',
            ...(duration === undefined ? {} : { duration }),
          };
        }),
      },
    ],
  });

  it('walks the artifact subdirectories gh run download creates', () => {
    write(
      'live-reports-token-MultiToken-1/live-r1-token.json',
      report('/ci/contracts/src/token/test/MultiToken.test.ts', {
        'M > a': 1000,
      }),
    );
    write(
      'live-reports-access-Ownable/live-r1-access.json',
      report('/ci/contracts/src/access/test/Ownable.test.ts', {
        'O > b': 2000,
      }),
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
    write('a/live-r1-token.json', report('/ci/f.test.ts', { 'S > t': 1000 }));
    write('b/live-r2-f.json', report('/ci/f.test.ts', { 'S > t': 5000 }));

    expect(collectDurations(dir).get('/ci/f.test.ts')).toStrictEqual(
      new Map([['S > t', 5000]]),
    );
  });

  it('keys each duration by the name form the leg patterns match', () => {
    // The space-joined `fullName` in the report would never meet a leg
    // pattern, which vitest matches against `" > "`-joined names.
    write(
      'a/live-r1-token.json',
      report('/ci/f.test.ts', { 'S > nested > t': 1000 }),
    );

    expect(collectDurations(dir).get('/ci/f.test.ts')).toStrictEqual(
      new Map([['S > nested > t', 1000]]),
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
    write('a/notes.json', report('/ci/f.test.ts', { 'S > t': 1000 }));
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
