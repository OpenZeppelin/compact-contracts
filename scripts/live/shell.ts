import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import { REPO_ROOT } from './paths.ts';

/** Process and console primitives shared by every live-orchestrator service. */

/** Exit status convention for a child killed by a signal (128 + signal number). */
function signalStatus(signal: NodeJS.Signals): number {
  const number =
    os.constants.signals[signal as keyof typeof os.constants.signals];
  return 128 + (number ?? 0);
}

/**
 * Run a command with inherited stdio (so its output streams live) and resolve to
 * its exit status. A spawn failure is reported and mapped to 1, and a child killed
 * by a signal resolves to 128 + the signal number, so callers only branch on a
 * number.
 *
 * **Asynchronous on purpose.** With `spawnSync` the event loop is blocked for the
 * child's whole lifetime, and because a compile phase is one long synchronous
 * chain the loop never turns between children either — so a queued SIGINT handler
 * could not run until the entire phase finished. Ctrl-C during a compile was
 * therefore ignored until it was too late, and the truncated keys the interruption
 * itself had just created were then mistaken for a poisoned cache, draining it and
 * kicking off a pointless serial recompile. Awaiting the child keeps the loop live,
 * so {@link installSignalHandlers} fires immediately.
 *
 * Use {@link runSync} only where a result is needed without awaiting — teardown
 * inside a signal handler.
 */
export function run(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = REPO_ROOT,
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env, stdio: 'inherit' });
    child.on('error', (e) => {
      console.log(`could not run ${cmd}: ${e.message}`);
      resolve(1);
    });
    child.on('close', (status, signal) => {
      resolve(signal ? signalStatus(signal) : (status ?? 1));
    });
  });
}

/**
 * Blocking variant, for the one caller that cannot await: a signal handler has to
 * finish its cleanup before `process.exit`, and there is no way to await there.
 * Everything else should use {@link run}.
 */
export function runSync(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = REPO_ROOT,
): number {
  const res = spawnSync(cmd, args, { cwd, env, stdio: 'inherit' });
  if (res.error) {
    console.log(`could not run ${cmd}: ${res.error.message}`);
    return 1;
  }
  if (res.signal) return signalStatus(res.signal);
  return res.status ?? 1;
}

/** A ruled section header, so phases stand out in a long streaming log. */
export function banner(message: string): void {
  const rule = '═'.repeat(64);
  console.log(`\n${rule}\n${message}\n${rule}`);
}

/**
 * Run `onSignal` on Ctrl-C / SIGTERM, then exit with the conventional
 * 128 + signal code.
 *
 * Node runs **no** `finally` block on a signal, so cleanup that lives only in a
 * `try/finally` is skipped entirely when a run is interrupted. Anything that must
 * happen on every exit path has to be registered here as well, and must be
 * synchronous — the process exits as soon as `onSignal` returns.
 */
export function installSignalHandlers(
  onSignal: (signal: 'SIGINT' | 'SIGTERM') => void,
): void {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      onSignal(signal);
      process.exit(signal === 'SIGINT' ? 130 : 143);
    });
  }
}
