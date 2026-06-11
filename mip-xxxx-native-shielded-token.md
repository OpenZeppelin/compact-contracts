---
MIP: XXXX
Title: Native Shielded Token Standard
Authors:
  - Iskander Andrews (0xisk)
  - Andrew Fleming (andrew-fleming)
Status: Draft
Category: Standards
Created: 2026-06-10
Requires: none
Replaces: none
License: Apache-2.0
---

<!--
 This file is part of midnight-improvement-proposals.
 Copyright (C) 2025-2026 Midnight Foundation
 SPDX-License-Identifier: Apache-2.0
 Licensed under the Apache License, Version 2.0 (the "License");
 You may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
-->

## Abstract

This MIP defines a standard contract interface for **native shielded tokens** on Midnight: tokens that exist exclusively as [Zswap](https://docs.midnight.network/concepts/zswap) shielded [UTXOs](https://docs.midnight.network/concepts/utxo) rather than as balances in contract ledger state. Under this model the issuing contract is not a balance keeper — once minted, coins move wallet-to-wallet at the protocol level with no contract involvement. The contract's role is reduced to four concerns, and this standard specifies all of them: token metadata (`name`, `symbol`, `decimals`, `tokenColor`), issuance (`_mint`, `_mintWithNonce`), destruction (`_burn`, `_burnFromContract`), and honest supply accounting (`totalMinted` — exact, `totalBurned` — a lower bound, `totalSupply` — an upper bound on circulating supply). The interface supports multiple token types per contract via per-call domain separators, distinguishes recipient-public from recipient-private minting, and mandates the correct Zswap spend path for each burn flow (transient spends for coins provided within the transaction, Merkle-tree spends for contract-held coins). A reference implementation is provided as the `NativeShieldedToken` module in the [OpenZeppelin Compact Contracts library](https://github.com/OpenZeppelin/compact-contracts). This standard is complementary to [MIP-0004](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0004-fungible-token-standard-with-utxo.md), which standardizes account-based tokens with UTXO conversion.

## Motivation

Native shielded coins are the asset primitive the Midnight protocol itself operates on: they participate in [Zswap atomic swaps](https://docs.midnight.network/concepts/zswap), transfer peer-to-peer without any contract call, and hide value, sender, and receiver by construction. They are the natural representation for privacy-first assets — phase-one RWA issuance (mint/burn), liquidity-pool share tokens, and confidential payment instruments.

There is currently no standard for *issuing* them. Every project that mints native shielded tokens hand-rolls the same contract surface, and the protocol primitives involved have several non-obvious failure modes that have already appeared in real drafts across the ecosystem:

- **Wrong spend path.** A coin received by the contract within the current transaction is not yet in the global Zswap commitment tree; spending it requires the transient path (`sendImmediateShielded`), not a Merkle-proof spend (`sendShielded`). Conflating the two produces circuits that cannot be satisfied or that trust a caller-supplied Merkle index.
- **Lost coins.** Contract-initiated sends do not create coin ciphertexts, so recipient wallets cannot discover minted or refunded coins by scanning the chain. Interfaces that discard the protocol's returned coin info strand value.
- **Dishonest supply.** Holders can destroy coins by sending them to the burn address without touching the contract, so a contract-tracked "total supply" silently over-reports. Standards that present it as exact mislead indexers and integrators.
- **Commitment collisions.** Coin nonces derived from public ledger state are predictable; without care, caller-supplied and contract-derived nonces share one namespace and can be made to collide, causing mint transactions to be rejected.

Existing standards do not cover this asset class. The [OpenZeppelin FungibleToken](https://github.com/OpenZeppelin/compact-contracts/blob/main/contracts/src/token/FungibleToken.compact) is account-based, and [MIP-0004](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0004-fungible-token-standard-with-utxo.md) extends it with conversions between Map balances and UTXOs — the account model remains the source of truth. For tokens that should exist *only* in native shielded form, no interface exists. This MIP fills that gap with a minimal, composable mint/burn standard that encodes the correct protocol usage and states its privacy and accounting guarantees honestly.

## Specification

### Terminology

- **Native shielded token**: A class of Zswap coins sharing one **color**, minted by a contract. Managed by the Midnight protocol layer, not by contract ledger state.
- **Color (token type)**: `tokenType(domain, contractAddress)` per the [Compact Standard Library](https://docs.midnight.network/compact). Only the contract at `contractAddress` can ever mint coins of its colors.
- **Domain separator (`domain`)**: A 32-byte value that, together with the contract address, identifies one token type. A single contract MAY issue multiple token types by using multiple domains.
- **Same-tx coin**: A coin whose commitment is created by an output of the *current* transaction (e.g. a user's wallet pays the contract). Such a coin is not yet in the global commitment tree and MUST be spent via the transient path (`sendImmediateShielded`).
- **Contract-held coin**: A coin owned by the contract with a commitment already in the global Zswap commitment tree, identified by a `QualifiedShieldedCoinInfo` carrying a valid `mt_index`.
- **Burn address**: The all-zero `ZswapCoinPublicKey` returned by `shieldedBurnAddress()`, for which no secret key is known. Coins sent there are unspendable.

### Conformance Profiles

The standard defines two profiles:

- **Fungible profile** (reference module `NativeShieldedToken`): one token type per contract — the ERC-20-shaped common case. The domain separator is fixed at construction as `sealed ledger _domain` and is NOT a circuit parameter, eliminating caller-supplied domain misuse. Supply totals are scalar.
- **Family profile** (reference module `NativeShieldedTokenFamily`): many token types per contract, discriminated by a per-call `domain` parameter. This profile exists because of Midnight's composition model — no contract-to-contract interaction and no way for a contract to deploy another — so multi-asset protocols (e.g. a DEX minting one liquidity-share token per pair) cannot stamp out one token contract per asset and must issue their whole token family from a single contract. Supply totals are per-domain maps.

Both profiles carry the same metadata interface (`name`, `symbol`, `decimals`). In the Family profile these are **family metadata** shared by all token types, following the Uniswap-V2 LP precedent (every pair's LP token carries the same name/symbol/decimals); per-type identity belongs in the consumer's own state, such as a pair registry mapping domain to underlying tokens.

The remaining sections are written domain-parametrically for the Family profile. The Fungible profile is obtained by deleting every `domain` parameter (the stored `_domain` is used instead) and reading `totalMinted(domain)` etc. as the scalar `totalMinted()`. All issuance, burn, nonce, metadata, and supply-bound rules are identical across profiles. Neither profile provides balances, operator approvals, or batch transfers (see [Out of Scope](#out-of-scope)).

### Required State

Family profile (names per the reference implementation):

```typescript
export ledger _counter: Counter;
export ledger _nonce: Bytes<32>;
export ledger _totalMinted: Map<Bytes<32>, Uint<128>>;
export ledger _totalBurned: Map<Bytes<32>, Uint<128>>;

export sealed ledger _name: Opaque<"string">;
export sealed ledger _symbol: Opaque<"string">;
export sealed ledger _decimals: Uint<8>;
```

Fungible profile:

```typescript
export sealed ledger _domain: Bytes<32>;
export ledger _counter: Counter;
export ledger _nonce: Bytes<32>;
export ledger _totalMinted: Uint<128>;
export ledger _totalBurned: Uint<128>;

export sealed ledger _name: Opaque<"string">;
export sealed ledger _symbol: Opaque<"string">;
export sealed ledger _decimals: Uint<8>;
```

- `_counter` / `_nonce`: a monotonically increasing index and an evolving nonce chain seeding internally derived coin nonces. Note that *all* Compact ledger state is public on-chain regardless of `export`; omitting `export` does not hide the nonce. The privacy implications of public nonce derivation are addressed in [Security Considerations](#security-considerations).
- `_totalMinted` / `_totalBurned`: supply accounting (per domain in the Family profile). See [Supply Accounting](#supply-accounting).
- Sealed fields are immutable after construction. In the Fungible profile, the sealed `_domain` write forces token setup into the constructor by the sealed-write rule.

### Construction

This standard does not prescribe an initialization mechanism. How a contract sets up its own state is an implementation concern; only the resulting properties are normative:

1. `name`, `symbol`, and `decimals` (and, in the Fungible profile, the domain separator) MUST be set at construction and immutable thereafter.
2. The internal nonce chain MUST be seeded at construction, and the seed SHOULD be chosen unpredictably (e.g. 32 random bytes).

The reference implementation satisfies both via an `initialize` module circuit invoked once from the consuming contract's constructor.

### Metadata Circuits

```typescript
export circuit name(): Opaque<"string">
export circuit symbol(): Opaque<"string">
export circuit decimals(): Uint<8>

// Family profile
export circuit tokenColor(domain: Bytes<32>): Bytes<32>
// Fungible profile
export circuit tokenColor(): Bytes<32>
```

- In the Family profile, `name`/`symbol`/`decimals` are family metadata shared by all token types (see [Conformance Profiles](#conformance-profiles)). `decimals` applies family-wide; issuers with heterogeneous decimals per token type MUST handle that in their own state.
- `decimals` is a display convention only; the protocol operates on integer values.
- `tokenColor` MUST return `tokenType(domain, kernel.self())`, computed at call time. It exists so integrators and (future) contract-to-contract callers never re-derive the color by hand. Per the finding documented in [MIP-0004](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0004-fungible-token-standard-with-utxo.md), the color MUST NOT be precomputed in the constructor: `kernel.self()` resolves differently during constructor execution.

### Supply Accounting

```typescript
export circuit totalMinted(domain: Bytes<32>): Uint<128>
export circuit totalBurned(domain: Bytes<32>): Uint<128>
export circuit totalSupply(domain: Bytes<32>): Uint<128>
```

Exact circulating supply is not knowable for native shielded tokens: any holder can send coins directly to the burn address without contract involvement. This standard therefore commits to the strongest guarantees available and names them honestly:

- `totalMinted(domain)` is **exact**. Color derivation guarantees every coin of this contract's colors originates from this contract's mint circuits, all of which MUST increment it.
- `totalBurned(domain)` is a **lower bound**: it counts only contract-mediated burns.
- `totalSupply(domain)` MUST equal `totalMinted(domain) - totalBurned(domain)` and is therefore an **upper bound** on circulating supply.

```math
\texttt{circulating}(d) \le \texttt{totalSupply}(d) = \texttt{totalMinted}(d) - \texttt{totalBurned}(d)
```

Good point and fair challenge , but I'd keep it in the base, because the counters don't reveal anything an indexer can't already compute. I built a reproducer to prove this empirically: https://github.com/0xisk/exploring-native-shielded-token-indexing. One command deploys a shielded token on a local v8 stack, mints, burns part of it, and decodes the raw tx bytes into exactly what a public observer sees (a sample decoded report is committed as SAMPLE-OUTPUT.md if you don't want to run it). Result: the mint amount is public in the transcript's shieldedMints effect at the protocol level, and the burn flow discloses the coin value and change, so the burned amount is derivable too. totalMinted/totalBurned are therefore already reconstructable from chain data; the counters just standardize where to read them.

The other half is the one-way trap: Compact ledger layouts are fixed at deploy. A token that ships without the counters can never add them, so "opt in later" doesn't exist on Midnight. I'd rather pay three cheap fields in the base than make supply auditability unrecoverable for every conforming token.

On the title: I'd avoid "auditable". totalSupply is only an upper bound (out-of-band burns to the burn address are invisible to the contract), and the spec is deliberately honest about that. "Auditable" would oversell exactly what we're being careful not to promise.

Implementations MUST maintain: every mint of `amount` under `domain` adds `amount` to `_totalMinted[domain]` (reverting on `Uint<128>` overflow), and every contract-mediated burn of `amount` adds `amount` to `_totalBurned[domain]`. Burned can never exceed minted for the same domain, so the difference cannot underflow. Integrators SHOULD present `totalSupply` as an upper bound, not as exact circulating supply.

### Mint Circuits

```typescript
export circuit _mint(
  domain: Bytes<32>,
  recipient: Either<ZswapCoinPublicKey, ContractAddress>,
  amount: Uint<64>
): ShieldedCoinInfo

export circuit _mintWithNonce(
  domain: Bytes<32>,
  recipient: Either<ZswapCoinPublicKey, ContractAddress>,
  amount: Uint<64>,
  nonce: Bytes<32>
): ShieldedCoinInfo
```

**Common behavior:**

1. MUST revert if `recipient` is the zero key or zero address.
2. MUST add `amount` to `_totalMinted[domain]`, reverting on overflow.
3. MUST call `mintShieldedToken(domain, amount, nonce, recipient)` and return the resulting `ShieldedCoinInfo`.
4. The caller (DApp) MUST deliver the returned coin info to the recipient out of band; wallets cannot detect contract-minted coins by scanning the chain (contract-initiated outputs carry no coin ciphertext).

**`_mint` (derived nonce — recipient-public):**

5. MUST increment `_counter`, evolve the chain (`_nonce = evolveNonce(_counter, _nonce)`), and derive the coin nonce in a domain-separated namespace:

```typescript
coinNonce = persistentHash<Vector<2, Bytes<32>>>(
  [pad(32, "NativeShieldedToken:nonce"), _nonce]
);
```

6. Because every derivation input is public, the resulting coin commitment is recomputable by enumerating candidate recipient keys: `_mint` MUST be documented as **recipient-public**.

**`_mintWithNonce` (caller nonce — recipient-private):**

7. The caller is responsible for nonce uniqueness; reusing a nonce for the same `(domain, value, recipient)` produces a duplicate commitment, which the ledger rejects.
8. With a secret, cryptographically random nonce, the commitment cannot be linked to a recipient: this is the recipient-private mint. It is also the variant for operator-driven flows where the commitment must be computed off-chain before submission.

The `Uint<64>` amount cap is imposed by the ledger: contract shielded mints are recorded as a `Map<[u8; 32], u64>` in the transaction effects. Larger issuance requires multiple mints.

### Burn Circuits

```typescript
export circuit _burn(
  domain: Bytes<32>,
  coin: ShieldedCoinInfo,
  amount: Uint<128>,
  refundTo: Either<ZswapCoinPublicKey, ContractAddress>
): Maybe<ShieldedCoinInfo>

export circuit _burnFromContract(
  domain: Bytes<32>,
  coin: QualifiedShieldedCoinInfo,
  amount: Uint<128>
): Maybe<ShieldedCoinInfo>
```

**Common behavior:**

1. MUST revert unless `coin.color == tokenType(domain, kernel.self())`. This check is the only thing preventing a burn from destroying (and accounting for) a coin of the wrong token type — the protocol-level receive does not validate color.
2. MUST revert if `amount > coin.value`.
3. MUST send `amount` to `shieldedBurnAddress()` and add `amount` to `_totalBurned[domain]`.

**`_burn` (same-tx coin):**

4. For coins provided within the current transaction (e.g. paid in by the caller's wallet). MUST call `receiveShielded(coin)` and spend via `sendImmediateShielded` — the transient path. The signature takes an unqualified `ShieldedCoinInfo` deliberately: a same-tx coin has no meaningful `mt_index`, and accepting one would let the caller supply an arbitrary value.
5. MUST revert if `refundTo` is the zero key or zero address (the zero key *is* the burn address; a zeroed `refundTo` would silently burn the change too).
6. If `amount < coin.value`, the change MUST be forwarded to `refundTo` via a second `sendImmediateShielded`, and the circuit MUST return `some(refundCoin)` — the actual coin info created for `refundTo`. The caller MUST deliver it to `refundTo` out of band. If `amount == coin.value`, the circuit returns `none`.

**`_burnFromContract` (contract-held coin):**

7. For coins the contract already holds (valid `mt_index` in the global commitment tree). MUST spend via `sendShielded`. MUST NOT call `receiveShielded` (the coin is already owned; claiming a receive would require a fresh output that does not exist).
8. Change from `sendShielded` is auto-received by the contract at the protocol level. The circuit MUST return it (`Maybe<ShieldedCoinInfo>`), and the consuming contract SHOULD persist it in its own ledger state: the change replaces `coin` as the contract's holding and its info is not otherwise recoverable.

### Access Control

This standard defines an *unrestricted* module: the mint and burn circuits are building blocks. Consuming contracts MUST gate all four behind an authorization mechanism (e.g. [Ownable or AccessControl from OpenZeppelin Compact Contracts](https://github.com/OpenZeppelin/compact-contracts), or the hash-based commitment pattern specified in [MIP-0004](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0004-fungible-token-standard-with-utxo.md)). Consistent with MIP-0004, implementations MUST NOT authenticate callers via `ownPublicKey()`: it is a witness value supplied by the caller's frontend and is not bound to the proof.

### Out of Scope

`balanceOf`, `allowance`, transfer mediation, and post-issuance controls (pause, freeze) are not representable for native shielded tokens today: once a user holds a coin, the contract cannot observe or restrict its movement. These depend on protocol capabilities under separate discussion ([MPS-0013: zswap-business-logic](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mps/mps-0013-zswap-business-logic.md), [MPS-0021: contract-to-contract phase 2](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mps/mps-0021-phase2-contract-to-contract.md)) and are deferred to a future revision.

Two companion MIPs complete the native-token family: the [Native Unshielded Token Standard](./mip-xxxx-native-unshielded-token.md) (the transparent sibling of this standard, with the same two profiles) and the [Native Token Conversion Extension](./mip-xxxx-native-shielded-token-conversion-extension.md), a stateless module that converts between the two representations by composing both base standards' **Family profiles**. Dual-representation tokens MUST build on the Family profiles: the Fungible profiles each store a load-bearing sealed `_domain` written by their `initialize`, but the shared `Initializable` flag allows only one `initialize` call per contract. Because Compact ledger layouts are fixed at deploy, issuers who may ever need a transparent representation SHOULD deploy on the Family profiles with the extension compiled in (hardcoding one domain constant for a single-token product). When both bases are composed in one contract, the consumer MUST call exactly one base's `initialize` and SHOULD expose metadata getters from that base only.

## Rationale

### Why a separate standard from MIP-0004?

MIP-0004 anchors supply in an account-based Map and treats UTXOs as a converted representation; the contract remains the source of truth and `totalSupply` stays exact. That is the right model when DeFi logic needs balances. This standard covers the complementary case: assets that should exist *only* in native shielded form, where the account model would add state, circuits, and a public balance map for no benefit. The two compose — a MIP-0004 token's `shield` circuit and this standard's `_mint` use the same protocol primitive — but their guarantees (notably supply exactness) differ and should not be conflated under one interface.

### Why two profiles instead of one parameterized module?

An earlier draft had only the multi-domain module and advised single-token consumers to hardcode a domain in wrapper circuits. That pushed safety to the consumer: every single-token issuer had to re-implement the domain-hardcoding wrapper that the Fungible profile now provides once, audited (recovering MIP-0004's stored-domain safety at the library layer). The Fungible profile also gets scalar supply cells instead of per-domain maps — cheaper circuits for the most common case.

The profiles are one standard, not two. All observable coin behavior (nonce rules, spend paths, burn address, supply-bound semantics, metadata interface) is identical, and a minted coin carries no trace of which profile issued it. The Ethereum precedent of separate standards (ERC-20 vs ERC-1155) does not apply: those split because integrators code against different *transfer* interfaces, and native tokens have no transfer interface at all — movement is protocol-level Zswap. The Family profile is not an ERC-1155 analog; it is the answer to a Midnight-specific composability constraint (see the next section).

### Why family metadata?

The Family profile keeps contract-wide `name`/`symbol`/`decimals` rather than per-domain metadata, following the Uniswap-V2 LP precedent: every pair's LP token carries the same name, symbol, and decimals, and UIs compose per-pair display from the pair registry. A consumer's registry mapping `domain -> (token0, token1)` is strictly more informative than any stored per-domain string, so per-domain metadata maps would duplicate it at the cost of three maps, a setter circuit that must be gated and sequenced with domain creation, and an immutability story. Consumers issuing *heterogeneous* token families (where one brand is genuinely dishonest) can add their own per-domain metadata in consumer state — metadata is plain ledger data with no protocol interaction.

### Why does the Family profile use per-call `domain`?

The ERC-20 precedent of one token per contract relies on deployment economics Midnight does not have. On Ethereum, factories deploy a minimal-proxy clone per token cheaply, so single-asset contracts compose into multi-asset systems at the deployment layer. On Midnight, one contract is one address with its own circuits and verifier keys, composition happens at compile time, and there is no mechanism for a contract to instantiate another. Multi-asset protocols (e.g. a liquidity-pool contract minting one share token per pair) therefore cannot follow the clone-factory pattern and must issue multiple colors from a single contract — which the protocol's color derivation (`tokenType(domain, contractAddress)`) natively supports.
### Forward compatibility with contract-to-contract calls

The arrival of contract-to-contract (C2C) calls does not change the choice between this standard and MIP-0004 — it upgrades both along their own axes. C2C makes MIP-0004's deferred account-model circuits (`approve`, `transferFrom`) usable; for native shielded tokens, C2C together with custom spend logic ([MPS-0013](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mps/mps-0013-zswap-business-logic.md), [MPS-0021](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mps/mps-0021-phase2-contract-to-contract.md)) is what unlocks phase-two transfer mediation and post-issuance controls. Neither standard absorbs the other. Nor does C2C revive the clone-factory pattern: it adds cross-contract calls, not cheap contract instantiation, so the multi-domain motivation above is unaffected.

This interface is designed to be C2C-ready without changes:

- Recipients and refund targets are `Either<ZswapCoinPublicKey, ContractAddress>` from day one, in both circuit signatures and supply-map keys.
- `_burnFromContract` already implements the spend path a *contract* holder of these tokens needs (Merkle-tree spend of a held coin, change auto-retained).
- `tokenColor(domain)` exists so C2C callers can query the color instead of re-deriving it.
- Fixing the ledger layout now (including the supply maps) means phase-two circuits can later be added to a deployed token via a CMA verifier-key rotation with zero ledger-state migration — the only kind of upgrade the CMA supports. This mirrors the migration plan documented in the OpenZeppelin `FungibleToken` module.

### Why two mint variants?

There is a genuine trade-off between operational simplicity and recipient privacy. Derived nonces (`_mint`) cannot collide and require nothing from the caller, but every derivation input is public, so commitments are linkable to recipients by enumeration. Caller nonces (`_mintWithNonce`) restore recipient privacy and enable off-chain commitment precomputation, at the cost of making the caller responsible for uniqueness. Hiding this trade-off behind a single circuit would mean either silently recipient-public mints or silently fragile ones.

### Why two burn variants?

The Zswap spend path is determined by where the coin lives. A same-tx coin must be spent transiently; a tree-resident coin must be spent with a Merkle proof. These take different input types (`ShieldedCoinInfo` vs `QualifiedShieldedCoinInfo`) and have different change semantics (forward to a refund target vs auto-retained by the contract). One circuit cannot do both correctly, and an interface that accepts a `QualifiedShieldedCoinInfo` while internally receiving the coin trusts a caller-supplied `mt_index` it cannot use.

### Why return the refund/change coin?

Contract-initiated sends create no coin ciphertexts, so the only copy of a refund or change coin's info is the circuit's return value. Discarding it (as early drafts did) strands value. Returning `Maybe<ShieldedCoinInfo>` makes the delivery obligation explicit and testable.

### Why supply bounds instead of exact supply?

The alternative — an exact-looking `totalSupply` counter — is strictly worse: it reports the same number while implying a guarantee the protocol cannot provide (out-of-band burns are invisible to contract state). Naming the quantities `totalMinted` / `totalBurned` / upper-bound `totalSupply` gives indexers correct semantics. Supply tracking is included in the base standard rather than an optional extension because Compact ledger layouts are fixed at deployment: a consumer that deploys without it can never add it.

### Why domain-separate the internal nonce chain?

The evolved chain values are public. If coin nonces equaled chain values, the most natural misuse of `_mintWithNonce` — reading the public `_nonce` field and passing it back — would collide with an internal mint. Hashing chain values under a fixed tag (`"NativeShieldedToken:nonce"`) puts internal nonces in a namespace honest callers will not produce. It does not prevent deliberate collision-griefing (see Security Considerations); it removes the accidental case.

### Naming

"Native shielded token" follows the terminology split used across the ecosystem: *native* (protocol-level UTXO) vs *contract-based* (ledger-state balances), and *shielded* vs *unshielded*. Alternatives considered: `ZswapToken` (protocol jargon, and Zswap also covers unshielded swap mechanics), `ShieldedToken` (ambiguous against shielded *contract-based* tokens such as ShieldedAccessControl-style assets), `NativeToken` (ambiguous against unshielded native UTXOs).

For the profiles, the short name `NativeShieldedToken` goes to the Fungible profile (the common case) and the multi-domain module is named `NativeShieldedTokenFamily`. Two suffixes were rejected: `MultiToken` (the library's existing `MultiToken` module means "ERC-1155 with `uri`", and this profile shares neither that metadata model nor any transfer semantics) and the plural `NativeShieldedTokens` (one letter away from the sibling module — a misread and mistype hazard at every import and call site). "Family" also matches the profile's metadata concept. "Fungible" is deliberately kept out of the module names: a `NativeFungibleShieldedToken` would invite confusion with the account-based `FungibleToken` module.

## Path to Active

### Acceptance Criteria

- Reference implementation merged into the [OpenZeppelin Compact Contracts library](https://github.com/OpenZeppelin/compact-contracts) with a full simulator-based test suite.
- At least one deployment on Midnight testnet exercising all six mutating circuits (`initialize`, both mints, both burns, supply getters), including the partial-burn refund path.
- Demonstrated wallet round-trip: mint → out-of-band coin delivery → wallet-to-wallet transfer → contract burn.
- Review and endorsement through the [MIP process](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0001-mip-process.md) workshops.
- Security audit of the reference implementation.

### Implementation Plan

1. Land the `NativeShieldedToken` module in OpenZeppelin Compact Contracts (rework of [PR #559](https://github.com/OpenZeppelin/compact-contracts/pull/559), tracking [issue #544](https://github.com/OpenZeppelin/compact-contracts/issues/544)).
2. Add simulator + Vitest coverage for all behaviors specified above, including the revert cases.
3. Provide a composed example (token + Ownable/AccessControl gating) and DApp-side guidance for out-of-band coin delivery.
4. Deploy to testnet; submit for formal MIP review.

## Backwards Compatibility Assessment

This MIP is purely additive: a new contract standard requiring no protocol or network changes; all primitives used (`mintShieldedToken`, `receiveShielded`, `sendShielded`, `sendImmediateShielded`, `evolveNonce`, `tokenType`, `shieldedBurnAddress`) exist in the current Compact Standard Library. It does not modify or conflict with [MIP-0004](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0004-fungible-token-standard-with-utxo.md); the two standards target different asset models and can coexist in one ecosystem (and one contract, where a hybrid design is desired). Tokens issued under this standard are ordinary Zswap coins and interoperate with existing wallets, Zswap atomic swaps, and DApps that handle `ShieldedCoinInfo`.

The standard is also forward compatible with contract-to-contract calls: signatures accept `ContractAddress` recipients from day one, and the fixed ledger layout allows phase-two circuits to be added to already-deployed tokens via CMA verifier-key rotation without state migration (see [Forward compatibility with contract-to-contract calls](#forward-compatibility-with-contract-to-contract-calls)).

## Security Considerations

### Unrestricted issuance

The module-level circuits carry no authorization. A consumer that exposes `_mint` ungated has an infinitely mintable token; one that exposes `_burnFromContract` ungated lets anyone destroy treasury holdings. Consumers MUST gate all mint and burn circuits ([Access Control](#access-control)) and MUST NOT use `ownPublicKey()` for caller verification.

### Commitment collisions and mint denial-of-service

Internally derived nonces are predictable from public state. An actor with access to `_mintWithNonce` can precompute a future internal nonce, pre-mint a coin with the identical `(nonce, domain, value, recipient)` tuple, and cause that specific future `_mint` to fail on duplicate-commitment rejection. The namespace separation removes accidental collisions; the deliberate vector is mitigated operationally: gate both mint variants, and prefer not exposing both for the same domain to distinct trust levels. A failed mint is recoverable (any subsequent mint with a different tuple advances the chain past the collision).

### Recipient linkability of derived-nonce mints

For `_mint`, the coin commitment is recomputable from public state for any candidate recipient key, so mint recipients are effectively public (the later *spend* of the coin remains unlinkable — nullifier derivation requires the holder's secret key). Issuers needing recipient privacy at mint time MUST use `_mintWithNonce` with a secret uniform nonce. Note that declining to `export` the nonce ledger fields does not change this: ledger state is public on-chain regardless.

### Coin delivery and value loss

The returned `ShieldedCoinInfo` from mints and the `Maybe<ShieldedCoinInfo>` from burns are the only copies of the corresponding coins' info available to recipients (no ciphertexts are emitted for contract-initiated outputs). DApps integrating this standard MUST capture and deliver them; dropping them strands value irrecoverably. Test suites SHOULD assert on returned coin info, not only on ledger state.

### Wrong-color burns

`receiveShielded` validates commitment presence, not color. The mandated `coin.color == tokenType(domain, kernel.self())` assertion is the only barrier preventing a multi-domain contract from burning token A while accounting the burn against token B's supply — which would corrupt both domains' supply bounds.

### Burn-address footguns

`shieldedBurnAddress()` is the all-zero public key, which is also the default/zero value of `ZswapCoinPublicKey`. The mandated zero-checks on `recipient` (mint) and `refundTo` (burn) exist because a defaulted struct silently routes value to the burn address.

### Supply interpretation

`totalSupply` is an upper bound. Integrators SHOULD present it as such rather than as exact circulating supply; the spec names `totalMinted`/`totalBurned` so UIs can disclose the bound semantics.

### No post-issuance control

Once minted, coins are unconditionally transferable bearer instruments: no pause, freeze, clawback, or transfer restriction is possible at this layer. Issuers with compliance requirements (e.g. regulated stablecoins) should treat this standard as the phase-one primitive and track [MPS-0013](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mps/mps-0013-zswap-business-logic.md) / [MPS-0021](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mps/mps-0021-phase2-contract-to-contract.md) for custom spend logic.

## Implementation

### Components

1. **New Compact modules**: [`NativeShieldedToken.compact` (Fungible profile) and `NativeShieldedTokenFamily.compact` (Family profile)](https://github.com/OpenZeppelin/compact-contracts/tree/main/contracts/src/token) in the OpenZeppelin Compact Contracts library — all state and circuits specified above, composed with the library's `Initializable` and `Utils` modules.
2. **Mocks + simulators + tests**: `MockNativeShieldedToken.compact` and `MockNativeShieldedTokenFamily.compact` exposing the module circuits, with TypeScript simulators and Vitest suites.
3. **No protocol changes required.**

### Dependencies

- [Compact Standard Library](https://docs.midnight.network/compact): `mintShieldedToken`, `receiveShielded`, `sendShielded`, `sendImmediateShielded`, `evolveNonce`, `tokenType`, `shieldedBurnAddress`, `Counter`, `ShieldedCoinInfo`, `QualifiedShieldedCoinInfo`, `Maybe`.
- [OpenZeppelin Compact Contracts](https://github.com/OpenZeppelin/compact-contracts): `Initializable`, `Utils` modules.
- Compact language version >= 0.21.0. The reference implementation compiles against this toolchain.

## Testing

### Unit Tests

- `initialize`: all circuits revert before initialization; double-initialize reverts; metadata getters return constructor values.
- `_mint`: returns coin info with `color == tokenColor(domain)` and correct value; `_counter`/`_nonce` evolve per spec; `_totalMinted[domain]` incremented; revert on zero recipient; overflow guard.
- `_mintWithNonce`: identical accounting; coin nonce equals caller's nonce; distinct domains accumulate independent supplies.
- `_burn`: revert on wrong color, on `amount > coin.value`, on zero `refundTo`; full burn returns `none`; partial burn returns `some(refund)` with `refund.value == coin.value - amount`; `_totalBurned[domain]` incremented.
- `_burnFromContract`: revert on wrong color and on `amount > coin.value`; change returned and owned by the contract; no receive claim emitted.
- Supply getters: `totalSupply == totalMinted - totalBurned` after arbitrary mint/burn sequences; unknown domains return 0.

### Integration Tests

- Round-trip on network: mint to user wallet → out-of-band delivery → user pays coin into `_burn` → refund coin spendable by `refundTo`.
- Treasury flow: mint to `kernel.self()` → `_burnFromContract` partial burn → persisted change burnable again.
- Multi-domain isolation: mints/burns under domain A do not affect domain B's supply or color checks.
- Invariant fuzzing: for random operation sequences, `totalMinted` exact vs simulator-observed mints; `circulating <= totalSupply` after including direct-to-burn-address sends that bypass the contract.

## References (Optional)

- [MIP-0001: Midnight Improvement Proposal Process](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0001-mip-process.md)
- [MIP-0004: Fungible Token Standard with UTXO Conversion Extensions](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0004-fungible-token-standard-with-utxo.md)
- [MPS-0013: zswap-business-logic](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mps/mps-0013-zswap-business-logic.md)
- [MPS-0021: contract-to-contract phase 2](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mps/mps-0021-phase2-contract-to-contract.md)
- [OpenZeppelin Compact Contracts — Repository](https://github.com/OpenZeppelin/compact-contracts)
- [OpenZeppelin Compact Contracts — Issue #544: Add Shielded Native Token standard](https://github.com/OpenZeppelin/compact-contracts/issues/544)
- [OpenZeppelin Compact Contracts — PR #559: Add shielded token](https://github.com/OpenZeppelin/compact-contracts/pull/559)
- [Midnight Zswap Documentation](https://docs.midnight.network/concepts/zswap)
- [Midnight UTXO Model Documentation](https://docs.midnight.network/concepts/utxo)
- [The Compact Language](https://docs.midnight.network/compact)

## Acknowledgements

This proposal builds on the OpenZeppelin Compact Contracts library and its archived shielded-token exploration, on the protocol behavior documented in the Midnight ledger specification, and on issuance patterns observed in ecosystem applications. Thanks to the Midnight protocol and documentation teams, and to the authors of MIP-0004 for the groundwork on token standards and hash-based caller authentication.

## Copyright Waiver

All contributions (code and text) submitted in this MIP must be licensed under the Apache License, Version 2.0.
Submission requires agreement to the Midnight Foundation Contributor License Agreement [Link to CLA], which includes the assignment of copyright for your contributions to the Foundation.
