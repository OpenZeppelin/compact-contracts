/**
 * Cap a spec file's suite leg at {@link MAX_TESTS_PER_LEG} tests.
 *
 * A live test costs ~55s of wall clock (deploy-per-test against a real node),
 * so one big file is one long serial job: `ShieldedAccessControl.test.ts` (89
 * tests) ran 85+ minutes and set the whole run's duration. Files cannot be
 * split on disk without losing their structure, but vitest can run a slice of
 * one: `-t <regex>` (testNamePattern) skips every test whose full name does
 * not match. So a file over the limit is parsed into its `describe` tree,
 * bin-packed by describe blocks into groups of at most the limit, and each
 * group becomes one leg running the same file under a `-t` filter.
 *
 * Nothing here is per-file: the rule is driven only by the constant, and the
 * parser handles whatever the spec files contain (verified against the forms
 * that occur under `contracts/src/`).
 *
 * ## The filter format, pinned against vitest 4.x
 *
 * `-t` becomes `new RegExp(pattern)` and is matched (unanchored) against a
 * test's full name — the describe names and the test name joined by SINGLE
 * SPACES, without the file name (`getTaskFullName` in `@vitest/runner`, used
 * by `interpretTaskModes`). NOT the `" > "` the reporters print. Each group's
 * filter is an alternation of `^`-anchored, regex-escaped describe paths, each
 * with a trailing space so `grantRole ` can match neither `_grantRole` (the
 * anchor pins the start) nor `grantRoleExtra` (the space pins the end):
 *
 *   ^ShieldedAccessControl after initialization grantRole |^ShieldedAcc…
 *
 * Tests sitting directly under a describe that also has child describes get a
 * remainder alternative: the parent's path with a lookahead excluding every
 * child (`^Parent (?!childA |childB )`), so they land in exactly one group.
 *
 * ## Safety fallbacks — a wrong filter is worse than a long leg
 *
 * A describe that cannot be named exactly (template literal with `${}`, a
 * variable, `describe.each`) cannot be filtered reliably; its subtree rides
 * the parent's remainder group, whose lookahead names only the literal
 * siblings. Whenever exactness is at risk the file is NOT split at all:
 *   - the scan looks corrupted (unbalanced brackets, unterminated literals);
 *   - an indivisible unit alone exceeds the limit;
 *   - two sibling names collide as prefixes (`grant` next to `grant extra`),
 *     which would run one group's tests in two legs;
 *   - the units' counts do not add back up to the file's total.
 * The runtime backstop for what a static parse cannot see (a describe
 * registered through a helper function, say) is in `LiveOrchestrator`: a
 * pattern that matches no reported test name aborts the leg loudly.
 *
 * Counting is static: an `it.each` table counts as one test, so property-based
 * files pack under their runtime size. Acceptable — packing is a budget, not
 * an invariant.
 */

/** No suite leg may carry more tests than this. ~30 × 55s ≈ a half-hour job,
 * short enough that no single file dominates the run's wall clock. */
export const MAX_TESTS_PER_LEG = 30;

/** One leg of a split file. */
export interface SplitLeg {
  /** vitest `-t` regex selecting exactly this leg's share of the file. */
  readonly testFilter: string;
  /** Statically counted tests in the leg (an `.each` table counts once). */
  readonly tests: number;
}

/** A `describe` block: its name (or null when it cannot be matched by name),
 * the tests registered directly in it, and its child describes. */
interface SuiteNode {
  readonly name: string | null;
  directTests: number;
  readonly children: SuiteNode[];
}

/** An indivisible slice of the tree the packer arranges into legs. */
interface Unit {
  readonly tests: number;
  /** A `^`-anchored regex alternative selecting exactly this unit. */
  readonly pattern: string;
  /** Source order, so a leg's alternation reads like the file does. */
  readonly order: number;
}

/**
 * Split a spec file's source into legs of at most `limit` tests.
 *
 * @returns the legs, or `null` when the file fits in one leg or cannot be
 *   split safely (see the fallback list above) — the caller then runs the
 *   whole file unfiltered, exactly as before.
 */
