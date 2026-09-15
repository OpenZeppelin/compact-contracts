import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { filterSpecFiles, specFiles, specFilesIn } from '../specs.ts';

/**
 * Dry unit tests for `specs.ts`: spec discovery and filtering. `specFiles`
 * reads the real `src/` and `test/integration` trees; `specFilesIn` works in a
 * temp directory.
 */

describe('specFiles', () => {
  it('drops the witness specs `unit-live` excludes', () => {
    // Reads the real `src/` tree: these files exist, and vitest's `unit-live`
    // project excludes `src/**/test/witnesses/**`. A leg for one would run no
    // file, which the runner reports as an infrastructure abort rather than a
    // pass — observed on run 32811648017 before this filter existed.
    const files = specFiles('token');

    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((f) => f.includes('/witnesses/'))).toStrictEqual([]);
    expect(files).toContain('src/token/test/FungibleToken.test.ts');
  });

  it('keeps the integration specs, which have no such exclude', () => {
    expect(specFiles('integration')).toStrictEqual([
      'test/integration/specs/confidentialFungibleToken.spec.ts',
      'test/integration/specs/initStateIsolation.spec.ts',
    ]);
  });
});

describe('filterSpecFiles', () => {
  const FILES = [
    'src/multisig/test/Forwarder.test.ts',
    'src/token/test/FungibleToken.test.ts',
  ];

  it('matches a substring of the path, case-insensitively', () => {
    // vitest lowercases both sides (`TestProject.filterFiles`), so a filter that
    // runs locally must not be rejected as unmatched here.
    expect(filterSpecFiles(FILES, ['forwarder'])).toStrictEqual([
      'src/multisig/test/Forwarder.test.ts',
    ]);
  });

  it('matches a directory prefix as well as a file name', () => {
    expect(filterSpecFiles(FILES, ['src/token'])).toStrictEqual([
      'src/token/test/FungibleToken.test.ts',
    ]);
  });

  it('ORs several filters', () => {
    expect(filterSpecFiles(FILES, ['Forwarder', 'Fungible'])).toStrictEqual(
      FILES,
    );
  });

  it('matches nothing for a filter no path contains', () => {
    expect(filterSpecFiles(FILES, ['Frowarder'])).toStrictEqual([]);
  });
});

describe('specFilesIn', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'live-specs-'));
  });

  /** Write `name` under `dir`, creating its parent directories. */
  const touch = (name: string): void => {
    const file = path.join(dir, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '');
  };

  it('finds the suffix at any depth', () => {
    touch('src/multisig/test/Forwarder.test.ts');
    touch('src/multisig/test/witnesses/Deep.test.ts');

    expect(specFilesIn(dir, dir, '.test.ts')).toStrictEqual([
      'src/multisig/test/Forwarder.test.ts',
      'src/multisig/test/witnesses/Deep.test.ts',
    ]);
  });

  it('takes only the suffix asked for', () => {
    // One suffix per live project: `unit-live` includes `*.test.ts`, so a
    // `*.spec.ts` under `src/` would be handed to vitest as a path it never runs.
    touch('src/multisig/test/Forwarder.test.ts');
    touch('src/multisig/test/Forwarder.spec.ts');
    touch('src/multisig/MultiSigWallet.compact');

    expect(specFilesIn(dir, dir, '.test.ts')).toStrictEqual([
      'src/multisig/test/Forwarder.test.ts',
    ]);
  });

  it('reports paths relative to the given base', () => {
    // The base is the vitest root, because that is what a positional filter is
    // matched against.
    touch('contracts/src/token/test/FungibleToken.test.ts');

    expect(
      specFilesIn(path.join(dir, 'contracts'), dir, '.test.ts'),
    ).toStrictEqual(['contracts/src/token/test/FungibleToken.test.ts']);
  });

  it('reports nothing for a directory that does not exist', () => {
    // A target with no `src/` directory cannot be in the target list, so this is
    // only about not throwing on one.
    expect(specFilesIn(path.join(dir, 'nope'), dir, '.test.ts')).toStrictEqual(
      [],
    );
  });
});
