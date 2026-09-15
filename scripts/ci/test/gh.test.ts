import { describe, expect, it } from 'vitest';
import { type Captured, type Exec, GhIssueTracker } from '../gh.ts';

/**
 * Unit tests for `gh.ts`. The CLI adapter is driven through a recording
 * `Exec`, so the argv it builds is asserted rather than run.
 */

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
