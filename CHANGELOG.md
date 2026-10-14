# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- Add the `math` category, ported from [midnight-apps `contracts/src/math`](https://github.com/OpenZeppelin/midnight-apps/tree/7de45ab1afb34b2b101767f7c987ef79c555be10/contracts/src/math): `Types`, `Pack<N>`, `Bytes8`, `Uint64`, `Uint128`, `Uint256`, `Bytes32` and `Field255`. Circuit, struct and witness names, signatures and assert messages are unchanged. The [math guide](contracts/src/math/README.md) lists the witnesses and the `disclose()` needs of every circuit, and the [migration guide](contracts/src/math/MIGRATION.md) maps the source API (#1125, #1126, #1127, #1128, #1143)

### Changed

- `Uint128.sqrt` (`Uint<128>` form) checks the witness root with native arithmetic. It makes 2 witness calls instead of 15. Results and messages for valid inputs are unchanged. Rows (v2 / v3): 4125 / 1206 to 596 / 213 (#1147)
- `Uint128.div`, `rem`, `divRem` and `isMultiple` (`Uint<128>` forms) check the result of `wit_divUint128(a, b)` with native arithmetic. They call `wit_divUint128` with the divisor `b`, so a consumer `wit_divUint128` must implement a general division, as the reference does; a witness that only splits at 2^64 makes these forms fail. They make one witness call instead of 10, and a consumer that uses no other circuit that needs `wit_divU128` can drop that witness. Results and messages for valid inputs are unchanged. For an incorrect witness result: the forms no longer split `a` and `b` or call `wit_divU128`, so a wrong split or a replaced `wit_divU128` result no longer fails them with `Uint128: conversion invalid` or a division message (they return the honest result); the first `wit_divUint128` call is now the division, so an incorrect result of that call fails with the first failing message of the `U128` form, for example `Uint128: remainder error`. Rows (v2 / v3): `div` 3356 / 1017 to 845 / 287, `divRem` 3269 / 1026 to 886 / 328 (#1146)
- `Uint128.addChecked` (both overloads) computes the sum with native addition. It is a `pure circuit`, makes no witness call and its result is not witness-tainted. Every honest input keeps its result and its `Uint128: addition overflow` message; an incorrect `wit_divUint128` result can no longer fail it with `Uint128: conversion invalid` (#1141)

### Deprecated

- `Utils.UINT128_MAX`: use `Uint128.MAX_UINT128` from `math/Uint128`, which returns the same value. It stays callable (#1145)
- Math circuits with an equal native expression and no library failure message, listed with their replacements in the [migration guide](contracts/src/math/MIGRATION.md#deprecated-circuits): `Pack.pack`, `Bytes8.pack` and `toUint64(Vector<8, Uint<8>>)`, `Uint64.add`, `mul`, `min` and `max`, `Uint128.ZERO_U128`, `toUint128` and both forms of `eq`, `lt`, `lte`, `gt`, `gte`, `isZero`, `min` and `max`, `Uint256.ZERO_U256`, `eq`, `lt`, `lte`, `gt` and `gte`, `Bytes32.pack`, `toU256(Vector<32, Uint<8>>)`, `eq` and `isZero`, `Field255.toBytes`, `eq` and `isZero`. They stay callable (#1142)

### Fixed

- Math fixes over the source library (see the [migration guide](contracts/src/math/MIGRATION.md#fixes)):
  - `Uint128.sub(U128)` computes the low limb without a branch, so `sub(U128)` and every `Uint128` division prove also with compilers that range-check a downcast in an untaken branch ([midnight-apps#309](https://github.com/OpenZeppelin/midnight-apps/pull/309), #1127)
  - `Uint128._mul` adds each result word in one step: 7 limb splits instead of 9, fewer rows for every multiplication, division and square root (audit finding L-06, [midnight-apps#313](https://github.com/OpenZeppelin/midnight-apps/pull/313), #1127)
  - An incorrect `Uint64` division witness whose sum exceeds 64 bits fails with `Uint64: division invalid` instead of a cast error (#1126)
  - An incorrect `Uint128` quotient that passes the remainder check and whose product with `b` fits in 128 bits but exceeds the dividend fails with `Uint128: division invalid` instead of `Uint128: subtraction underflow` (#1127)
  - Doc comment corrections, including the typos of audit finding N-01 ([midnight-apps#312](https://github.com/OpenZeppelin/midnight-apps/pull/312), #1126, #1127, #1128)

## 0.5.0-alpha.1 (2026-10-13)

### Added

- Add Confidential Note Fungible Token core (#743)
- Add the `crypto/Ecdh` module, the Jubjub key agreement that `crypto/EcdhMask` used to carry inline: `deriveShared` (sender side, owns the identity-key and zero-ephemeral guards), `recoverShared` (recipient side, never asserts), and the `SharedSecret` struct. `EcdhMask.encrypt` and `decrypt` delegate to it and produce the same ciphertexts as before; the guard messages now read `Ecdh: identity pk` / `Ecdh: zero ephemeral`. (#866)

### Changed

- `EcdhMask.decrypt` rejects a ciphertext whose ephemeral is the identity point as `EcdhMask: identity ephemeral`. `encrypt` never emits one; decrypting it returned a public constant far above any `Uint<128>`. (#866)
- `ShieldedAccessControl`: re-granting an active `(role, accountId)` pairing is a no-op. Granted nullifiers are tracked in `_grantedRoleNullifiers`, so one pairing can never consume more than one `_operatorRoles` slot (#1071)

## 0.4.0-alpha.6 (2026-10-06)

### Added

- `ZOwnableNativeShieldedToken` preset and example: a native shielded token that a single `ZOwnablePK` owner mints and burns, with a public minted total and no burned total (#1022)

### Changed

- **Breaking:** Rename `EcdsaSignerManager` to `Secp256k1EcdsaMultisig<#t>`, with the threshold `t` as the import generic and errors prefixed `Secp256k1EcdsaMultisig:` (#1052, #1058)
  - `initialize<#n>(instanceSalt, signerCommitments)` drops the threshold argument
  - `assertApprovals` verifies exactly `t` distinct registered approvals
  - The signer commitment domain is `Secp256k1EcdsaMultisig:signer`, so every signer commitment changes
- **Breaking:** `ShieldedMultiSigV2<#t>` and `NativeShieldedTokenIssuer<#t>` take the threshold as a module generic, and the examples fix 2-of-3 (#1052)
  - `initialize` drops the threshold argument
  - `execute`, `mint`, `mintToSelf`, `burn` and `burnFromSelf` take `Vector<t>` keys and signatures
  - `execute`'s recipient error reads `ShieldedMultiSigV2: recipient must be a coin public key`
- **Breaking:** `ZOwnablePK.initialize` rejects a zero `instanceSalt` as `ZOwnablePK: invalid salt`. A zero salt gave deployments that share an owner id the same public owner commitment. (#1054)

## 0.4.0-alpha.5 (2026-09-29)

### Changed

- **Breaking:** `ShieldedMultiSigV2.execute` rejects a `Contract` recipient as `Multisig: recipient must be a coin public key`. A contract-addressed coin is unclaimable, so the node rejected every such execution. (#1034)
- **Breaking:** `NativeShieldedTokenIssuer.burnFromSelf` binds the spent coin. The `BurnFromSelf` struct gains `coinNonce` and `coinValue`, so an approval authorizes one held coin and existing burn-from-self signatures no longer verify. (#993)
- **Breaking:** `ForwarderShielded._deposit` returns the forward's `ShieldedSendResult` instead of `[]`, and `ForwarderShieldedExample.deposit` returns it too (#999)
- **Breaking:** `UnshieldedTreasury._send` rejects a zero amount, which the ledger refuses as a zero-value output (#980)

### Fixed

- `NativeShieldedTokenIssuer.burn` and `burnFromSelf` take a `Uint<128>` amount, the shielded coin value range. Digests for amounts that fit `Uint<64>` are unchanged. (#1033)
- Drop the duplicate `receiveShielded` on self-addressed `NativeShieldedTokenCore._mint` and `_burn` coins. `mintShieldedToken` and `sendShielded` already claim them, so the extra call emitted a second Zswap output for the same commitment. Core `_mint` drops from k=15 to k=14. (#1017)
- `EcdsaSignerManager.initialize` rejects signer sets smaller than 2 and any threshold other than 2. `assertApprovals` always verifies two signatures, so a smaller set could never pass and a stored threshold of 1 was never honored. (#1011)

## 0.4.0-alpha.4 (2026-09-25)

### Changed

- **Breaking:** Rename `NativeShieldedTokenIssuer.burn` to `burnFromSelf` (contract-held coin, EIP-712 struct `BurnFromSelf`). New `burn` burns a holder's coin paid into the transaction and refunds the change to `refundTo`, bound in the new `Burn` struct. `mint` takes a `ZswapCoinPublicKey` recipient and signs the new `Mint` struct (no `isContract` word); new `mintToSelf` mints to the contract itself under `MintToSelf`. The example contract exports all four. (#974)

## 0.4.0-alpha.3 (2026-09-24)

### Changed

- **Breaking:** Change `NativeShieldedToken` / `NativeShieldedTokenFamily` `_mint` recipient and `_burn` refund recipient to `ZswapCoinPublicKey`, add `_mintToSelf`, and restrict `NativeShieldedTokenCore` contract-addressed recipients to the contract itself; `NativeShieldedTokenIssuer.mint` keeps its `Either` recipient and rejects any other contract (#965)
- **Breaking:** Widen the CFT balance claim and ElGamal `assertDecryptsTo` to `Uint<248>`, so a balance accumulated past the per-transfer bound stays spendable. `wit_PlaintextBalance` returns `Uint<248>`. (#961)
- **Breaking:** Domain-separate `ElGamal.secretToScalar` from the account-id hash. Every derived public key changes, so existing CFT registrations and ciphertexts are incompatible. (#964)
- **Breaking:** `ConfidentialFungibleToken.clearMemos` takes `expectedEpoch` and reverts if a credit landed after the memos were read, so unread credits are never cleared. (#962)
- **Breaking:** Derive the `ConfidentialFungibleToken` credit nonce from the new `_creditEpochs` counter instead of the memo count, so `clearMemos` cannot reset it. Ledger layout changes, so fresh deploys only. (#958)
- **Breaking:** Bind the `ConfidentialFungibleToken` escrow-spend randomness to the owner, the spender, and a per-pair epoch in the new `_escrowSpendEpochs` ledger. Ledger layout changes, so fresh deploys only. (#963)
- **Breaking:** `ConfidentialFungibleToken.sweep` and `clearMemos` require the encryption-key witness; the account secret alone no longer authorizes them. (#960)

### Fixed

- `NonFungibleToken._approve` reverts for a nonexistent token even with a zero `auth`. The new `_unsafeApprove` takes an `isExistenceRequired` flag. (#959)

## 0.4.0-alpha.2 (2026-09-23)

### Added

- Add `EvmAbi` and `Eip712` modules (#906)
- `_domainSeparator` ledger field (#906)
  - `ShieldedMultiSigV2`
  - `ShieldedMultiSigV3`

### Changed

- **Breaking:** (#906)
  - `ShieldedMultiSigV2`
    - Sign `execute` as EIP-712 typed data instead of
    a `persistentHash` digest

  - `ShieldedMultiSigV3`
    - Sign `mint` and `burn` as EIP-712 typed data instead of `persistentHash` digests

- **Breaking:** Refactor `ProposalManager` (#780)
  - `Proposal.status` → `state: Uint<64>`, overlaying lifecycle and expiry
  - `_createProposal` / `createShieldedProposal` require `expiry`
  - `getProposalStatus` returns `Inactive` for unknown ids instead of failing

- **Breaking:** Remove `Signer.initialize` and `_isInitialized`; the registry is configured through `_addSigner` / `_changeThreshold` / `_setThreshold` only. `EcdsaSignerManager_initialize` does that configuration itself instead of calling another module's `initialize`, rejects a second call while signers are registered, and `_instanceSalt` is `export sealed`. Ledger slot indices change, so fresh deploys only. (#925)

- **Breaking:** Turn the `ShieldedMultiSigV2` and `ShieldedMultiSigV3` presets into modules, deployable through the new `multisig/examples/` contracts; the forwarder presets move there too. Ledger slot indices change, so fresh deploys only. (#885)
  - Fix the `EcdsaSignerManager` double import in the examples (#928)
- **Breaking:** Rename `ShieldedMultiSigV3` to `NativeShieldedTokenIssuer`, built on `NativeShieldedToken`. New `initialize` signature and EIP-712 domain; `mint` / `burn` return the coin; `getTokenDomain` / `getTokenType` replaced by `tokenColor`, `name`, `symbol`, `decimals`. (#887)

### Removed

- **Breaking:** Remove the `ShieldedMultiSig` preset. A rebuild on `EcdsaSignerManager` is tracked in #905. (#885)

### Fixed

- Bump `@openzeppelin/compact-cli` `^0.0.3` → `^0.1.1`, whose `compact-builder` `0.0.5` fails the build when `compact compile` fails; `0.0.4` reported every failure as `✔ Compiled`. `engines.node` follows the cli to `>=24`. Fixes #894.
- Exclude `crypto/` and `multisig/` from the aggregate `compile` script. They need `--feature-zkir-v3` and are built by `compile:crypto` / `compile:multisig`; recompiling them on v2 emptied their artifact directories. The aggregate cannot move to v3 while `ConfidentialFungibleToken` fails key generation there. `build` passes `--feature-zkir-v3` instead: it excludes mocks, and only the `ConfidentialFungibleToken` mocks hit the v3 key-generation failure. (#899)

## 0.4.0-alpha.1 (2026-09-02)

### Added

- Add the `crypto/Ecdsa` module, which supplies the low-s constraint the `secp256k1EcdsaVerify` standard-library primitive leaves to its callers: `isLowS`, `assertLowS`, and the combined `secp256k1EcdsaVerifyLowS`. `EcdsaSignerManager` verifies approvals through `secp256k1EcdsaVerifyLowS`, so `ShieldedMultiSigV2` and `ShieldedMultiSigV3` reject the high-s encoding of an otherwise valid signature (as `Multisig: invalid signature`). `compile:crypto` passes `--feature-zkir-v3`, since the `Secp256k1` types live in the ZKIR v3 library. (#842)

### Changed

- **Breaking:** Verify `ShieldedMultiSigV2` and `ShieldedMultiSigV3` approvals with `secp256k1EcdsaVerifyLowS` from the new `crypto/Ecdsa` module, removing `stubVerifySignature` from both presets. `execute` / `mint` / `burn` now take `Vector<2, Secp256k1Point>` public keys and `Vector<2, Secp256k1EcdsaSignature>` signatures, and signer commitments hash the public-key coordinates (`pkX`, `pkY`) instead of a `Bytes<64>` key. `ShieldedMultiSigV2`'s `execute` digest is now domain-separated and bound to the contract instance (`kernel.self()`) and the full recipient (kind and address). Both presets share the verification logic through the new `EcdsaSignerManager` module, which unifies the signer-commitment domain separator on `multisig:signer:`; `ShieldedMultiSigV2` previously used `MultiSig:signer:`, so its commitments change again. The module owns the instance salt and the signer registry, so `ShieldedMultiSigV3`'s `ledger()` reader no longer exposes `_instanceSalt`, and `ShieldedMultiSigV2` no longer exports the `VerificationState` and `SignerCommitmentInput` structs, which were part of its generated artifact types. These primitives require ZKIR v3, so `compile:multisig` now passes `--feature-zkir-v3`. (#826)
- Upgrade the Compact toolchain and Midnight dependencies: compiler `0.31.0` → `0.34.0`, `@midnight-ntwrk/compact-runtime` `0.16.0` → `0.19.0`, `@midnight-ntwrk/ledger-v8` `8.1.0` → `@midnightntwrk/ledger-v9` `1.0.0-rc.3`, `@midnight-ntwrk/compact-js` `2.5.1` → `2.5.5-rc.8`, the `midnight-js` packages `4.1.1` → `5.0.0-beta.7`, and `@openzeppelin/compact-simulator` `^0.3.1` → `^0.4.0`. Contract `pragma language_version` raised `>= 0.23.0` → `>= 0.26.0` (the language version shipped with compiler 0.34.0). (#841)

### Known issues

- Compiler 0.34.0 emits ZKIR v2 by default, and this release targets v2. Only `crypto/Ecdsa`, `multisig/EcdsaSignerManager` and the `ShieldedMultiSigV2` / `ShieldedMultiSigV3` presets need `--feature-zkir-v3`, because the `Secp256k1` types live in the v3 library; `compile:crypto` and `compile:multisig` pass it.
- Under `--feature-zkir-v3`, any impure circuit that reaches `ElGamal.encryptPoint` (notably `ConfidentialFungibleToken`) fails at key generation with `Unsupported test_eq: JubjubScalar == JubjubScalar`, because the ZKIR v3 backend has no `JubjubScalar` equality ([LFDT-Minokawa/compact#757](https://github.com/LFDT-Minokawa/compact/issues/757)). A source-level fix, comparing the derived point instead of the scalar, is planned for the next release.
- Under `--feature-zkir-v3`, exporting `ElGamal.derivePk` as an impure circuit panics with `ZkStdLibArch must enable jubjub` ([LFDT-Minokawa/compact#616](https://github.com/LFDT-Minokawa/compact/issues/616)). There is no source workaround.
- `@openzeppelin/compact-cli` `0.0.3` pins `@openzeppelin/compact-builder` to `0.0.4`, which reports a failed compile as success on Linux and writes no artifact. Bumped in Unreleased (#899).

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
