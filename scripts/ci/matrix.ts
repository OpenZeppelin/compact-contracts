import path from 'node:path';
import { filterSpecFiles } from '../live/specs.ts';
import {
  estimateSpecMs,
  MAX_TESTS_PER_LEG,
  splitSpec,
  type TestDurations,
} from './split.ts';

/**
 * What `live.yml` fans out into matrix jobs: one compile job per live target,
 * then one suite job per spec file.
 *
 * The target list comes from the runner (`listTargets(liveCategories())`) and the
 * files from its spec walker, so the workflow never carries a copy of either: a
 * category starts getting jobs the moment it appears under `src/`, and a new spec
 * file gets its own job the moment it is written. This module only decides what a
 * requested scope resolves to against them.
 *
 * Per file rather than per target because a target is one long serial job — the
 * 2026-08-24 nightly spent 5.75h in `live-token` — while the files are
 * independent: each suite job resets its own stack, so nothing one spec leaves on
 * the node can fail another. The compile layer is what keeps that affordable,
 * since 16 token jobs must not mean 16 token compiles.
 */

/** The dispatch input meaning "every live target". An empty input resolves to the
 * same thing. */
export const ALL_TARGETS = 'all';

/** The PR label prefix that opts a pull request into a live run.
 * `live-tests:<target>` scopes the run to one target, `live-tests:all` runs
 * every one of them. The bare label is rejected: with legs split per spec file
 * the full fan-out is 60+ checks on the PR, which is never what applying a
 * label casually means, so it has to be spelled out. */
export const LIVE_LABEL = 'live-tests';

/** How a run was asked for. Each field is empty on the triggers that do not carry
 * it: `label` on a dispatch, `target` and `filter` on a PR label. */
export interface MatrixRequest {
  /** The `target` dispatch input. */
  readonly target: string;
  /** The label that was applied, when a PR label triggered the run. */
  readonly label: string;
  /** The `filter` dispatch input: a vitest file-name substring. */
  readonly filter: string;
}

/** One suite job: a single spec file, run under its target's project. */
export interface MatrixLeg {
  readonly target: string;
  /** Spec path relative to `contracts/`, handed to the runner as its file
   * filter. A full path matches exactly one file, so no leg can pull in a
   * sibling the way a bare name would. */
  readonly file: string;
  /** Distinguishes the job and its uploaded artifacts within the target. A
   * split file's legs carry a `-1`, `-2`, … suffix, which keeps the name
   * unique and artifact-safe without depending on describe names. */
  readonly name: string;
  /** vitest `-t` regex scoping the leg to its share of the file's tests.
   * Absent on an unsplit leg — the workflow reads a missing matrix key as an
   * empty string, which the runner treats as "no filter". */
  readonly testFilter?: string;
}

/** A resolved leg plus what it is expected to cost, for the plan job's log.
 * The estimate stays plan-side: the caller strips it before publishing the
 * matrix, so the workflow's leg shape does not change with it. */
export interface PlannedLeg extends MatrixLeg {
  /** Measured history where it exists, `DEFAULT_TEST_MS` per test where it
   * does not. Absent when the spec source could not be read or scanned. */
  readonly estimatedMs?: number;
}

export type MatrixResolution =
  | {
      readonly ok: true;
      /** Targets to compile: those at least one leg runs under. */
      readonly targets: readonly string[];
      readonly legs: readonly PlannedLeg[];
      /** Targets the file filter ruled out, for the plan job's log. */
      readonly dropped: readonly string[];
    }
  | { readonly ok: false; readonly message: string };

/**
 * Name each spec file within its target, uniquely.
 *
 * The basename alone collides (`multisig` has both `test/ForwarderPrivate` and
 * `test/presets/ForwarderPrivate`), and a collision would make two jobs upload
 * artifacts under one name. Stripping the directory the target's specs share
 * keeps the common case to a bare file name and lets a nested one carry just
 * enough path to be distinct (`presets-ForwarderPrivate`).
 */
export function legNames(files: readonly string[]): string[] {
  const dirs = files.map((f) => path.dirname(f).split(path.sep));
  const shared: string[] = [];
  for (let i = 0; dirs.length > 0 && i < dirs[0].length; i++) {
    const segment = dirs[0][i];
    if (!dirs.every((d) => d[i] === segment)) break;
    shared.push(segment);
  }
  return files.map((file) =>
    file
      .split(path.sep)
      .slice(shared.length)
      .join('-')
      .replace(/\.(test|spec)\.ts$/, ''),
  );
}

/**
 * The target a request scopes to, before the file filter narrows it further.
 * `''` means "every target".
 */
function requestedTarget(
  request: Pick<MatrixRequest, 'target' | 'label'>,
): string {
  const label = request.label.trim();
  if (label.startsWith(`${LIVE_LABEL}:`)) {
    const scope = label.slice(LIVE_LABEL.length + 1).trim();
    // A bare `live-tests:` names no target, and `''` here would mean "every
    // target" — a malformed label must not silently queue the full fan-out. Hand
    // the label itself back instead: it is not a target name, so the caller
    // rejects it with the valid ones.
    if (scope === '') return label;
    // `live-tests:all` is the label form of the dispatch's `all`, and the only
    // way to ask a PR for the full fan-out: a run per target would otherwise
    // mean a label per target, which the concurrency group (keyed by PR, not by
    // label) would cancel down to whichever was applied last.
    return scope === ALL_TARGETS ? '' : scope;
  }
  const target = request.target.trim();
  return target === ALL_TARGETS ? '' : target;
}

