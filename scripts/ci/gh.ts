import { spawnSync } from 'node:child_process';
import type { IssueTracker } from './nightly.ts';

/**
 * The `gh` CLI adapter behind {@link IssueTracker}.
 *
 * The command line is built as an argv array, never a string, so an issue body
 * containing backticks, `$`, or a newline is passed through verbatim instead of
 * being re-interpreted by a shell.
 *
 * Authentication is `GH_TOKEN` in the environment, as in the workflow.
 */

export interface Captured {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs a command and captures its output. Injected so the tests can assert on
 * the argv that would have been run. */
export type Exec = (cmd: string, args: readonly string[]) => Captured;

export const spawnCapture: Exec = (cmd, args) => {
  const result = spawnSync(cmd, [...args], { encoding: 'utf8' });
  if (result.error) {
    return { status: 1, stdout: '', stderr: result.error.message };
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
};

/** Metadata for the label, created on demand the first time an issue needs it. */
const LABEL_DESCRIPTION = 'Tracks the nightly live test run';
const LABEL_COLOR = 'B60205';

interface IssueRef {
  readonly number: number;
}

export class GhIssueTracker implements IssueTracker {
  readonly #repo: string;
  readonly #exec: Exec;

  constructor(repo: string, exec: Exec = spawnCapture) {
    this.#repo = repo;
    this.#exec = exec;
  }

  findOpen(label: string): number | undefined {
    // `--json` + parsing here rather than `--jq`: the empty-list case is then an
    // empty array this side reads, not a jq expression whose output for a missing
    // element has to be guessed at.
    const out = this.#gh([
      'issue',
      'list',
      '--label',
      label,
      '--state',
      'open',
      '--limit',
      '1',
      '--json',
      'number',
    ]);
    let issues: readonly IssueRef[];
    try {
      issues = JSON.parse(out || '[]') as readonly IssueRef[];
    } catch (e) {
      // `gh` keeps its warnings on stderr today, so this should not happen. If it
      // ever does, a bare `SyntaxError` names neither the command nor the output.
      throw new Error(
        `gh issue list returned unreadable JSON (${
          e instanceof Error ? e.message : String(e)
        }): ${out}`,
      );
    }
    return issues[0]?.number;
  }

  close(issue: number, comment: string): void {
    this.#gh(['issue', 'close', String(issue), '--comment', comment]);
  }

  comment(issue: number, body: string): void {
    this.#gh(['issue', 'comment', String(issue), '--body', body]);
  }

  create(label: string, title: string, body: string): void {
    // `--force` makes this idempotent: it updates the label if it already exists
    // instead of failing the step on the second nightly failure.
    this.#gh([
      'label',
      'create',
      label,
      '--force',
      '--description',
      LABEL_DESCRIPTION,
      '--color',
      LABEL_COLOR,
    ]);
    this.#gh([
      'issue',
      'create',
      '--label',
      label,
      '--title',
      title,
      '--body',
      body,
    ]);
  }

  /** Every call carries `--repo`, so the adapter never depends on the checkout's
   * git remotes. */
  #gh(args: readonly string[]): string {
    const argv = [...args, '--repo', this.#repo];
    const { status, stdout, stderr } = this.#exec('gh', argv);
    if (status !== 0) {
      // The full argv carries the issue body, which is many lines long, so the
      // message names the subcommand and lets `gh` explain itself.
      throw new Error(
        `gh ${args[0]} ${args[1]} failed (exit ${status}): ${stderr.trim()}`,
      );
    }
    return stdout.trim();
  }
}
