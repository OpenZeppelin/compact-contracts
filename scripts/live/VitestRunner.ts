import { existsSync, readFileSync } from 'node:fs';
import { CONTRACTS, PROGRESS_REPORTER, rel, VITEST_BIN } from './paths.ts';
import { run } from './shell.ts';
import type { LiveTarget } from './targets.ts';

interface JsonAssertionResult {
  readonly fullName: string;
  readonly status: string;
}
interface JsonTestResult {
  readonly name: string;
  readonly status: string;
  readonly assertionResults?: readonly JsonAssertionResult[];
}
interface JsonReport {
  readonly testResults?: readonly JsonTestResult[];
}

/** Spawns vitest against one live project and reads back its JSON report. */
export class VitestRunner {
  /** A `-t` (testNamePattern) regex every run gets, empty for none. Held here
   * so round 2 re-runs a failed file under the same slice as round 1 — a CI
   * leg of a split file must never widen back to the whole file. */
  readonly #testPattern: string;

  constructor(testPattern = '') {
    this.#testPattern = testPattern;
  }

  /**
   * Run one live project.
   *
   * @param project - the single project for this invocation (see `targets.ts` on
   *   why it is never more than one)
   * @param reportPath - where the JSON reporter writes, for {@link fileStatuses}
   * @param fileFilters - vitest positional filters; empty runs the include glob
   * @param extraEnv - overrides layered over `MIDNIGHT_BACKEND=live`
   * @returns vitest's exit status
   */
  run(
    project: LiveTarget['project'],
    reportPath: string,
    fileFilters: readonly string[],
    extraEnv: Record<string, string> = {},
  ): Promise<number> {
    return run(
      VITEST_BIN,
      [
        'run',
        '--project',
        project,
        // One target filtered down to zero matching files is a pass, not an
        // error: a name filter may only exist under some of the targets in an
        // unscoped run. Zero across the WHOLE run is a different thing, and
        // `LiveOrchestrator.#round1` rejects it.
        '--passWithNoTests',
        // `default` prints one line per file (piped) plus failures/summary; the
        // progress reporter adds the worker-tagged, counted per-test line.
        '--reporter=default',
        `--reporter=${PROGRESS_REPORTER}`,
        '--reporter=json',
        `--outputFile.json=${reportPath}`,
        // The pattern travels as one argv element, so its regex metacharacters
        // never meet a shell.
        ...(this.#testPattern === '' ? [] : ['-t', this.#testPattern]),
        ...fileFilters,
      ],
      { ...process.env, MIDNIGHT_BACKEND: 'live', ...extraEnv },
      CONTRACTS,
    );
  }

  /**
   * File name → status for every file in the report.
   *
   * @returns `undefined` when no *readable* report exists — the run was blocked
   *   (dirty node / lock), crashed before writing one, or was killed mid-write
   *   and left truncated JSON behind. Callers must treat that as an
   *   infrastructure abort rather than a test failure.
   */
  fileStatuses(reportPath: string): Map<string, string> | undefined {
    const report = this.#report(reportPath);
    if (report === undefined) return undefined;
    return new Map(
      (report.testResults ?? []).map((r) => [r.name, r.status] as const),
    );
  }

  /**
   * Every full test name the report carries, executed or not — vitest lists
   * the tests a `-t` pattern skipped too, in the same space-joined form the
   * pattern is matched against. That is what lets the orchestrator tell a
   * pattern that matched nothing (its names are absent) from a slice whose
   * tests were all runtime-skipped (`.skipIf`; the names are present).
   *
   * @returns `undefined` under the same conditions as {@link fileStatuses}
   */
  reportedTestNames(reportPath: string): string[] | undefined {
    const report = this.#report(reportPath);
    if (report === undefined) return undefined;
    return (report.testResults ?? []).flatMap((r) =>
      (r.assertionResults ?? []).map((a) => a.fullName),
    );
  }

  #report(reportPath: string): JsonReport | undefined {
    if (!existsSync(reportPath)) return undefined;
    try {
      return JSON.parse(readFileSync(reportPath, 'utf8')) as JsonReport;
    } catch (e) {
      // A killed vitest can leave a partial report that still passes `existsSync`,
      // so parsing is a second way to have no result — not an exception to throw
      // through the callers, which are written to abort gracefully on `undefined`.
      // Named here because the caller's message ("produced no results file")
      // would otherwise misdescribe an unreadable one.
      console.log(
        `\ncould not read ${rel(reportPath)}: ` +
          `${e instanceof Error ? e.message : String(e)}`,
      );
      return undefined;
    }
  }
}
