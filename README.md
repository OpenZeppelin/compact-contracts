# OpenZeppelin Contracts for Midnight

**A library for secure smart contract development** written in Compact for [Midnight](https://midnight.network/).

> ## ⚠️ WARNING! ⚠️
>
> This repo contains highly experimental code.
> Expect rapid iteration.
> **Use at your own risk.**

## Development

> ### Requirements
>
> - [node](https://nodejs.org/)
> - [yarn](https://yarnpkg.com/getting-started/install)
> - [compact](https://docs.midnight.network/develop/tutorial/building/#midnight-compact-compiler)

Clone the repository:

```bash
git clone git@github.com:OpenZeppelin/midnight-contracts.git
```

`cd` into it and then install dependencies, prepare compiler, and compile:

```bash
yarn && \
yarn run prepare && \
npx turbo compact
```

### Run tests

```bash
npx turbo test
```

## Security

This project is still in a very early and experimental phase. It has never been audited nor thoroughly reviewed for security vulnerabilities. DO NOT USE IT IN PRODUCTION.

Please report any security issues you find to <security@openzeppelin.com>.
