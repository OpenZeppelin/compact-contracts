# Agent Guide

Start here when contributing to this repository with an AI coding agent. The rules live in the
same files that human contributors use:

- [`GUIDELINES.md`](GUIDELINES.md): coding conventions, testing, linting and documentation.
- [`ARCHITECTURE.md`](ARCHITECTURE.md): repository layout, design decisions and constraints.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): contribution process, PR conventions and the test suites.

## Build, test and review

Use the toolchain and commands in [`README.md`](README.md#development) and the test suites in
[`CONTRIBUTING.md`](CONTRIBUTING.md). Review changed code against `GUIDELINES.md` and
`ARCHITECTURE.md` before submitting it.

For a local code-quality review, run `/code-quality` in Claude Code. Codex and other agents should
read and follow [the same procedure](.claude/skills/code-quality/SKILL.md) when asked to review
code quality. The procedure reads the documents above instead of defining another set of
conventions.

## Using the library

For agents integrating this library into another project, [`llms.txt`](llms.txt) is the
discovery entry point for modules, examples, API reference and audits.
