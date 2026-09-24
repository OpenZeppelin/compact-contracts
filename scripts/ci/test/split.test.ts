import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEST_MS,
  estimateSpecMs,
  MAX_TESTS_PER_LEG,
  type SplitLeg,
  splitSpec,
} from '../split.ts';

/** Unit tests for `split.ts`: carving one spec file into matrix legs. */

describe('splitSpec', () => {
  /** `n` test registrations, distinct names. */
  const its = (n: number, prefix = 't'): string =>
    Array.from(
      { length: n },
      (_, i) => `it('${prefix}${i}', () => {});\n`,
    ).join('');

  const block = (name: string, body: string): string =>
    `describe('${name}', () => {\n${body}});\n`;

  /** How vitest applies a leg's filter: `new RegExp(pattern)` against the
   * `" > "`-joined full name (see split.ts on the format). */
  const matches = (filter: string, fullName: string): boolean =>
    new RegExp(filter).test(fullName);

  it('does not split a file at or under the limit', () => {
    expect(splitSpec(block('A', its(3)), 3)).toBeNull();
  });

  it('splits sibling describes into anchored path patterns', () => {
    const legs = splitSpec(block('A', its(2)) + block('B', its(2)), 2);

    expect(legs).toStrictEqual([
      { testFilter: '^A > ', tests: 2, estimatedMs: 2 * DEFAULT_TEST_MS },
      { testFilter: '^B > ', tests: 2, estimatedMs: 2 * DEFAULT_TEST_MS },
    ]);
  });

  it('descends into a describe bigger than the limit', () => {
    const legs = splitSpec(
      block('P', block('x', its(2)) + block('y', its(2))),
      2,
    );

    expect(legs).toStrictEqual([
      { testFilter: '^P > x > ', tests: 2, estimatedMs: 2 * DEFAULT_TEST_MS },
      { testFilter: '^P > y > ', tests: 2, estimatedMs: 2 * DEFAULT_TEST_MS },
    ]);
  });

  it('keeps tests beside child describes in exactly one leg', () => {
    // P holds one direct test next to two child describes, so the direct test
    // gets a remainder alternative: P's path minus its children. Without the
    // lookahead it would run in every leg whose pattern starts with `^P > `.
    const legs = splitSpec(
      block(
        'P',
        `${its(1, 'direct')}${block('x', its(2))}${block('y', its(2))}`,
      ),
      3,
    );

    expect(legs).toStrictEqual([
      {
        testFilter: '^P > (?!x > |y > )|^P > x > ',
        tests: 3,
        estimatedMs: 3 * DEFAULT_TEST_MS,
      },
      { testFilter: '^P > y > ', tests: 2, estimatedMs: 2 * DEFAULT_TEST_MS },
    ]);
    if (legs === null) return;
    const first = legs[0] as SplitLeg;
    const second = legs[1] as SplitLeg;
    expect(matches(first.testFilter, 'P > direct0')).toBe(true);
    expect(matches(second.testFilter, 'P > direct0')).toBe(false);
    expect(matches(first.testFilter, 'P > y > t0')).toBe(false);
    expect(matches(second.testFilter, 'P > y > t0')).toBe(true);
  });

  it('bounds names by anchor and joint against sibling near-misses', () => {
    // The classic hazard: an unanchored 'grantRole' matches '_grantRole', and
    // one without the trailing joint matches 'grantRoleExtra'.
    const legs = splitSpec(
      block(
        'C',
        'grantRole _grantRole grantRoleExtra'
          .split(' ')
          .map((name) => block(name, its(2)))
          .join(''),
      ),
      2,
    );

    expect(legs).not.toBeNull();
    if (legs === null) return;
    const forName = (name: string) =>
      legs.filter((leg) => matches(leg.testFilter, `C > ${name} > t0`));
    for (const name of ['grantRole', '_grantRole', 'grantRoleExtra']) {
      // Each test lands in exactly one leg.
      expect(forName(name)).toHaveLength(1);
    }
    expect(forName('grantRole')).not.toStrictEqual(forName('_grantRole'));
    expect(forName('grantRole')).not.toStrictEqual(forName('grantRoleExtra'));
  });

  it('regex-escapes describe names', () => {
    const legs = splitSpec(
      block('A (v1.0) [x]', its(2)) + block('B $end', its(2)),
      2,
    );

    expect(legs).not.toBeNull();
    if (legs === null) return;
    for (const leg of legs)
      expect(() => new RegExp(leg.testFilter)).not.toThrow();
    const a = legs[0] as SplitLeg;
    const b = legs[1] as SplitLeg;
    expect(matches(a.testFilter, 'A (v1.0) [x] > t0')).toBe(true);
    // The dot must not have become a wildcard.
    expect(matches(a.testFilter, 'A (v1X0) [x] > t0')).toBe(false);
    expect(matches(b.testFilter, 'B $end > t0')).toBe(true);
  });

  it('rides a dynamic-named child on the remainder leg', () => {
    // A `describe.each` (or template/variable name) cannot be named in a
    // pattern; its tests are addressed by excluding every literal sibling.
    const legs = splitSpec(
      block(
        'P',
        `${block('lit', its(2))}describe.each(rows)('with %s', () => {\n${its(2)}});\n`,
      ),
      2,
    );

    expect(legs).toStrictEqual([
      {
        testFilter: '^P > (?!lit > )',
        tests: 2,
        estimatedMs: 2 * DEFAULT_TEST_MS,
      },
      { testFilter: '^P > lit > ', tests: 2, estimatedMs: 2 * DEFAULT_TEST_MS },
    ]);
  });

  it('does not split when a dynamic subtree alone exceeds the limit', () => {
    // The dynamic child cannot be subdivided (no names to pattern on), so the
    // rule cannot be met; a wrong filter would be worse than a long leg.
    const legs = splitSpec(
      block(
        'P',
        `${block('lit', its(2))}describe.each(rows)('with %s', () => {\n${its(3)}});\n`,
      ),
      2,
    );

    expect(legs).toBeNull();
  });

  it('treats a template name with an interpolation as dynamic', () => {
    const legs = splitSpec(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the placeholder is the fixture's point (an interpolated describe name must count as dynamic)
      'describe(`P ${suffix}`, () => {\n' +
        its(3) +
        '});\n' +
        block('B', its(2)),
      2,
    );

    expect(legs).toBeNull();
  });

  it('does not split when one describe exceeds the limit indivisibly', () => {
    expect(splitSpec(block('A', its(4)) + block('B', its(1)), 2)).toBeNull();
  });

  it('does not split colliding sibling prefixes', () => {
    // 'grant > ' is a prefix of 'grant > extra > ', so the shorter pattern
    // would run the longer one's tests in two legs.
    const legs = splitSpec(
      block('P', block('grant', its(2)) + block('grant > extra', its(2))),
      2,
    );

    expect(legs).toBeNull();
  });

  it('splits sibling names that extend each other by a word', () => {
    // The joint ends every name, so 'grant > ' cannot match 'grant extra > '.
    const legs = splitSpec(
      block('P', block('grant', its(2)) + block('grant extra', its(2))),
      2,
    );

    expect(legs).toStrictEqual([
      {
        testFilter: '^P > grant > ',
        tests: 2,
        estimatedMs: 2 * DEFAULT_TEST_MS,
      },
      {
        testFilter: '^P > grant extra > ',
        tests: 2,
        estimatedMs: 2 * DEFAULT_TEST_MS,
      },
    ]);
  });

  it('counts aliased test registrations', () => {
    // `const itDryOnly = it.skipIf(isLiveBackend())` registers tests under
    // another name (ShieldedAccessControl does this); missing them would both
    // undercount the packing and misjudge the split threshold.
    const source =
      'const itDryOnly = it.skipIf(isLiveBackend());\n' +
      block('A', `itDryOnly('a', () => {});\n${its(1)}`) +
      block('B', its(2));

    expect(splitSpec(source, 2)).toStrictEqual([
      { testFilter: '^A > ', tests: 2, estimatedMs: 2 * DEFAULT_TEST_MS },
      { testFilter: '^B > ', tests: 2, estimatedMs: 2 * DEFAULT_TEST_MS },
    ]);
  });

  it('counts modifier chains and .each tables as one test each', () => {
    const body =
      "it.each([1, 2, 3])('case %s', () => {});\n" + // one, however many rows
      "it.skipIf(cond)('conditional', () => {});\n" +
      "it.concurrent('parallel', () => {});\n";
    const legs = splitSpec(block('A', body) + block('B', its(3)), 3);

    expect(legs).toStrictEqual([
      { testFilter: '^A > ', tests: 3, estimatedMs: 3 * DEFAULT_TEST_MS },
      { testFilter: '^B > ', tests: 3, estimatedMs: 3 * DEFAULT_TEST_MS },
    ]);
  });

  it('ignores registrations in comments and strings', () => {
    const source =
      "// it('commented', () => {});\n" +
      "/* describe('block', () => {}); */\n" +
      'const s = "it(\'in a string\', x)";\n' +
      block('A', its(2)) +
      block('B', its(2));

    expect(splitSpec(source, 2)).toStrictEqual([
      { testFilter: '^A > ', tests: 2, estimatedMs: 2 * DEFAULT_TEST_MS },
      { testFilter: '^B > ', tests: 2, estimatedMs: 2 * DEFAULT_TEST_MS },
    ]);
  });

  it('puts top-level tests on the root remainder leg', () => {
    const legs = splitSpec(its(2, 'top') + block('A', its(2)), 2);

    expect(legs).toStrictEqual([
      { testFilter: '^(?!A > )', tests: 2, estimatedMs: 2 * DEFAULT_TEST_MS },
      { testFilter: '^A > ', tests: 2, estimatedMs: 2 * DEFAULT_TEST_MS },
    ]);
  });

  it('does not split a source it cannot scan to the end', () => {
    // An unbalanced scan means some construct was misread, and a filter built
    // on a misreading could silently skip tests.
    expect(splitSpec(`describe('A', () => {\n${its(4)}`, 2)).toBeNull();
  });

  it('splits the real worst offender within the limit', () => {
    // The rule exists for files like ShieldedAccessControl (85+ minutes as a
    // single live leg). Against the real source: every leg within the limit,
    // every filter a valid regex, and enough legs to matter.
    const source = readFileSync(
      path.join(
        import.meta.dirname,
        '../../../contracts/src/access/test/ShieldedAccessControl.test.ts',
      ),
      'utf8',
    );
    const legs = splitSpec(source, MAX_TESTS_PER_LEG);

    expect(legs).not.toBeNull();
    if (legs === null) return;
    expect(legs.length).toBeGreaterThanOrEqual(3);
    for (const leg of legs) {
      expect(leg.tests).toBeLessThanOrEqual(MAX_TESTS_PER_LEG);
      expect(() => new RegExp(leg.testFilter)).not.toThrow();
      expect(leg.testFilter.startsWith('^')).toBe(true);
    }
  });
});

