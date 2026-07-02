---
MIP: XXXX
Title: Native Shielded Token Standard
Authors: Iskander Andrews @0xisk (OpenZeppelin), Andrew Fleming @andrew-fleming (OpenZeppelin)
Reviewers: Pepe Blasco @pepebndc (OpenZeppelin)
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

This MIP specifies a contract interface for **native shielded tokens** on Midnight:
assets that exist only as [Zswap](https://docs.midnight.network/concepts/zswap) shielded [UTXOs](https://docs.midnight.network/concepts/utxo), never as a balance in contract state.
The issuing contract mints and burns; it is not a balance keeper.
Once minted, a coin moves wallet-to-wallet at the protocol level with no contract involvement.

The standard specifies three things — metadata (`name`, `symbol`, `decimals`, `tokenColor`), issuance (`_mint`), and destruction (`_burn`, `_burnFromContract`) — and two OPTIONAL extensions: derived-nonce minting and supply accounting.
It supports multiple token types per contract through a per-call domain separator, separates recipient-public from recipient-private minting, and mandates the correct Zswap spend path for each burn: transient for same-transaction coins, Merkle for contract-held coins.

A reference implementation ships as the `NativeShieldedToken` module in the [OpenZeppelin Compact Contracts library](https://github.com/OpenZeppelin/compact-contracts).
It complements [MIP-0004](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0004-fungible-token-standard-with-utxo.md), which standardizes account-based tokens with UTXO conversion.

## Motivation

Native shielded coins are the asset the Midnight protocol operates on directly.
They take part in [Zswap atomic swaps](https://docs.midnight.network/concepts/zswap), transfer peer-to-peer with no contract call, and hide value, sender, and receiver by construction.
That makes them the natural representation for privacy-first assets: phase-one RWA issuance, liquidity-pool share tokens, and confidential payment instruments.

There is no standard for issuing them.
Every project rebuilds the same contract surface, and the underlying primitives have non-obvious failure modes that have already appeared in ecosystem drafts:

- **Wrong spend path.** A coin received within the current transaction is not yet in the global commitment tree. It MUST be spent transiently (`sendImmediateShielded`), not with a Merkle proof (`sendShielded`). Conflating them yields unsatisfiable circuits, or circuits that trust a caller-supplied Merkle index.
- **Lost coins.** Contract-initiated sends emit no coin ciphertext, so recipient wallets cannot find minted or refunded coins by scanning the chain. An interface that discards the protocol's returned coin info strands value.
- **Dishonest supply.** Holders can destroy coins without touching the contract (burn-address send, or an imbalanced Zswap offer). A contract-tracked "total supply" therefore over-reports. Standards that present it as exact mislead indexers.
- **Commitment collisions.** Nonces derived from public state are predictable. Without care, caller-supplied and contract-derived nonces share one namespace and can be made to collide, rejecting mints.

Existing standards do not cover this asset class.
The [OpenZeppelin FungibleToken](https://github.com/OpenZeppelin/compact-contracts/blob/main/contracts/src/token/FungibleToken.compact) is account-based; [MIP-0004](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0004-fungible-token-standard-with-utxo.md) adds map/UTXO conversion but keeps the account model as the source of truth.
For tokens that should exist only in native shielded form, no interface exists.
This MIP fills the gap with a minimal mint/burn standard that encodes the correct protocol usage and states its privacy and accounting guarantees plainly.

## Specification

### Terminology

- **Native shielded token**: a class of Zswap coins sharing one **color**, minted by a contract, managed by the protocol layer rather than contract state.
- **Color (token type)**: `tokenType(domain, contractAddress)` per the [Compact Standard Library](https://docs.midnight.network/compact). Only the contract at `contractAddress` can mint coins of its colors.
- **Domain separator (`domain`)**: a 32-byte value that, with the contract address, identifies one token type. One contract MAY issue many token types via many domains.
- **Same-tx coin**: a coin whose commitment is created by an output of the current transaction. Not yet in the global tree; MUST be spent via the [transient path](https://github.com/midnightntwrk/midnight-ledger/blob/ledger-8/spec/zswap.md#transients) (`sendImmediateShielded`).
- **Contract-held coin**: a coin the contract owns whose commitment is already in the global tree, carried as a `QualifiedShieldedCoinInfo` with a valid `mt_index`.
- **Burn address**: the all-zero `ZswapCoinPublicKey` from `shieldedBurnAddress()`, with no known secret key. Coins sent there are unspendable.

### Conformance Profiles

The standard defines two profiles. They are one standard, not two: a minted coin carries no trace of which profile issued it, and all issuance, burn, nonce, metadata, and supply-bound rules are identical.

| | Fungible (`NativeShieldedToken`) | Family (`NativeShieldedTokenFamily`) |
| --- | --- | --- |
| Token types per contract | one | many |
| Domain | fixed at construction (`sealed _domain`), not a parameter | per-call `domain` parameter |
| Supply totals (extension) | scalar | per-domain maps |
| Use case | ERC-20-shaped single asset | multi-asset issuer (e.g. DEX LP shares) |

The Fungible profile fixes the domain at construction, removing caller-supplied domain misuse.
The Family profile exists because of Midnight's composition model: a contract cannot deploy or call another, so a multi-asset protocol cannot stamp out one token contract per asset and MUST issue its whole family from one contract.

> **Today, not forever.**
> There are no contract-to-contract (C2C) calls yet, so "a contract cannot call another" is a current constraint, not a permanent one.
> C2C is expected to land ([Compact PR #449](https://github.com/LFDT-Minokawa/compact/pull/449)); it would add cross-contract calls, not cheap per-asset deployment, so the Family-profile motivation stands either way (see [Backwards Compatibility Assessment](#backwards-compatibility-assessment)).

Both profiles carry the same metadata interface (`name`, `symbol`, `decimals`).
In the Family profile these are family metadata shared by all token types — the Uniswap V2 LP precedent, where every pair's LP token carries the same name, symbol, and decimals (`Uniswap V2` / `UNI-V2` / 18) regardless of the underlying pair.
Per-type identity belongs in the consumer's own state (e.g. a registry mapping each domain to its underlying tokens).

The sections below are written for the Family profile, with an explicit `domain` parameter.
The Fungible profile is identical with every `domain` removed: the stored `_domain` is used, and `totalMinted(domain)` reads as the scalar `totalMinted()`.
Neither profile provides balances, operator approvals, or batch transfers (see [Out of Scope](#out-of-scope)).

### Required State

Core state is metadata only. Supply counters belong to the optional supply extension (see [Extension: Supply Accounting](#extension-supply-accounting)).

```typescript
// Family profile
export sealed ledger _name: Opaque<"string">;
export sealed ledger _symbol: Opaque<"string">;
export sealed ledger _decimals: Uint<8>;

// Fungible profile adds:
export sealed ledger _domain: Bytes<32>;
```

- Sealed fields are immutable after construction. In the Fungible profile, the sealed `_domain` write forces token setup into the constructor by the sealed-write rule.
- All Compact ledger state is public on-chain regardless of `export`; omitting `export` does not hide a field.

### Construction

This standard does not prescribe an initialization mechanism; only the result is normative.
`name`, `symbol`, `decimals`, and (Fungible) the domain separator MUST be set at construction and MUST be immutable thereafter.
The reference implementation uses an `initialize` module circuit invoked once from the consuming contract's constructor.

### Metadata Circuits

```typescript
export circuit name(): Opaque<"string">
export circuit symbol(): Opaque<"string">
export circuit decimals(): Uint<8>

export circuit tokenColor(domain: Bytes<32>): Bytes<32>   // Family
export circuit tokenColor(): Bytes<32>                    // Fungible
```

- `decimals` is a display convention only; the protocol operates on integers. In the Family profile it applies family-wide, and a heterogeneous issuer MUST handle per-type decimals in its own state.
- `tokenColor` MUST return `tokenType(domain, kernel.self())`, computed at call time. Per the [MIP-0004](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0004-fungible-token-standard-with-utxo.md) finding, the color MUST NOT be precomputed in the constructor: `kernel.self()` resolves differently there.

### Mint Circuit

```typescript
export circuit _mint(
  domain: Bytes<32>,
  recipient: Either<ZswapCoinPublicKey, ContractAddress>,
  amount: Uint<64>,
  nonce: Bytes<32>
): ShieldedCoinInfo
```

1. MUST revert if `recipient` is the zero key or zero address.
2. MUST call `mintShieldedToken(domain, amount, nonce, recipient)` and return the resulting `ShieldedCoinInfo`.
3. Contract-initiated outputs carry no coin ciphertext, so wallets cannot detect contract-minted coins by scanning the chain. The returned coin info is the recipient's only copy; callers SHOULD deliver it out of band.
4. The caller owns nonce uniqueness. Reusing a nonce for the same `(domain, value, recipient)` produces a duplicate commitment, which the ledger rejects.
5. With a secret, uniformly random nonce the commitment is unlinkable to a recipient — the recipient-private mint.

The `Uint<64>` cap is imposed by the ledger ([`shieldedMints` is recorded as `Map<[u8; 32], u64>`](https://github.com/midnightntwrk/midnight-ledger/blob/ledger-8/spec/contracts.md#effects)); larger issuance requires multiple mints.
A consumer composing the supply extension MUST pair every successful mint with `_addMinted(domain, amount)` (see [Extension: Supply Accounting](#extension-supply-accounting)).

> **Contract recipients are limited today.**
> Until contract-to-contract (C2C) calls land, the `ContractAddress` branch of `recipient` is deliverable only to the *issuing* contract (mint-to-self, which needs no `receiveShielded`).
> A coin output addressed to a *different* contract is rejected by the node (`1010: Invalid Transaction: Custom error: 186`): the recipient contract would have to run [`receiveShielded`](https://github.com/midnightntwrk/midnight-ledger/blob/ledger-8/spec/contracts.md#effects) in the same transaction (the coin must land in its `claimed_shielded_receives`), and Compact has no cross-contract calls.
> So today, mint to a wallet (`ZswapCoinPublicKey`) or to the issuing contract.
> The `ContractAddress` branch is retained for forward-compatibility and becomes generally usable once C2C lands (verified by decoding raw transactions; see the [indexing study](https://github.com/0xisk/exploring-native-shielded-token-indexing)).

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

The Zswap spend path depends on where the coin lives, so there are two variants:

| | `_burn` | `_burnFromContract` |
| --- | --- | --- |
| Coin location | provided in the current tx (same-tx) | already held by the contract (in the tree) |
| Coin type | `ShieldedCoinInfo` | `QualifiedShieldedCoinInfo` (valid `mt_index`) |
| Receive step | `receiveShielded(coin)` | none (already owned) |
| Spend path | `sendImmediateShielded` (transient) | `sendShielded` (Merkle) |
| Change | forwarded to `refundTo` | auto-received by the contract, returned |

**Common behavior:**

1. MUST revert unless `coin.color == tokenType(domain, kernel.self())`. This is the only barrier stopping a multi-domain contract from burning token A while accounting it against token B; the protocol-level receive does not validate color.
2. MUST revert if `amount > coin.value`.
3. MUST send `amount` to `shieldedBurnAddress()`. The bare burn keeps the amount **private**; a consumer composing the supply extension MUST also `_addBurned(domain, amount)`, which makes the amount public (see [Extension: Supply Accounting](#extension-supply-accounting)).

**`_burn` (same-tx coin):**

4. Takes an unqualified `ShieldedCoinInfo` deliberately: a same-tx coin has no meaningful `mt_index`, and accepting one would let the caller supply an arbitrary value.
5. MUST revert if `refundTo` is the zero key or zero address — the zero key is the burn address, so a zeroed `refundTo` would silently burn the change too.
6. If `amount < coin.value`, the change MUST be forwarded to `refundTo` via a second `sendImmediateShielded` and the circuit MUST return `some(refundCoin)` (the actual coin info, delivered out of band). If `amount == coin.value`, it returns `none`.

> **`refundTo` has the same contract-recipient limit.**
> Until C2C lands, `refundTo` may be a wallet or the issuing contract, but not a *different* contract — a contract-addressed change output is rejected (`186`) for the reason given under [Mint Circuit](#mint-circuit).
> Expected to change with C2C.

**`_burnFromContract` (contract-held coin):**

7. MUST NOT call `receiveShielded`: the coin is already owned, and claiming a receive would require a fresh output that does not exist.
8. Change from `sendShielded` is auto-received by the contract. The circuit MUST return it (`Maybe<ShieldedCoinInfo>`); the consumer SHOULD persist it, since it replaces `coin` as the contract's holding and is not otherwise recoverable.

### Extension: Supply Accounting

An OPTIONAL extension, not part of the core. The reference implementation ships it as standalone modules (`NativeShieldedTokenSupply`, scalar; `NativeShieldedTokenFamilySupply`, per-domain) a consumer composes alongside the token, pairing the accounting blocks with each mint/burn.

```typescript
export circuit totalMinted(domain: Bytes<32>): Uint<128>
export circuit totalBurned(domain: Bytes<32>): Uint<128>
export circuit totalSupply(domain: Bytes<32>): Uint<128>
```

Exact circulating supply is **not knowable** for a native shielded token — coins can be destroyed without involving the contract. When composed, the extension tracks the strongest quantities it can and names them honestly:

- `totalMinted(domain)` is **exact** — color derivation guarantees every coin of this contract's colors comes from its mints, and each MUST increment it.
- `totalBurned(domain)` is a **lower bound** — it counts only contract-mediated burns.
- `totalSupply(domain)` MUST equal `totalMinted(domain) - totalBurned(domain)`, an **upper bound** on circulating supply.

```math
\texttt{circulating}(d) \le \texttt{totalSupply}(d) = \texttt{totalMinted}(d) - \texttt{totalBurned}(d)
```

Two destruction paths bypass the contract: **burn-address sends** (amount stays in a Pedersen commitment, hidden from everyone) and **protocol burns** (an [imbalanced Zswap offer](https://github.com/midnightntwrk/midnight-ledger/blob/ledger-8/spec/zswap.md#offers); amount is public in the value deltas but invisible to contract state).

Counters MUST be maintained as: every mint adds `amount` to `_totalMinted[domain]`, reverting on `Uint<128>` overflow; every contract-mediated burn adds `amount` to `_totalBurned[domain]`. Burned can never exceed minted, so `totalSupply` cannot underflow. The getters do not gate on initialization — a counter reading 0 pre-init is correct; init stays on the mint/burn circuits.

#### Composing the extension is a privacy trade-off

Composing supply accounting makes contract-mediated burn amounts **public**, where a bare burn keeps them private. The mechanism is precise:

- `disclose()` is a compiler permission marker, **not** a disclosure. A value only actually becomes public when it reaches an operation that writes it somewhere observable: a write to public ledger state, a return from an exported circuit, or a pass to another contract.
- The coin operations (`receiveShielded`, `sendImmediateShielded`, `sendShielded`) emit only [commitments and nullifiers](https://github.com/midnightntwrk/midnight-ledger/blob/ledger-8/spec/zswap.md#preliminaries) (hashes of the coin), never the value — even though the compiler forces a `disclose()` on each.
- So the **only** thing that puts a burned amount into the public transcript is the supply counter's ledger write. A bare `_burn` / `_burnFromContract` hides it; composing the extension trades that for an on-chain `totalSupply`.
- Mint amounts are public regardless, via the `shieldedMints` effect. The extension changes burn visibility, not mint visibility.

Verified against decoded transaction bytes ([study](https://github.com/0xisk/exploring-native-shielded-token-indexing)): an otherwise-identical burn with the supply write removed leaves no amount in the transcript, while every coin-op `disclose()` is still present.

What is hidden vs public:

| | |
| --- | --- |
| **Hidden** | coin owners and recipients; the value inside any commitment; the amount of a bare contract burn; burn-address burn amounts |
| **Public** | contract address and entry point; token color; new commitments and spent nullifiers; the attached proof; mint amounts (`shieldedMints`); a contract burn amount **when supply is composed**; protocol-burn amounts (value deltas) |

Who can reconstruct what:

| Party | Can reconstruct |
| --- | --- |
| The contract | its own mints; its own contract-mediated burns **only if** the supply extension is composed |
| An indexer | mints (`shieldedMints`), protocol burns (value deltas), per-color pool value (negated delta sum); contract-mediated burn amounts **only when** supply is composed |
| No one | the spendable share of the pool — burn-address coins are indistinguishable from live coins, so exact circulating supply is unknowable on-chain and off |

### Extension: Derived-Nonce Minting

An OPTIONAL extension for an issuer that wants a mint requiring no caller-managed nonce. It adds nonce-chain state and one circuit:

```typescript
export ledger _counter: Counter;
export ledger _nonce: Bytes<32>;

export circuit _mintWithDerivedNonce(
  domain: Bytes<32>,
  recipient: Either<ZswapCoinPublicKey, ContractAddress>,
  amount: Uint<64>
): ShieldedCoinInfo
```

`_mintWithDerivedNonce` MUST behave as `_mint` with a nonce derived from contract state. The derivation is not prescribed, but MUST:

1. seed the chain at construction, with a seed chosen unpredictably (e.g. 32 random bytes);
2. never repeat a derived nonce for the contract's lifetime;
3. domain-separate derived nonces from values an honest `_mint` caller could produce by reading public state (e.g. hash under a fixed tag), so the two namespaces cannot collide by accident.

Its derivation inputs are public state, so the commitment is recomputable by enumerating candidate recipient keys: implementations SHOULD document this circuit as **recipient-public**, and an issuer needing recipient privacy uses the base `_mint` with a secret nonce.
The reference implementation (`NativeShieldedTokenDerivedNonce`) evolves a counter-indexed chain and derives the nonce as `persistentHash([pad(32, "NativeShieldedToken:nonce"), chainValue])`.

### Access Control

This is an unrestricted module; the mint and burn circuits are building blocks with no authorization of their own.
A consuming contract MUST gate all of them behind an authorization mechanism — e.g. [Ownable or AccessControl](https://github.com/OpenZeppelin/compact-contracts), or the hash-based commitment pattern from [MIP-0004](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0004-fungible-token-standard-with-utxo.md).
As in MIP-0004, implementations MUST NOT authenticate callers with `ownPublicKey()`: it is a caller-supplied witness, not bound to the proof.

### Out of Scope

`balanceOf`, `allowance`, transfer mediation, and post-issuance controls (pause, freeze) are not representable today: once a user holds a coin, the contract cannot observe or restrict its movement.
These depend on protocol capabilities under separate discussion ([MPS-0013](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mps/mps-0013-zswap-business-logic.md), [MPS-0021](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mps/mps-0021-phase2-contract-to-contract.md)) and are deferred.

A transparent sibling (native unshielded tokens) and a conversion extension between the two representations are planned as separate standards.
Because Compact ledger layouts are fixed at deploy, an issuer that may ever need both representations SHOULD deploy on the Family profiles from the start, hardcoding one domain for a single-token product.

## Rationale

### Why a separate standard from MIP-0004?

MIP-0004 is account-based: the contract is the source of truth and `totalSupply` is exact, which fits DeFi that needs balances.
This standard is for assets that exist only as native shielded UTXOs, where that account model adds state and a public balance map for no gain.
They compose (same mint primitive) but differ in guarantees — notably supply exactness — so they stay separate interfaces.

### Why two profiles instead of one parameterized module?

A single multi-domain module would force every single-token issuer to hardcode a domain in their own unaudited wrapper. The Fungible profile provides that once, audited, with cheaper scalar supply cells.
This is not an ERC-20-vs-ERC-1155 split (those differ in transfer interface; native tokens have none) — the Family profile answers a Midnight composability constraint, below.

### Why does the Family profile use a per-call `domain`?

Midnight has no cheap clone-factory deployment: one contract is one address with its own circuits, and a contract cannot instantiate another.
So a multi-asset protocol (e.g. an LP contract, one share token per pair) must issue multiple colors from one contract — what `tokenType(domain, contractAddress)` supports natively.

### Why family metadata?

A `domain -> (token0, token1)` registry in consumer state is more informative than any stored per-domain string, which would cost three maps, a gated setter, and an immutability story.
So the Family profile shares one `name`/`symbol`/`decimals` (the Uniswap V2 LP precedent); an issuer needing distinct branding adds per-domain metadata itself.

### Why one mint primitive plus an extension?

The core `_mint` maps one-to-one to the protocol primitive: the caller owns nonce uniqueness and gets recipient privacy with a secret nonce.
Derived-nonce minting is convenience with a trade-off — no caller nonce, but public inputs make recipients linkable by enumeration — so it stays a separate, optional extension that keeps the trade-off visible at the call site.

### Why two burn variants?

A same-tx coin must be spent transiently; a tree-resident coin needs a Merkle proof.
They take different input types and change semantics (forward vs auto-retain), so one circuit cannot do both — and accepting a `QualifiedShieldedCoinInfo` while internally receiving the coin would trust an `mt_index` it cannot use.

### Why return the refund/change coin?

Contract-initiated sends emit no ciphertext, so the circuit's return value is the only copy of a refund or change coin's info.
Discarding it strands value; returning `Maybe<ShieldedCoinInfo>` makes the delivery obligation explicit and testable.

### Why supply bounds, and why supply is an opt-in extension

Two decisions.
**Bounds, not exact:** an exact-looking `totalSupply` implies a guarantee the protocol cannot give (out-of-band burns are invisible), so naming `totalMinted`, `totalBurned`, and an upper-bound `totalSupply` is the honest interface.
**Opt-in extension:** the counter's ledger write is the only thing that makes a burn amount public, so tracking supply costs burn privacy — folding it into the core would force that on everyone. The choice is permanent (ledger layouts are fixed at deploy); mint amounts are public via `shieldedMints` either way.

### Why domain-separate the internal nonce chain?

Chain values are public, so if a coin nonce equaled one, the natural misuse of `_mint` (echoing the public `_nonce` back as the nonce) would collide with an internal mint.
Hashing under a fixed tag puts derived nonces in a namespace honest callers won't hit, removing the accidental collision (the deliberate one is in [Security Considerations](#security-considerations)).

### Naming

"Native shielded token" follows the ecosystem split: native (protocol-level UTXO) vs contract-based (ledger-state balances), and shielded vs unshielded.

| Candidate | Why not |
| --- | --- |
| `ZswapToken` | protocol jargon; Zswap also covers unshielded swap mechanics |
| `ShieldedToken` | ambiguous against shielded contract-based tokens |
| `NativeToken` | ambiguous against unshielded native UTXOs |

The short `NativeShieldedToken` goes to the Fungible profile (the common case); the multi-domain module is `NativeShieldedTokenFamily`.
`MultiToken` was rejected (it already means "ERC-1155 with `uri`" in the library, shared here in neither metadata model nor transfer semantics), as was the plural `NativeShieldedTokens` (one letter from the sibling — a misread/mistype hazard).

## Path to Active

### Acceptance Criteria

- Reference implementation merged into the [OpenZeppelin Compact Contracts library](https://github.com/OpenZeppelin/compact-contracts) with a full simulator-based test suite.
- At least one Midnight testnet deployment exercising the full surface (construction, both mint paths, both burns, supply getters), including the partial-burn refund path.
- A demonstrated wallet round-trip: mint, out-of-band delivery, wallet-to-wallet transfer, contract burn.
- Review through the [MIP process](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0001-mip-process.md) workshops.
- A security audit of the reference implementation.

### Implementation Plan

1. Land the native shielded token modules in OpenZeppelin Compact Contracts: the reference implementation is [PR #621](https://github.com/OpenZeppelin/compact-contracts/pull/621), tracking [issue #544](https://github.com/OpenZeppelin/compact-contracts/issues/544) (superseding the earlier [PR #559](https://github.com/OpenZeppelin/compact-contracts/pull/559)).
2. Add simulator and Vitest coverage for all behaviors above, including revert cases.
3. Deploy to testnet, then submit for formal MIP review.

## Backwards Compatibility Assessment

Purely additive: a new contract standard requiring no protocol or network changes.
Every primitive it uses (`mintShieldedToken`, `receiveShielded`, `sendShielded`, `sendImmediateShielded`, `evolveNonce`, `tokenType`, `shieldedBurnAddress`) exists in the current Compact Standard Library.
It does not conflict with [MIP-0004](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0004-fungible-token-standard-with-utxo.md): the two target different asset models and can coexist, including in one hybrid contract.
Tokens issued here are ordinary Zswap coins and interoperate with existing wallets, atomic swaps, and DApps that handle `ShieldedCoinInfo`.

The standard is forward compatible with contract-to-contract (C2C) calls: signatures accept `ContractAddress` recipients from day one, and the fixed ledger layout lets phase-two circuits be added to deployed tokens through a CMA verifier-key rotation with no state migration (mirroring the OpenZeppelin `FungibleToken` migration plan).
C2C does not revive the clone-factory pattern — it adds cross-contract calls, not cheap instantiation — so the multi-domain motivation is unaffected.

## Security Considerations

### Unrestricted issuance

The circuits carry no authorization. An ungated `_mint` is an infinitely mintable token; an ungated `_burnFromContract` lets anyone destroy treasury holdings. Consumers MUST gate all mint and burn circuits ([Access Control](#access-control)) and MUST NOT verify callers with `ownPublicKey()`.

### Commitment collisions and mint denial-of-service

Derived nonces are predictable from public state. An actor with access to `_mint` can pre-mint a coin with a future internal nonce's `(nonce, domain, value, recipient)` tuple, making that `_mintWithDerivedNonce` fail on duplicate-commitment rejection.
Namespace separation removes accidental collisions; this deliberate vector is mitigated operationally: gate both mint circuits, and prefer not exposing both for one domain to different trust levels. A failed mint is recoverable — any later mint with a different tuple advances the chain past the collision.

### Recipient linkability of derived-nonce mints

For `_mintWithDerivedNonce`, the commitment is recomputable from public state for any candidate recipient key, so recipients are effectively public. The later spend stays unlinkable (the nullifier needs the holder's secret).
An issuer needing recipient privacy at mint time MUST use `_mint` with a secret uniform nonce. Declining to `export` the nonce fields changes nothing — ledger state is public regardless.

### Coin delivery and value loss

The `ShieldedCoinInfo` from a mint and the `Maybe<ShieldedCoinInfo>` from a burn are the only copies available to recipients, since contract-initiated outputs emit no ciphertext.
A DApp SHOULD capture and deliver them; dropping them strands value irrecoverably. Test suites SHOULD assert on returned coin info, not only on ledger state.

### Wrong-color burns

`receiveShielded` validates commitment presence, not color. The mandated `coin.color == tokenType(domain, kernel.self())` assertion is the only barrier stopping a multi-domain contract from burning token A while accounting it against token B, which would corrupt both domains' supply bounds.

### Burn-address footguns

`shieldedBurnAddress()` is the all-zero public key — also the default `ZswapCoinPublicKey`. The mandated zero-checks on `recipient` (mint) and `refundTo` (burn) exist because a defaulted struct silently routes value to the burn address.

### Supply interpretation and burn privacy

`totalSupply` is an upper bound; integrators SHOULD present it as such, not as exact circulating supply.
`totalMinted` is independently verifiable from `shieldedMints` effects, so indexers can flag non-conforming implementations.
Composing the supply extension makes contract-mediated burn amounts public; omitting it keeps them private (see [Extension: Supply Accounting](#extension-supply-accounting)). Issuers MUST make this choice at deployment, since the ledger layout is then fixed.

### No post-issuance control

Once minted, coins are unconditionally transferable bearer instruments — no pause, freeze, clawback, or transfer restriction at this layer. A compliance-bound issuer (e.g. a regulated stablecoin) should treat this standard as the phase-one primitive and track [MPS-0013](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mps/mps-0013-zswap-business-logic.md) and [MPS-0021](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mps/mps-0021-phase2-contract-to-contract.md) for custom spend logic.

## Implementation

### Components

1. **Compact modules.** The core [`NativeShieldedToken`](https://github.com/OpenZeppelin/compact-contracts/blob/feat/native-shielded-token-supply/contracts/src/token/NativeShieldedToken.compact) and [`NativeShieldedTokenFamily`](https://github.com/OpenZeppelin/compact-contracts/blob/feat/native-shielded-token-supply/contracts/src/token/NativeShieldedTokenFamily.compact): the state and circuits above, composed with the library's `Utils` module, plus the optional extensions [`NativeShieldedTokenDerivedNonce`](https://github.com/OpenZeppelin/compact-contracts/blob/feat/native-shielded-token-supply/contracts/src/token/extensions/NativeShieldedTokenDerivedNonce.compact), [`NativeShieldedTokenSupply`](https://github.com/OpenZeppelin/compact-contracts/blob/feat/native-shielded-token-supply/contracts/src/token/extensions/NativeShieldedTokenSupply.compact), and [`NativeShieldedTokenFamilySupply`](https://github.com/OpenZeppelin/compact-contracts/blob/feat/native-shielded-token-supply/contracts/src/token/extensions/NativeShieldedTokenFamilySupply.compact).
2. **Mocks, simulators, and tests.** `MockNativeShieldedToken` and `MockNativeShieldedTokenFamily` compose the modules (including the supply extension) and expose their circuits, with TypeScript simulators and Vitest suites.
3. **No protocol changes required.**

### Dependencies

- [Compact Standard Library](https://docs.midnight.network/compact): `mintShieldedToken`, `receiveShielded`, `sendShielded`, `sendImmediateShielded`, `evolveNonce`, `tokenType`, `shieldedBurnAddress`, `Counter`, `ShieldedCoinInfo`, `QualifiedShieldedCoinInfo`, `Maybe`.
- [OpenZeppelin Compact Contracts](https://github.com/OpenZeppelin/compact-contracts): the `Utils` module; initialization tracked inline per-module rather than via the shared `Initializable` module.
- Compact language version >= 0.21.0.

## Testing

### Unit Tests

- `initialize`: all core circuits revert before initialization; double-initialize reverts; metadata getters return constructor values.
- `_mint`: returns coin info with `color == tokenColor(domain)` and the correct value; coin nonce equals the caller's; revert on zero recipient; distinct domains accumulate independent supplies (with the extension).
- `_mintWithDerivedNonce`: identical accounting; `_counter`/`_nonce` evolve per the properties; derived nonces never repeat.
- `_burn`: revert on wrong color, on `amount > coin.value`, and on zero `refundTo`; full burn returns `none`; partial burn returns `some(refund)` with `refund.value == coin.value - amount`.
- `_burnFromContract`: revert on wrong color and on `amount > coin.value`; change returned and owned by the contract; no receive claim emitted.
- Supply extension: `totalSupply == totalMinted - totalBurned` after arbitrary sequences; unknown domains read 0; getters do not gate on initialization; overflow guard on `_addMinted`.

### Integration Tests

- Network round-trip: mint to a wallet, out-of-band delivery, user pays the coin into `_burn`, refund spendable by `refundTo`.
- Treasury flow: mint to `kernel.self()`, `_burnFromContract` partial burn, persisted change burnable again.
- Multi-domain isolation: mints/burns under domain A do not affect domain B's supply or color checks.
- Invariant fuzzing: `totalMinted` exact vs simulator-observed mints; `circulating <= totalSupply` after including contract-bypassing burns (burn-address sends and imbalanced-offer protocol burns).
- Burn privacy: decode a bare `_burn` and assert no amount literal appears; decode the supply-composed path and assert the counter write discloses it.

## References (Optional)

- [MIP-0001: Midnight Improvement Proposal Process](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0001-mip-process.md)
- [MIP-0004: Fungible Token Standard with UTXO Conversion Extensions](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0004-fungible-token-standard-with-utxo.md)
- [MPS-0013: zswap-business-logic](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mps/mps-0013-zswap-business-logic.md)
- [MPS-0021: contract-to-contract phase 2](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mps/mps-0021-phase2-contract-to-contract.md)
- [OpenZeppelin Compact Contracts — Repository](https://github.com/OpenZeppelin/compact-contracts)
- [OpenZeppelin Compact Contracts — Issue #544: Add Shielded Native Token standard](https://github.com/OpenZeppelin/compact-contracts/issues/544)
- [OpenZeppelin Compact Contracts — PR #621: Reference implementation (native shielded token standard)](https://github.com/OpenZeppelin/compact-contracts/pull/621)
- [OpenZeppelin Compact Contracts — PR #559: Add shielded token (earlier draft, superseded)](https://github.com/OpenZeppelin/compact-contracts/pull/559)
- [Native shielded token indexing study — empirical decode of mint/burn visibility and supply reconstruction](https://github.com/0xisk/exploring-native-shielded-token-indexing)
- [Midnight Zswap Documentation](https://docs.midnight.network/concepts/zswap)
- [Midnight UTXO Model Documentation](https://docs.midnight.network/concepts/utxo)
- [The Compact Language](https://docs.midnight.network/compact)
- [Midnight Ledger Specification (`ledger-8`) — Zswap and contract effects](https://github.com/midnightntwrk/midnight-ledger/tree/ledger-8/spec)

## Acknowledgments

This proposal builds on the OpenZeppelin Compact Contracts library and its archived shielded-token exploration, on the Midnight ledger specification, and on issuance patterns seen in ecosystem applications.

## Copyright Waiver

All contributions (code and text) submitted in this MIP must be licensed under the Apache License, Version 2.0.
Submission requires agreement to the Midnight Foundation Contributor License Agreement, which includes the assignment of copyright for your contributions to the Foundation.
