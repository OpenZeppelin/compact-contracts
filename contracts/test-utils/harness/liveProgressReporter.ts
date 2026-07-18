import type { Reporter, TestCase, TestModule } from 'vitest/node';

/**
 * Prints one worker-tagged, globally-counted line per test, e.g.
 *   [w2] ✓ Signer > assertThresholdMet > should fail… (15ms) [118/210]
 *
 * Runs alongside the built-in `default` reporter, which still owns the per-file
 * lines, failure details, and final summary — this reporter only adds the
 * per-test progress line. The worker id comes from `task.meta`, stamped by each
 * worker in `live.setup` (the only place that knows its `VITEST_POOL_ID`). The
 * total accrues as modules are collected, so the first few lines may show a
 * smaller denominator until collection finishes.
 */
const MARKS: Record<string, string> = {
  passed: '✓',
  failed: '✗',
  skipped: '↓',
};

export default class LiveProgressReporter implements Reporter {
  private total = 0;
  private done = 0;

  onTestRunStart(): void {
    this.total = 0;
    this.done = 0;
  }

  onTestModuleCollected(module: TestModule): void {
    this.total += [...module.children.allTests()].length;
  }

  onTestCaseResult(testCase: TestCase): void {
    const { state } = testCase.result();
    if (state === 'pending') return; // not finished yet
    this.done += 1;
    const worker = (testCase.meta() as { workerId?: number }).workerId ?? '?';
    const mark = MARKS[state] ?? '·';
    const ms = Math.round(testCase.diagnostic()?.duration ?? 0);
    console.log(
      `[w${worker}] ${mark} ${testCase.fullName} (${ms}ms) ` +
        `[${this.done}/${this.total}]`,
    );
  }
}
