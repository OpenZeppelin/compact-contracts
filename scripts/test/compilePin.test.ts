import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../live/paths.ts';

/**
 * Every `compile:*` script pins the toolchain CI installs. Turbo hashes the
 * script text, so the pin puts the compiler version in the cache key, and the
 * local default toolchain never reaches a cached compile.
 */

const CI_VERSION = readFileSync(
  path.join(REPO_ROOT, '.github/actions/setup/action.yml'),
  'utf8',
).match(/^\s*compact-version:\s*"([^"]+)"\s*$/m)?.[1];

const SCRIPTS = (
  JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'contracts/package.json'), 'utf8'),
  ) as { scripts: Record<string, string> }
).scripts;

const COMPILE = Object.entries(SCRIPTS).filter(([name]) =>
  name.startsWith('compile:'),
);

describe('compile toolchain pin', () => {
  it('reads the version the setup action installs', () => {
    expect(CI_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it.each(COMPILE)('%s pins every compact-compiler call to it', (_, script) => {
    const compilers = script
      .split('&&')
      .map((call) => call.trim().split(' '))
      .filter((argv) => argv[0] === 'compact-compiler');

    expect(compilers.length).toBeGreaterThan(0);
    expect(compilers.map((argv) => argv[1])).toStrictEqual(
      compilers.map(() => `+${CI_VERSION}`),
    );
  });
});
