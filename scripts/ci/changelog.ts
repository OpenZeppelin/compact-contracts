/**
 * Keep `CHANGELOG.md` and the releases in step.
 *
 * A release flow that never touches the file ships versions with their entries
 * still under `## Unreleased` and no section of their own. So the version bump
 * rolls `## Unreleased` into the new version's section
 * ({@link rollUnreleased}), the release reads its notes from that section
 * ({@link releaseNotes}), and a PR that changes what consumers get must add an
 * `## Unreleased` entry first ({@link changelogVerdict}).
 *
 * Pure: `release-ci.ts` owns the file and `git` I/O.
 */

const UNRELEASED = '## Unreleased';

/** The contracts package manifest. Its runtime `dependencies` ship to
 * consumers, so bumping one is a contract change. */
export const PACKAGE_JSON = 'contracts/package.json';

/** A contract source outside any `test/` dir. Tests change nothing a consumer
 * sees, so they never need an entry. */
const CONTRACT_SOURCE = /^contracts\/src\/(?!(.*\/)?test\/)/;

/** CRLF is folded first so a file saved on Windows still matches the headers. */
function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n');
}

/** Exact, or followed by a space (the date), so `0.5.0-alpha.1` never matches
 * `0.5.0-alpha.10`. */
function isVersionHeader(line: string, version: string): boolean {
  const header = `## ${version}`;
  return line === header || line.startsWith(`${header} `);
}

/** Index of the next `## ` header after `start`, or the line count. */
function sectionEnd(lines: readonly string[], start: number): number {
  const next = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  return next === -1 ? lines.length : next;
}

/** The error for a section cut short by an entry heading written as `##`, or
 * `undefined`. Every entry below the stray header would otherwise fall out of
 * the section unnoticed. */
function strayHeader(
  lines: readonly string[],
  start: number,
): string | undefined {
  const end = sectionEnd(lines, start);
  if (end === lines.length || /^## \d/.test(lines[end])) return undefined;
  return `CHANGELOG.md has a stray "${lines[end]}" header under "${lines[start]}" (entry headings are ###).`;
}

/**
 * Open `## <version> (<date>)` directly under `## Unreleased`, leaving the
 * entries below it as the new version's section and every other line as is.
 *
 * Refuses an empty section unless `allowEmpty`: an empty roll ships a release
 * with no curated notes, so it has to be a deliberate choice (a first rc, a
 * clean audit).
 */
export function rollUnreleased(
  text: string,
  options: {
    readonly version: string;
    readonly date: string;
    readonly allowEmpty: boolean;
  },
):
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly message: string } {
  const { version, date, allowEmpty } = options;
  const lines = splitLines(text);
  const heads = lines.flatMap((l, i) => (l === UNRELEASED ? [i] : []));
  if (heads.length !== 1) {
    return {
      ok: false,
      message: `CHANGELOG.md needs exactly one "${UNRELEASED}" header, found ${heads.length}.`,
    };
  }
  if (lines.some((l) => isVersionHeader(l, version))) {
    return {
      ok: false,
      message: `CHANGELOG.md already has a "## ${version}" section.`,
    };
  }
  const start = heads[0];
  const stray = strayHeader(lines, start);
  if (stray) return { ok: false, message: stray };
  const hasEntries = lines
    .slice(start + 1, sectionEnd(lines, start))
    .some((l) => l.startsWith('- '));
  if (!hasEntries && !allowEmpty) {
    return {
      ok: false,
      message:
        `CHANGELOG.md has no entries under "${UNRELEASED}". ` +
        'If that is intended, re-run with allow_empty_changelog ticked.',
    };
  }
  lines.splice(start + 1, 0, '', `## ${version} (${date})`);
  return { ok: true, text: lines.join('\n') };
}

/**
 * The body of `version`'s section, trimmed. A body of headings alone counts as
 * empty, which is valid: GitHub's generated notes still follow it. A missing
 * section fails instead, since the alternative is a release whose notes
 * silently omit its changes.
 */
export function releaseNotes(
  text: string,
  version: string,
):
  | { readonly ok: true; readonly notes: string }
  | { readonly ok: false; readonly message: string } {
  const lines = splitLines(text);
  const start = lines.findIndex((l) => isVersionHeader(l, version));
  if (start === -1) {
    return {
      ok: false,
      message: `CHANGELOG.md has no "## ${version}" section to use as release notes.`,
    };
  }
  const stray = strayHeader(lines, start);
  if (stray) return { ok: false, message: stray };
  const body = lines.slice(start + 1, sectionEnd(lines, start));
  const headingsOnly = body.every((l) => l.trim() === '' || l.startsWith('#'));
  return { ok: true, notes: headingsOnly ? '' : body.join('\n').trim() };
}

/** The `- ` entries under `## Unreleased`, or none when the header is missing. */
export function unreleasedEntries(text: string): string[] {
  const lines = splitLines(text);
  const start = lines.indexOf(UNRELEASED);
  if (start === -1) return [];
  return lines
    .slice(start + 1, sectionEnd(lines, start))
    .filter((l) => l.startsWith('- '));
}

/** `dependencies` with sorted keys, so a reorder is not a bump. */
function runtimeDependencies(packageJson: string): string {
  const deps: Record<string, unknown> =
    JSON.parse(packageJson).dependencies ?? {};
  return JSON.stringify(
    Object.entries(deps).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
}

/**
 * Whether the PR changes what a consumer of the package gets: a contract
 * source, or a runtime dependency in {@link PACKAGE_JSON}. A `devDependencies`
 * or `scripts` edit alone does not count.
 *
 * @param packageJson - both sides of {@link PACKAGE_JSON}, when it changed.
 * Missing or unparsable texts count as a change: the check fails closed.
 */
export function contractChange(
  changedFiles: readonly string[],
  packageJson?: { readonly before: string; readonly after: string },
): boolean {
  if (changedFiles.some((f) => CONTRACT_SOURCE.test(f))) return true;
  if (!changedFiles.includes(PACKAGE_JSON)) return false;
  if (!packageJson) return true;
  try {
    return (
      runtimeDependencies(packageJson.before) !==
      runtimeDependencies(packageJson.after)
    );
  } catch {
    return true;
  }
}

/**
 * Whether a PR may merge without a new `## Unreleased` entry. The version bump
 * PR is exempt because it moves the entries rather than adding one. The
 * `skip-changelog` label is the escape for contract changes nobody would
 * notice (a comment, a rename of a private helper).
 */
export function changelogVerdict(pr: {
  readonly contractChange: boolean;
  readonly entryAdded: boolean;
  readonly skipLabel: boolean;
  readonly bumpBranch: boolean;
}): { readonly ok: boolean; readonly message: string } {
  if (!pr.contractChange) {
    return {
      ok: true,
      message:
        'No contract source or runtime dependency changes. No entry needed.',
    };
  }
  if (pr.bumpBranch) {
    return { ok: true, message: 'Version bump PR, rolls the changelog.' };
  }
  if (pr.entryAdded) {
    return { ok: true, message: 'CHANGELOG.md gained an Unreleased entry.' };
  }
  if (pr.skipLabel) {
    return { ok: true, message: 'skip-changelog label set. No entry needed.' };
  }
  return {
    ok: false,
    message:
      "This PR changes contract sources but adds no entry under '## Unreleased' " +
      'in CHANGELOG.md. Add one, or ask a maintainer to add the skip-changelog ' +
      'label if nothing user-facing changed.',
  };
}
