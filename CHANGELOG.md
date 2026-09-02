# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- Add the `crypto/Ecdsa` module, which supplies the low-s constraint the `secp256k1EcdsaVerify` standard-library primitive leaves to its callers: `isLowS`, `assertLowS`, and the combined `secp256k1EcdsaVerifyLowS`. `EcdsaSignerManager` verifies approvals through `secp256k1EcdsaVerifyLowS`, so `ShieldedMultiSigV2` and `ShieldedMultiSigV3` reject the high-s encoding of an otherwise valid signature (as `Multisig: invalid signature`). `compile:crypto` passes `--feature-zkir-v3`, since the `Secp256k1` types live in the ZKIR v3 library. (#842)

### Changed

- **Breaking:** Verify `ShieldedMultiSigV2` and `ShieldedMultiSigV3` approvals with `secp256k1EcdsaVerifyLowS` from the new `crypto/Ecdsa` module, removing `stubVerifySignature` from both presets. `execute` / `mint` / `burn` now take `Vector<2, Secp256k1Point>` public keys and `Vector<2, Secp256k1EcdsaSignature>` signatures, and signer commitments hash the public-key coordinates (`pkX`, `pkY`) instead of a `Bytes<64>` key. `ShieldedMultiSigV2`'s `execute` digest is now domain-separated and bound to the contract instance (`kernel.self()`) and the full recipient (kind and address). Both presets share the verification logic through the new `EcdsaSignerManager` module, which unifies the signer-commitment domain separator on `multisig:signer:`; `ShieldedMultiSigV2` previously used `MultiSig:signer:`, so its commitments change again. The module owns the instance salt and the signer registry, so `ShieldedMultiSigV3`'s `ledger()` reader no longer exposes `_instanceSalt`, and `ShieldedMultiSigV2` no longer exports the `VerificationState` and `SignerCommitmentInput` structs, which were part of its generated artifact types. These primitives require ZKIR v3, so `compile:multisig` now passes `--feature-zkir-v3`. (#826)
- Upgrade the Compact toolchain and Midnight dependencies: compiler `0.31.0` → `0.34.0`, `@midnight-ntwrk/compact-runtime` `0.16.0` → `0.19.0`, `@midnight-ntwrk/ledger-v8` `8.1.0` → `@midnightntwrk/ledger-v9` `1.0.0-rc.3`, `@midnight-ntwrk/compact-js` `2.5.1` → `2.5.5-rc.8`, the `midnight-js` packages `4.1.1` → `5.0.0-beta.7`, and `@openzeppelin/compact-simulator` `^0.3.1` → `^0.4.0`. Contract `pragma language_version` raised `>= 0.23.0` → `>= 0.26.0` (the language version shipped with compiler 0.34.0). (#841)

### Known issues

- Compiler 0.34.0 emits ZKIR v2 by default, and this release targets v2. Only `crypto/Ecdsa`, `multisig/EcdsaSignerManager` and the `ShieldedMultiSigV2` / `ShieldedMultiSigV3` presets need `--feature-zkir-v3`, because the `Secp256k1` types live in the v3 library; `compile:crypto` and `compile:multisig` pass it.
- Under `--feature-zkir-v3`, any impure circuit that reaches `ElGamal.encryptPoint` (notably `ConfidentialFungibleToken`) fails at key generation with `Unsupported test_eq: JubjubScalar == JubjubScalar`, because the ZKIR v3 backend has no `JubjubScalar` equality ([LFDT-Minokawa/compact#757](https://github.com/LFDT-Minokawa/compact/issues/757)). A source-level fix, comparing the derived point instead of the scalar, lands in the next release.
- Under `--feature-zkir-v3`, exporting `ElGamal.derivePk` as an impure circuit panics with `ZkStdLibArch must enable jubjub` ([LFDT-Minokawa/compact#616](https://github.com/LFDT-Minokawa/compact/issues/616)). There is no source workaround.
- `@openzeppelin/compact-cli` `0.0.3` pins `@openzeppelin/compact-builder` to `0.0.4`, which reports a failed compile as success on Linux and writes no artifact. This is fixed in `compact-builder` `0.0.5` ([OpenZeppelin/compact-tools#162](https://github.com/OpenZeppelin/compact-tools/pull/162)); a `compact-cli` patch release picking it up follows, after which this repo bumps it. Until then, check that `artifacts/<Name>/compiler/contract-info.json` exists after a compile.

## 0.3.0-alpha.2 (2026-08-11)

### Changed

- Remove the initialization guard from `Signer`'s `assertSigner`, `assertThresholdMet`, `getSignerCount`, and `getThreshold` (#761)
- Consolidate the duplicate multisig signer registries onto `Signer`, removing `SignerManager` (#760)
- Rename the native shielded token supply extensions to `NativeShieldedTokenPublicSupply` / `NativeShieldedTokenFamilyPublicSupply` (and the shared `NativeShieldedTokenPublicSupplyCore`), making explicit that they track supply on-chain and matching the `ConfidentialFungibleTokenPublicSupply` naming. (#710)

### Fixed

- Guard `UnshieldedTreasury` on its tracked balance instead of the protocol balance, fixing a runtime failure that made deposits revert (#762)

## 0.3.0-alpha.1 (2026-07-21)

### Added

- Add Confidential Fungible Token (#653)
- Add EcdhMask (#655)

### Changed

- Rename the contract-compilation scripts and Turbo tasks from `compact` / `compact:*` to `compile` / `compile:*`, and the Biome scripts from `fmt-and-lint` / `fmt-and-lint:*` to `lint` / `lint:*`. (#680)

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
