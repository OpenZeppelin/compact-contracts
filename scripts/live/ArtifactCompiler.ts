import { emptyKeyArtifacts, missingKeyArtifacts } from '../keyIntegrity.ts';
import { ARTIFACTS, rel } from './paths.ts';
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
 * A killed compile (or machine crash) can leave a truncated key on disk. A
 * 0-byte `.prover` makes the deploy fail in `beforeAll`, which vitest turns into
 * a silent whole-suite skip — the failure mode this check exists to prevent.
 * The repair is mechanical, so self-heal once (recompile, bypassing a turbo
 * cache entry that may hold the truncated key) and only abort if keys are still
 * truncated afterwards.
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
    console.log('\nPoisoned artifact tree — recompiling without the cache...');
    if (!(await this.#compileAll(['--force']))) {
      console.log('forced recompile failed.');
      return false;
    }
    const stillEmpty = this.#truncatedKeys();
    if (stillEmpty.length === 0) {
      console.log('recovered — ZK keys intact after the forced recompile.');
      return true;
    }
    console.log(
      '\nstill truncated after a forced recompile — needs investigation:',
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
   * hand the live path keyless artifacts, whatever turbo's env mode does.
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
   *   - a contract is absent or incomplete, because the upload or the download
   *     only partly landed (or the compile job built a different scope than
   *     this run needs);
   *   - a key is truncated, here carried in rather than produced locally.
   * Both abort. Recompiling would paper over a broken hand-off, and every job
   * sharing this tree would pay for it separately.
   */
  #verifyPrebuilt(): boolean {
    const missing = missingKeyArtifacts(...this.#scope.verifyRoots);
    if (missing.length > 0) {
      console.log(
        `\n${rel(ARTIFACTS)} is missing ${missing.length} artifact(s) this ` +
          'run deploys:',
      );
      for (const p of missing) console.log(`  ✗ ${rel(p)}`);
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
      '\nThe tree was poisoned before it got here; rerun the compile job.',
    );
    return false;
  }

  /** Scoped to the source roots this run deploys from, so an artifact directory
   * nothing here deploys — a stale orphan, or another category's build
   * byproduct — cannot false-positive. */
  #truncatedKeys(): string[] {
    return emptyKeyArtifacts(...this.#scope.verifyRoots);
  }
}