describe('splitSpec weighting', () => {
  const its = (n: number, prefix = 't'): string =>
    Array.from(
      { length: n },
      (_, i) => `it('${prefix}${i}', () => {});\n`,
    ).join('');
  const block = (name: string, body: string): string =>
    `describe('${name}', () => {\n${body}});\n`;

  /** History for every test the fixtures register: `<describe> > <prefix><i>`,
   * the `" > "`-joined form the leg patterns match. */
  const history = (
    perTest: Readonly<Record<string, number>>,
    tests: number,
    prefix = 't',
  ): Map<string, number> => {
    const map = new Map<string, number>();
    for (const [name, ms] of Object.entries(perTest)) {
      for (let i = 0; i < tests; i++) map.set(`${name} > ${prefix}${i}`, ms);
    }
    return map;
  };

  // The MultiToken shape: few tests, each several minutes. 20 tests over four
  // describes is far under the 30-test cap, but at 3 min/test the file is a
  // ~1h leg — the exact under-split run 32831811290 measured.
  const HEAVY =
    block('A', its(5)) +
    block('B', its(5)) +
    block('C', its(5)) +
    block('D', its(5));
  const HEAVY_MS = history(
    { A: 180_000, B: 180_000, C: 180_000, D: 180_000 },
    5,
  );

  it('splits a heavy file that count packing leaves whole', () => {
    // 20 tests ≤ 30: the count rule sees nothing to do.
    expect(splitSpec(HEAVY, MAX_TESTS_PER_LEG)).toBeNull();

    // 20 × 180s = 60 minutes of measured history: over the ~27.5 min budget,
    // so the same file now fans out, each leg within it.
    const legs = splitSpec(HEAVY, MAX_TESTS_PER_LEG, HEAVY_MS);

    expect(legs).not.toBeNull();
    if (legs === null) return;
    expect(legs.length).toBeGreaterThanOrEqual(2);
    for (const leg of legs) {
      expect(leg.estimatedMs).toBeLessThanOrEqual(
        MAX_TESTS_PER_LEG * DEFAULT_TEST_MS,
      );
    }
    // Every test still runs exactly once.
    expect(legs.reduce((sum, leg) => sum + leg.tests, 0)).toBe(20);
  });

  it('packs exactly as the count rule when no test matches the history', () => {
    // The equivalence the fallback promises: uniform default weights make
    // every weight comparison the count comparison scaled by the default, so
    // no history, an empty history, and another file's history all produce
    // the same legs the count-based rule did.
    const source = block('A', its(2)) + block('B', its(2)) + block('C', its(1));
    const byCount = splitSpec(source, 2);

    expect(byCount).not.toBeNull();
    expect(splitSpec(source, 2, new Map())).toStrictEqual(byCount);
    expect(
      splitSpec(source, 2, history({ 'Other file suite': 999_000 }, 2)),
    ).toStrictEqual(byCount);
  });

  it('matches history names the way the leg patterns are built', () => {
    // The lookup keys are full names in the split's own convention —
    // `" > "`-joined describe path plus test name. A measured describe carries
    // its duration; an unmeasured sibling weighs the default per test.
    const source = block('A', its(2)) + block('B', its(2));
    const legs = splitSpec(source, 2, history({ A: 50_000 }, 2));

    expect(legs).toStrictEqual([
      { testFilter: '^A > ', tests: 2, estimatedMs: 100_000 },
      { testFilter: '^B > ', tests: 2, estimatedMs: 2 * DEFAULT_TEST_MS },
    ]);
  });

  it('gives a measured, indivisible, over-budget describe its own leg', () => {
    // A cannot be subdivided (no child describes) and its MEASURED weight
    // exceeds the budget. Its filter is still exact, so it stands alone as an
    // oversized leg — refusing here would collapse the whole file into one
    // even longer leg (the exact way MultiToken degraded in the first cut).
    const source = block('A', its(2)) + block('B', its(2));
    const legs = splitSpec(source, 2, history({ A: 400_000 }, 2));

    expect(legs).toStrictEqual([
      { testFilter: '^A > ', tests: 2, estimatedMs: 800_000 },
      { testFilter: '^B > ', tests: 2, estimatedMs: 2 * DEFAULT_TEST_MS },
    ]);
  });

  it('still refuses an over-budget indivisible unit assumed from defaults', () => {
    // Without a measurement the overrun is a guess, so the old count rule
    // stands: a 4-test leaf describe at limit 2 does not split, history or
    // not — this is the count-equivalence corner, pinned on purpose.
    const source = block('A', its(4)) + block('B', its(1));

    expect(splitSpec(source, 2, history({ B: 10_000 }, 1))).toBeNull();
  });

  it('descends into a heavy describe with splittable children', () => {
    // P as a whole (160s) is over the 110s budget, but each child fits: the
    // walk recurses into P instead of giving up on it.
    const source = block('P', block('x', its(2)) + block('y', its(2)));
    const legs = splitSpec(
      source,
      2,
      history({ 'P > x': 40_000, 'P > y': 40_000 }, 2),
    );

    expect(legs).toStrictEqual([
      { testFilter: '^P > x > ', tests: 2, estimatedMs: 80_000 },
      { testFilter: '^P > y > ', tests: 2, estimatedMs: 80_000 },
    ]);
  });
});

describe('estimateSpecMs', () => {
  it('weighs an unmeasured file at the default per test', () => {
    expect(estimateSpecMs("describe('A', () => { it('t', () => {}); });")).toBe(
      DEFAULT_TEST_MS,
    );
  });

  it('prefers measured durations and defaults the rest', () => {
    expect(
      estimateSpecMs(
        "describe('A', () => { it('t0', () => {}); it('t1', () => {}); });",
        new Map([['A > t0', 120_000]]),
      ),
    ).toBe(120_000 + DEFAULT_TEST_MS);
  });

  it('reports no estimate for a source it cannot scan', () => {
    expect(estimateSpecMs("describe('A', () => {")).toBeUndefined();
  });
});
