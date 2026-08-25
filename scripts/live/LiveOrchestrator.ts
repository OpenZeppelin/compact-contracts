import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { ArtifactCompiler } from './ArtifactCompiler.ts';
import { deterministicCause } from './deterministic.ts';
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
import { filterSpecFiles, specFiles } from './specs.ts';
import type { LivePlan, LiveTarget } from './targets.ts';
import type { VitestRunner } from './VitestRunner.ts';

/** Exit code for an infrastructure abort, as opposed to a test failure (1). */
export const INFRA_ABORT = 2;

interface FailedFile {
  readonly file: string;
  /** The target that ran it, so round 2 re-runs it under the same project. */
  readonly target: LiveTarget;
  /** Set when every failure in the file is a deterministic rejection (see
   * `deterministic.ts`): the file skips round 2 — a fresh node returns the
   * same verdict — and reports as REAL under this cause. */
  readonly cause?: string;
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
 *            under a later one. A file whose every round-1 failure matches a
 *            deterministic rejection (`deterministic.ts`) is exempt: a fresh
 *            node returns the same verdict, so it reports REAL immediately with
 *            the cause named.
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
  readonly #specFiles: (target: string) => readonly string[];
  readonly #testPattern: string;

  constructor(deps: {
    readonly plan: LivePlan;
    readonly stack: LiveStack;
    readonly compiler: ArtifactCompiler;
    readonly runner: VitestRunner;
    readonly reporter: Reporter;
    /** A target's spec files. Injected only so a round can be tested without a
     * real `src/` tree. */
    readonly specFiles?: (target: string) => readonly string[];
    /** The `-t` pattern the runner was built with, when a CI leg runs a slice
     * of a split file. The orchestrator needs it too: a pattern that matches
     * no reported test name means the slice ran nothing, which must abort
     * rather than pass (see the guard in `#round1`). */
    readonly testPattern?: string;
  }) {
    this.#plan = deps.plan;
    this.#stack = deps.stack;
    this.#compiler = deps.compiler;
    this.#runner = deps.runner;
    this.#reporter = deps.reporter;
    this.#specFiles = deps.specFiles ?? specFiles;
    this.#testPattern = deps.testPattern ?? '';
  }

  /** @returns the process exit code */
  async run(): Promise<number> {
    this.#clearStaleReports();

    const { targets, fileFilters } = this.#plan;
    banner(
      `ROUND 1 — targets: ${targets.map((t) => t.name).join(', ')}` +
        (fileFilters.length ? ` (filter: ${fileFilters.join(' ')})` : '') +
        (this.#testPattern !== '' ? ` (-t: ${this.#testPattern})` : ''),
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
    for (const f of failed) {
      console.log(
        `  ✗ ${rel(f.file)}${f.cause === undefined ? '' : ` — deterministic: ${f.cause}`}`,
      );
    }

    // A file whose every failure is a deterministic rejection skips round 2:
    // the verdict is a property of the transaction, so a fresh node re-returns
    // it, and the re-run only doubles the loss. It is REAL without a retry.
    const deterministic = failed.filter((f) => f.cause !== undefined);
    const retryable = failed.filter((f) => f.cause === undefined);
    if (deterministic.length > 0) {
      console.log(
        `\nskipping round 2 for ${deterministic.length} file(s): every ` +
          'failure is a deterministic rejection a fresh node cannot change.',
      );
    }

    const round2 =
      retryable.length > 0
        ? await this.#round2(retryable)
        : new Map<string, string>();
    if (round2 === undefined) return INFRA_ABORT;

    const { flaky, real } = classify(
      retryable.map((f) => f.file),
      round2,
    );
    const causes = new Map(
      deterministic.map((f) => [f.file, f.cause as string]),
    );
    return this.#reporter.verdict(
      flaky,
      // Round-1 order, so the verdict reads like the run did.
      failed
        .map((f) => f.file)
        .filter((file) => causes.has(file) || real.includes(file)),
      causes,
    );
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
   * only on-chain footprint (NIGHT/dust) does not trip the freshness guard, so
   * the first target reuses the node the smoke ran against.
   *
   * A file filter is resolved per target, and a target it matches nothing under
   * is skipped rather than run: that keeps a filter from reaching into another
   * target's specs, which matters most in CI, where each target is its own job.
   *
   * @returns the failing files, or `undefined` on an infrastructure abort
   */
  async #round1(): Promise<FailedFile[] | undefined> {
    const { targets, fileFilters } = this.#plan;
    const failed: FailedFile[] = [];
    let filesRun = 0;
    let targetsRun = 0;

    for (const [i, target] of targets.entries()) {
      banner(`ROUND 1 · ${target.name} (${i + 1}/${targets.length})`);

      // vitest ORs positional filters, so passing the target directory *and* a
      // name filter would run the whole target, and passing the name alone would
      // reach into every OTHER target too (the project's include glob is not
      // scoped to one). So a name filter is resolved against this target's own
      // spec files and handed over as explicit paths. With no filter, the
      // target's own filters run the whole set (for integration: none, so the
      // project's include glob decides).
      const filters =
        fileFilters.length > 0
          ? filterSpecFiles(this.#specFiles(target.name), fileFilters)
          : target.defaultFilters;

      // Nothing to run here, and an empty filter list would run the whole
      // project. Skipping keeps the filter scoped; a filter that matches nothing
      // in ANY target is caught after the loop.
      if (fileFilters.length > 0 && filters.length === 0) {
        console.log(
          `\n${target.name}: no file matches ${fileFilters.join(' ')} — skipped.`,
        );
        continue;
      }

      // The harness smoke already validated the stack and its NIGHT/dust
      // footprint does not trip the freshness guard, so the first target that
      // actually runs reuses that node.
      if (targetsRun > 0 && (await this.#stack.up()) !== 0) {
        console.log(`env-up failed before '${target.name}'.`);
        return undefined;
      }
      targetsRun++;

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

      // Vitest is silently green when `-t` matches nothing: the file reports
      // "passed" with every test skipped, indistinguishable in exit code from
      // a real pass. The report still lists every test's full name, though —
      // matched or not — so a pattern that matches none of them is provably
      // wrong (stale against the file, or a splitter bug), not merely
      // runtime-skipped: a slice whose tests are all `.skipIf`-ed still has
      // its names in the report and passes here. Only a clean run is checked;
      // a failing file already tells its own story.
      if (
        this.#testPattern !== '' &&
        status === 0 &&
        targetFailed.length === 0
      ) {
        const names = this.#runner.reportedTestNames(reportPath) ?? [];
        const pattern = new RegExp(this.#testPattern);
        if (!names.some((name) => pattern.test(name))) {
          console.log(
            `\nthe test-name pattern matched none of the ${names.length} ` +
              `reported test name(s) under '${target.name}' — the run would ` +
              'have passed while executing nothing. The pattern no longer ' +
              'fits the file; regenerate the plan.',
          );
          return undefined;
        }
      }

      filesRun += statuses.size;
      // A file is only exempt from round 2 when the report can prove every
      // one of its failures deterministic; an unreadable second read (should
      // not happen — `fileStatuses` just parsed this file) or a hook-level
      // crash with no failed assertions proves nothing, so `cause` stays
      // unset and the file keeps its flake check.
      const failureMessages = this.#runner.failedTestMessages(reportPath);
      failed.push(
        ...targetFailed.map((file) => ({
          file,
          target,
          cause: deterministicCause(failureMessages?.get(file) ?? []),
        })),
      );
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
