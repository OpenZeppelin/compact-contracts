import { rmSync } from 'node:fs';
import { emptyKeyArtifacts, missingKeyArtifacts } from '../keyIntegrity.ts';
import { ARTIFACTS, rel, TURBO_CACHE } from './paths.ts';
import { run } from './shell.ts';
import type { CompileScope } from './targets.ts';

/**
 * Builds the artifacts a live run will deploy, and refuses to hand the run a
 * poisoned artifact tree.
 *
 * The scope says what to build and what to check: a scoped run compiles its own
 * slice (`compile:<category>`, with turbo pulling in the categories it imports)
 * instead of the whole repo, which is what keeps a CI job for one target from
 * paying for every other target's key generation. See `compileScope` in
 * `targets.ts` for how a plan resolves to one.
 *
 * A killed compile (or machine crash) can poison the turbo cache so every later
 * cache hit re-extracts a truncated key, and a concurrent compile racing over the
 * shared `artifacts/` tree can truncate keys directly
 * (OpenZeppelin/compact-contracts#675). A 0-byte `.prover` makes the deploy fail
 * in `beforeAll`, which vitest turns into a silent whole-suite skip — the failure
 * mode this check exists to prevent. Both repairs are mechanical, so self-heal
 * once (drain the cache, recompile serially — a parallel recompile can re-poison
 * it) and only abort if keys are still truncated afterwards.
 *
 * In `prebuilt` mode the tree was built somewhere else and arrives ready — a CI
 * compile job builds it once and every suite job for that target downloads it.
 * Building is then the wrong response to a bad tree: the artifacts are an input
 * to this run, not its product, so a failure aborts instead of quietly
 * recompiling in every one of the jobs that share them.
 */
export class ArtifactCompiler {
  readonly #scope: CompileScope;
  readonly #prebuilt: boolean;

  constructor(scope: CompileScope, prebuilt = false) {
    this.#scope = scope;
    this.#prebuilt = prebuilt;
  }

  /**
   * Compile, verify, self-heal once, verify again. In `prebuilt` mode, verify
   * only.
   *
   * @returns `true` when the artifact tree is safe to deploy from
   */
  async compileVerified(): Promise<boolean> {
    if (this.#prebuilt) return this.#verifyPrebuilt();
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
   * Run the scope's compile scripts, in order.
   *
   * Every compile clears `SKIP_ZK` rather than trusting the ambient value: a live
   * run always needs real proving keys, and the dry `test:integration` path
   * exports `SKIP_ZK=true`. Clearing it here means an ambient value can never
   * hand the live path keyless artifacts, whatever turbo's env mode does. turbo
   * keys the compile tasks on `SKIP_ZK`, so dry and full-key builds cache apart.
   *
   * Artifact directories are keyed on the source basename, so basenames must stay
   * unique across `src/` and `test/integration/_mocks/` — two files sharing one
   * would overwrite each other's `artifacts/<name>/`. The composed mock is named
   * `ComposedConfidentialFungibleTokenPublicSupply.compact` for exactly this
   * reason.
   */
  async #compileAll(extraArgs: string[]): Promise<boolean> {
    const { SKIP_ZK: _skipZk, ...fullKeyEnv } = process.env;
    for (const script of this.#scope.scripts) {
      if ((await run('yarn', [script, ...extraArgs], fullKeyEnv)) !== 0) {
        return false;
      }
    }
    return true;
  }

  /**
   * Check a tree this run did not build, and never repair it.
   *
   * Two ways a provided tree can be wrong, and both end the same way for the
   * specs — a deploy that fails in `beforeAll`, which vitest turns into a silent
   * whole-suite skip:
   *   - a contract is absent, because the upload or the download only partly
   *     landed (or the compile job built a different scope than this run needs);
   *   - a key is truncated, the #675 failure mode, here carried in rather than
   *     produced locally.
   * Both abort. Recompiling would paper over a broken hand-off, and every job
   * sharing this tree would pay for it separately.
   */
  #verifyPrebuilt(): boolean {
    const missing = missingKeyArtifacts(ARTIFACTS, ...this.#scope.verifyRoots);
    if (missing.length > 0) {
      console.log(
        `\nno artifacts under ${rel(ARTIFACTS)} for ${missing.length} ` +
          'contract(s) this run deploys:',
      );
      for (const name of missing) console.log(`  ✗ ${name}`);
      console.log(
        '\nThe artifacts are an input to this run, not its product ' +
          '(--prebuilt), so there is nothing to rebuild from here. Check that ' +
          'the compile job for this target succeeded and that its upload was ' +
          'downloaded into the right path.',
      );
      return false;
    }
    const empty = this.#truncatedKeys();
    if (empty.length === 0) return true;
    console.log('\nprovided artifacts carry truncated (0-byte) ZK key(s):');
    for (const k of empty) console.log(`  ✗ ${rel(k)}`);
    console.log(
      '\nThe tree was poisoned before it got here ' +
        '(OpenZeppelin/compact-contracts#675); rerun the compile job.',
    );
    return false;
  }

  /** Scoped to the source roots this run deploys from, so an artifact directory
   * nothing here deploys — a stale orphan, or another category's build
   * byproduct — cannot false-positive. */
  #truncatedKeys(): string[] {
    return emptyKeyArtifacts(ARTIFACTS, ...this.#scope.verifyRoots);
  }
}
