import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setOutput } from '../actions.ts';

/** Unit tests for `actions.ts`, against a temp `GITHUB_OUTPUT` file. */

describe('setOutput', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'live-ci-'));
  });

  // `vi.stubEnv`, not a direct assignment: it scopes the change to the test even
  // if this file ever runs concurrently with another that reads the environment.
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('appends the pair to the outputs file', () => {
    const file = path.join(dir, 'output');
    writeFileSync(file, 'existing=1\n');
    vi.stubEnv('GITHUB_OUTPUT', file);

    setOutput('targets', '["multisig"]');

    // Appended, not written: a step may publish more than one output.
    expect(readFileSync(file, 'utf8')).toBe(
      'existing=1\ntargets=["multisig"]\n',
    );
  });

  it('prints the pair when run outside Actions', () => {
    vi.stubEnv('GITHUB_OUTPUT', undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    setOutput('targets', '["multisig"]');

    expect(log).toHaveBeenCalledWith('targets=["multisig"]');
  });

  it('refuses a multi-line value', () => {
    vi.stubEnv('GITHUB_OUTPUT', path.join(dir, 'output'));

    // `name=value` cannot express one, and writing it anyway corrupts every
    // later output in the file instead of failing here.
    expect(() => setOutput('targets', 'a\nb')).toThrow(/single line/);
  });
});
