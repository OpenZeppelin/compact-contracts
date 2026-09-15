import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { INTEGRATION_MOCKS, SRC } from '../paths.ts';
import {
  compileScope,
  type LivePlan,
  listTargets,
  parseInvocation,
  resolvePlan,
} from '../targets.ts';

/**
 * Dry unit tests for `targets.ts`: target listing, plan resolution, flag
 * parsing, and compile scoping. Pure functions; nothing here reads `src/`.
 */

/** `liveCategories()` reads `src/`, so every case passes this explicitly to keep
 * the tests independent of the on-disk category set. */
const CATEGORIES = ['multisig', 'token'] as const;

describe('listTargets', () => {
  it('lists every category plus the integration target', () => {
    // CI builds its matrix from this (`test:live --list`), so a dropped entry
    // would surface only as a silently missing job — a live target nobody runs.
    expect(listTargets(CATEGORIES)).toStrictEqual([
      'multisig',
      'token',
      'integration',
    ]);
  });

  it('still offers the integration target when no category has tests', () => {
    // `integration` is not a `src/` category, so it does not come from the
    // discovered category set the way the unit targets do.
    expect(listTargets([])).toStrictEqual(['integration']);
  });
});

describe('resolvePlan', () => {
  it('scopes to the integration target', () => {
    const resolution = resolvePlan(['integration'], CATEGORIES);

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    // 'integration' is deliberately NOT in CATEGORIES: it is not a `src/`
    // category, so the guard has to match it before the category branch or the
    // run falls through to the unscoped path (the original INV-10 bug).
    expect(resolution.plan.targets).toStrictEqual([
      { name: 'integration', project: 'integration-live', defaultFilters: [] },
    ]);
    expect(resolution.plan.integration).toBe(true);
    expect(resolution.plan.fileFilters).toStrictEqual([]);
  });

  it('passes trailing args after the integration target as file filters', () => {
    const resolution = resolvePlan(
      ['integration', 'confidentialFungibleToken'],
      CATEGORIES,
    );

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.plan.fileFilters).toStrictEqual([
      'confidentialFungibleToken',
    ]);
    expect(resolution.plan.integration).toBe(true);
  });

  it('scopes to a unit category', () => {
    const resolution = resolvePlan(['multisig'], CATEGORIES);

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.plan.targets).toStrictEqual([
      {
        name: 'multisig',
        project: 'unit-live',
        defaultFilters: ['src/multisig'],
      },
    ]);
    expect(resolution.plan.integration).toBe(false);
  });

  it('passes trailing args after a category as file filters', () => {
    const resolution = resolvePlan(['multisig', 'Forwarder'], CATEGORIES);

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.plan.fileFilters).toStrictEqual(['Forwarder']);
  });

  it('rejects an excluded category by name', () => {
    // `archive` never reaches `liveCategories()`, so without the excluded-set
    // branch it would be reported as an unknown target — true but unhelpful.
    const resolution = resolvePlan(['archive'], CATEGORIES);

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.message).toContain(
      "'archive' is excluded from live runs",
    );
    expect(resolution.message).toContain('Live targets: multisig, token');
    expect(resolution.message).toContain("'integration'");
  });

  it('rejects an unknown first arg instead of running it as a file filter', () => {
    // Rejecting here is what keeps a typo from burning a compile / env-up /
    // harness-smoke cycle only to match no files.
    const resolution = resolvePlan(['someFileFilter'], CATEGORIES);

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.message).toContain(
      "'someFileFilter' is not a live target",
    );
    expect(resolution.message).toContain('Live targets: multisig, token');
  });

  it('runs every category when unscoped', () => {
    const resolution = resolvePlan([], CATEGORIES);

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.plan.targets).toStrictEqual([
      {
        name: 'multisig',
        project: 'unit-live',
        defaultFilters: ['src/multisig'],
      },
      { name: 'token', project: 'unit-live', defaultFilters: ['src/token'] },
    ]);
    expect(resolution.plan.fileFilters).toStrictEqual([]);
    expect(resolution.plan.integration).toBe(false);
  });
});

