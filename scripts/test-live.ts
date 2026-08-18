import { ArtifactCompiler } from './live/ArtifactCompiler.ts';
import { INFRA_ABORT, LiveOrchestrator } from './live/LiveOrchestrator.ts';
import { LiveStack } from './live/LiveStack.ts';
import { Reporter } from './live/Reporter.ts';
import { RunLock } from './live/RunLock.ts';
import { installSignalHandlers } from './live/shell.ts';
import { listTargets, liveCategories, resolvePlan } from './live/targets.ts';
import { VitestRunner } from './live/VitestRunner.ts';

/**
 * Live-test orchestrator entry point: resolve args into a plan, wire the
 * services, run it under the single-run lock, always stop the stack.
 *
 * Each concern lives in `scripts/live/` with the reasoning that belongs to it:
 *   - `targets.ts`          — what an invocation resolves to (pure)
 *   - `RunLock.ts`          — one orchestrator run at a time
 *   - `LiveStack.ts`        — `make env-up` / `env-down` lifecycle
 *   - `ArtifactCompiler.ts` — build + truncated-ZK-key self-heal
 *   - `VitestRunner.ts`     — spawn one live project, read its JSON report
 *   - `LiveOrchestrator.ts` — the two rounds and flake classification
 *   - `Reporter.ts`         — verdict, CI annotations, job summary
 *   - `shell.ts` / `paths.ts` — process, console and filesystem primitives
 *
 * Why a script and not turbo tasks: turbo models a DAG of stateless, cacheable
 * tasks, and a live run needs stateful orchestration a task graph cannot express:
 *   - two-round flake classification (re-run failures, classify, exit 0 on
 *     flaky-only);
 *   - docker lifecycle between targets and rounds against ONE shared node —
 *     parallel turbo tasks would race over it;
 *   - ZK-key integrity self-heal (turbo's own poisoned cache, #675);
 *   - infra-vs-test exit codes (2 vs 1), the pid lock, CI verdict summaries.
 * Turbo still runs where the DAG helps: the compile and harness-smoke steps go
 * through it (cached keygen, dependency ordering).
 *
 * Usage (via the root package.json scripts):
 *   yarn test:live                     # every live-ready category
 *   yarn test:live multisig            # one category
 *   yarn test:live multisig Forwarder  # files within a category
 *   yarn test:live integration         # the composed-contract integration specs
 *   yarn test:live --list              # live targets, for the CI matrix (JSON)
 *
 * The stack's whole lifecycle belongs to this script: it starts it (`make env-up`,
 * itself a reset) and stops it on every exit path, signals included.
 * `MIDNIGHT_LIVE_KEEP_ENV=1` leaves it running for post-mortem inspection;
 * container logs in `logs/` survive teardown either way.
 *
 * Exit codes: 0 pass (flaky-only included), 1 real test failure, 2 infrastructure
 * abort, 130/143 interrupted.
 *
 * Node runs this .ts directly (type stripping); only `node:` builtins.
 */
async function main(): Promise<number> {
  // `--list` prints the CI matrix targets and exits without touching the stack.
  if (process.argv.includes('--list')) {
    console.log(JSON.stringify(listTargets(liveCategories())));
    return 0;
  }

  const args = process.argv.slice(2).filter((a) => a !== '--');
  const resolution = resolvePlan(args, liveCategories());
  if (!resolution.ok) {
    console.log(resolution.message);
    return INFRA_ABORT;
  }
  const { plan } = resolution;

  const stack = new LiveStack();
  const lock = new RunLock();
  const orchestrator = new LiveOrchestrator({
    plan,
    stack,
    compiler: new ArtifactCompiler(plan.integration),
    runner: new VitestRunner(),
    reporter: new Reporter(),
  });

  // Teardown always precedes the lock release, so no other run can start against
  // a half-stopped stack. Both cleanup paths are needed: `finally` covers normal
  // and thrown exits, the signal handler covers Ctrl-C (where no `finally` runs).
  const cleanup = (reason: string): void => {
    stack.stop(reason);
    lock.release();
  };
  installSignalHandlers(cleanup);

  lock.acquire();
  try {
    return await orchestrator.run();
  } finally {
    cleanup('run finished');
  }
}

// `process.exitCode`, not `process.exit()`: a run under CI has its stdout piped
// into `tee`/a log collector, where writes are asynchronous, and `process.exit`
// discards whatever is still queued. What a run prints last is the verdict block,
// so that is precisely what would be lost. Nothing holds the loop open once
// `main` resolves — every child is awaited to `close`, and Node unrefs signal
// listeners — so the process still exits immediately. The signal handler in
// `shell.ts` keeps `process.exit` on purpose: it has to leave the moment its
// synchronous cleanup returns.
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    console.log(e instanceof Error ? e.message : String(e));
    process.exitCode = INFRA_ABORT;
  });
