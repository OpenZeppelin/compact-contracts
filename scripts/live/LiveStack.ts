import { run, runSync } from './shell.ts';

/** Opt out of teardown to inspect a failed run's node state. */
export const KEEP_ENV_VAR = 'MIDNIGHT_LIVE_KEEP_ENV';
export const KEEP_ENV_HINT = `set ${KEEP_ENV_VAR}=1 to keep the stack up for inspection`;

/**
 * Owns the local stack's lifecycle for one orchestrator run: `make env-up`
 * between phases, `make env-down` once at the end.
 *
 * `env-up` itself depends on `env-down` (see the Makefile), so each bring-up is
 * also a reset — that is what gives every target and every round-2 file a fresh
 * node, and why a stack leaked by a crashed run cannot corrupt the *next* one.
 *
 * Teardown therefore exists for the **current** run: the containers, and the
 * `docker compose logs -f` streamers that each `env-up` backgrounds, otherwise
 * outlive the process indefinitely. Container logs survive it — `env-down` kills
 * the streamers, only `env-logs-clean` deletes files — so a failed run's
 * `logs/*.log` stay readable. Only live node state is lost, hence
 * {@link KEEP_ENV_VAR}.
 */
export class LiveStack {
  /** Only tear down a stack this run actually started: an abort during compile
   * (before the first `up()`) has nothing to stop, and `--list` never starts one. */
  #started = false;
  #stopped = false;

  /** Reset and bring the stack up. Resolves to the `make` exit status. */
  up(): Promise<number> {
    // Marked before the call, not after: `env-up` can fail with containers
    // already half-started (it stops on the `--wait`), and those still need
    // stopping.
    this.#started = true;
    return run('make', ['env-up']);
  }

  /**
   * Stop the stack, at most once. A no-op if this run never started one, or if
   * teardown already happened (the `finally` path and the signal path both call
   * it, and a double Ctrl-C calls it twice).
   *
   * Deliberately synchronous: it runs inside the signal handler, which exits the
   * process the moment it returns, so there is nowhere to await.
   *
   * @param reason - what triggered the teardown, for the log line
   */
  stop(reason: string): void {
    if (!this.#started || this.#stopped) return;
    this.#stopped = true;
    if (process.env[KEEP_ENV_VAR] === '1') {
      console.log(
        `\nleaving the live stack up (${KEEP_ENV_VAR}=1, ${reason}) — ` +
          "run 'yarn env:down' when you are finished with it.",
      );
      return;
    }
    console.log(`\nstopping the live stack (${reason})...`);
    runSync('make', ['env-down']);
  }
}
