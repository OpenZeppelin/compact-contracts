import { readdirSync } from 'node:fs';
import path from 'node:path';
import { INTEGRATION_MOCKS, SRC } from './paths.ts';

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

// The live suite runs every `src/<category>` that has tests (see
// `liveCategories`) — there is no separate live-ready allowlist to keep in sync,
// since all current categories are backend-aware. A category that must NOT run
// live is an explicit opt-out here (only legacy `archive` today, which the
// unit/unit-live vitest projects also exclude — see vitest.config).
const EXCLUDED_CATEGORIES = new Set(['archive']);

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

/** Targets CI should spawn a job for: every discovered category plus the
 * integration target. `liveCategories()` is the single source of truth for the
 * matrix — there is no allowlist to keep in sync with it. */
export function listTargets(allCategories: readonly string[]): string[] {
  return [...allCategories, INTEGRATION];
}

/**
 * Resolve CLI args into a plan. Pure: no filesystem, no console, no exit codes —
 * the caller decides what to do with a rejection.
 *
 * A first arg naming a target scopes the run (the `test:live:<target>` scripts
 * pass one); everything else is a vitest file filter. `integration` is matched
 * first because it is not a `src/` category, so it would otherwise be rejected
 * as an unknown target.
 */
export function resolvePlan(
  args: readonly string[],
  allCategories: readonly string[],
): PlanResolution {
  const integration = args[0] === INTEGRATION;
  const scoped =
    !integration && args.length > 0 && allCategories.includes(args[0]);

  // The first positional arg always names the target (CONTRIBUTING.md). If it is
  // present but names neither an active live category — an excluded one like
  // `archive`, or a typo — nor `integration`, reject it here so the caller can
  // fail fast, BEFORE the expensive compile / env-up / harness-smoke setup (no
  // args = every category, the default).
  if (args.length > 0 && !integration && !scoped) {
    const reason = EXCLUDED_CATEGORIES.has(args[0])
      ? `'${args[0]}' is excluded from live runs (see EXCLUDED_CATEGORIES)`
      : `'${args[0]}' is not a live target`;
    return {
      ok: false,
      message:
        `${reason}.\nLive targets: ${allCategories.join(', ')}, plus ` +
        `'${INTEGRATION}'.`,
    };
  }

  const targets: LiveTarget[] = integration
    ? [{ name: INTEGRATION, project: 'integration-live', defaultFilters: [] }]
    : (scoped ? [args[0]] : allCategories).map((category) => ({
        name: category,
        project: 'unit-live',
        defaultFilters: [`src/${category}`],
      }));

  return {
    ok: true,
    plan: {
      targets,
      // Any surviving arg list is scoped (an unrecognised first arg was rejected
      // above), so the first arg is always the target name.
      fileFilters: args.slice(1),
      integration,
    },
  };
}

/** What a plan compiles, and which artifacts it must be able to deploy. */
export interface CompileScope {
  /** Root `package.json` compile scripts to run, in order. */
  readonly scripts: readonly string[];
  /** Source roots whose artifacts the plan's specs deploy, scoping the
   * key-integrity checks. */
  readonly verifyRoots: readonly string[];
}

/**
 * Categories whose specs deploy another category's artifacts, so the
 * key-integrity scan must cover that category's tree too.
 *
 * Deploy-driven, not import-driven: an import alone yields a build byproduct
 * nothing deploys (composition is compile-time), and the build side is covered
 * by turbo's `dependsOn` regardless. Today only the token fixtures deploy
 * `src/crypto` mocks (`MockElGamal`, `MockEcdhMask`).
 */
const DEPLOYS_FROM = new Map<string, readonly string[]>([
  ['token', ['crypto']],
]);

/**
 * Resolve a plan into its compile scope.
 *
 * A scoped run compiles its own slice, not the repo: turbo's `dependsOn` pulls
 * in the categories a slice imports (`compile:token` builds `utils` and
 * `crypto` too), and composition is compile-time, so the artifacts a target's
 * specs deploy are self-contained — dependency artifacts are build byproducts
 * nothing deploys. That is also why `verifyRoots` names only the deployed
 * tree: `src/<category>` for a category, the composed mocks for integration
 * (whose `compile:integration` task now depends on the full `compile`).
 *
 * A category without a root `compile:<category>` script fails the run loudly at
 * the yarn level — a new `src/` category joins the live matrix automatically
 * (see {@link liveCategories}), and this is where it learns it also needs the
 * script and turbo task.
 */
export function compileScope(plan: LivePlan): CompileScope {
  if (plan.integration) {
    return {
      scripts: ['compile:integration'],
      verifyRoots: [INTEGRATION_MOCKS],
    };
  }
  if (plan.targets.length === 1) {
    const category = plan.targets[0].name;
    return {
      scripts: [`compile:${category}`],
      verifyRoots: [category, ...(DEPLOYS_FROM.get(category) ?? [])].map((c) =>
        path.join(SRC, c),
      ),
    };
  }
  return { scripts: ['compile'], verifyRoots: [SRC] };
}
