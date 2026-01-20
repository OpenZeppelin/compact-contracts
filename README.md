[![Generic badge](https://img.shields.io/badge/Compact%20Compiler-0.26.0-1abc9c.svg)](https://docs.midnight.network/relnotes/compact/minokawa-0-18-26-0)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](CODE_OF_CONDUCT.md)

# OpenZeppelin Contracts for Compact

**A library for secure smart contract development** written in Compact for [Midnight](https://midnight.network/).

> ## ⚠️ WARNING! ⚠️
>
> This repo contains highly experimental code.
> Expect rapid iteration.
> **Use at your own risk.**

## Learn

### Documentation

Check out the [full documentation site](https://docs.openzeppelin.com/contracts-compact)!

## Usage

Make sure you have [nvm](https://github.com/nvm-sh/nvm) and [yarn](https://yarnpkg.com/getting-started/install) installed on your machine.

Follow Midnight's [Compact Developer Tools installation guide](https://docs.midnight.network/develop/tutorial/building/#midnight-compact-compiler) and confirm that `compact` is in the `PATH` env variable.

```bash
$ compact compile --version

Compactc version: 0.26.0
0.26.0
```

### Installation

Create a directory for your project.

```bash
mkdir my-project
cd my-project
```

Initialize git and add OpenZeppelin Contracts for Compact as a submodule.

```bash
git init && \
git submodule add https://github.com/OpenZeppelin/compact-contracts.git
```

`cd` into it and then install dependencies and prepare the environment.

```bash
nvm install && \
yarn && \
SKIP_ZK=true yarn compact
```


### Write a custom contract using library modules

In the root of `my-project`, create a custom contract using OpenZeppelin Compact modules.
Import the modules through `compact-contracts/node_modules/@openzeppelin/compact-contracts/...`.
Import modules through `node_modules` rather than directly to avoid state conflicts between shared dependencies.

> NOTE: Installing the library will be easier once it's available as an NPM package.

```typescript
// MyContract.compact

pragma language_version >= 0.18.0;

import CompactStandardLibrary;
import "./compact-contracts/node_modules/@openzeppelin/compact-contracts/src/access/Ownable"
  prefix Ownable_;
import "./compact-contracts/node_modules/@openzeppelin/compact-contracts/src/security/Pausable"
  prefix Pausable_;
import "./compact-contracts/node_modules/@openzeppelin/compact-contracts/src/token/FungibleToken"
  prefix FungibleToken_;

constructor(
  _name: Opaque<"string">,
  _symbol: Opaque<"string">,
  _decimals: Uint<8>,
  _recipient: Either<ZswapCoinPublicKey, ContractAddress>,
  _amount: Uint<128>,
  _initOwner: Either<ZswapCoinPublicKey, ContractAddress>,
) {
  Ownable_initialize(_initOwner);
  FungibleToken_initialize(_name, _symbol, _decimals);
  FungibleToken__mint(_recipient, _amount);
}

export circuit transfer(
  to: Either<ZswapCoinPublicKey, ContractAddress>,
  value: Uint<128>,
): Boolean {
  Pausable_assertNotPaused();
  return FungibleToken_transfer(to, value);
}

export circuit pause(): [] {
  Ownable_assertOnlyOwner();
  Pausable__pause();
}

export circuit unpause(): [] {
  Ownable_assertOnlyOwner();
  Pausable__unpause();
}

(...)
```

### Compile the contract

In the project root, compile the contract using Compact's dev tools.

```bash
% compact compile MyContract.compact artifacts/MyContract
Compiling 3 circuits:
  circuit "pause" (k=10, rows=125)
  circuit "transfer" (k=11, rows=1180)
  circuit "unpause" (k=10, rows=121)
Overall progress [====================] 3/3
```

## Development

OpenZeppelin Contracts for Compact exists thanks to its contributors.
There are many ways you can participate and help build high quality software,
make sure to check out the [contribution guide](CONTRIBUTING.md) in advance.

> ### Requirements
>
> - [Node.js](https://nodejs.org/)
> - [Yarn](https://yarnpkg.com/getting-started/install)
> - [Turbo](https://turborepo.com/docs/getting-started/installation)
> - [Compact](https://docs.midnight.network/blog/compact-developer-tools)

### Set up the project

Clone the OpenZeppelin Contracts for Compact library.

```bash
git clone git@github.com:OpenZeppelin/compact-contracts.git
```

`cd` into it and then install dependencies and prepare the environment.

```bash
nvm install && \
yarn && \
turbo compact
```

### Run tests

```bash
turbo test
```

### Check/apply Biome formatter

```bash
turbo fmt-and-lint
turbo fmt-and-lint:fix
```

### Advanced

#### Targeted compilation

```bash
turbo compact:access
turbo compact:archive
...
```

#### Skip ZK prover/verifier keys

ZK key generation is slow and usually unnecessary during development.

```bash
# Individual module compilation (recommended for development)
turbo compact:token  --filter=@openzeppelin/compact-contracts -- --skip-zk

# Full compilation with skip-zk (use environment variable)
SKIP_ZK=true turbo compact
```

#### Clean environment

```bash
# WARNING!
# These are destructive commands
turbo clean
rm -rf .turbo/
```

### Troubleshooting

- **Issues with turbo's cache?** Try cleaning: `turbo clean && rm -rf .turbo/`
- **Node version issues?** Use `nvm use` to switch to the correct version

## Security

This project is still in a very early and experimental phase. It has never been audited nor thoroughly reviewed for security vulnerabilities. DO NOT USE IT IN PRODUCTION.

Please report any security issues you find to <security@openzeppelin.com>.
