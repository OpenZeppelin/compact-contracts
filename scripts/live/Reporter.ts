import { appendFileSync } from 'node:fs';
import { KEEP_ENV_HINT } from './LiveStack.ts';
import { LOGS, rel } from './paths.ts';
import { banner } from './shell.ts';

const FLAKE_NOTE = 'failed round 1, passed round 2 on a fresh node';

/**
 * All run-level output: the verdict banner, GitHub Actions annotations, and the
 * job summary. Everything here is a no-op outside CI except the console output,
 * so local and CI runs go through the same path.
 */
export class Reporter {
  /** Append markdown to the GitHub Actions job summary (no-op outside CI). */
  jobSummary(markdown: string): void {
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (!summaryPath) return;
    appendFileSync(summaryPath, `${markdown}\n`);
  }

  /** Emit a GitHub Actions warning annotation (no-op outside CI). */
  ciWarn(file: string, message: string): void {
    if (process.env.GITHUB_ACTIONS !== 'true') return;
    console.log(`::warning file=${file}::${message}`);
  }

  /** Nothing failed in round 1, so no classification was needed. */
  firstRunGreen(): number {
    const headline = 'VERDICT: PASSED — all live specs green on the first run.';
    banner(headline);
    this.jobSummary(`### ${headline}`);
    return 0;
  }

  /**
   * Final verdict after round 2.
   *
   * @returns the process exit code — 0 for a flaky-only run, so an environment
   *   artifact never turns the build red, and 1 only for a real failure
   */
  verdict(flaky: readonly string[], real: readonly string[]): number {
    const headline =
      real.length === 0
        ? `VERDICT: PASSED${flaky.length ? ` (with ${flaky.length} flaky file(s))` : ''}`
        : `VERDICT: FAILED — ${real.length} real failure(s), ${flaky.length} flaky`;
    banner(headline);

    if (flaky.length > 0) {
      console.log(`\nFLAKY (${FLAKE_NOTE}):`);
      for (const f of flaky) console.log(`  ~ ${rel(f)}`);
    }
    if (real.length > 0) {
      console.log('\nREAL (failed both rounds — investigate):');
      for (const f of real) console.log(`  ✗ ${rel(f)}`);
      // The stack is about to be stopped, so point at what survives it.
      console.log(
        `\ncontainer logs are kept in ${rel(LOGS)}/*.log after teardown; ` +
          `on a re-run, ${KEEP_ENV_HINT}.`,
      );
    }
    // A flaky-only run exits 0, so without these a green CI run would swallow the
    // flake report entirely.
    for (const f of flaky) {
      this.ciWarn(rel(f), `flaky live spec — ${FLAKE_NOTE}`);
    }
    this.jobSummary(
      [
        `### ${headline}`,
        ...(flaky.length > 0
          ? [
              '',
              `Flaky (${FLAKE_NOTE}):`,
              ...flaky.map((f) => `- ~ \`${rel(f)}\``),
            ]
          : []),
        ...(real.length > 0
          ? [
              '',
              'Real failures (failed both rounds — investigate):',
              ...real.map((f) => `- ✗ \`${rel(f)}\``),
            ]
          : []),
      ].join('\n'),
    );
    return real.length === 0 ? 0 : 1;
  }
}
