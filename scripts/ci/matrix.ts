/**
 * Which live targets `live.yml` fans out into matrix jobs.
 *
 * The list itself comes from the runner (`listTargets(liveCategories())`), so the
 * workflow never carries a copy of it: a category starts getting its own CI job
 * the moment it appears under `src/`. This module only decides what a requested
 * scope resolves to against that list.
 */

/** The dispatch input meaning "every live target". An empty input (a schedule
 * run, or a PR label) resolves to the same thing. */
export const ALL_TARGETS = 'all';

export type MatrixResolution =
  | { readonly ok: true; readonly targets: readonly string[] }
  | { readonly ok: false; readonly message: string };

/**
 * Resolve a requested scope into the matrix list.
 *
 * Pure: the caller reads the environment, prints, and picks an exit code.
 *
 * @param requested - the `target` dispatch input (`''` and {@link ALL_TARGETS}
 *   both mean "everything")
 * @param available - what the runner reports as live targets
 */
export function resolveMatrix(
  requested: string,
  available: readonly string[],
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

  const wanted = requested.trim();
  if (wanted === '' || wanted === ALL_TARGETS) {
    return { ok: true, targets: available };
  }
  if (available.includes(wanted)) {
    return { ok: true, targets: [wanted] };
  }

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