export function splitSpec(
  source: string,
  limit: number = MAX_TESTS_PER_LEG,
): SplitLeg[] | null {
  const root = parseSuiteTree(source);
  if (root === undefined) return null;
  const total = totalTests(root);
  if (total <= limit) return null;

  const units: Unit[] = [];
  if (!collectUnits(root, [], limit, units)) return null;
  // Exactness insurance: the units partition the tree by construction, so a
  // sum that misses the total means the parse or the walk is wrong — and a
  // wrong filter must fall back to one long leg, never ship.
  if (units.reduce((sum, unit) => sum + unit.tests, 0) !== total) return null;
  if (units.length < 2) return null;

  const legs = pack(units, limit).map((bin) => ({
    testFilter: bin.units.map((unit) => unit.pattern).join('|'),
    tests: bin.tests,
  }));
  if (legs.length < 2) return null;
  // The pattern is handed to `new RegExp` twice downstream (vitest's `-t` and
  // the orchestrator's match guard); one that does not compile must never
  // leave the plan job.
  for (const leg of legs) {
    try {
      new RegExp(leg.testFilter);
    } catch {
      return null;
    }
  }
  return legs;
}

/** Sum of a subtree's statically counted tests. */
function totalTests(node: SuiteNode): number {
  return node.children.reduce(
    (sum, child) => sum + totalTests(child),
    node.directTests,
  );
}

const escapeRegex = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The space-joined full-name prefix for a describe path, regex-escaped. Ends
 * in a space (the joint before the next name) unless the path is the root. */
function pathPrefix(names: readonly string[]): string {
  return names.map((name) => `${escapeRegex(name)} `).join('');
}

/**
 * Decompose `node` (whose own path is literal) into indivisible units.
 *
 * A literal child at or under the limit is one unit; one over it is recursed
 * into. The node's direct tests and every dynamic-named child form the
 * remainder unit: the node's path minus a lookahead over the literal children
 * — the only way to address tests whose own describe cannot be named.
 *
 * @returns false when the subtree cannot be partitioned exactly, which the
 *   caller must turn into "do not split this file".
 */
function collectUnits(
  node: SuiteNode,
  path: readonly string[],
  limit: number,
  out: Unit[],
): boolean {
  const literal = node.children.filter((child) => child.name !== null) as
    // narrowed for the name uses below
    (SuiteNode & { name: string })[];
  const dynamic = node.children.filter((child) => child.name === null);

  // Two sibling names where one extends the other word-by-word ('grant' next
  // to 'grant extra') make the shorter one's pattern match both subtrees, so
  // a test would run in two legs. Rare enough to refuse rather than solve.
  for (const a of literal) {
    for (const b of literal) {
      if (a !== b && `${b.name} `.startsWith(`${a.name} `)) return false;
    }
  }

  const remainder =
    node.directTests +
    dynamic.reduce((sum, child) => sum + totalTests(child), 0);
  // The remainder cannot be subdivided (its describes cannot be named), so a
  // remainder over the limit means this file cannot be split within the rule.
  if (remainder > limit) return false;
  if (remainder > 0) {
    const lookahead =
      literal.length > 0
        ? `(?!${literal.map((child) => `${escapeRegex(child.name)} `).join('|')})`
        : '';
    out.push({
      tests: remainder,
      pattern: `^${pathPrefix(path)}${lookahead}`,
      order: out.length,
    });
  }

  for (const child of literal) {
    const tests = totalTests(child);
    if (tests === 0) continue; // nothing to select; still excluded above
    const childPath = [...path, child.name];
    if (tests <= limit) {
      out.push({
        tests,
        pattern: `^${pathPrefix(childPath)}`,
        order: out.length,
      });
    } else if (!collectUnits(child, childPath, limit, out)) {
      return false;
    }
  }
  return true;
}

interface Bin {
  tests: number;
  units: Unit[];
}

/**
 * First-fit-decreasing bin packing. Not optimal, but within one bin of
 * `ceil(total/limit)` in practice, and the group count is a job count — a
 * spare group costs one more stack reset, not correctness.
 */
function pack(units: readonly Unit[], limit: number): Bin[] {
  const bins: Bin[] = [];
  for (const unit of [...units].sort((a, b) => b.tests - a.tests)) {
    const bin = bins.find((b) => b.tests + unit.tests <= limit);
    if (bin === undefined) bins.push({ tests: unit.tests, units: [unit] });
    else {
      bin.tests += unit.tests;
      bin.units.push(unit);
    }
  }
  // Source order inside each leg and across legs, so the plan log and the
  // filters read like the file rather than like the packer.
  for (const bin of bins) bin.units.sort((a, b) => a.order - b.order);
  return bins.sort(
    (a, b) => (a.units[0]?.order ?? 0) - (b.units[0]?.order ?? 0),
  );
}

