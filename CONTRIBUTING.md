# Contributing to OpenZeppelin Contracts for Compact

We really appreciate and value contributions to OpenZeppelin Contracts for Compact.
Please take 5' to review the items listed below to make sure that your contributions are merged as soon as possible.

For ANY of the items below, if they seem too complicated or hard,
you can always ask for help from us.
We love that you are helping us, and we would love to help you back!

## Opening an issue

Before starting development,
please [create an issue](https://github.com/OpenZeppelin/compact-contracts/issues/new) to open the discussion,
validate that the change is wanted, and coordinate overall implementation details.

**Security vulnerabilities are the exception.**
Do not describe a potential vulnerability in a public issue or pull request.
Report it privately as described in [`SECURITY.md`](SECURITY.md) and wait for the maintainers before doing anything public.

## Creating Pull Requests (PRs)

As a contributor, you are expected to fork this repository,
work on your own fork and then submit pull requests.
The pull requests will be reviewed and eventually merged into the main repo.
See ["Fork-a-Repo"](https://help.github.com/articles/fork-a-repo/) for how this works.

## Code quality standards

Coding conventions live in [`GUIDELINES.md`](GUIDELINES.md):
the single source of truth for naming, section ordering, idioms, testing and documentation.
The design rationale and constraints live in [`ARCHITECTURE.md`](ARCHITECTURE.md).
Read both before opening a PR.
The items below are the hard gates your contribution must clear:

- **Test coverage**: minimum 95% per-file coverage on TypeScript sources (witnesses and simulators),
  checked with `yarn test:coverage`.
  Compact coverage is reported but not gated.
- **Formatting and linting**: all code must pass the formatter and strict linting
  with the commands in [the workflow below](#a-typical-workflow).
- **Conventions**: follow [`GUIDELINES.md`](GUIDELINES.md).
- **Documentation**: add inline documentation for every public API,
  formatted per [`GUIDELINES.md`](GUIDELINES.md#documentation).

## Commit and PR conventions

The single source of truth for how changes land, and humans and agents follow the same rules:

- **Sign every commit.**
  Configure commit signing before your first contribution;
  unsigned commits will not be merged.
- Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for commit messages:
  `type(scope): summary`, e.g. `fix(token): reject zero-amount transfers`.
  Pull requests are squash-merged and the PR title becomes the commit message,
  so the title must follow the same format.
  A CI check enforces it on the title:
  one of `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `style` or `revert`,
  an optional scope, and a summary starting with a lowercase letter.
- **Never add a `Co-Authored-By` trailer for an AI assistant.**
  Add one only for a human co-author.
  You are accountable for everything you submit under your own name, whatever tools helped produce it.
- Keep the summary short and imperative,
  and explain the *why* in the body when it is not obvious from the diff.
- Link the issue in the PR description:
  `Fixes #123` / `Resolves #123` closes it on merge and belongs only on a PR that resolves it completely;
  for partial work a plain `#123` reference is enough.
  Closing keywords act only on PRs targeting the default branch.
- If the PR changes `contracts/src/` (outside test dirs) or a runtime dependency in `contracts/package.json`,
  add an entry to [`CHANGELOG.md`](CHANGELOG.md) under `## Unreleased`,
  grouped by change type (`### Added` / `Changed` / `Fixed` / ...),
  following [Keep a Changelog](https://keepachangelog.com/),
  and reference the PR number.
  A CI check requires the entry;
  if nothing user-facing changed, ask a maintainer to add the `skip-changelog` label instead.

## AI-assisted contributions

AI coding assistants are welcome (see [`AGENTS.md`](AGENTS.md) for the agent setup),
but review thoroughly every line you submit.
What does not change is who is answerable for the result:

- **You are responsible for the quality of everything you submit, whatever tools produced it.**
  Read, understand and test the code before opening a PR.
  If you cannot explain why a change is correct, it is not ready.
- **Respect reviewers' time.**
  Review bandwidth is the scarcest resource in this project,
  and an unreviewed generated diff spends it faster than anything else.
- **Do a local review pass before requesting a human one.**
  Run the tests, the formatter and the linter,
  then follow the `code-quality` review procedure (see [`AGENTS.md`](AGENTS.md) for how to use it with your agent).
  Act on what these checks report.

We may close low-effort AI output without further explanation.

## A typical workflow

1. Once, after cloning your fork, add the main repository as `upstream`,
   then set up the toolchain (Node via `nvm`, Yarn via Corepack, and the Compact compiler)
   as described in the [README](README.md#development):

   ```sh
   cd compact-contracts
   git remote add upstream https://github.com/OpenZeppelin/compact-contracts.git
   ```

   > NOTE: The directory `compact-contracts` represents your fork's local copy.

2. Start every change from the current `upstream/main`, with a clean working tree.
   Fetch it and branch directly from it.
   This works regardless of which branch you are on:

   ```sh
   git fetch upstream
   git checkout -b fix/some-bug-short-description-123 upstream/main
   ```

   The issue number in the branch name (ex: `fix/typos-in-docs-123`) is for readability only;
   the PR is linked to the issue through its description (step 5).

3. Make your changes, add your files and update documentation.
   Run the tests, the formatter and the linter locally and make sure they pass.
   For external PRs, the checks on GitHub run once a maintainer approves them.

   ```sh
   yarn compile
   yarn test
   yarn test:integration
   yarn test:coverage
   yarn lint:fix
   yarn lint
   ```

   Integration and live suites, and how the live suite runs in CI,
   are described in [`TESTING.md`](TESTING.md).

4. Commit (signed) and push to your fork.

   ```sh
   git add .
   git commit -S -m "fix(token): reject zero-amount transfers"
   git push origin fix/some-bug-short-description-123
   ```

5. Go to [OpenZeppelin/compact-contracts](https://github.com/OpenZeppelin/compact-contracts) in your web browser and issue a new pull request.
   Link the issue in the description as set out in *Commit and PR conventions*,
   and make sure all PR checks pass before requesting a review.

6. Maintainers will review your code and possibly ask for changes before it is pulled into the main repository.
   We'll check that all tests pass, review the coding style, and check for general code correctness.
   If everything is OK, we'll merge your pull request and your code will be part of OpenZeppelin Contracts for Compact.

   *IMPORTANT*: please pay attention to the maintainer's feedback,
   since it's a necessary step to keep up with the standards this project attains to.

## Tests

What every change must be tested with, and how tests are laid out, lives in [`GUIDELINES.md`](GUIDELINES.md#testing).
The coverage gate above is the only testing rule this file owns.

`yarn test` and `yarn test:integration` run against a mock backend and are what CI runs on every PR.
The mock accepts some operations the node rejects,
so a change that touches coins, identity or deployment should also pass live against a local Midnight stack (Docker required)
before you request a review:

```sh
yarn test:live token                        # one category, on a freshly reset node
yarn test:live token NativeShieldedToken    # files matching a name within it
```

The live suite takes hours and is never a required check.
It runs nightly on `main`, and on a PR when a maintainer applies a `live-tests:<target>` label.
Targets, filters, the flake check and the CI layout are in [`TESTING.md`](TESTING.md).

## All set

If you have any questions,
feel free to post them as an [issue](https://github.com/OpenZeppelin/compact-contracts/issues)
or on [GitHub Discussions](https://github.com/OpenZeppelin/compact-contracts/discussions).

Finally, if you're looking to collaborate and want to find easy tasks to start,
look at the issues we marked as ["beginner"](https://github.com/OpenZeppelin/compact-contracts/labels/beginner)
or ["help wanted"](https://github.com/OpenZeppelin/compact-contracts/labels/help%20wanted).

Thanks for your time and code!
