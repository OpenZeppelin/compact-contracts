import { describe, expect, it } from 'vitest';
import {
  changelogVerdict,
  releaseNotes,
  rollUnreleased,
} from '../changelog.ts';

/** Unit tests for `changelog.ts`: rolling, reading, and requiring entries. */

const CHANGELOG = [
  '# Changelog',
  '',
  'All notable changes to this project will be documented in this file.',
  '',
  '## Unreleased',
  '',
  '### Changed',
  '',
  '- Widen `EcdhMask.encrypt` to `Uint<248>` (#1150)',
  '',
  '## 0.5.0-alpha.1 (2026-10-13)',
  '',
  '### Added',
  '',
  '- Add Confidential Note Fungible Token core (#743)',
  '',
  '## 0.0.1-alpha.1 (2025-12-2)',
  '',
  '- First release',
  '',
].join('\n');

const ROLLED = CHANGELOG.replace(
  '## Unreleased\n',
  '## Unreleased\n\n## 0.5.0-alpha.2 (2026-10-19)\n',
);

const EMPTY_UNRELEASED = CHANGELOG.replace(
  '### Changed\n\n- Widen `EcdhMask.encrypt` to `Uint<248>` (#1150)\n\n',
  '### Changed\n\n',
);

const roll = (text: string, allowEmpty = false) =>
  rollUnreleased(text, {
    version: '0.5.0-alpha.2',
    date: '2026-10-19',
    allowEmpty,
  });

describe('rollUnreleased', () => {
  it('should open the new version section under Unreleased', () => {
    const result = roll(CHANGELOG);
    expect(result.ok && result.text).toContain(
      '## Unreleased\n\n## 0.5.0-alpha.2 (2026-10-19)\n\n### Changed\n',
    );
  });

  it('should keep the rest of the file byte-identical', () => {
    expect(roll(CHANGELOG)).toStrictEqual({ ok: true, text: ROLLED });
  });

  it('should preserve the trailing newline', () => {
    const result = roll(CHANGELOG);
    expect(result.ok && result.text.endsWith('- First release\n')).toBe(true);
  });

  it('should normalize CRLF line endings', () => {
    expect(roll(CHANGELOG.replace(/\n/g, '\r\n'))).toStrictEqual({
      ok: true,
      text: ROLLED,
    });
  });

  it('should fail on a duplicate Unreleased header', () => {
    const text = CHANGELOG.replace(
      '## 0.5.0-alpha.1',
      '## Unreleased\n\n- Stray\n\n## 0.5.0-alpha.1',
    );
    expect(roll(text)).toStrictEqual({
      ok: false,
      message:
        'CHANGELOG.md needs exactly one "## Unreleased" header, found 2.',
    });
  });

  it('should fail when the Unreleased header is missing', () => {
    const text = CHANGELOG.replace('## Unreleased\n', '');
    expect(roll(text)).toStrictEqual({
      ok: false,
      message:
        'CHANGELOG.md needs exactly one "## Unreleased" header, found 0.',
    });
  });

  it('should fail when the version already has a section', () => {
    const text = CHANGELOG.replace(
      '## 0.5.0-alpha.1 (2026-10-13)',
      '## 0.5.0-alpha.2 (2026-10-13)',
    );
    expect(roll(text)).toStrictEqual({
      ok: false,
      message: 'CHANGELOG.md already has a "## 0.5.0-alpha.2" section.',
    });
  });

  it('should fail when the version already has an undated section', () => {
    const text = CHANGELOG.replace(
      '## 0.5.0-alpha.1 (2026-10-13)',
      '## 0.5.0-alpha.2',
    );
    expect(roll(text).ok).toBe(false);
  });

  it('should not treat a longer version with the same prefix as existing', () => {
    const text = CHANGELOG.replace(
      '## 0.5.0-alpha.1 (2026-10-13)',
      '## 0.5.0-alpha.20 (2026-10-13)',
    );
    expect(roll(text).ok).toBe(true);
  });

  it('should fail on an Unreleased section with no entries', () => {
    expect(roll(EMPTY_UNRELEASED)).toStrictEqual({
      ok: false,
      message:
        'CHANGELOG.md has no entries under "## Unreleased". ' +
        'If that is intended, re-run with allow_empty_changelog ticked.',
    });
  });

  it('should roll an empty Unreleased section when allowEmpty is set', () => {
    const result = roll(EMPTY_UNRELEASED, true);
    expect(result.ok && result.text).toContain(
      '## Unreleased\n\n## 0.5.0-alpha.2 (2026-10-19)\n\n### Changed\n\n## 0.5.0-alpha.1',
    );
  });
});

