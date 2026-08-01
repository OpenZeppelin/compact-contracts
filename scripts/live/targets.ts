import { readdirSync } from 'node:fs';
import path from 'node:path';
import { SRC } from './paths.ts';

/**
 * What a live invocation resolves to.
 *
 * A target is either a unit category (`src/<category>`, run under
 * `--project unit-live`) or the composed-contract `integration` target (run under
 * `--project integration-live` over `test/integration/specs`).
 *
 * Exactly ONE live project per vitest invocation: both live projects derive their
 * wallets from `walletSeedsFor(VITEST_POOL_ID)`, so worker 1 of each resolves to
 * the same genesis deployer. `live.globalSetup` rejects a second live project in
 * one process; issuing one `--project` per invocation is how this side keeps that
 * from happening in the first place.
 */

/** `archive` is excluded from the unit/unit-live projects (see vitest.config). */
const EXCLUDED_CATEGORIES = new Set(['archive']);

/**
 * Categories whose specs have been refactored for the live backend. The others
 * still assume dry-only semantics (e.g. `.as()` identities derived from alias
 * labels, which the live wallet pool cannot impersonate) and join this list as
 * they are refactored, PR by PR.
 */
export const LIVE_READY = new Set(['multisig']);

/** The composed-contract target. Not a `src/` category, so it is matched before
 * the category branch — {@link liveCategories} will never contain it. */
export const INTEGRATION = 'integration';

/** One unit of live work: a vitest project plus the files to run under it. */
export interface LiveTarget {
  /** Labels the target in banners and names its round-1 report. */
  readonly name: string;
  readonly project: 'unit-live' | 'integration-live';
  /** vitest positional filters used when the dev gave no explicit file filter.
   * Empty means "the project's whole include glob". */
  readonly defaultFilters: readonly string[];
}

export interface LivePlan {
  readonly targets: readonly LiveTarget[];
  /** Live-ready-gated categories left out of an unscoped run, for reporting. */
  readonly skipped: readonly string[];
  readonly fileFilters: readonly string[];
  /** Whether the run needs full-key integration-mock artifacts. */
  readonly integration: boolean;
}

export type PlanResolution =
  | { readonly ok: true; readonly plan: LivePlan }
  | { readonly ok: false; readonly message: string };

/** `src/` subdirectories that contain test files (future categories join
 * automatically; no hardcoded list to maintain). */
export function liveCategories(): string[] {
  const hasTests = (dir: string): boolean =>
    readdirSync(dir, { withFileTypes: true }).some((entry) =>
      entry.isDirectory()
        ? hasTests(path.join(dir, entry.name))
        : entry.name.endsWith('.test.ts'),
    );
  return readdirSync(SRC, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !EXCLUDED_CATEGORIES.has(d.name))
    .map((d) => d.name)
    .filter((name) => hasTests(path.join(SRC, name)))
    .sort();
}

/** Targets CI should spawn a job for. `LIVE_READY` plus the integration target
 * stays the single source of truth for the matrix. */
export function listTargets(allCategories: readonly string[]): string[] {
  return [...allCategories.filter((c) => LIVE_READY.has(c)), INTEGRATION];
}

/**
 * Resolve CLI args into a plan. Pure: no filesystem, no console, no exit codes —
 * the caller decides what to do with a rejection.
 *
 * A first arg naming a target scopes the run (the `test:live:<target>` scripts
 * pass one); everything else is a vitest file filter. `integration` is matched
 * first because it is not a `src/` category, so it would otherwise fall through
 * to the unscoped path and silently run every live-ready unit category instead.
 */
export function resolvePlan(
  args: readonly string[],
  allCategories: readonly string[],
): PlanResolution {
  const integration = args[0] === INTEGRATION;
  const scoped =
    !integration && args.length > 0 && allCategories.includes(args[0]);

  if (scoped && !LIVE_READY.has(args[0])) {
    return {
      ok: false,
      message:
        `'${args[0]}' is not live-ready yet — its specs still assume dry-only ` +
        `semantics. Ready categories: ${[...LIVE_READY].join(', ')}, plus ` +
        `'${INTEGRATION}'.`,
    };
  }

  const targets: LiveTarget[] = integration
    ? [{ name: INTEGRATION, project: 'integration-live', defaultFilters: [] }]
    : (scoped ? [args[0]] : allCategories.filter((c) => LIVE_READY.has(c))).map(
        (category) => ({
          name: category,
          project: 'unit-live',
          defaultFilters: [`src/${category}`],
        }),
      );

  return {
    ok: true,
    plan: {
      targets,
      skipped:
        integration || scoped
          ? []
          : allCategories.filter((c) => !LIVE_READY.has(c)),
      fileFilters: integration || scoped ? args.slice(1) : args,
      integration,
    },
  };
}
