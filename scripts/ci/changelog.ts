/**
 * Keep `CHANGELOG.md` and the releases in step.
 *
 * A release flow that never touches the file ships versions with their entries
 * still under `## Unreleased` and no section of their own. So the version bump
 * rolls `## Unreleased` into the new version's section
 * ({@link rollUnreleased}), the release reads its notes from that section
 * ({@link releaseNotes}), and a PR that changes contract sources must add an
 * entry first ({@link changelogVerdict}).
 *
 * Pure: `release-ci.ts` owns the file and `git` I/O.
 */

const UNRELEASED = '## Unreleased';

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
 * The body of `version`'s section, trimmed. An empty body is valid: GitHub's
 * generated notes still follow it. A missing section fails instead, since the
 * alternative is a release whose notes silently omit its changes.
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
  const notes = lines
    .slice(start + 1, sectionEnd(lines, start))
    .join('\n')
    .trim();
  return { ok: true, notes };
}

/**
 * Whether a PR's change set needs a `CHANGELOG.md` entry it lacks. The
 * `skip-changelog` label is the escape for contract changes nobody would
 * notice (a comment, a rename of a private helper).
 */
export function changelogVerdict(
  changedFiles: readonly string[],
  skipLabel: boolean,
): { readonly ok: boolean; readonly message: string } {
  if (!changedFiles.some((f) => CONTRACT_SOURCE.test(f))) {
    return {
      ok: true,
      message: 'No contracts/src/ changes outside test dirs. No entry needed.',
    };
  }
  if (changedFiles.includes('CHANGELOG.md')) {
    return { ok: true, message: 'CHANGELOG.md updated.' };
  }
  if (skipLabel) {
    return { ok: true, message: 'skip-changelog label set. No entry needed.' };
  }
  return {
    ok: false,
    message:
      'This PR changes contracts/src/ but not CHANGELOG.md. ' +
      "Add an entry under '## Unreleased', or ask a maintainer to add the " +
      'skip-changelog label if nothing user-facing changed.',
  };
}