describe('releaseNotes', () => {
  it('should return a middle section trimmed', () => {
    expect(releaseNotes(CHANGELOG, '0.5.0-alpha.1')).toStrictEqual({
      ok: true,
      notes: '### Added\n\n- Add Confidential Note Fungible Token core (#743)',
    });
  });

  it('should read the last section to the end of the file', () => {
    expect(releaseNotes(CHANGELOG, '0.0.1-alpha.1')).toStrictEqual({
      ok: true,
      notes: '- First release',
    });
  });

  it('should fail when the version has no section', () => {
    expect(releaseNotes(CHANGELOG, '9.9.9')).toStrictEqual({
      ok: false,
      message:
        'CHANGELOG.md has no "## 9.9.9" section to use as release notes.',
    });
  });

  it('should not match a longer version with the same prefix', () => {
    const text = [
      '## 0.5.0-alpha.10 (2026-12-01)',
      '',
      '- Ten',
      '',
      '## 0.5.0-alpha.1 (2026-10-13)',
      '',
      '- One',
      '',
    ].join('\n');
    expect(releaseNotes(text, '0.5.0-alpha.1')).toStrictEqual({
      ok: true,
      notes: '- One',
    });
  });

  it('should return an empty string for an empty section', () => {
    const text =
      '## Unreleased\n\n## 0.6.0\n\n## 0.5.0 (2026-10-13)\n\n- Five\n';
    expect(releaseNotes(text, '0.6.0')).toStrictEqual({ ok: true, notes: '' });
  });

  it('should normalize CRLF line endings', () => {
    expect(
      releaseNotes(CHANGELOG.replace(/\n/g, '\r\n'), '0.0.1-alpha.1'),
    ).toStrictEqual({ ok: true, notes: '- First release' });
  });
});

describe('changelogVerdict', () => {
  const SRC = 'contracts/src/token/FungibleToken.compact';

  it('should pass a change that only touches test dirs', () => {
    expect(
      changelogVerdict(
        ['contracts/src/token/test/FungibleToken.test.ts'],
        false,
      ).ok,
    ).toBe(true);
  });

  it('should pass a change under a nested test dir', () => {
    expect(
      changelogVerdict(
        ['contracts/src/token/examples/test/Example.test.ts'],
        false,
      ).ok,
    ).toBe(true);
  });

  it('should pass a docs-only change', () => {
    expect(changelogVerdict(['README.md', 'docs/x.md'], false).ok).toBe(true);
  });

  it('should fail a contract change without a CHANGELOG.md entry', () => {
    const verdict = changelogVerdict([SRC], false);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain(
      'ask a maintainer to add the skip-changelog label',
    );
  });

  it('should not mistake a test-like dir name for a test dir', () => {
    expect(
      changelogVerdict(['contracts/src/token/testing/Helper.ts'], false).ok,
    ).toBe(false);
  });

  it('should pass a contract change with a CHANGELOG.md entry', () => {
    expect(changelogVerdict([SRC, 'CHANGELOG.md'], false).ok).toBe(true);
  });

  it('should pass a contract change with the skip-changelog label', () => {
    expect(changelogVerdict([SRC], true).ok).toBe(true);
  });
});
