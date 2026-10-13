import { readdirSync } from 'node:fs';
import path from 'node:path';
import { CompactConfig } from '@openzeppelin/compact-deployer/config/compact-config';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The deployer finds an artifact only through its `compact.toml` entry, while
 * `compact-compiler --hierarchical` mirrors the source tree under
 * `contracts/artifacts`. A deployable source whose entry names any other path
 * fails its live deploy on a missing module.
 */

const CONTRACTS = path.resolve(import.meta.dirname, '..', '..', '..');
const SRC = path.join(CONTRACTS, 'src');
const INTEGRATION_MOCKS = path.join(CONTRACTS, 'test/integration/_mocks');

/** `.compact` files under `dir`, relative to it, without the extension. */
const compactFiles = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.compact'))
    .map((f) => f.slice(0, -'.compact'.length));

/** `[contract name, artifact path]` for every source a live spec can deploy. */
const DEPLOYABLE: [string, string][] = [
  ...compactFiles(SRC)
    .filter((f) => /\/test\/mocks\/[^/]+$|^[^/]+\/examples\/[^/]+$/.test(f))
    .map((f): [string, string] => [path.basename(f), f]),
  ...compactFiles(INTEGRATION_MOCKS)
    .filter((f) => !f.includes('/'))
    .map((f): [string, string] => [f, `integration/${f}`]),
];

describe('compact.toml', () => {
  let config: CompactConfig;

  beforeAll(async () => {
    config = await CompactConfig.load(
      path.join(CONTRACTS, '..', 'compact.toml'),
    );
  });

  it('covers the mocks, examples and integration mocks', () => {
    expect(DEPLOYABLE.map(([name]) => name)).toEqual(
      expect.arrayContaining([
        'MockOwnable',
        'ForwarderPrivateExample',
        'ComposedTokens',
      ]),
    );
  });

  it.each(DEPLOYABLE)('names the mirrored artifact of %s', (name, artifact) => {
    expect(config.contract(name).artifact).toBe(artifact);
  });
});