describe('parseInvocation', () => {
  /** The mode and the surviving positionals, which is all a caller reads. */
  const parse = (argv: string[]) => {
    const resolution = parseInvocation(argv);
    if (!resolution.ok) throw new Error(resolution.message);
    return resolution.invocation;
  };

  it('defaults to building, with every arg positional', () => {
    expect(parse(['multisig', 'Forwarder'])).toStrictEqual({
      mode: 'build',
      args: ['multisig', 'Forwarder'],
    });
  });

  it('reads --compile-only and keeps the target positional', () => {
    expect(parse(['token', '--compile-only'])).toStrictEqual({
      mode: 'build-only',
      args: ['token'],
    });
  });

  it('reads --prebuilt alongside a file filter', () => {
    expect(
      parse(['token', 'src/token/test/FungibleToken.test.ts', '--prebuilt']),
    ).toStrictEqual({
      mode: 'prebuilt',
      args: ['token', 'src/token/test/FungibleToken.test.ts'],
    });
  });

  it('drops the `--` yarn passes through', () => {
    expect(parse(['--', 'token'])).toStrictEqual({
      mode: 'build',
      args: ['token'],
    });
  });

  it('rejects the two modes together', () => {
    // One builds the artifacts and the other forbids building them, so there is
    // no run this could mean.
    const resolution = parseInvocation(['--compile-only', '--prebuilt']);

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.message).toContain('pass one or the other');
  });

  it('rejects an unknown flag by name', () => {
    // Left in, it would reach `resolvePlan` as a positional and come back as
    // "not a live target", which points at the wrong fix.
    const resolution = parseInvocation(['token', '--prebuild']);

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.message).toContain("unknown flag '--prebuild'");
    expect(resolution.message).toContain('--compile-only, --prebuilt');
  });

  it('accepts a flag repeated', () => {
    expect(parse(['--prebuilt', 'token', '--prebuilt'])).toStrictEqual({
      mode: 'prebuilt',
      args: ['token'],
    });
  });
});

describe('compileScope', () => {
  /** Resolve a plan the way `main()` does, failing the test on a rejection so
   * the scope cases stay about scoping. */
  const plan = (args: string[]): LivePlan => {
    const resolution = resolvePlan(args, CATEGORIES);
    if (!resolution.ok) throw new Error(resolution.message);
    return resolution.plan;
  };

  it('compiles only a scoped category, and verifies only its tree', () => {
    // turbo's `dependsOn` pulls in the categories the slice imports, and the
    // specs deploy only their own category's artifacts (composition is
    // compile-time), so both the build and the scan stay per-category.
    expect(compileScope(plan(['multisig']))).toStrictEqual({
      scripts: ['compile:multisig'],
      verifyRoots: [path.join(SRC, 'multisig')],
    });
  });

  it('widens the scan to a category whose mocks a target deploys', () => {
    // The token fixtures deploy `src/crypto` mocks (MockElGamal, MockEcdhMask),
    // so token's key scan covers crypto too — the build already does, through
    // turbo's `dependsOn`.
    expect(compileScope(plan(['token']))).toStrictEqual({
      scripts: ['compile:token'],
      verifyRoots: [path.join(SRC, 'token'), path.join(SRC, 'crypto')],
    });
  });

  it('compiles the integration mocks for the integration target', () => {
    // `compile:integration` depends on the full `compile`, so the src slices
    // the mocks import are built without being named here; the specs deploy
    // only the composed mocks, so only that tree is scanned.
    expect(compileScope(plan(['integration']))).toStrictEqual({
      scripts: ['compile:integration'],
      verifyRoots: [INTEGRATION_MOCKS],
    });
  });

  it('compiles everything for an unscoped run', () => {
    expect(compileScope(plan([]))).toStrictEqual({
      scripts: ['compile'],
      verifyRoots: [SRC],
    });
  });
});
