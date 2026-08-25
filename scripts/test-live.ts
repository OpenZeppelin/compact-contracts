import { ArtifactCompiler } from './live/ArtifactCompiler.ts';
import { INFRA_ABORT, LiveOrchestrator } from './live/LiveOrchestrator.ts';
import { LiveStack } from './live/LiveStack.ts';
import { Reporter } from './live/Reporter.ts';
import { RunLock } from './live/RunLock.ts';
import { banner, installSignalHandlers } from './live/shell.ts';
import {
  compileScope,
  listTargets,
  liveCategories,
  parseInvocation,
  resolvePlan,
} from './live/targets.ts';
import { VitestRunner } from './live/VitestRunner.ts';

/**
 * Live-test orchestrator entry point: resolve args into a plan, wire the
 * services, run it under the single-run lock, always stop the stack.
 *
 * Each concern lives in `scripts/live/` with the reasoning that belongs to it:
 *   - `targets.ts`          — what an invocation resolves to (pure)
 *   - `specs.ts`            — a target's spec files, and vitest's filter match
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
 *   yarn test:live                     # every live category
 *   yarn test:live multisig            # one category
 *   yarn test:live multisig Forwarder  # files within a category
 *   yarn test:live integration         # the composed-contract integration specs
 *   yarn test:live --list              # live targets, for the CI matrix (JSON)
 *
 * Two flags exist for CI, which splits a run across jobs that a local run does
 * in one process (see `live.yml`):
 *   yarn test:live token --compile-only        # build the slice, then stop
 *   yarn test:live token <file> --prebuilt     # run against a downloaded build
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

  const invocation = parseInvocation(process.argv.slice(2));
  if (!invocation.ok) {
    console.log(invocation.message);
    return INFRA_ABORT;
  }
  const { mode, args } = invocation.invocation;

  const resolution = resolvePlan(args, liveCategories());
  if (!resolution.ok) {
    console.log(resolution.message);
    return INFRA_ABORT;
  }
  const { plan } = resolution;
  const compiler = new ArtifactCompiler(
    compileScope(plan),
    mode === 'prebuilt',
  );

  // `--compile-only` stops here: no stack, no specs. The CI compile job runs
  // this so the suite jobs that fan out per spec file can share one build
  // instead of each repeating it (see `live.yml`). It still takes the run lock:
  // it writes the same shared `artifacts/` tree a full run deploys from, and a
  // compile racing a live run over that tree is the #675 truncation.
  if (mode === 'build-only') {
    banner(`COMPILE — ${plan.targets.map((t) => t.name).join(', ')}`);
    const lock = new RunLock();
    lock.acquire();
    try {
      return (await compiler.compileVerified()) ? 0 : INFRA_ABORT;
    } finally {
      lock.release();
    }
  }

  const stack = new LiveStack();
  const lock = new RunLock();
  const orchestrator = new LiveOrchestrator({
    plan,
    stack,
    compiler,
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
