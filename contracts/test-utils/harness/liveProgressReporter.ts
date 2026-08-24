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
 *
 * A SKIPPED test never runs `beforeEach`, so no worker stamps it. Rather than
 * print `[w?]`, fall back to the last worker seen for that test's module: the
 * module was loaded and run by that worker even where an individual test was
 * skipped. `?` remains only for a module where nothing ever reported a worker.
 */
const MARKS: Record<string, string> = {
  passed: '✓',
  failed: '✗',
  skipped: '↓',
};

export default class LiveProgressReporter implements Reporter {
  private total = 0;
  private done = 0;
  /** module id → the last worker that reported a test from it. */
  private workerByModule = new Map<string, number>();

  onTestRunStart(): void {
    this.total = 0;
    this.done = 0;
    this.workerByModule.clear();
  }

  onTestModuleCollected(module: TestModule): void {
    this.total += [...module.children.allTests()].length;
  }

  onTestCaseResult(testCase: TestCase): void {
    const { state } = testCase.result();
    if (state === 'pending') return; // not finished yet
    this.done += 1;
    const moduleId = testCase.module.moduleId;
    const stamped = (testCase.meta() as { workerId?: number }).workerId;
    if (stamped !== undefined) this.workerByModule.set(moduleId, stamped);
    const worker = stamped ?? this.workerByModule.get(moduleId) ?? '?';
    const mark = MARKS[state] ?? '·';
    const ms = Math.round(testCase.diagnostic()?.duration ?? 0);
    console.log(
      `[w${worker}] ${mark} ${testCase.fullName} (${ms}ms) ` +
        `[${this.done}/${this.total}]`,
    );
  }
}