/**
 * Resolve a request into the matrix list.
 *
 * Pure: the caller reads the environment, prints, and picks an exit code.
 *
 * @param available - what the runner reports as live targets
 * @param specFiles - a target's spec files, consulted only when a filter is set
 * @param readSpec - a spec file's source, for the leg-splitting rule. Returning
 *   `undefined` (the default) means "cannot read it", which safely disables
 *   splitting for that file rather than failing the plan.
 * @param durationsFor - a spec file's measured per-test history from the
 *   previous run's reports (`weights.ts`), for duration-weighted packing.
 *   Returning `undefined` (the default) means "no history", which packs the
 *   file by test count exactly as before.
 */
export function resolveMatrix(
  request: MatrixRequest,
  available: readonly string[],
  specFiles: (target: string) => readonly string[],
  readSpec: (file: string) => string | undefined = () => undefined,
  durationsFor: (file: string) => TestDurations | undefined = () => undefined,
): MatrixResolution {
  // An empty matrix is not a no-op in Actions: the fan-out job fails with an
  // opaque "matrix must define at least one vector" error. Rejecting here puts
  // the reason in the plan job's log instead.
  if (available.length === 0) {
    return {
      ok: false,
      message:
        'the runner reports no live targets, so there is nothing to run. ' +
        'Check `yarn test:live --list`.',
    };
  }

  // The bare label used to mean "every target", which was fine when that was
  // seven jobs. Per-file (and per-slice) legs made it 60+ checks on the PR, so
  // the unscoped form is refused with the forms that spell out what they do.
  if (request.label.trim() === LIVE_LABEL) {
    return {
      ok: false,
      message:
        `the bare '${LIVE_LABEL}' label would fan out into a job per spec ` +
        'file across every target (60+ checks on this PR). Use ' +
        `'${LIVE_LABEL}:<target>' (one of: ${available.join(', ')}), or ` +
        `'${LIVE_LABEL}:${ALL_TARGETS}' if the full fan-out is deliberate.`,
    };
  }

  const wanted = requestedTarget(request);
  if (wanted !== '' && !available.includes(wanted)) {
    // A mistyped target would otherwise reach the suite job and die hours later
    // inside the runner (exit 2, after `env-up` and a compile). Naming the valid
    // set here fails the dispatch in seconds instead.
    return {
      ok: false,
      message:
        `'${wanted}' is not a live target. Available: ` +
        `${available.join(', ')}, or '${ALL_TARGETS}' for all of them.`,
    };
  }
  const scope = wanted === '' ? available : [wanted];

  // A filter is a substring of a file path, so it selects files within a target
  // and rules other targets out entirely. A target it misses must not get a job
  // at all: one that runs no file is an infrastructure abort in the runner, not
  // a pass. The match is vitest's own, so a filter that works locally is never
  // rejected here.
  const filter = request.filter.trim();
  const legs: PlannedLeg[] = [];
  const matched: string[] = [];
  for (const target of scope) {
    const all = specFiles(target);
    const files = filter === '' ? all : filterSpecFiles(all, [filter]);
    if (files.length === 0) continue;
    matched.push(target);
    const names = legNames(files);
    for (const [i, file] of files.entries()) {
      const name = names[i] as string;
      // The leg-splitting rule: a file over the leg budget (MAX_LEG_MS,
      // weighed by measured durations where history exists and by test count
      // otherwise) becomes several legs of the same file, each scoped by a
      // test-name pattern, so one big file cannot dominate the run's wall
      // clock. Applied after the file filter on purpose: a dispatch that
      // selects the file still gets the split, since the point is the file's
      // weight, not how it was chosen.
      const source = readSpec(file);
      const durations = durationsFor(file);
      const split =
        source === undefined
          ? null
          : splitSpec(source, MAX_TESTS_PER_LEG, durations);
      if (split === null) {
        const estimatedMs =
          source === undefined ? undefined : estimateSpecMs(source, durations);
        legs.push({
          target,
          file,
          name,
          // Left off entirely when unknown, so an estimate-less leg keeps the
          // exact shape (and JSON) legs had before estimates existed.
          ...(estimatedMs === undefined ? {} : { estimatedMs }),
        });
        continue;
      }
      legs.push(
        ...split.map((leg, k) => ({
          target,
          file,
          name: `${name}-${k + 1}`,
          testFilter: leg.testFilter,
          estimatedMs: leg.estimatedMs,
        })),
      );
    }
  }

  if (legs.length === 0) {
    return {
      ok: false,
      message:
        filter === ''
          ? `no spec file exists under ${scope.join(', ')}, so there is ` +
            'nothing to run. Check `yarn test:live --list`.'
          : `no spec file matches '${filter}' under ${scope.join(', ')}. ` +
            'The filter is a substring of the file path, as vitest matches it.',
    };
  }
  return {
    ok: true,
    targets: matched,
    legs,
    dropped: scope.filter((target) => !matched.includes(target)),
  };
}
