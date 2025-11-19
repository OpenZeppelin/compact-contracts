# Engineering Guidelines

## Testing

Code must be thoroughly tested with quality unit tests.

We defer to the [Moloch Testing Guide](https://github.com/MolochVentures/moloch/tree/master/test#readme) for specific recommendations, though not all of it is relevant here. Note the introduction:

> Tests should be written, not only to verify correctness of the target code, but to be comprehensively reviewed by other programmers. Therefore, for mission critical Compact code, the quality of the tests is just as important (if not more so) than the code itself, and should be written to the highest standards of clarity and elegance.

Every addition or change to the code must come with relevant and comprehensive tests.

Refactors should avoid simultaneous changes to tests.

Flaky tests are not acceptable.

The test suite should run automatically for every change in the repository, and in pull requests tests must pass before merging.

In some cases unit tests may be insufficient and complementary techniques should be used:

1. Property-based tests (aka. fuzzing) for math-heavy code.
2. Formal verification for state machines.

## Code style

TypeScript code should be written in a consistent format enforced by the project's chosen formatting tool, [biomejs](https://biomejs.dev/).

## Documentation

The online version of the Compact contracts documentation is maintained at [OpenZeppelin/docs](https://github.com/OpenZeppelin/docs).
It should mirror all documentation embedded within the contracts themselves with additional context and usage examples if applicable.
Pull requests in [OpenZeppelin/docs](https://github.com/OpenZeppelin/docs) should be linked to the corresponding pull request in this repo.

For contributors, project guidelines and processes must be documented publicly.

For users, features must be abundantly documented. Documentation should include answers to common questions, solutions to common problems, and recommendations for critical decisions that the user may face.

Method documentation must list all requirements necessary for the method to execute without error.

## Peer review

All changes must be submitted through pull requests and go through peer code review.

The review must be approached by the reviewer in a similar way as if it was an audit of the code in question (but importantly it is not a substitute for and should not be considered an audit).

Reviewers should enforce code and project guidelines.

Small external contributions and documentation changes must be reviewed by a at least a single maintainer. Large PRs and critical code changes must be reviewed by multiple maintainers.

## Automation

Automation should be used as much as possible to reduce the possibility of human error and forgetfulness.

Automations that make use of sensitive credentials must use secure secret management, and must be strengthened against attacks such as [those on GitHub Actions workflows](https://github.com/nikitastupin/pwnhub).

Some other examples of automation are:

- Looking for common security vulnerabilities or errors in our code (eg. reentrancy analysis).
- Keeping dependencies up to date and monitoring for vulnerable dependencies.

## Pull requests

Pull requests are squash-merged to keep the `main` branch history clean. The title of the pull request becomes the commit message, so it should be written in a consistent format:

1) Begin with a capital letter.
2) Do not end with a period.
3) Write in the imperative: "Add feature X" and not "Adds feature X" or "Added feature X".

This repository does not follow conventional commits, so do not prefix the title with "fix:" or "feat:".

Work in progress pull requests should be submitted as Drafts and should not be prefixed with "WIP:".

Branch names don't matter, and commit messages within a pull request mostly don't matter either, although they can help the review process.
