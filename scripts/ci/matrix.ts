import path from 'node:path';
import { filterSpecFiles } from '../live/specs.ts';
import { splitSpec } from './split.ts';

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

/** The PR label that opts a pull request into a live run. On its own it means
 * every target; `live-tests:<target>` scopes the run to one, which is what a PR
 * usually wants (the full fan-out is one long-running job per target). */
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

export type MatrixResolution =
  | {
      readonly ok: true;
      /** Targets to compile: those at least one leg runs under. */
      readonly targets: readonly string[];
      readonly legs: readonly MatrixLeg[];
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
    // A bare `live-tests:` names no target, and `''` here would mean "every
    // target" — a malformed label must not silently queue the full fan-out. Hand
    // the label itself back instead: it is not a target name, so the caller
    // rejects it with the valid ones.
    return label.slice(LIVE_LABEL.length + 1).trim() || label;
  }
  // The bare label carries no scope, so a PR run falls through to the dispatch
  // input, which is itself empty on a `pull_request` event.
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
 */
export function resolveMatrix(
  request: MatrixRequest,
  available: readonly string[],
  specFiles: (target: string) => readonly string[],
  readSpec: (file: string) => string | undefined = () => undefined,
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
  const legs: MatrixLeg[] = [];
  const matched: string[] = [];
  for (const target of scope) {
    const all = specFiles(target);
    const files = filter === '' ? all : filterSpecFiles(all, [filter]);
    if (files.length === 0) continue;
    matched.push(target);
    const names = legNames(files);
    for (const [i, file] of files.entries()) {
      const name = names[i] as string;
      // The leg-splitting rule: a file over MAX_TESTS_PER_LEG becomes several
      // legs of the same file, each scoped by a test-name pattern, so one big
      // file cannot dominate the run's wall clock. Applied after the file
      // filter on purpose: a dispatch that selects the file still gets the
      // split, since the point is the file's size, not how it was chosen.
      const source = readSpec(file);
      const split = source === undefined ? null : splitSpec(source);
      if (split === null) {
        legs.push({ target, file, name });
        continue;
      }
      legs.push(
        ...split.map((leg, k) => ({
          target,
          file,
          name: `${name}-${k + 1}`,
          testFilter: leg.testFilter,
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
