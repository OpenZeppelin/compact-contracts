# Contributing to OpenZeppelin Contracts for Compact

👍🎉 First off, thanks for taking the time to contribute! 🎉👍

We really appreciate and value contributions to OpenZeppelin Contracts for Compact. Please take 5' to review the items listed below to make sure that your contributions are merged and questions are answered.

## Table Of Contents

[Code of Conduct](#code-of-conduct)

[I don't want to read this whole thing, I just have a question!!!](#i-dont-want-to-read-this-whole-thing-i-just-have-a-question)

[What should I know before I get started?](#what-should-i-know-before-i-get-started)

* [What Is OpenZeppelin Contracts for Compact](#what-is-openzeppelin-contracts-for-compact)
* [Compact Contracts Design Decisions](#compact-contracts-design-decisions)

[How Can I Contribute?](#how-can-i-contribute)

* [Reporting Bugs](#reporting-bugs)
* [Suggesting Enhancements](#suggesting-enhancements)
* [Your First Code Contribution](#your-first-code-contribution)
* [Pull Requests](#pull-requests)
* [Opening an Issue](#opening-an-issue)

[Styleguides](#styleguides)

* [Git Commit Messages](#git-commit-messages)
* [TypeScript Styleguide](#typescript-styleguide)

[Additional Notes](#additional-notes)

* [Issue and Pull Request Labels](#issue-and-pull-request-labels)

## Code of Conduct

This project and everyone participating in it is governed by the [OpenZeppelin Compact Contracts Code of Conduct](CODE_OF_CONDUCT.md).
By participating, you are expected to uphold this code.
Please report unacceptable behavior to [contact@openzeppelin.com](contact@openzeppelin.com).

## I don't want to read this whole thing I just have a question!!!

> **Note:** Please don't file an issue to ask a question. You'll get faster results by using the resources below.

We have an official message board where the community chimes in with helpful advice if you have questions.

* [Github Discussions](https://github.com/OpenZeppelin/compact-contracts/discussions)

## What should I know before I get started?

### What Is OpenZeppelin Contracts for Compact?

**A library for secure smart contract development** written in Compact for [Midnight](https://midnight.network/).

> ## ⚠️ WARNING! ⚠️
>
> This repo contains highly experimental code.
> Expect rapid iteration.
> **Use at your own risk.**

### Compact Contracts Design Decisions

We try our best to document important design decisions, limitations, and pitfalls in each module using the [NatSpec format](https://docs.soliditylang.org/en/latest/natspec-format.html). If you have a question about module that's not answered by this documentation please use the [Discussion Board](https://github.com/OpenZeppelin/compact-contracts/discussions).

## How Can I Contribute?

### Reporting Bugs

This section guides you through submitting a bug report for Compact Contracts. Following these guidelines helps maintainers and the community understand your report :pencil:, reproduce the behavior :computer: :computer:, and find related reports :mag_right:.

Before creating bug reports, please check [this list](#before-submitting-a-bug-report) as you might find out that you don't need to create one. When you are creating a bug report, please [include as many details as possible](#how-do-i-submit-a-good-bug-report). Fill out [the required template](https://github.com/OpenZeppelin/compact-contracts/blob/main/.github/ISSUE_TEMPLATE/01_BUG_REPORT.yml), the information it asks for helps us resolve issues faster.

> **Note:** If you find a **Closed** issue that seems like it is the same thing that you're experiencing, open a new issue and include a link to the original issue in the body of your new one.

#### Before Submitting A Bug Report

* **Check the [discussions](https://github.com/OpenZeppelin/compact-contracts/discussions)** for a list of common questions and problems.
* **Perform a [cursory search](https://github.com/search?q=repo%3AOpenZeppelin%2Fcompact-contracts%20is%3Aissue&type=issues)** to see if the problem has already been reported. If it has **and the issue is still open**, add a comment to the existing issue instead of opening a new one.

#### How Do I Submit A (Good) Bug Report?

Bugs are tracked as [GitHub issues](https://guides.github.com/features/issues/). Create an issue and provide the following information by filling in [the template](https://github.com/OpenZeppelin/compact-contracts/issues/new?template=01_BUG_REPORT.yml).

Explain the problem and include additional details to help maintainers reproduce the problem:

* **Use a clear and descriptive title** for the issue to identify the problem.
* **Describe the exact steps which reproduce the problem** in as many details as possible. When listing steps, **don't just say what you did, but explain how you did it**.
* **Provide specific examples to demonstrate the steps**. Include links to files or GitHub projects, or copy/pasteable snippets, which you use in those examples. If you're providing snippets in the issue, use [Markdown code blocks](https://help.github.com/articles/markdown-basics/#multiple-lines).
* **Describe the behavior you observed after following the steps** and point out what exactly is the problem with that behavior.
* **Explain which behavior you expected to see instead and why.**
* **Include screenshots and animated GIFs** which show you following the described steps and clearly demonstrate the problem. 

Include details about your configuration and environment:

* **Which version of compactc are you using?** You can get the exact version by running `compactc --version` in your terminal.

### Suggesting Enhancements

This section guides you through submitting an enhancement suggestion for OpenZeppelin, including completely new features and minor improvements to existing functionality. Following these guidelines helps maintainers and the community understand your suggestion :pencil: and find related suggestions :mag_right:.

Before creating enhancement suggestions, please check [this list](#before-submitting-an-enhancement-suggestion) as you might find out that you don't need to create one. When you are creating an enhancement suggestion, please [include as many details as possible](#how-do-i-submit-a-good-enhancement-suggestion). Fill in [the template](https://github.com/OpenZeppelin/.github/blob/master/.github/ISSUE_TEMPLATE/02_FEATURE_REQUEST.md), including the steps that you imagine you would take if the feature you're requesting existed.

#### Before Submitting An Enhancement Suggestion

* **Check if you're using the latest version of contracts**
* **Perform a [cursory search](https://github.com/search?q=+is%3Aissue+user%3AOpenZeppelin)** to see if the enhancement has already been suggested. If it has, add a comment to the existing issue instead of opening a new one.

#### How Do I Submit A (Good) Enhancement Suggestion?

Enhancement suggestions are tracked as [GitHub issues](https://guides.github.com/features/issues/). Create an issue and provide the following information:

* **Use a clear and descriptive title** for the issue to identify the suggestion.
* **Provide a step-by-step description of the suggested enhancement** in as many details as possible.
* **Provide specific examples to demonstrate the steps**. Include copy/pasteable snippets which you use in those examples, as [Markdown code blocks](https://help.github.com/articles/markdown-basics/#multiple-lines).
* **Describe the current behavior** and **explain which behavior you expected to see instead** and why.
* **Include screenshots and animated GIFs** which help you demonstrate the steps or point out the part of the contracts library the suggestion is related to.
* **Explain why this enhancement would be useful** to most OpenZeppelin contracts users
* **Specify which version of Compact you're using.** You can get the exact version by running `compactc --version` in your terminal

### Your First Code Contribution

Unsure where to begin contributing to Compact Contracts? You can start by looking through these `beginner` and `help-wanted` issues:

* [Beginner issues][beginner] - issues which should only require a few lines of code, and a test or two.
* [Help wanted issues][help-wanted] - issues which should be a bit more involved than `beginner` issues.

Both issue lists are sorted by total number of comments. While not perfect, number of comments is a reasonable proxy for impact a given change will have.

### Pull Requests

The process described here has several goals:

* Maintain Compact Contracts quality.
* Fix problems that are important to users.
* Engage the community in working toward the best possible Compact smart contracts library.
* Enable a sustainable system for Compact Contract's maintainers to review contributions.

Any non-trivial code contribution must be first discussed with the maintainers in an issue (see [Opening an issue](#opening-an-issue)). Only very minor changes are accepted without prior discussion.

Please follow these steps to have your contribution considered by the maintainers:

1. [Open an issue](#opening-an-issue).
2. Fork the repository and create a new branch.
3. Follow all instructions in [the template](.github/PULL_REQUEST_TEMPLATE.md)
4. Follow the [engineering guidelines](./GUIDELINES.md).
5. Follow the [styleguides](#styleguides)
6. If the PR includes non-trivial changes, additions, or deletions (especially in Compact modules and/or witnesses),
add an entry to the [CHANGELOG](./CHANGELOG.md).
7. After you submit your pull request, verify that all [status checks](https://help.github.com/articles/about-status-checks/) are passing. <details><summary>What if the status checks are failing?</summary>
If a status check is failing, and you believe that the failure is unrelated to your change, please leave a comment on the pull request explaining why you believe the failure is unrelated.
A maintainer will re-run the status check for you. If we conclude that the failure was a false positive, then we will open an issue to track that problem with our status check suite.</details>

While the prerequisites above must be satisfied prior to having your pull request reviewed, the reviewer(s) may ask you to complete additional design work, tests, or other changes before your pull request can be ultimately accepted.

## Styleguides

### TypeScript Styleguide

All TypeScript code is linted with [Biomejs](https://biomejs.dev/).

Quickly fix all formatting and linting errors with the `turbo fmt:fix` and `turbo lint:fix` commands.

## Opening an issue

You can [open an issue] to suggest a feature or report a minor bug. For serious bugs please do not open an issue, instead refer to our [security policy] for appropriate steps.

If you believe your issue may be due to user error and not a problem in the library, consider instead posting a question on the [OpenZeppelin Forum].

Before opening an issue, be sure to search through the existing open and closed issues, and consider posting a comment in one of those instead.

When requesting a new feature, include as many details as you can, especially around the use cases that motivate it. Features are prioritized according to the impact they may have on the ecosystem, so we appreciate information showing that the impact could be high.

[security policy]: https://github.com/OpenZeppelin/compact-contracts/security
[open an issue]: https://github.com/OpenZeppelin/compact-contracts/issues/new/choose

## Additional Notes

### Issue and Pull Request Labels

This section lists the labels we use to help us track and manage issues and pull requests.

[GitHub search](https://help.github.com/articles/searching-issues/) makes it easy to use labels for finding groups of issues or pull requests you're interested in.
For example, you might be interested in [open issues across `OpenZeppelin` and all OpenZeppelin-owned packages which are labeled as bugs, but still need to be reliably reproduced](https://github.com/search?utf8=%E2%9C%93&q=is%3Aopen+is%3Aissue+user%3AOpenZeppelin+label%3Abug) or perhaps [open pull requests in `OpenZeppelin/compact-contracts` which haven't been reviewed yet](https://github.com/search?utf8=%E2%9C%93&q=is%3Aopen+is%3Apr+repo%3AOpenZeppelin%2Fcompact-contracts+comments%3A0).
To help you find issues and pull requests, each label is listed with search links for finding open items with that label in `OpenZeppelin/compact-contracts` only and also across all OpenZeppelin repositories.
We  encourage you to read about [other search filters](https://help.github.com/articles/searching-issues/) which will help you write more focused queries.

The labels are loosely grouped by their purpose, but it's not required that every issue has a label from every group or that an issue can't have more than one label from the same group.

Please open an issue on `OpenZeppelin/compact-contracts` if you have suggestions for new labels, and if you notice some labels are missing on some repositories, then please open an issue on that repository.

#### Type of Issue and Issue State

| Label name | `OpenZeppelin/compact-contracts` :mag_right: | `OpenZeppelin`‑org :mag_right: | Description |
| --- | --- | --- | --- |
| `enhancement` | [search][search-OpenZeppelin-repo-label-enhancement] | [search][search-OpenZeppelin-org-label-enhancement] | Feature requests. |
| `bug` | [search][search-OpenZeppelin-repo-label-bug] | [search][search-OpenZeppelin-org-label-bug] | Confirmed bugs or reports that are very likely to be bugs. |
| `question` | [search][search-OpenZeppelin-repo-label-question] | [search][search-OpenZeppelin-org-label-question] | Questions more than bug reports or feature requests (e.g. how do I do X). |
| `feedback` | [search][search-OpenZeppelin-repo-label-feedback] | [search][search-OpenZeppelin-org-label-feedback] | General feedback more than bug reports or feature requests. |
| `help-wanted` | [search][search-OpenZeppelin-repo-label-help-wanted] | [search][search-OpenZeppelin-org-label-help-wanted] | The OpenZeppelin core team would appreciate help from the community in resolving these issues. |
| `beginner` | [search][search-OpenZeppelin-repo-label-beginner] | [search][search-OpenZeppelin-org-label-beginner] | Less complex issues which would be good first issues to work on for users who want to contribute to OpenZeppelin. |
| `more-information-needed` | [search][search-OpenZeppelin-repo-label-more-information-needed] | [search][search-OpenZeppelin-org-label-more-information-needed] | More information needs to be collected about these problems or feature requests (e.g. steps to reproduce). |
| `needs-reproduction` | [search][search-OpenZeppelin-repo-label-needs-reproduction] | [search][search-OpenZeppelin-org-label-needs-reproduction] | Likely bugs, but haven't been reliably reproduced. |
| `blocked` | [search][search-OpenZeppelin-repo-label-blocked] | [search][search-OpenZeppelin-org-label-blocked] | Issues blocked on other issues. |
| `duplicate` | [search][search-OpenZeppelin-repo-label-duplicate] | [search][search-OpenZeppelin-org-label-duplicate] | Issues which are duplicates of other issues, i.e. they have been reported before. |
| `wontfix` | [search][search-OpenZeppelin-repo-label-wontfix] | [search][search-OpenZeppelin-org-label-wontfix] | The OpenZeppelin core team has decided not to fix these issues for now, either because they're working as intended or for some other reason. |
| `invalid` | [search][search-OpenZeppelin-repo-label-invalid] | [search][search-OpenZeppelin-org-label-invalid] | Issues which aren't valid (e.g. user errors). |

#### Topic Categories

| Label name | `OpenZeppelin/compact-contracts` :mag_right: | `OpenZeppelin`‑org :mag_right: | Description |
| --- | --- | --- | --- |
| `documentation` | [search][search-OpenZeppelin-repo-label-documentation] | [search][search-OpenZeppelin-org-label-documentation] | Improvements or additions to documentation. |
| `performance` | [search][search-OpenZeppelin-repo-label-performance] | [search][search-OpenZeppelin-org-label-performance] | Improvements related to circuit size, gas optimization, or code efficiency. |
| `security` | [search][search-OpenZeppelin-repo-label-security] | [search][search-OpenZeppelin-org-label-security] | Related to security. |
| `deprecation-help` | [search][search-OpenZeppelin-repo-label-deprecation-help] | [search][search-OpenZeppelin-org-label-deprecation-help] | Issues for helping package authors remove usage of deprecated APIs in packages. |

#### Pull Request Labels

| Label name | `OpenZeppelin/compact-contracts` :mag_right: | `OpenZeppelin`‑org :mag_right: | Description
| --- | --- | --- | --- |
| `work-in-progress` | [search][search-OpenZeppelin-repo-label-work-in-progress] | [search][search-OpenZeppelin-org-label-work-in-progress] | Pull requests which are still being worked on, more changes will follow. |
| `needs-review` | [search][search-OpenZeppelin-repo-label-needs-review] | [search][search-OpenZeppelin-org-label-needs-review] | Pull requests which need code review, and approval from maintainers or OpenZeppelin core team. |
| `under-review` | [search][search-OpenZeppelin-repo-label-under-review] | [search][search-OpenZeppelin-org-label-under-review] | Pull requests being reviewed by maintainers or OpenZeppelin core team. |
| `requires-changes` | [search][search-OpenZeppelin-repo-label-requires-changes] | [search][search-OpenZeppelin-org-label-requires-changes] | Pull requests which need to be updated based on review comments and then reviewed again. |
| `needs-testing` | [search][search-OpenZeppelin-repo-label-needs-testing] | [search][search-OpenZeppelin-org-label-needs-testing] | Pull requests which need manual testing. |

[search-OpenZeppelin-repo-label-enhancement]: https://github.com/search?q=is%3Aopen+is%3Aissue+repo%3AOpenZeppelin%2Fcompact-contracts+label%3Aenhancement
[search-OpenZeppelin-org-label-enhancement]: https://github.com/search?q=is%3Aopen+is%3Aissue+user%3AOpenZeppelin+label%3Aenhancement
[search-OpenZeppelin-repo-label-bug]: https://github.com/search?q=is%3Aopen+is%3Aissue+repo%3AOpenZeppelin%2Fcompact-contracts+label%3Abug
[search-OpenZeppelin-org-label-bug]: https://github.com/search?q=is%3Aopen+is%3Aissue+user%3AOpenZeppelin+label%3Abug
[search-OpenZeppelin-repo-label-question]: https://github.com/search?q=is%3Aopen+is%3Aissue+repo%3AOpenZeppelin%2Fcompact-contracts+label%3Aquestion
[search-OpenZeppelin-org-label-question]: https://github.com/search?q=is%3Aopen+is%3Aissue+user%3AOpenZeppelin+label%3Aquestion
[search-OpenZeppelin-repo-label-feedback]: https://github.com/search?q=is%3Aopen+is%3Aissue+repo%3AOpenZeppelin%2Fcompact-contracts+label%3Afeedback
[search-OpenZeppelin-org-label-feedback]: https://github.com/search?q=is%3Aopen+is%3Aissue+user%3AOpenZeppelin+label%3Afeedback
[search-OpenZeppelin-repo-label-help-wanted]: https://github.com/search?q=is%3Aopen+is%3Aissue+repo%3AOpenZeppelin%2Fcompact-contracts+label%3Ahelp-wanted
[search-OpenZeppelin-org-label-help-wanted]: https://github.com/search?q=is%3Aopen+is%3Aissue+user%3AOpenZeppelin+label%3Ahelp-wanted
[search-OpenZeppelin-repo-label-beginner]: https://github.com/search?q=is%3Aopen+is%3Aissue+repo%3AOpenZeppelin%2Fcompact-contracts+label%3Abeginner
[search-OpenZeppelin-org-label-beginner]: https://github.com/search?q=is%3Aopen+is%3Aissue+user%3AOpenZeppelin+label%3Abeginner
[search-OpenZeppelin-repo-label-more-information-needed]: https://github.com/search?q=is%3Aopen+is%3Aissue+repo%3AOpenZeppelin%2Fcompact-contracts+label%3Amore-information-needed
[search-OpenZeppelin-org-label-more-information-needed]: https://github.com/search?q=is%3Aopen+is%3Aissue+user%3AOpenZeppelin+label%3Amore-information-needed
[search-OpenZeppelin-repo-label-needs-reproduction]: https://github.com/search?q=is%3Aopen+is%3Aissue+repo%3AOpenZeppelin%2Fcompact-contracts+label%3Aneeds-reproduction
[search-OpenZeppelin-org-label-needs-reproduction]: https://github.com/search?q=is%3Aopen+is%3Aissue+user%3AOpenZeppelin+label%3Aneeds-reproduction
[search-OpenZeppelin-repo-label-documentation]: https://github.com/search?q=is%3Aopen+is%3Aissue+repo%3AOpenZeppelin%2Fcompact-contracts+label%3Adocumentation
[search-OpenZeppelin-org-label-documentation]: https://github.com/search?q=is%3Aopen+is%3Aissue+user%3AOpenZeppelin+label%3Adocumentation
[search-OpenZeppelin-repo-label-performance]: https://github.com/search?q=is%3Aopen+is%3Aissue+repo%3AOpenZeppelin%2Fcompact-contracts+label%3Aperformance
[search-OpenZeppelin-org-label-performance]: https://github.com/search?q=is%3Aopen+is%3Aissue+user%3AOpenZeppelin+label%3Aperformance
[search-OpenZeppelin-repo-label-security]: https://github.com/search?q=is%3Aopen+is%3Aissue+repo%3AOpenZeppelin%2Fcompact-contracts+label%3Asecurity
[search-OpenZeppelin-org-label-security]: https://github.com/search?q=is%3Aopen+is%3Aissue+user%3AOpenZeppelin+label%3Asecurity

[search-OpenZeppelin-repo-label-blocked]: https://github.com/search?q=is%3Aopen+is%3Aissue+repo%3AOpenZeppelin%2Fcompact-contracts+label%3Ablocked
[search-OpenZeppelin-org-label-blocked]: https://github.com/search?q=is%3Aopen+is%3Aissue+user%3AOpenZeppelin+label%3Ablocked
[search-OpenZeppelin-repo-label-duplicate]: https://github.com/search?q=is%3Aopen+is%3Aissue+repo%3AOpenZeppelin%2Fcompact-contracts+label%3Aduplicate
[search-OpenZeppelin-org-label-duplicate]: https://github.com/search?q=is%3Aopen+is%3Aissue+user%3AOpenZeppelin+label%3Aduplicate
[search-OpenZeppelin-repo-label-wontfix]: https://github.com/search?q=is%3Aopen+is%3Aissue+repo%3AOpenZeppelin%2Fcompact-contracts+label%3Awontfix
[search-OpenZeppelin-org-label-wontfix]: https://github.com/search?q=is%3Aopen+is%3Aissue+user%3AOpenZeppelin+label%3Awontfix
[search-OpenZeppelin-repo-label-invalid]: https://github.com/search?q=is%3Aopen+is%3Aissue+repo%3AOpenZeppelin%2Fcompact-contracts+label%3Ainvalid
[search-OpenZeppelin-org-label-invalid]: https://github.com/search?q=is%3Aopen+is%3Aissue+user%3AOpenZeppelin+label%3Ainvalid
[search-OpenZeppelin-repo-label-deprecation-help]: https://github.com/search?q=is%3Aopen+is%3Aissue+repo%3AOpenZeppelin%2Fcompact-contracts+label%3Adeprecation-help
[search-OpenZeppelin-org-label-deprecation-help]: https://github.com/search?q=is%3Aopen+is%3Aissue+user%3AOpenZeppelin+label%3Adeprecation-help

[search-OpenZeppelin-repo-label-work-in-progress]: https://github.com/search?q=is%3Aopen+is%3Apr+repo%3AOpenZeppelin%2Fcompact-contracts+label%3Awork-in-progress
[search-OpenZeppelin-org-label-work-in-progress]: https://github.com/search?q=is%3Aopen+is%3Apr+user%3AOpenZeppelin+label%3Awork-in-progress
[search-OpenZeppelin-repo-label-needs-review]: https://github.com/search?q=is%3Aopen+is%3Apr+repo%3AOpenZeppelin%2Fcompact-contracts+label%3Aneeds-review
[search-OpenZeppelin-org-label-needs-review]: https://github.com/search?q=is%3Aopen+is%3Apr+user%3AOpenZeppelin+label%3Aneeds-review
[search-OpenZeppelin-repo-label-under-review]: https://github.com/search?q=is%3Aopen+is%3Apr+repo%3AOpenZeppelin%2Fcompact-contracts+label%3Aunder-review
[search-OpenZeppelin-org-label-under-review]: https://github.com/search?q=is%3Aopen+is%3Apr+user%3AOpenZeppelin+label%3Aunder-review
[search-OpenZeppelin-repo-label-requires-changes]: https://github.com/search?q=is%3Aopen+is%3Apr+repo%3AOpenZeppelin%2Fcompact-contracts+label%3Arequires-changes
[search-OpenZeppelin-org-label-requires-changes]: https://github.com/search?q=is%3Aopen+is%3Apr+user%3AOpenZeppelin+label%3Arequires-changes
[search-OpenZeppelin-repo-label-needs-testing]: https://github.com/search?q=is%3Aopen+is%3Apr+repo%3AOpenZeppelin%2Fcompact-contracts+label%3Aneeds-testing
[search-OpenZeppelin-org-label-needs-testing]: https://github.com/search?q=is%3Aopen+is%3Apr+user%3AOpenZeppelin+label%3Aneeds-testing

[beginner]:https://github.com/search?utf8=%E2%9C%93&q=is%3Aopen+is%3Aissue+label%3Abeginner+label%3Ahelp-wanted+user%3AOpenZeppelin+sort%3Acomments-desc
[help-wanted]:https://github.com/search?q=is%3Aopen+is%3Aissue+label%3Ahelp-wanted+user%3AOpenZeppelin+sort%3Acomments-desc+-label%3Abeginner

