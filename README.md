[![Generic badge](https://img.shields.io/badge/Compact%20Compiler-0.29.0-1abc9c.svg)](https://docs.midnight.network/relnotes/compact/minokawa-0-18-26-0)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](CODE_OF_CONDUCT.md)

This project is built on the Midnight Network.

# OpenZeppelin Contracts for Compact

**A library for secure smart contract development** written in Compact for [Midnight](https://midnight.network/).


> ## ⚠️ WARNING! ⚠️
>
> This repo contains highly experimental code.
> Expect rapid iteration.
> **Use at your own risk.**

> ## ⚠️ Witnesses Are Test-Only Material ⚠️
>
> Every TypeScript witness in this repo lives under `contracts/src/<module>/test/witnesses/` and exists **solely to drive the Compact circuits during off-chain tests**. They are not part of the published package and are not maintained as a public API.
>
> **Witness implementations are security-critical.** A witness controls the private state a circuit reads from — a buggy or malicious witness can leak secrets, produce invalid proofs, or undermine the guarantees of the contract it pairs with. Consumers of this library **must author and audit their own witnesses** for production use; the ones shipped here are reference test doubles only.
>
> OpenZeppelin does not publish witnesses as a consumable artifact and takes no responsibility for any witness implementation reused outside its test context.

## Learn

### Documentation

Check out the [full documentation site](https://docs.openzeppelin.com/contracts-compact)!

## Usage

Make sure you have [nvm](https://github.com/nvm-sh/nvm) and [yarn](https://yarnpkg.com/getting-started/install) installed on your machine.

Follow Midnight's [Compact Developer Tools installation guide](https://docs.midnight.network/develop/tutorial/building/#midnight-compact-compiler) and confirm that `compact` is in the `PATH` env variable.

```bash
$ compact compile --version

Compactc version: 0.29.0
0.29.0
```

### Installation

Create a directory for your project.

```bash
mkdir my-project
cd my-project
```

Install the package.

```bash
yarn add @openzeppelin/compact-contracts
```

### Write a custom contract using library modules

In the root of `my-project`, create a custom contract using OpenZeppelin Compact modules.
Import the modules through `./node_modules/@openzeppelin/compact-contracts/...`.

```typescript
// MyContract.compact

pragma language_version >= 0.21.0;

import CompactStandardLibrary;
import "./node_modules/@openzeppelin/compact-contracts/access/Ownable"
  prefix Ownable_;
import "./node_modules/@openzeppelin/compact-contracts/security/Pausable"
  prefix Pausable_;
import "./node_modules/@openzeppelin/compact-contracts/token/FungibleToken"
  prefix FungibleToken_;

constructor(
  _name: Opaque<"string">,
  _symbol: Opaque<"string">,
  _decimals: Uint<8>,
  _recipient: Either<Bytes<32>, ContractAddress>,
  _amount: Uint<128>,
  _initOwner: Either<Bytes<32>, ContractAddress>,
) {
  Ownable_initialize(_initOwner);
  FungibleToken_initialize(_name, _symbol, _decimals);
  FungibleToken__mint(_recipient, _amount);
}

/** IFungibleToken */

export circuit name(): Opaque<"string"> {
  return FungibleToken_name();
}

export circuit symbol(): Opaque<"string"> {
  return FungibleToken_symbol();
}

export circuit decimals(): Uint<8> {
  return FungibleToken_decimals();
}

export circuit totalSupply(): Uint<128> {
  return FungibleToken_totalSupply();
}

export circuit balanceOf(account: Either<Bytes<32>, ContractAddress>): Uint<128> {
  return FungibleToken_balanceOf(account);
}

export circuit allowance(
  owner: Either<Bytes<32>, ContractAddress>,
  spender: Either<Bytes<32>, ContractAddress>
): Uint<128> {
  return FungibleToken_allowance(owner, spender);
}

export circuit transfer(
  to: Either<Bytes<32>, ContractAddress>,
  value: Uint<128>,
): Boolean {
  Pausable_assertNotPaused();
  return FungibleToken_transfer(to, value);
}

export circuit transferFrom(
  fromAddress: Either<Bytes<32>, ContractAddress>,
  to: Either<Bytes<32>, ContractAddress>,
  value: Uint<128>
): Boolean {
  Pausable_assertNotPaused();
  return FungibleToken_transferFrom(fromAddress, to, value);
}

export circuit approve(spender: Either<Bytes<32>, ContractAddress>, value: Uint<128>): Boolean {
  Pausable_assertNotPaused();
  return FungibleToken_approve(spender, value);
}

/** IOwnable */

export circuit owner(): Either<Bytes<32>, ContractAddress> {
  return Ownable_owner();
}

export circuit transferOwnership(newOwner: Either<Bytes<32>, ContractAddress>): [] {
  return Ownable_transferOwnership(newOwner);
}

export circuit renounceOwnership(): [] {
  return Ownable_renounceOwnership();
}

/** IPausable */

export circuit pause(): [] {
  Ownable_assertOnlyOwner();
  Pausable__pause();
}

export circuit unpause(): [] {
  Ownable_assertOnlyOwner();
  Pausable__unpause();
}
```

### Compile the contract

Compile the contract.

```bash
% compact compile MyContract.compact artifacts/MyContract
Compiling 14 circuits:
  circuit "allowance" (k=11, rows=1352)
  circuit "approve" (k=13, rows=3080)
  circuit "balanceOf" (k=10, rows=673)
  circuit "decimals" (k=6, rows=28)
  circuit "name" (k=6, rows=28)
  circuit "owner" (k=7, rows=76)
  circuit "pause" (k=13, rows=2365)
  circuit "renounceOwnership" (k=13, rows=2364)
  circuit "symbol" (k=6, rows=28)
  circuit "totalSupply" (k=6, rows=28)
  circuit "transfer" (k=13, rows=3990)
  circuit "transferFrom" (k=13, rows=4977)
  circuit "transferOwnership" (k=13, rows=2959)
  circuit "unpause" (k=13, rows=2362)
Overall progress [====================] 14/14
```

## Development

OpenZeppelin Contracts for Compact exists thanks to its contributors.
There are many ways you can participate and help build high quality software,
make sure to check out the [contribution guide](CONTRIBUTING.md) in advance.

> ### Requirements
>
> - [Node.js](https://nodejs.org/)
> - [Yarn](https://yarnpkg.com/getting-started/install)
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
yarn compact
```

### Run tests

```bash
yarn test
```

### Check/apply Biome formatter

```bash
yarn fmt-and-lint
yarn fmt-and-lint:fix
```

### Advanced

#### Targeted compilation

```bash
yarn compact:access
yarn compact:archive
...
```

#### Skip ZK prover/verifier keys

ZK key generation is slow and usually unnecessary during development.

```bash
# Full compilation with skip-zk (use environment variable)
SKIP_ZK=true yarn compact

# Access compilation with skip-zk (this compiles security first as a dependency)
SKIP_ZK=true yarn compact:access
```

#### Clean environment

```bash
# WARNING!
# These are destructive commands
yarn clean
rm -rf .turbo/
```

### Troubleshooting

- **Issues with turbo's cache?** Try cleaning: `yarn clean && rm -rf .turbo/`
- **Node version issues?** Use `nvm use` to switch to the correct version

## Security

This project is still in a very early and experimental phase. It has never been audited nor thoroughly reviewed for security vulnerabilities. DO NOT USE IT IN PRODUCTION.

Please report any security issues you find to <security@openzeppelin.com>.

### Provenance

Releases are published from GitHub Actions with [npm provenance](https://docs.npmjs.com/generating-provenance-statements) enabled. Each published version carries a signed attestation in the public Sigstore transparency log linking the package to its source commit and build workflow run. View the verified source commit, build, and transparency-log links in the **Provenance** panel on the [npm package page](https://www.npmjs.com/package/@openzeppelin/compact-contracts).
