import { existsSync, readFileSync } from 'node:fs';
import { CONTRACTS, PROGRESS_REPORTER, rel, VITEST_BIN } from './paths.ts';
import { run } from './shell.ts';
import type { LiveTarget } from './targets.ts';

interface JsonTestResult {
  readonly name: string;
  readonly status: string;
}
interface JsonReport {
  readonly testResults?: readonly JsonTestResult[];
}

/** Spawns vitest against one live project and reads back its JSON report. */
export class VitestRunner {
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
    if (!existsSync(reportPath)) return undefined;
    let report: JsonReport;
    try {
      report = JSON.parse(readFileSync(reportPath, 'utf8')) as JsonReport;
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
    return new Map(
      (report.testResults ?? []).map((r) => [r.name, r.status] as const),
    );
  }
}