// ---------------------------------------------------------------------------
// Source scanning. A tokenizer, not a JS parser: it only has to track what
// hides brackets (comments, strings, templates, regex literals) and recognize
// `describe`/`it`/`test` call heads with their modifier chains. Anything it
// cannot follow surfaces as an imbalance at EOF, which `parseSuiteTree` turns
// into "do not split".
// ---------------------------------------------------------------------------

const TEST_HEADS = new Set(['it', 'test']);
/** Modifiers that take their own argument list before the registration call:
 * `it.each(table)('name', fn)`, `describe.skipIf(cond)('name', fn)`, … */
const CALLED_MODS = new Set(['each', 'for', 'skipIf', 'runIf']);
/** After these, a `/` starts a regex literal rather than a division. */
const REGEX_KEYWORDS = new Set([
  'return',
  'case',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'void',
  'delete',
  'throw',
  'yield',
  'await',
  'do',
  'else',
]);

const isIdentStart = (c: string): boolean => /[A-Za-z_$]/.test(c);
const isIdentChar = (c: string): boolean => /[A-Za-z0-9_$]/.test(c);

/** `const itDryOnly = it.skipIf(isLiveBackend());` registers tests under
 * another name; the alias has to count like `it` or the file undercounts. */
function testAliases(source: string): Set<string> {
  const aliases = new Set<string>();
  const decl = /\bconst\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:it|test)\b/g;
  for (const match of source.matchAll(decl)) aliases.add(match[1] as string);
  return aliases;
}

/** Index after a `//` comment (the newline stays for the caller). */
function skipLineComment(src: string, i: number): number {
  const end = src.indexOf('\n', i);
  return end === -1 ? src.length : end;
}

/** Index after a `/*` comment, or -1 when unterminated. */
function skipBlockComment(src: string, i: number): number {
  const end = src.indexOf('*/', i + 2);
  return end === -1 ? -1 : end + 2;
}

/** Index after a `'`/`"` string starting at `i`, or -1 when unterminated. */
function skipString(src: string, i: number): number {
  const quote = src[i];
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') j++;
    else if (src[j] === quote) return j + 1;
    else if (src[j] === '\n') return -1; // unterminated on this line
  }
  return -1;
}

/** Index after a template literal starting at `i`, handling nested `${}`
 * (which can hold strings, comments, and further templates), or -1. */
function skipTemplate(src: string, i: number): number {
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') j += 2;
    else if (c === '`') return j + 1;
    else if (c === '$' && src[j + 1] === '{') {
      j = skipInterpolation(src, j + 1);
      if (j === -1) return -1;
    } else j++;
  }
  return -1;
}

/** Index after the `{…}` of a template interpolation, or -1. */
function skipInterpolation(src: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === '/' && src[j + 1] === '/') j = skipLineComment(src, j);
    else if (c === '/' && src[j + 1] === '*') {
      j = skipBlockComment(src, j);
      if (j === -1) return -1;
    } else if (c === "'" || c === '"') {
      j = skipString(src, j);
      if (j === -1) return -1;
    } else if (c === '`') {
      j = skipTemplate(src, j);
      if (j === -1) return -1;
    } else if (c === '{') {
      depth++;
      j++;
    } else if (c === '}') {
      depth--;
      j++;
      if (depth === 0) return j;
    } else j++;
  }
  return -1;
}

/** Index after a regex literal starting at `i`, or -1. Character classes may
 * contain an unescaped `/`, so they are tracked. */
function skipRegexLiteral(src: string, i: number): number {
  let inClass = false;
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') j++;
    else if (c === '\n') return -1;
    else if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) {
      let k = j + 1;
      while (k < src.length && /[a-z]/i.test(src[k] as string)) k++; // flags
      return k;
    }
  }
  return -1;
}

/** Index after whitespace and comments from `i`, or -1 on an unterminated
 * block comment. */
