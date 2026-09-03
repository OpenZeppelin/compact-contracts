/**
 * Failures a fresh node cannot change the verdict on.
 *
 * The two-round design exists because the live specs share one node: a file
 * that failed in a busy round 1 may pass alone on a reset stack, which is what
 * round 2 tests. But some failures are properties of the transaction itself,
 * not of the node's state — re-running them on a fresh node returns the exact
 * same rejection, so round 2 only doubles the loss (measured on run
 * 32831811290: 11 legs, every one a known-deterministic rejection, each paying
 * a second stack reset and re-run for nothing).
 *
 * A file skips round 2 only when EVERY failed test in it matches one of these
 * patterns; a single unmatched (or message-less) failure keeps the file on
 * today's round-2 path, so an unknown failure can never lose its flake check.
 */

/** One deterministic-rejection fingerprint, matched against a failed test's
 * rendered failure messages. */
export interface DeterministicPattern {
  readonly pattern: RegExp;
  /** Short name for the verdict line (`✗ file — deterministic: <cause>`). */
  readonly cause: string;
}

export const DETERMINISTIC_FAILURES: readonly DeterministicPattern[] = [
  {
    // Node rejection 1010 "Invalid Transaction": the deploy transaction alone
    // exceeds the per-block resource ceiling. The tx is identical on every
    // node, and so is the ceiling — a composite contract over the limit fails
    // the same way forever until the contract (or the node) changes.
    pattern: /Transaction would exhaust the block limits/,
    cause: 'block limits',
  },
  {
    // Ledger "Custom error: 186": an unclaimed shielded output — a shielded
    // send to a contract address, which nothing can claim (audit finding
    // H-03). A rule of the ledger, not a state artifact.
    pattern: /Custom error: 186/,
    cause: 'unclaimed shielded output (err 186)',
  },
];

/**
 * The deterministic cause for a failed file, or `undefined` when round 2 is
 * still worth running.
 *
 * @param failedTests - one entry per failed test: its failure messages
 * @returns the distinct cause names (source order, ' + '-joined) when every
 *   failed test matches some pattern; `undefined` when any does not, or when
 *   nothing failed at assertion level (a hook crash reports no failed tests,
 *   and an unknown cause must keep its flake check)
 */
export function deterministicCause(
  failedTests: readonly (readonly string[])[],
): string | undefined {
  if (failedTests.length === 0) return undefined;
  const causes = new Set<string>();
  for (const messages of failedTests) {
    const matched = DETERMINISTIC_FAILURES.filter((d) =>
      messages.some((m) => d.pattern.test(m)),
    );
    if (matched.length === 0) return undefined;
    for (const d of matched) causes.add(d.cause);
  }
  return DETERMINISTIC_FAILURES.filter((d) => causes.has(d.cause))
    .map((d) => d.cause)
    .join(' + ');
}
