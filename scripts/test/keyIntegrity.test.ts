import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { missingKeyArtifacts } from '../keyIntegrity.ts';

/**
 * Dry unit tests for `keyIntegrity.ts`'s completeness check, against a source
 * tree and an artifact tree laid out in a temp directory.
 */

describe('missingKeyArtifacts', () => {
  let src: string;
  let artifacts: string;

  const contractInfo = (circuits: { name: string; pure: boolean }[]): string =>
    JSON.stringify({ circuits });

  /** Lay out `artifacts/<name>/` with the given files, each non-empty. */
  const artifact = (name: string, files: Record<string, string>): void => {
    for (const [file, body] of Object.entries(files)) {
      const p = path.join(artifacts, name, file);
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, body);
    }
  };

  beforeEach(() => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'keyintegrity-'));
    src = path.join(dir, 'src');
    artifacts = path.join(dir, 'artifacts');
    mkdirSync(path.join(src, 'token'), { recursive: true });
    mkdirSync(artifacts);
    writeFileSync(path.join(src, 'token', 'MockToken.compact'), '');
  });

  it('accepts a contract with its module, info and a key pair per circuit', () => {
    artifact('MockToken', {
      'contract/index.js': 'export {};',
      'compiler/contract-info.json': contractInfo([
        { name: 'mint', pure: false },
        { name: 'ONE', pure: true },
      ]),
      'keys/mint.prover': 'k',
      'keys/mint.verifier': 'k',
    });

    expect(missingKeyArtifacts(artifacts, src)).toStrictEqual([]);
  });

  it('accepts a module with no circuits and no keys directory', () => {
    artifact('MockToken', {
      'contract/index.js': 'export {};',
      'compiler/contract-info.json': contractInfo([]),
    });

    expect(missingKeyArtifacts(artifacts, src)).toStrictEqual([]);
  });

  it('names a contract whose directory never arrived', () => {
    expect(missingKeyArtifacts(artifacts, src)).toStrictEqual(['MockToken']);
  });

  it('names a regular file standing where the directory should be', () => {
    writeFileSync(path.join(artifacts, 'MockToken'), '');

    expect(missingKeyArtifacts(artifacts, src)).toStrictEqual(['MockToken']);
  });

  it('names every required file an empty directory lacks', () => {
    // A download that created the directory and unpacked nothing into it.
    mkdirSync(path.join(artifacts, 'MockToken'));

    expect(missingKeyArtifacts(artifacts, src)).toStrictEqual([
      'MockToken/compiler/contract-info.json',
      'MockToken/contract/index.js',
    ]);
  });

  it('names the key pair an impure circuit lacks', () => {
    artifact('MockToken', {
      'contract/index.js': 'export {};',
      'compiler/contract-info.json': contractInfo([
        { name: 'mint', pure: false },
        { name: 'burn', pure: false },
      ]),
      'keys/mint.prover': 'k',
      'keys/mint.verifier': 'k',
    });

    expect(missingKeyArtifacts(artifacts, src)).toStrictEqual([
      'MockToken/keys/burn.prover',
      'MockToken/keys/burn.verifier',
    ]);
  });

  it('ignores artifacts of contracts outside the source roots', () => {
    artifact('MockToken', {
      'contract/index.js': 'export {};',
      'compiler/contract-info.json': contractInfo([]),
    });
    mkdirSync(path.join(artifacts, 'Orphan'));

    expect(missingKeyArtifacts(artifacts, src)).toStrictEqual([]);
  });
});
