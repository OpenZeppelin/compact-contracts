# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- Add `account/Account`: the `Account` type (`Either<Bytes<32>, ContractAddress>`) and the `PublicKey` type (`Bytes<32>`), with the pure accessors `publicKeyOf` and `contractAddressOf`. Each accessor fails on the other arm. (#1243)
- Add the `crypto/prf` modules: `PrfCore.evaluate<T, K>(input, key)` hashes an input under a secret key, and `PrfAddr.derivePk<S>(domain, salt, sk)` derives a 32-byte key under a purpose tag and a salt. (#1243)
- Add the `crypto/authentication` modules. `interfaces/IAuthenticator` defines the `Caller` struct and the contract type an authenticator satisfies. `AuthPrfAddr.authenticate(salt)` authenticates by knowledge of a secret key (`wit_AuthPrfAddrSK`) and exports a pure `deriveAccount` for off-chain use. (#1243)
- Add `crypto/prf/PrfExpand`: `expand<T>(domain, slot, context, seed)` derives independent values from one seed. (#1244)
- Add `crypto/commitment/HashCommitment`: `commit<M>(domain, message, randomness)` commits to a message under a mandatory purpose tag. (#1244)
- Add `crypto/randomness/RandPrfExpand`: `derive<T>(domain, slot, context)` expands the seed that `wit_RandPrfExpandSeed` returns, one seed witness for every module of a contract. A zero seed fails with `RandPrfExpand: zero seed`. (#1244)
- Add the `CustodialConfidentialNoteFungibleToken<#depth>` preset and its example: the issuer, the `Ownable` owner, mints notes, and holders transfer and burn their own. Callers authenticate through `AuthPrfAddr` under two salts, one for the issuer and one for note ownership. (#1244)

### Changed (breaking)

- Upgrade the Compact toolchain and Midnight dependencies:
  - compiler `0.34.0` → `0.36.0` (language `0.28.0`, ZKIR v3 only)
  - `@midnight-ntwrk/compact-runtime` `0.19.0` → `0.21.0`
  - `@openzeppelin/compact-simulator` `^0.4.1` → `^0.5.0`
  - `@openzeppelin/compact-cli` `^0.1.1` → `^0.2.0`
  - `@openzeppelin/compact-deployer` `^0.3.1` → `^0.4.0`
  Every module now declares `pragma language_version >= 0.28.0`, the language of compiler 0.36.0, so an older compiler rejects it with a version error. Artifacts built with an older compiler fail the runtime version check and must be rebuilt, and `--feature-zkir-v3` is now a compiler error. A contract already deployed with ZKIR v2 verifier keys cannot be called with the rebuilt artifacts until its keys are rotated through the CMA (`VerifierKeyRemove` and `VerifierKeyInsert` per circuit) or it is redeployed; a contract that makes cross-contract calls must also have its old keys removed, since proofs under them do not bind the callee circuit (#1229)
- CFT: replace `register()` with `registerWithKey(pk: JubjubPoint)`, which takes the caller's encryption public key and checks it against the key derived from `wit_ConfidentialTokenEK` with `ElGamal.assertKeyPair` (`ElGamal: ek/pk mismatch`). Callers derive `pk` off-chain, either through a re-exported pure `ElGamal_derivePk` via the generated `pureCircuits` or by mirroring `ElGamal.derivePk` in the client (#1228)
- `Ecdsa.secp256k1EcdsaVerifyLowS` fails with `Secp256k1Point identity is not a permitted secp256k1EcdsaVerify verification key` when the key is the identity point, where it used to return `false`. The standard library asserts this since toolchain 0.35.0. (#1229)
- `Ownable`, `AccessControl`, `ShieldedAccessControl`, `FungibleToken`, `NonFungibleToken`, `MultiToken` and `ConfidentialFungibleToken` take the caller as an argument. Each circuit that acts for the caller has a `Caller` first parameter, which the contract produces once per circuit with an authenticator such as `AuthPrfAddr.authenticate(salt)`, so composed modules always act for one identity. The key witnesses are removed (`wit_OwnableSK`, `wit_AccessControlSK`, `wit_secretKey`, `wit_FungibleTokenSK`, `wit_NonFungibleTokenSK`, `wit_MultiTokenSK`, `wit_ConfidentialTokenSK`), and so is `computeAccountId` in `Utils`, `ShieldedAccessControl` and `ConfidentialFungibleToken`: `AuthPrfAddr.deriveAccount(secretKey, salt)` replaces it. The authenticator derives the account id under a tag and a salt, so every stored id changes: fresh deploys only. `ShieldedAccessControl` and `ConfidentialFungibleToken` reject a contract caller with `Account: contract account`. `Ownable.assertOnlyOwner` rejects the zero account, so no caller passes once ownership is renounced. A circuit authenticating through `AuthPrfAddr` costs about 1,900 rows more than the in-module hash did (none more in `ShieldedAccessControl`), and a circuit driving several modules pays it once (#1243)
- `Allowlist` and `Blocklist` key their sets by account: every circuit takes an `Either<Bytes<32>, ContractAddress>` in place of a `Bytes<32>`, canonicalized on read and write, so a contract address can be listed. A 32-byte id is passed as `left<Bytes<32>, ContractAddress>(id)`. Ledger layout changes, so fresh deploys only (#1243)
- `ConfidentialNoteFungibleToken<#depth, T>` is note machinery only: the owner key type `T` is an import generic, and the module holds no identity, no setup and no witness. `initialize`, `derivePk`, `_spenderPk` and `_inputNote` are removed, with `_isInitialized`, `_instanceSalt` and the four witnesses. The gated `transfer` and `burn` and the caller-built-note `_transfer` and `_burn` give way to `_transfer(spenderPk, recipientPk, value, note, path)` and `_burn(spenderPk, value, note, path)`, and `_consumeNote` is `_consumeNote(note, ownerPk, path)`: a spend takes its input note and Merkle path as arguments, and a wrong note, key or path fails with `ConfidentialNoteFungibleToken: input root not recognized`. `Note`, `commitOf`, `nullifierOf` and `issuedTagOf` move to the new `token/utils/ConfidentialNoteFungibleTokenUtils`. Default nonces come from `RandPrfExpand` (`wit_RandPrfExpandSeed`). The note commitment is a `HashCommitment`, so every commitment changes, while nullifiers and issued tags do not. Ledger layout changes, so fresh deploys only (#1244)
- `ConfidentialNoteFungibleTokenDelivery._deliver` derives its ephemeral from `RandPrfExpand`, bound to the nonce, the key and the value, in place of `wit_ConfidentialNoteDeliveryRandomness`. The `Delivery` entry format is unchanged (#1244)

### Known issues

- Under toolchain 0.36.0, circuits that verify secp256k1 ECDSA cost about 49% more rows: `Ecdsa.secp256k1EcdsaVerifyLowS` goes from 34,056 to 50,859, and `Secp256k1EcdsaMultisig.assertApprovals` at `t = 3`, `NativeShieldedTokenIssuer.burn` / `burnFromSelf` and `NativeShieldedStatelessTreasury.execute` cross from k=17 to k=18, roughly doubling their proving time. Most of it is the standard library's identity-key check in `secp256k1EcdsaVerify`
- Under toolchain 0.36.0, key generation panics with `ZkStdLibArch must enable jubjub` for any circuit that produces Jubjub points without taking a `JubjubScalar` or `JubjubPoint` input, as an argument, a witness value or a ledger read ([LFDT-Minokawa/compact#616](https://github.com/LFDT-Minokawa/compact/issues/616)). No library circuit is affected, but a consumer circuit that derives a key from a secret and stores it reaches the same shape through `ElGamal.secretToScalar`, `derivePk`, `expandRandomness` or `encryptZero`; take the key as an argument and check it with `ElGamal.assertKeyPair` instead, as `ConfidentialFungibleToken.registerWithKey` does, or give the circuit an otherwise unused `JubjubScalar` argument or witness value. There is no v2 backend to fall back to

## 0.5.0-alpha.2 (2026-11-04)

### Added

- Add the `math/UintN<N>` module: `wrappingAdd` and `wrappingSub` compute `(a ± b) mod 2^N` on `Uint<N>` for any width and never fail, and `MODULUS` returns `2^N` as a `Field`. (#1189)
- Add the `ConfidentialNoteFungibleTokenDelivery` extension: `_deliver` publishes an output note's `(value, nonce)` to the `_deliveries` list, padded under one nonce-bound ECDH ephemeral and two `EcdhMask.kdf` masks to the owner's Jubjub key, and the pure `recoverNote` opens an entry off-chain, so a wallet finds its notes by scanning the chain. (#1183)

### Changed

- `EcdhMask.kdf` is `kdfFromDigest(pointDigest(S), domain)`, both exported, so a consumer deriving several masks from one shared point digests it once. Masks are unchanged. (#1183)
- `EcdhMask.encrypt` takes a `Uint<248>` value instead of a `Uint<128>`, the full range of its 248-bit pad. Ciphertexts for `Uint<128>` values are unchanged. The hiding margin shrinks with the value's width and is gone at the full 248 bits. (#1150)
- `ElGamal.encryptPoint` takes its ephemeral and mask from `Ecdh.deriveShared`, so its weak-input guards now read `Ecdh: identity pk` / `Ecdh: zero ephemeral` instead of `ElGamal: identity pk` / `ElGamal: zero randomness`. Ciphertexts are unchanged. (#1110)
- **Breaking:** Rename the `ShieldedMultiSigV2` preset module to `NativeShieldedStatelessTreasury`, and its example to `NativeShieldedStatelessTreasuryExample`. The EIP-712 domain name changes with it, so `_domainSeparator` and every `execute` digest change: existing signatures must be re-signed. `execute`'s recipient error reads `NativeShieldedStatelessTreasury: recipient must be a coin public key`. `_nonce` is exported, and the example's `ledger()` exposes it. (#891)

### Fixed

- Compile each module into its own artifact subtree, mirroring `src/` (`artifacts/token/test/mocks/MockFungibleToken/`), and cache each `compile:*` task on that subtree alone. The tasks shared `artifacts/**` as their turbo output, so one task's cache pack or restore truncated ZK keys a sibling was still writing. The aggregate `compile` script, which recompiled `access`, `security`, `token` and `utils` a second time, is removed. The `compile:*` scripts pin the toolchain CI installs (`+0.34.0`), so the cache key carries the compiler version, and clear their subtree first, so a deleted source leaves no orphan in the cache. Fixes #675.

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
