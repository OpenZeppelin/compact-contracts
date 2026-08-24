import { filterSpecFiles } from '../live/specs.ts';

/**
 * Which live targets `live.yml` fans out into matrix jobs.
 *
 * The list itself comes from the runner (`listTargets(liveCategories())`), so the
 * workflow never carries a copy of it: a category starts getting its own CI job
 * the moment it appears under `src/`. This module only decides what a requested
 * scope resolves to against that list.
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

export type MatrixResolution =
  | {
      readonly ok: true;
      readonly targets: readonly string[];
      /** Targets the file filter ruled out, for the plan job's log. */
      readonly dropped: readonly string[];
    }
  | { readonly ok: false; readonly message: string };

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
 */
export function resolveMatrix(
  request: MatrixRequest,
  available: readonly string[],
  specFiles: (target: string) => readonly string[],
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

  const filter = request.filter.trim();
  if (filter === '') return { ok: true, targets: scope, dropped: [] };

  // A filter is a substring of a file path, so it matches some targets and not
  // others. The ones it misses must not get a job at all: one live target that
  // runs no file is an infrastructure abort in the runner, not a pass, so a
  // full fan-out with a filter would report red jobs for every target the
  // filter does not name. The match is vitest's own, so a filter that works
  // locally is never rejected here.
  const matched = scope.filter(
    (target) => filterSpecFiles(specFiles(target), [filter]).length > 0,
  );
  if (matched.length === 0) {
    return {
      ok: false,
      message:
        `no spec file matches '${filter}' under ${scope.join(', ')}. ` +
        'The filter is a substring of the file path, as vitest matches it.',
    };
  }
  return {
    ok: true,
    targets: matched,
    dropped: scope.filter((target) => !matched.includes(target)),
  };
}
