# OpenZeppelin Contracts for Midnight

**A library for secure smart contract development** written in Compact for [Midnight](https://midnight.network/).

> ## ⚠️ WARNING! ⚠️
>
> This repo contains highly experimental code.
> Expect rapid iteration.
> **Use at your own risk.**

## Installation

Make sure you have [nvm](https://github.com/nvm-sh/nvm) and [yarn](https://yarnpkg.com/getting-started/install) installed on your machine.

Follow Midnight's [compact installation guide](https://docs.midnight.network/develop/tutorial/building/#midnight-compact-compiler) and confirm that `compactc` is in the `PATH` env variable.

```bash
$ compactc

Compactc version: 0.23.0
Usage: compactc.bin <flag> ... <source-pathname> <target-directory-pathname>
       --help displays detailed usage information
```

## Set up the project

Clone the repository:

```bash
git clone git@github.com:OpenZeppelin/midnight-contracts.git
```

`cd` into it and then install dependencies and prepare the environment:

```bash
nvm install && \
yarn && \
yarn prepare
```

## Usage

### Compile the contracts

```bash
$ npx turbo compact

(...)
✔ [COMPILE] [1/2] Compiled ERC20.compact
@openzeppelin-midnight/erc20:compact:     Compactc version: 0.23.0
@openzeppelin-midnight/erc20:compact:
✔ [COMPILE] [1/6] Compiled Initializable.compact
@openzeppelin-midnight/utils:compact:     Compactc version: 0.23.0
@openzeppelin-midnight/utils:compact:
✔ [COMPILE] [2/6] Compiled Pausable.compact
@openzeppelin-midnight/utils:compact:     Compactc version: 0.23.0
@openzeppelin-midnight/utils:compact:
✔ [COMPILE] [3/6] Compiled Utils.compact
@openzeppelin-midnight/utils:compact:     Compactc version: 0.23.0
@openzeppelin-midnight/utils:compact:
✔ [COMPILE] [4/6] Compiled test/mocks/MockInitializable.compact
@openzeppelin-midnight/utils:compact:     Compactc version: 0.23.0
@openzeppelin-midnight/utils:compact:     Compiling 3 circuits:
✔ [COMPILE] [5/6] Compiled test/mocks/MockPausable.compact
@openzeppelin-midnight/utils:compact:     Compactc version: 0.23.0
@openzeppelin-midnight/utils:compact:     Compiling 5 circuits:
✔ [COMPILE] [6/6] Compiled test/mocks/MockUtils.compact
@openzeppelin-midnight/utils:compact:     Compactc version: 0.23.0
@openzeppelin-midnight/utils:compact:

✔ [COMPILE] [2/2] Compiled test/mocks/MockERC20.compact
@openzeppelin-midnight/erc20:compact:     Compactc version: 0.23.0
@openzeppelin-midnight/erc20:compact:     Compiling 15 circuits:


 Tasks:    2 successful, 2 total
Cached:    0 cached, 2 total
  Time:    7.178s
```

**Note:** Speed up the development process by skipping the prover and verifier key file generation:

```bash
npx turbo compact -- --skip-zk
```

### Run tests

```bash
npx turbo test
```

## Security

This project is still in a very early and experimental phase. It has never been audited nor thoroughly reviewed for security vulnerabilities. DO NOT USE IT IN PRODUCTION.

Please report any security issues you find to <security@openzeppelin.com>.
