# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

## 0.3.0-alpha (2026-06-30)

### Added

- Native shielded token standard implementing `MIP-0011`, with opt-in supply and derived-nonce extensions. (#621)
- Add blocklist (#626)
- Add allowList (#625)
- Add ElGamal module (#617)
- Multisig contract suite under `contracts/src/multisig/`: configurable M-of-N `Signer` / `SignerManager` registry, `ProposalManager`, stateful `ShieldedTreasury` and `ShieldedTreasuryStateless`, `UnshieldedTreasury`, `Forwarder` + `ForwarderPrivate` modules with per-recipient presets, and the `ShieldedMultiSig` / `ShieldedMultiSigV2` presets. Signature verification is stubbed pending ECDSA + Keccak primitives (#475). (#378, #424, #526)

### Changed

- Upgrade the Compact toolchain and Midnight dependencies: compiler `0.29.0` → `0.31.0`, `@midnight-ntwrk/compact-runtime` `0.14.0` → `0.16.0`, `@midnight-ntwrk/ledger-v7` `7.0.3` → `@midnight-ntwrk/ledger-v8` `8.1.0`, and `@openzeppelin/compact-simulator` `^0.0.1` → `^0.2.0`. Contract `pragma language_version` raised `>= 0.21.0` → `>= 0.23.0` (the language version shipped with compiler 0.31.0).
- Migrate the unit test suites to the async, backend-aware simulator API so they can run against both the dry-run and live Midnight backends. (#620, #631)

### Fixed

- Resolve zero-value revert audit findings L-01 and L-02 in the token modules. (#616)

## 0.2.0 (2026-06-12)

### Changed

- **Breaking:** Each module now owns its `_isInitialized` ledger flag. The shared `Initializable__isInitialized` public ledger key is replaced by per-module keys (`Ownable__isInitialized`, `ZOwnablePK__isInitialized`, `ShieldedAccessControl__isInitialized`, `FungibleToken__isInitialized`, `NonFungibleToken__isInitialized`, `MultiToken__isInitialized`), fixing a state collision when two modules import the shared `Initializable` from the same directory (compiler [LFDT-Minokawa/compact#270](https://github.com/LFDT-Minokawa/compact/issues/270)). Fixes #556. (#562)
- Replace the Turbo task runner with Yarn-based commands across the docs, CI workflows, and devcontainer. Fixes #572. (#576)
- Batch Dependabot bumps for GitHub Actions and dev dependencies. (#553)

## 0.1.0 (2026-06-05)

### Changes

- Add defensive Buffer copy to ZOwnablePKWitnesses (#397)
- Disclose commitment instead of raw owner id in `_transferOwnership` in ZOwnablePK (#397)
- Use generic ledger type in ZOwnablePKWitnesses (#389)
- Bump compact compiler to v0.29.0 (#366)

## 0.0.1-alpha.1 (2025-12-2)

### Added

- @tsconfig/node24 to @openzeppelin-compact/contracts, @openzeppelin-compact/compact, @openzeppelin-compact/contracts-simulator (#278)
- OpenZeppelin Compact Simulator (#247)

### Changed

- Bump compact compiler to v0.25.0 (#233)
- Bump .nvmrc to v24.9.0 (#278)
- Upgrade @types/node 22.18.0 -> 24.9.0 in openzeppelin-compact, @openzeppelin-compact/contracts, @openzeppelin-compact/compact, @openzeppelin-compact/contracts-simulator (#278)
- Bump node version requirement to >=22 in @openzeppelin-compact/contracts and @openzeppelin-compact/contracts-simulator (#278)

### Removed

- @tsconfig/node22 from @openzeppelin-compact/contracts, @openzeppelin-compact/compact, @openzeppelin-compact/contracts-simulator (#278)
- Bump compact compiler to v0.26.0 (#279)
- Upgrade @midnight-ntwrk/compact-runtime ^0.8.1 -> ^0.9.0 (#279)
- Move @openzeppelin-compact/compact to its own package in the package/compact dir (#247)
