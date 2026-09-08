import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { ArtifactCompiler } from './ArtifactCompiler.ts';
import type { LiveStack } from './LiveStack.ts';
import {
  LOGS,
  ROUND2_REPORT_PREFIX,
  rel,
  round1Report,
  round2Report,
} from './paths.ts';
import type { Reporter } from './Reporter.ts';
import { banner, run } from './shell.ts';
import type { LivePlan, LiveTarget } from './targets.ts';
import type { VitestRunner } from './VitestRunner.ts';

/** Exit code for an infrastructure abort, as opposed to a test failure (1). */
export const INFRA_ABORT = 2;

interface FailedFile {
  readonly file: string;
  /** The target that ran it, so round 2 re-runs it under the same project. */
  readonly target: LiveTarget;
}

/**
 * Split round-1 failures into flakes and real failures.
 *
 * Only an explicit round-2 pass demotes a failure to FLAKY; a file that failed
 * again — or never reported (crashed) — stays REAL.
 */
export function classify(
  files: readonly string[],
  round2: ReadonlyMap<string, string>,
): { flaky: string[]; real: string[] } {
  return {
    flaky: files.filter((f) => round2.get(f) === 'passed'),
    real: files.filter((f) => round2.get(f) !== 'passed'),
  };
}

/**
 * Runs the two-round live verification.
 *
 * The live specs are not isolated from one another: they all run against one
 * shared node, so state left by an earlier test can make a later one fail (a coin
 * re-spent against stale node state is rejected with node "Custom error: 103").
 * A file that fails during a busy full run may therefore pass in isolation on a
 * fresh node. Hence two rounds:
 *
 *   Round 1: compile + harness smoke once, then per target: reset the stack and
 *            run that target's files (parallel workers where the project allows
 *            it). Collect the files that failed from the JSON reporter.
 *   Round 2: for each failed file, reset the stack and re-run just that file on
 *            its own (one worker), so no earlier round-2 file can dirty the node
 *            under a later one.
 *
 * A file that fails round 1 but passes round 2 is FLAKY (an environment
 * artifact); one that fails both — or never reports in round 2 — is a REAL
 * failure. The run exits 0 unless there is a real failure, so an env flake never
 * turns the build red, but it is reported loudly.
 *
 * Anything that prevents classification (no report written, a non-zero exit with
 * no failing files, a run that matched no test file at all, a stack that will not
 * come up) aborts with {@link INFRA_ABORT} rather than being guessed at.
 */
export class LiveOrchestrator {
  readonly #plan: LivePlan;
  readonly #stack: LiveStack;
  readonly #compiler: ArtifactCompiler;
  readonly #runner: VitestRunner;
  readonly #reporter: Reporter;

  constructor(deps: {
    readonly plan: LivePlan;
    readonly stack: LiveStack;
    readonly compiler: ArtifactCompiler;
    readonly runner: VitestRunner;
    readonly reporter: Reporter;
  }) {
    this.#plan = deps.plan;
    this.#stack = deps.stack;
    this.#compiler = deps.compiler;
    this.#runner = deps.runner;
    this.#reporter = deps.reporter;
  }

