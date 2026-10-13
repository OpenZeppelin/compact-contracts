import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyKeyArtifacts, missingKeyArtifacts } from '../keyIntegrity.ts';
import type { ArtifactRoot } from '../live/paths.ts';

/**
 * Dry unit tests for `keyIntegrity.ts`'s checks, against a source tree and an
 * artifact tree laid out in a temp directory.
 */

let src: string;
let artifacts: string;
let root: ArtifactRoot;

const contractInfo = (circuits: { name: string; pure: boolean }[]): string =>
  JSON.stringify({ circuits });

/** Lay out `artifacts/<rel>/` with the given files and contents. */
const artifact = (rel: string, files: Record<string, string>): void => {
  for (const [file, body] of Object.entries(files)) {
    const p = path.join(artifacts, rel, file);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
};

/** `src/token/MockToken.compact` compiles to `artifacts/token/MockToken/`. */
const TOKEN = 'token/MockToken';
const at = (...parts: string[]): string =>
  path.join(artifacts, TOKEN, ...parts);

beforeEach(() => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'keyintegrity-'));
  src = path.join(dir, 'src');
  artifacts = path.join(dir, 'artifacts');
  root = { src, artifacts };
  mkdirSync(path.join(src, 'token'), { recursive: true });
  mkdirSync(artifacts);
  writeFileSync(path.join(src, 'token', 'MockToken.compact'), '');
});

describe('emptyKeyArtifacts', () => {
  it('finds a truncated key in the directory that mirrors the source', () => {
    artifact(TOKEN, { 'keys/mint.prover': '', 'keys/mint.verifier': 'k' });

    expect(emptyKeyArtifacts(root)).toStrictEqual([at('keys/mint.prover')]);
  });

  it('ignores a truncated key outside the mirrored directory', () => {
    // The flat pre-hierarchical location: no source maps to it.
    artifact('MockToken', { 'keys/mint.prover': '' });

    expect(emptyKeyArtifacts(root)).toStrictEqual([]);
  });
});

describe('missingKeyArtifacts', () => {
  it('accepts a contract with its module, info and a key pair per circuit', () => {
    artifact(TOKEN, {
      'contract/index.js': 'export {};',
      'compiler/contract-info.json': contractInfo([
        { name: 'mint', pure: false },
        { name: 'ONE', pure: true },
      ]),
      'keys/mint.prover': 'k',
      'keys/mint.verifier': 'k',
    });

    expect(missingKeyArtifacts(root)).toStrictEqual([]);
  });

  it('accepts a module with no circuits and no keys directory', () => {
    artifact(TOKEN, {
      'contract/index.js': 'export {};',
      'compiler/contract-info.json': contractInfo([]),
    });

    expect(missingKeyArtifacts(root)).toStrictEqual([]);
  });

  it('names a contract whose directory never arrived', () => {
    expect(missingKeyArtifacts(root)).toStrictEqual([at()]);
  });

  it('names a regular file standing where the directory should be', () => {
    mkdirSync(path.dirname(at()), { recursive: true });
    writeFileSync(at(), '');

    expect(missingKeyArtifacts(root)).toStrictEqual([at()]);
  });

  it('names every required file an empty directory lacks', () => {
    // A download that created the directory and unpacked nothing into it.
    mkdirSync(at(), { recursive: true });

    expect(missingKeyArtifacts(root)).toStrictEqual([
      at('compiler/contract-info.json'),
      at('contract/index.js'),
    ]);
  });

  it('names the key pair an impure circuit lacks', () => {
    artifact(TOKEN, {
      'contract/index.js': 'export {};',
      'compiler/contract-info.json': contractInfo([
        { name: 'mint', pure: false },
        { name: 'burn', pure: false },
      ]),
      'keys/mint.prover': 'k',
      'keys/mint.verifier': 'k',
    });

    expect(missingKeyArtifacts(root)).toStrictEqual([
      at('keys/burn.prover'),
      at('keys/burn.verifier'),
    ]);
  });

  it('ignores artifacts of contracts outside the source roots', () => {
    artifact(TOKEN, {
      'contract/index.js': 'export {};',
      'compiler/contract-info.json': contractInfo([]),
    });
    mkdirSync(path.join(artifacts, 'token', 'Orphan'));

    expect(missingKeyArtifacts(root)).toStrictEqual([]);
  });
});
