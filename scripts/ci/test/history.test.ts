import { describe, expect, it } from 'vitest';
import type { Captured, Exec } from '../gh.ts';
import { fetchPreviousReports } from '../history.ts';

/**
 * Unit tests for `history.ts`. The `gh` adapter is driven through a recording
 * `Exec`, so the argv it builds is asserted rather than run.
 */

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