  /** @returns the process exit code */
  async run(): Promise<number> {
    this.#clearStaleReports();

    const { targets, fileFilters } = this.#plan;
    banner(
      `ROUND 1 — targets: ${targets.map((t) => t.name).join(', ')}` +
        (fileFilters.length ? ` (filter: ${fileFilters.join(' ')})` : ''),
    );

    if (!(await this.#compiler.compileVerified())) return INFRA_ABORT;
    if ((await this.#stack.up()) !== 0) {
      console.log('env-up failed — cannot start the live stack.');
      return INFRA_ABORT;
    }
    if ((await run('yarn', ['test:harness:live'])) !== 0) {
      console.log(
        '\nlive harness smoke failed — this is an infrastructure problem, ' +
          'not a spec flake. Fix the stack and retry.',
      );
      return INFRA_ABORT;
    }

    const failed = await this.#round1();
    if (failed === undefined) return INFRA_ABORT;
    if (failed.length === 0) return this.#reporter.firstRunGreen();

    banner(`ROUND 1 found ${failed.length} failing file(s)`);
    for (const f of failed) console.log(`  ✗ ${rel(f.file)}`);

    const round2 = await this.#round2(failed);
    if (round2 === undefined) return INFRA_ABORT;

    const { flaky, real } = classify(
      failed.map((f) => f.file),
      round2,
    );
    return this.#reporter.verdict(flaky, real);
  }

  /** Drop reports from previous runs, so a stale file can never be read as this
   * run's result. Round-2 names depend on which files fail, so clear them all. */
  #clearStaleReports(): void {
    for (const t of this.#plan.targets) {
      rmSync(round1Report(t.name), { force: true });
    }
    if (!existsSync(LOGS)) return;
    for (const f of readdirSync(LOGS)) {
      if (f.startsWith(ROUND2_REPORT_PREFIX) && f.endsWith('.json')) {
        rmSync(path.join(LOGS, f), { force: true });
      }
    }
  }

  /**
   * Run every target once.
   *
   * Each target gets a freshly reset node: smaller coin tree, no cross-target
   * state interactions. The harness smoke already validated the stack, and its
   * only on-chain footprint (NIGHT/dust) does not trip the freshness guard — so
   * the first target reuses the node the smoke ran against.
   *
   * @returns the failing files, or `undefined` on an infrastructure abort
   */
  async #round1(): Promise<FailedFile[] | undefined> {
    const { targets, fileFilters } = this.#plan;
    const failed: FailedFile[] = [];
    let filesRun = 0;

    for (const [i, target] of targets.entries()) {
      banner(`ROUND 1 · ${target.name} (${i + 1}/${targets.length})`);
      if (i > 0 && (await this.#stack.up()) !== 0) {
        console.log(`env-up failed before '${target.name}'.`);
        return undefined;
      }

      // vitest ORs positional filters, so passing the target dir *and* a name
      // filter would match the whole target (every file is under the dir). Use
      // the name filters when given — they scope to the matching files;
      // otherwise the target's own filters run the whole set (for integration:
      // none, so the project's include glob decides).
      const filters =
        fileFilters.length > 0 ? fileFilters : target.defaultFilters;
      const reportPath = round1Report(target.name);
      const status = await this.#runner.run(
        target.project,
        reportPath,
        filters,
      );

      const statuses = this.#runner.fileStatuses(reportPath);
      if (statuses === undefined) {
        console.log(
          `\n'${target.name}' produced no results file — the run was blocked ` +
            '(dirty node / lock) or crashed before finishing.',
        );
        return undefined;
      }
      const targetFailed = [...statuses.entries()]
        .filter(([, s]) => s === 'failed')
        .map(([name]) => name);
      if (status !== 0 && targetFailed.length === 0) {
        console.log(
          `\n'${target.name}' exited non-zero without reporting failing ` +
            'files — aborting to be safe.',
        );
        return undefined;
      }

      filesRun += statuses.size;
      failed.push(...targetFailed.map((file) => ({ file, target })));
      console.log(
        `\n${target.name}: ${statuses.size} file(s), ${targetFailed.length} failed`,
      );
    }

    if (targets.length > 0 && filesRun === 0) {
      console.log(
        `\nno test file matched across ${targets.map((t) => t.name).join(', ')}` +
          (fileFilters.length ? ` (filter: ${fileFilters.join(' ')})` : '') +
          ' — nothing ran, so there is no result to report.\n' +
          'A file filter matching nothing is the usual cause (an unrecognised ' +
          'first argument is rejected before the run starts). Run ' +
          "'yarn test:live --list' for the target names.",
      );
      return undefined;
    }
    return failed;
  }

  /**
   * Re-run each failed file alone on a fresh node.
   *
   * The node is reset before *every* file, so state left by an earlier round-2
   * file can never fail a later one — that would misclassify a flake as REAL.
   *
   * @returns file → round-2 status, or `undefined` on an infrastructure abort
   */
  async #round2(
    failed: readonly FailedFile[],
  ): Promise<Map<string, string> | undefined> {
    banner('ROUND 2 — re-run each failed file alone on a fresh node');
    const statusByFile = new Map<string, string>();

    for (const [i, { file, target }] of failed.entries()) {
      banner(`ROUND 2 · ${rel(file)} (${i + 1}/${failed.length})`);
      if ((await this.#stack.up()) !== 0) {
        console.log(`env-up failed before round 2 of '${rel(file)}'.`);
        return undefined;
      }
      const reportPath = round2Report(file);
      await this.#runner.run(target.project, reportPath, [file], {
        MIDNIGHT_LIVE_WORKERS: '1',
      });
      const statuses = this.#runner.fileStatuses(reportPath);
      if (statuses === undefined) {
        console.log(
          `\nround 2 produced no results for '${rel(file)}' — cannot classify.`,
        );
        return undefined;
      }
      // No entry means the file crashed without reporting; treat as not-passed.
      statusByFile.set(file, statuses.get(file) ?? 'failed');
    }
    return statusByFile;
  }
}
