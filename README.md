[![Generic badge](https://img.shields.io/badge/Compact%20Compiler-0.24.0-1abc9c.svg)](https://docs.midnight.network/relnotes/compact)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](CODE_OF_CONDUCT.md)

# OpenZeppelin Contracts for Compact

**A library for secure smart contract development** written in Compact for [Midnight](https://midnight.network/).

> ## ⚠️ WARNING! ⚠️
>
> This repo contains highly experimental code.
> Expect rapid iteration.
> **Use at your own risk.**

## Installation

Make sure you have [nvm](https://github.com/nvm-sh/nvm), [yarn](https://yarnpkg.com/getting-started/install), and [turbo](https://turborepo.com/docs/getting-started/installation) installed on your machine.

Follow Midnight's [compact installation guide](https://docs.midnight.network/develop/tutorial/building/#midnight-compact-compiler) and confirm that `compactc` is in the `PATH` env variable.

```bash
$ compactc

Compactc version: 0.24.0
Usage: compactc.bin <flag> ... <source-pathname> <target-directory-pathname>
       --help displays detailed usage information
```

## Set up the project

> ### Requirements
>
> - [node](https://nodejs.org/)
> - [yarn](https://yarnpkg.com/getting-started/install)
> - [turbo](https://turborepo.com/docs/getting-started/installation)
> - [compact](https://docs.midnight.network/develop/tutorial/building/#midnight-compact-compiler)

Clone the repository:

```bash
git clone git@github.com:OpenZeppelin/compact-contracts.git
```

`cd` into it and then install dependencies and prepare the environment:

```bash
nvm install && \
yarn && \
turbo compact
```

## Usage

### Compile the contracts

```bash
$ turbo compact

(...)
✔ [COMPILE] [1/2] Compiled FungibleToken.compact
@openzeppelin-compact/fungible-token:compact:     Compactc version: 0.24.0
@openzeppelin-compact/fungible-token:compact:
✔ [COMPILE] [1/6] Compiled Initializable.compact
@openzeppelin-compact/utils:compact:     Compactc version: 0.24.0
@openzeppelin-compact/utils:compact:
✔ [COMPILE] [2/6] Compiled Pausable.compact
@openzeppelin-compact/utils:compact:     Compactc version: 0.24.0
@openzeppelin-compact/utils:compact:
✔ [COMPILE] [3/6] Compiled Utils.compact
@openzeppelin-compact/utils:compact:     Compactc version: 0.24.0
@openzeppelin-compact/utils:compact:
✔ [COMPILE] [4/6] Compiled test/mocks/MockInitializable.compact
@openzeppelin-compact/utils:compact:     Compactc version: 0.24.0
@openzeppelin-compact/utils:compact:     Compiling 3 circuits:
✔ [COMPILE] [5/6] Compiled test/mocks/MockPausable.compact
@openzeppelin-compact/utils:compact:     Compactc version: 0.24.0
@openzeppelin-compact/utils:compact:     Compiling 5 circuits:
✔ [COMPILE] [6/6] Compiled test/mocks/MockUtils.compact
@openzeppelin-compact/utils:compact:     Compactc version: 0.24.0
@openzeppelin-compact/utils:compact:

✔ [COMPILE] [2/2] Compiled test/mocks/MockFungibleToken.compact
@openzeppelin-compact/fungible-token:compact:     Compactc version: 0.24.0
@openzeppelin-compact/fungible-token:compact:     Compiling 15 circuits:


 Tasks:    2 successful, 2 total
Cached:    0 cached, 2 total
  Time:    7.178s
```

**Note:** Speed up the development process by skipping the prover and verifier key file generation:

```bash
turbo compact -- --skip-zk
```

### Run tests

```bash
turbo test
```

### Format and lint files

```bash
turbo fmt-and-lint:fix
```

### All together now!
```bash
turbo compact test fmt-and-lint:fix
```

## Security

This project is still in a very early and experimental phase. It has never been audited nor thoroughly reviewed for security vulnerabilities. DO NOT USE IT IN PRODUCTION.

Please report any security issues you find to <security@openzeppelin.com>.
