import { type Dirent, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseJsonReport } from '../live/VitestRunner.ts';

/**
 * Measured per-test durations from a previous run's report artifacts, for the
 * leg packer.
 *
 * The split rule used to budget legs by test count, but a live test's cost is
 * its transaction count times ~18s of indexer finality, and that varies by a
 * factor of three across files (run 32831811290: MultiToken legs of ≤30 tests
 * ran 70–91 minutes at ~3 min/test while most files run ~1 min/test). The plan
 * job therefore downloads the newest completed run's `live-reports-*`
 * artifacts, and this module turns whatever unpacked into a duration lookup:
 * spec file → (test full name → milliseconds).
 *
 * Everything here is best-effort by design: a missing directory, an expired
 * artifact, or an unreadable report just contributes nothing, and a test with
 * no history gets the packer's default weight. History can only re-balance the
 * packing, never break the plan.
 */

/** A file's history: test full name (space-joined, the same form the split
 * patterns match) → wall-clock milliseconds. */
export type TestDurations = ReadonlyMap<string, number>;

/** Report files, as the suite legs upload them: `live-r1-<target>.json` from
 * round 1, `live-r2-<file>.json` from a round-2 re-run. */
const REPORT_NAME = /^live-r[12]-.*\.json$/;

/**
 * Every duration in every report under `dir`, keyed by the spec file path the
 * report carries (absolute on the runner that wrote it — see
 * {@link durationsForFile} for how a plan-side path finds it).
 *
 * `gh run download` unpacks each artifact into its own subdirectory, so the
 * walk is recursive. A name seen in several reports (round 2 after round 1, or
 * a split file's sibling legs) keeps its maximum duration: the pessimistic
 * estimate is the one that keeps a leg under its budget.
 */
export function collectDurations(
  dir: string,
): Map<string, Map<string, number>> {
  const byFile = new Map<string, Map<string, number>>();
  for (const reportPath of reportFiles(dir)) {
    let body: string;
    try {
      body = readFileSync(reportPath, 'utf8');
    } catch {
      continue;
    }
    const report = parseJsonReport(body);
    for (const result of report?.testResults ?? []) {
      const durations = byFile.get(result.name) ?? new Map<string, number>();
      byFile.set(result.name, durations);
      for (const test of result.assertionResults ?? []) {
        // Skipped tests (by a `-t` pattern or `.skipIf`) report without a
        // duration; only a real measurement may enter the lookup.
        if (
          typeof test.duration !== 'number' ||
          !Number.isFinite(test.duration)
        )
          continue;
        durations.set(
          test.fullName,
          Math.max(durations.get(test.fullName) ?? 0, test.duration),
        );
      }
    }
  }
  return byFile;
}

/** Recursively list the report files under `dir`; empty when it is missing. */
function reportFiles(dir: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return reportFiles(full);
    return entry.isFile() && REPORT_NAME.test(entry.name) ? [full] : [];
  });
}

/**
 * The history for one spec file, or `undefined` when none was collected.
 *
 * The reports key files by the absolute path on the runner that wrote them,
 * while the plan works in `contracts/`-relative paths — so the match is by
 * path suffix. Suffix matching (rather than pooling every name) is also what
 * keeps two files' identically named describes from inflating each other.
 */
export function durationsForFile(
  collected: ReadonlyMap<string, TestDurations>,
  file: string,
): TestDurations | undefined {
  for (const [reportedPath, durations] of collected) {
    const normalized = reportedPath.split(path.sep).join('/');
    if (normalized === file || normalized.endsWith(`/${file}`)) {
      return durations;
    }
  }
  return undefined;
}
