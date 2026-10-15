# Testing

How to run the test suites locally and how the live suite runs in CI. What every change must
be tested with lives in [`GUIDELINES.md`](GUIDELINES.md#testing); the coverage gate lives in
[`CONTRIBUTING.md`](CONTRIBUTING.md#code-quality-standards).

Run all commands from the repository root. Enable Corepack once (`corepack enable`) so `yarn`
resolves to the version pinned in `package.json`.

## Unit tests

Unit tests run against an in-process mock backend: no network, ZK proving skipped.

```bash
yarn test
yarn test:coverage   # the per-file coverage gate CI enforces
```

## Integration tests

Composed-contract specs under `contracts/test/integration/specs`: several modules assembled
into one contract under `test/integration/_mocks`, then deployed and driven as a unit. Same
mock backend as the unit tests.

```bash
yarn test:integration
```

## Live tests

Live tests run against a local Midnight network (node, indexer and proof server) defined in
[`local-env.yml`](local-env.yml). They need [Docker](https://docs.docker.com/get-docker/) and a
completed `yarn install`. The runner builds the target's contracts with real ZK keys, which is
slow; do not interleave `SKIP_ZK=true` builds with live runs, since a key-less build forces a
full regeneration.

```bash
yarn test:live                              # every live category, sequentially
yarn test:live multisig                     # one category
yarn test:live multisig ShieldedTreasury    # files within a category
yarn test:live integration                  # the composed-contract specs (or: yarn test:integration:live)
yarn test:live --list                       # the live targets, as the CI matrix reads them
```

A run compiles the target's slice, starts the stack (`make env-up`, itself a reset), runs a
harness smoke, then the specs, each category on a freshly reset node. The runner stops the
stack on every exit path, Ctrl-C included; no manual `env:up` or `env:down` is needed.
`MIDNIGHT_LIVE_KEEP_ENV=1` leaves it running for inspection. Container logs land in `logs/`
either way.

### Targets and filters

Every `contracts/src/<category>` with tests is a live category; today that is `access`,
`crypto`, `multisig`, `security`, `token` and `utils`. A category that must not run live is
an explicit opt-out in `EXCLUDED_CATEGORIES` in [`scripts/live/targets.ts`](scripts/live/targets.ts)
(only the legacy `archive` today).

`integration` is a target of its own, not a category: an unscoped run skips it, so ask for it
by name. Only one target runs per invocation, since both live projects draw wallets from the
same genesis-funded pool. The integration live block deploys the composed contract and reads
its supply back; the functional integration specs stay dry-only because they mutate private
state mid-test, which the live backend rejects.

The first argument names the target. Any further argument is a filename filter, matched the
way vitest matches it (a case-insensitive substring of the path) against that target's own
spec files, so a name that prefixes others runs all of them. In an unscoped run, a target the
filter matches nothing under is skipped; a filter that matches nothing anywhere aborts.

### Flake check and exit codes

If any files fail, a second round re-runs just those files on a fresh node with one worker:

- Fails round 1, passes round 2: **FLAKY** (exit 0, reported loudly).
- Fails both rounds, or never reports in round 2: **REAL** (exit 1).
- Infrastructure abort (stack, compile, lock): exit 2.

The same semantics apply to a scoped run, so a green result means the same thing as for the
full suite.

### Fresh node rules

All live tests share one node, so state left by an earlier run can fail a later one. A guard
enforces two rules and fails fast, before any wallet build:

1. **Start from a fresh node.** Stale state makes shielded spends fail with node
   `Custom error: 103`. The guard aborts if it finds any shielded coin event beyond genesis.
   The runner resets for you; reset manually with `yarn env:up`.
2. **One live run at a time.** A pid-stamped lock (`contracts/logs/.live-run.lock`) makes a
   second concurrent run abort.

| Variable | Default | Effect |
| --- | --- | --- |
| `MIDNIGHT_LIVE_WORKERS` | 3 | Parallel spec files under `unit-live` (max 3, one genesis-funded deployer each). |
| `MIDNIGHT_LIVE_ALLOW_DIRTY` | unset | `1` skips the freshness check. |
| `MIDNIGHT_LIVE_MAX_COIN_EVENTS` | 0 | Coin events beyond genesis tolerated before "not fresh". |
| `MIDNIGHT_LIVE_MAX_SCAN_BLOCKS` | 3600 | Above this indexer head, the guard asks you to `env:up` rather than scan. |
| `MIDNIGHT_LIVE_KEEP_ENV` | unset | `1` leaves the stack running after the run. |

### Reading the output

`unit-live` runs up to 3 workers in parallel, so output interleaves. It is tagged per worker:
a `▶ live worker N/3 ready` banner when a worker's wallets are funded, a `[wN] ❯ <file>` line
as each spec file starts, and a `[wN] ✓ <test> (<ms>) [done/total]` line per test. Each worker
also writes `logs/live-harness-wN.log`. `integration-live` runs one worker.

To keep a readable log, force color and pipe to `tee`: piping makes vitest print one line per
result instead of a spinner, and `FORCE_COLOR=1` keeps the color.

```bash
FORCE_COLOR=1 yarn test:live multisig 2>&1 | tee logs/live-multisig.ansi
```

Render the `.ansi` file rather than reading it raw: `less -R` in a terminal, or an ANSI
extension such as [`iliazeus.vscode-ansi`](https://marketplace.visualstudio.com/items?itemName=iliazeus.vscode-ansi)
in VS Code. On Linux, prefix `systemd-inhibit --why="live tests"` for a long run.

### Live tests in CI

The live suite takes hours, so [`live.yml`](.github/workflows/live.yml) runs it separately
from the PR checks and is never a required check:

- **Nightly** on `main`. A failed nightly opens (or comments on) a `live-nightly` tracking
  issue, which closes automatically on the next green run.
- **On demand**: run `Live Test Suite` from the Actions tab (or `gh workflow run live.yml`),
  optionally scoped with the `target` and `filter` inputs.
- **On a PR**: apply a `live-tests:<target>` label (e.g. `live-tests:multisig`), or
  `live-tests:all` for every target. Re-apply the label for a fresh run after new pushes. The
  bare `live-tests` label is rejected by the plan job.

The run is one pipeline per target. A plan job asks the runner which targets exist and which
spec files each holds. Each target gets a compile job that builds its slice once with real ZK
keys, feeding a matrix with one job per spec file that runs its file on its own runner and
stack. A file whose estimated duration exceeds the leg budget (30 tests at ~55 s each, or the
previous run's measured timings when available) is split by its describe blocks into several
legs via [`scripts/ci/split.ts`](scripts/ci/split.ts). `KNOWN_TARGETS` in `live.yml` must
list every target; a new `src/` category without a job pair fails the plan in seconds. The
reasoning behind this layout is in the header comment of `live.yml`.

Every job runs the same `yarn test:live` entry point a local run does, so the flake semantics
are identical. The two flags CI adds are `--compile-only` (build the slice and stop) and
`--prebuilt` (run against a downloaded build, and abort rather than compile if it is
incomplete). A `filter` input narrows the matrix as well as the run, matched exactly as vitest
does. Each job's verdict lands in its job summary; JSON reports upload as a
`live-reports-<target>-<file>` artifact on every run, and service and worker logs as
`live-logs-<target>-<file>` on failure.

The workflow holds no logic: matrix resolution and nightly reporting live in
[`scripts/live-ci.ts`](scripts/live-ci.ts), so both are unit tested and runnable locally.

```bash
yarn test:scripts    # dry unit tests for scripts/live and scripts/ci
yarn types:scripts   # type-check them (also part of `yarn types`)
```
