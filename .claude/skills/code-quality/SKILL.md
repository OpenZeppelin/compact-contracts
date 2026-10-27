---
name: code-quality
description: Review or improve changed code, documentation and configuration against this repository's written conventions and design constraints. Use when asked for a code-quality, style, conventions or consistency review.
---

# Code quality

Review the requested files against the repository's own sources of truth. Run repository commands
from the repository root.

1. Identify the files in scope from the user's path or request. With no path, compare the current
   branch with the base branch of its pull request, if there is one, and include staged, unstaged
   and untracked changes. For a stacked pull request, use its immediate parent branch rather than
   the stack's trunk. If there is no pull request, identify the intended base from the local
   branch context and state your choice; do not assume it is `main`. Review the changed source,
   documentation and configuration files, excluding generated files only when the repository
   documents them. If there are no files in scope, say so.
2. Read the files in scope and the applicable parts of [`GUIDELINES.md`](../../../GUIDELINES.md),
   [`ARCHITECTURE.md`](../../../ARCHITECTURE.md) and
   [`CONTRIBUTING.md`](../../../CONTRIBUTING.md). Use the toolchain and commands documented in
   [`README.md`](../../../README.md) and `CONTRIBUTING.md` when they have been filled in for this
   repository.
3. Report concrete findings with a file and line and a proposed correction. For a convention
   finding, name the document section it rests on. For a functional defect — a wrong condition,
   a broken link, a failing test — give the evidence instead: the code path, the failing test or
   a reproduction; it counts even when no document covers it. Do not present an unwritten
   preference as a repository rule. If a template TODO still stands in place of a rule,
   identify that gap rather than guessing its content.
4. If the user asked to improve or fix the code, make the supported corrections, then run the
   relevant formatter, linter and tests from `CONTRIBUTING.md`. If the user asked only for a
   review, report findings without changing files. State any checks that could not run and why.