function skipTrivia(src: string, i: number): number {
  let j = i;
  while (j < src.length) {
    const c = src[j] as string;
    if (/\s/.test(c)) j++;
    else if (c === '/' && src[j + 1] === '/') j = skipLineComment(src, j);
    else if (c === '/' && src[j + 1] === '*') {
      j = skipBlockComment(src, j);
      if (j === -1) return -1;
    } else return j;
  }
  return j;
}

/** Index after a balanced `(…)` starting at `i`, skipping everything that can
 * hide a bracket, or -1. Used for modifier argument lists, which the main
 * scan then never sees. */
function skipBalancedParens(src: string, i: number): number {
  let depth = 0;
  let j = i;
  /** Last significant char, for the regex-vs-division call. Starts as `(`, an
   * operand position. */
  let last = '(';
  while (j < src.length) {
    const c = src[j] as string;
    if (/\s/.test(c)) {
      j++;
      continue;
    }
    if (c === '/' && src[j + 1] === '/') {
      j = skipLineComment(src, j);
      continue;
    }
    if (c === '/' && src[j + 1] === '*') {
      j = skipBlockComment(src, j);
      if (j === -1) return -1;
      continue;
    }
    if (c === "'" || c === '"') {
      j = skipString(src, j);
      if (j === -1) return -1;
      last = "'";
      continue;
    }
    if (c === '`') {
      j = skipTemplate(src, j);
      if (j === -1) return -1;
      last = "'";
      continue;
    }
    if (c === '/' && regexCanStart(last)) {
      j = skipRegexLiteral(src, j);
      if (j === -1) return -1;
      last = "'";
      continue;
    }
    if (isIdentStart(c)) {
      const start = j;
      while (j < src.length && isIdentChar(src[j] as string)) j++;
      last = REGEX_KEYWORDS.has(src.slice(start, j)) ? 'kw' : 'id';
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') {
      depth--;
      if (depth === 0) return j + 1;
    }
    last = c;
    j++;
  }
  return -1;
}

/** Whether a `/` after this last-significant token starts a regex literal
 * (operand position) rather than a division (after a value). */
function regexCanStart(last: string): boolean {
  return (
    last === 'kw' || !(last === 'id' || last === "'" || /[)\]0-9]/.test(last))
  );
}

/** The name argument at `i` (just inside the registration call's `(`).
 * `undefined` when it is not a plain literal — an expression, or a template
 * with `${}` — and so cannot be turned into an exact pattern. */
