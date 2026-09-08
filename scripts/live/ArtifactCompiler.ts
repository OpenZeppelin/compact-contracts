import { rmSync } from 'node:fs';
import { emptyKeyArtifacts } from '../keyIntegrity.ts';
import {
  ARTIFACTS,
  INTEGRATION_MOCKS,
  rel,
  SRC,
  TURBO_CACHE,
} from './paths.ts';
import { run } from './shell.ts';

/**
 * Builds the artifacts a live run will deploy, and refuses to hand the run a
 * poisoned artifact tree.
 *
 * A killed compile (or machine crash) can poison the turbo cache so every later
 * cache hit re-extracts a truncated key, and a concurrent compile racing over the
 * shared `artifacts/` tree can truncate keys directly
 * (OpenZeppelin/compact-contracts#675). A 0-byte `.prover` makes the deploy fail
 * in `beforeAll`, which vitest turns into a silent whole-suite skip — the failure
 * mode this check exists to prevent. Both repairs are mechanical, so self-heal
 * once (drain the cache, recompile serially — a parallel recompile can re-poison
 * it) and only abort if keys are still truncated afterwards.
 */
export class ArtifactCompiler {
  /** Whether this run also needs the integration mocks built with proving keys. */
  readonly #integration: boolean;

  constructor(integration: boolean) {
    this.#integration = integration;
  }

  /**
   * Compile, verify, self-heal once, verify again.
   *
   * @returns `true` when the artifact tree is safe to deploy from
   */
  async compileVerified(): Promise<boolean> {
    if (!(await this.#compileAll([]))) {
      console.log('compile failed — a compile error is real, not a flake.');
      return false;
    }
    const empty = this.#truncatedKeys();
    if (empty.length === 0) return true;

    console.log(
      '\ncompile reported success but left truncated (0-byte) ZK key(s):',
    );
    for (const k of empty) console.log(`  ✗ ${rel(k)}`);
    console.log(
      '\nPoisoned turbo cache or artifact tree ' +
        '(OpenZeppelin/compact-contracts#675) — draining the cache and ' +
        'recompiling serially...',
    );
    rmSync(TURBO_CACHE, { recursive: true, force: true });
    if (!(await this.#compileAll(['--concurrency=1']))) {
      console.log('serial recompile failed.');
      return false;
    }
    const stillEmpty = this.#truncatedKeys();
    if (stillEmpty.length === 0) {
      console.log('recovered — ZK keys intact after the serial recompile.');
      return true;
    }
    console.log(
      '\nstill truncated after a serial recompile — needs investigation:',
    );
    for (const k of stillEmpty) console.log(`  ✗ ${rel(k)}`);
    return false;
  }

  /**
   * `src` first, integration mocks second.
   *
   * Artifact directories are keyed on the source basename, so basenames must stay
   * unique across `src/` and `test/integration/_mocks/` — two files sharing one
   * would overwrite each other's `artifacts/<name>/`. The composed mock is named
   * `ComposedConfidentialFungibleTokenPublicSupply.compact` for exactly this
   * reason. src-first order is kept as a convention; it is no longer a
   * correctness requirement.
   *
   * BOTH compiles clear `SKIP_ZK` rather than trusting the ambient value: a live
   * run always needs real proving keys, and the dry `test:integration` path
   * exports `SKIP_ZK=true`. Clearing it here means an ambient value can never
   * hand the live path keyless artifacts, whatever turbo's env mode does. turbo
   * keys both tasks on `SKIP_ZK`, so dry and full-key builds cache apart.
   */
  async #compileAll(extraArgs: string[]): Promise<boolean> {
    const { SKIP_ZK: _skipZk, ...fullKeyEnv } = process.env;
    if ((await run('yarn', ['compile', ...extraArgs], fullKeyEnv)) !== 0) {
      return false;
    }
    if (!this.#integration) return true;
    return (
      (await run('yarn', ['compile:integration', ...extraArgs], fullKeyEnv)) ===
      0
    );
  }

  /** Scoped to the source roots this run deploys from, so a stale orphan
   * artifact directory cannot false-positive. */
  #truncatedKeys(): string[] {
    return emptyKeyArtifacts(
      ARTIFACTS,
      SRC,
      ...(this.#integration ? [INTEGRATION_MOCKS] : []),
    );
  }
}
