import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtifactCompiler } from '../ArtifactCompiler.ts';
import type { CompileScope } from '../targets.ts';

/**
 * Dry unit tests for `ArtifactCompiler.ts`: the compile scripts are recorded
 * instead of spawned and the key scan is scripted, so a round runs without a
 * compiler or an artifact tree.
 */

const { run, emptyKeyArtifacts } = vi.hoisted(() => ({
  run: vi.fn<
    (cmd: string, args: string[], env?: NodeJS.ProcessEnv) => Promise<number>
  >(),
  emptyKeyArtifacts: vi.fn<() => string[]>(),
}));

vi.mock('../shell.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shell.ts')>()),
  run,
}));

vi.mock('../../keyIntegrity.ts', () => ({
  emptyKeyArtifacts,
  missingKeyArtifacts: () => [],
}));

const SCOPE: CompileScope = {
  scripts: ['compile:token'],
  verifyRoots: [{ src: '/src/token', artifacts: '/artifacts/token' }],
};
const TRUNCATED = '/artifacts/token/test/mocks/MockToken/keys/mint.prover';

/** The argv of every compile spawned, in order. */
const compiles = (): string[][] => run.mock.calls.map(([, args]) => args);

describe('ArtifactCompiler', () => {
  beforeEach(() => {
    run.mockReset().mockResolvedValue(0);
    emptyKeyArtifacts.mockReset().mockReturnValue([]);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('compiles once when the keys come out intact', async () => {
    await expect(new ArtifactCompiler(SCOPE).compileVerified()).resolves.toBe(
      true,
    );
    expect(compiles()).toStrictEqual([['compile:token']]);
  });

  it('recompiles once with --force when a key comes out truncated', async () => {
    emptyKeyArtifacts.mockReturnValueOnce([TRUNCATED]);

    await expect(new ArtifactCompiler(SCOPE).compileVerified()).resolves.toBe(
      true,
    );
    expect(compiles()).toStrictEqual([
      ['compile:token'],
      ['compile:token', '--force'],
    ]);
  });

  it('gives up when the forced recompile still leaves a truncated key', async () => {
    emptyKeyArtifacts.mockReturnValue([TRUNCATED]);

    await expect(new ArtifactCompiler(SCOPE).compileVerified()).resolves.toBe(
      false,
    );
    expect(compiles()).toStrictEqual([
      ['compile:token'],
      ['compile:token', '--force'],
    ]);
  });

  it('neither scans nor recompiles when the compile itself fails', async () => {
    run.mockResolvedValueOnce(1);

    await expect(new ArtifactCompiler(SCOPE).compileVerified()).resolves.toBe(
      false,
    );
    expect(compiles()).toStrictEqual([['compile:token']]);
    expect(emptyKeyArtifacts).not.toHaveBeenCalled();
  });

  it('runs every script of the scope with SKIP_ZK cleared', async () => {
    vi.stubEnv('SKIP_ZK', 'true');

    await new ArtifactCompiler({
      ...SCOPE,
      scripts: ['compile:utils', 'compile:token'],
    }).compileVerified();

    expect(compiles()).toStrictEqual([['compile:utils'], ['compile:token']]);
    for (const [, , env] of run.mock.calls)
      expect(env).not.toHaveProperty('SKIP_ZK');
  });

  it('never compiles a prebuilt tree, poisoned or not', async () => {
    emptyKeyArtifacts.mockReturnValue([TRUNCATED]);

    await expect(
      new ArtifactCompiler(SCOPE, true).compileVerified(),
    ).resolves.toBe(false);
    expect(compiles()).toStrictEqual([]);
  });
});