function literalName(src: string, i: number): string | undefined {
  const c = src[i];
  if (c === "'" || c === '"') {
    const end = skipString(src, i);
    if (end === -1) return undefined;
    const raw = src.slice(i + 1, end - 1);
    // Only the simple escapes; an exotic one makes the name dynamic rather
    // than risk a pattern that spells the name differently than vitest sees.
    if (/\\[^\\'"`]/.test(raw)) return undefined;
    const name = raw.replace(/\\([\\'"`])/g, '$1');
    const after = skipTrivia(src, end);
    // `'a' + suffix` is not a literal name even though it starts as one.
    return after !== -1 && src[after] === ',' ? name : undefined;
  }
  if (c === '`') {
    const end = skipTemplate(src, i);
    if (end === -1) return undefined;
    const raw = src.slice(i + 1, end - 1);
    if (raw.includes('${') || raw.includes('\\')) return undefined;
    const after = skipTrivia(src, end);
    return after !== -1 && src[after] === ',' ? raw : undefined;
  }
  return undefined;
}

/** What `tryCall` found at a head identifier. */
interface CallHead {
  /** Index of the registration call's `(`. */
  readonly openParen: number;
  /** Whether the chain included `.each`/`.for` (dynamic names by design). */
  readonly each: boolean;
}

/**
 * Follow a modifier chain from just after a head identifier to the
 * registration call: `.skip`, `.each(table)`, `` .each`table` ``,
 * `.skipIf(cond)`, in any combination. `undefined` when no registration call
 * follows — e.g. the alias declaration `const itDryOnly = it.skipIf(cond);`,
 * which registers nothing itself.
 */
function tryCall(src: string, i: number): CallHead | undefined {
  let j = i;
  let each = false;
  for (;;) {
    j = skipTrivia(src, j);
    if (j === -1 || j >= src.length) return undefined;
    const c = src[j];
    if (c === '(') return { openParen: j, each };
    if (c !== '.') return undefined;
    j = skipTrivia(src, j + 1);
    if (j === -1 || !isIdentStart(src[j] as string)) return undefined;
    const start = j;
    while (j < src.length && isIdentChar(src[j] as string)) j++;
    const mod = src.slice(start, j);
    if (mod === 'each' || mod === 'for') each = true;
    if (CALLED_MODS.has(mod)) {
      j = skipTrivia(src, j);
      if (j === -1) return undefined;
      if (src[j] === '(') {
        j = skipBalancedParens(src, j);
        if (j === -1) return undefined;
      } else if (src[j] === '`') {
        // `it.each`a|b`(…)` — the table as a tagged template.
        j = skipTemplate(src, j);
        if (j === -1) return undefined;
      } else return undefined;
    }
  }
}

/**
 * Parse a spec file into its describe tree.
 *
 * Nesting is tracked by parenthesis depth: everything until a describe call's
 * closing `)` — its name, options, and callback alike — belongs to that
 * suite, whatever the callback's syntax. Tests registered inside loops or
 * local helpers therefore land on the lexically enclosing describe, which is
 * where their names sit at runtime too.
 *
 * @returns the virtual root (name '', the file's top level), or `undefined`
 *   when the scan ends unbalanced — the one honest signal that some construct
 *   was misread and no filter derived from it can be trusted.
 */
export function parseSuiteTree(source: string): SuiteNode | undefined {
  const aliases = testAliases(source);
  const root: SuiteNode = { name: '', directTests: 0, children: [] };
  const stack: { node: SuiteNode; closeDepth: number }[] = [];
  const current = (): SuiteNode =>
    stack.length > 0
      ? (stack[stack.length - 1] as { node: SuiteNode }).node
      : root;

  let depth = 0;
  let last = ';'; // last significant token, for the regex heuristic
  let i = 0;
  while (i < source.length) {
    const c = source[i] as string;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '/' && source[i + 1] === '/') {
      i = skipLineComment(source, i);
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      i = skipBlockComment(source, i);
      if (i === -1) return undefined;
      continue;
    }
    if (c === "'" || c === '"') {
      i = skipString(source, i);
      if (i === -1) return undefined;
      last = "'";
      continue;
    }
    if (c === '`') {
      i = skipTemplate(source, i);
      if (i === -1) return undefined;
      last = "'";
      continue;
    }
    if (c === '/' && regexCanStart(last)) {
      i = skipRegexLiteral(source, i);
      if (i === -1) return undefined;
      last = "'";
      continue;
    }
    if (isIdentStart(c)) {
      const start = i;
      while (i < source.length && isIdentChar(source[i] as string)) i++;
      const word = source.slice(start, i);
      last = REGEX_KEYWORDS.has(word) ? 'kw' : 'id';
      const prev = start > 0 ? (source[start - 1] as string) : ';';
      // `foo.describe(` or `xit(` is not a registration.
      if (prev === '.' || isIdentChar(prev)) continue;
      const isDescribe = word === 'describe';
      const isTest = TEST_HEADS.has(word) || aliases.has(word);
      if (!isDescribe && !isTest) continue;
      const call = tryCall(source, i);
      if (call === undefined) continue;
      if (isTest) {
        current().directTests++;
      } else {
        const nameAt = skipTrivia(source, call.openParen + 1);
        const name =
          call.each || nameAt === -1 ? undefined : literalName(source, nameAt);
        const node: SuiteNode = {
          // '' would make a path prefix indistinguishable from its parent's,
          // so an empty name counts as unfilterable too.
          name: name !== undefined && name !== '' ? name : null,
          directTests: 0,
          children: [],
        };
        current().children.push(node);
        stack.push({ node, closeDepth: depth });
      }
      // Enter the registration call; its arguments (the name literal
      // included) are scanned by this same loop.
      depth++;
      i = call.openParen + 1;
      last = '(';
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') {
      depth--;
      if (depth < 0) return undefined;
      while (
        stack.length > 0 &&
        (stack[stack.length - 1] as { closeDepth: number }).closeDepth === depth
      ) {
        stack.pop();
      }
    }
    last = c;
    i++;
  }
  return depth === 0 && stack.length === 0 ? root : undefined;
}
