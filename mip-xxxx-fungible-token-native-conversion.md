---
MIP: XXXX
Title: Fungible Token Native Conversion Extension
Authors:
  - Iskander Andrews (0xisk)
  - Andrew Fleming (andrew-fleming)
Status: Draft
Category: Standards
Created: 2026-06-10
Requires: none
Replaces: MIP-0004
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

This MIP defines a standard extension to the [OpenZeppelin `FungibleToken`](https://github.com/OpenZeppelin/compact-contracts/blob/main/contracts/src/token/FungibleToken.compact) — Midnight's account-based (Map) token — that converts balances to and from both native [UTXO](https://docs.midnight.network/concepts/utxo) representations: shielded ([Zswap](https://docs.midnight.network/concepts/zswap)) coins via `_shield` / `_shieldWithNonce` / `_unshield`, and unshielded value via `_toUnshielded` / `_fromUnshielded`. It shares the goals of [MIP-0004](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0004-fungible-token-standard-with-utxo.md) and proposes to supersede it, fixing two structural problems: (1) inbound conversions **destroy** the absorbed UTXO-side value at the protocol burn addresses instead of holding it in contract custody, eliminating a latent issuer double-spend that the Contract Maintenance Authority's upgrade mechanism would otherwise hold in escrow; and (2) supply is modeled with a **reserve account** — outbound conversions transfer the Map balance to the contract's own account, inbound conversions pay credits from it — so the base invariant `sum(balances) == totalSupply` holds exactly at all times, the outstanding UTXO-side value is simply `balanceOf(RESERVE)` (exposed as `utxoSupply()`), and inbound conversions are structurally capped by outbound ones. The extension also adds explicit recipients, a recipient-private shielding variant, and partial unshielding with a shielded refund. A reference implementation (`FungibleTokenConverter`) is provided in the [OpenZeppelin Compact Contracts library](https://github.com/OpenZeppelin/compact-contracts).

## Motivation

The motivation of MIP-0004 stands: account-based tokens power DeFi logic, but only native UTXOs participate in Zswap atomic swaps, peer-to-peer transfers, and privacy-preserving payments; without a standard conversion interface, every project bridges ad hoc. This proposal exists because the MIP-0004 mechanics have problems that should not be standardized:

1. **Absorb-and-hold creates a latent issuer double-spend.** MIP-0004's `unshield` receives the shielded coin into the contract's ownership and credits the Map; `fromUtxo` absorbs unshielded value into the contract's ledger balance and credits the Map. The absorbed value continues to exist. No circuit spends it today, but the [CMA](https://docs.midnight.network/) can rotate verifier keys and add circuits later: an upgraded contract could spend the accumulated pile — value that was already credited back to Map balances. Inbound value must be *destroyed* at conversion time, at addresses no future verifier key can spend from.

2. **The stated supply invariant is false at ledger level.** MIP-0004 asserts `totalSupply = Σ Map balances + Σ UTXOs`, but after any inbound conversion the absorbed value is still a UTXO or contract balance *and* has been credited to the Map — the equation double-counts. Separately, its `_deductBalance` helper breaks the basic ERC-20 invariant `Σ balances == totalSupply`, which the `utxoSupply` counter then papers over and which can silently drift from reality.

3. **Inconsistent conversion semantics.** Outbound mints fresh UTXO value; inbound absorbs and holds. Neither vault nor burn-and-mint: ledger totals for the color grow monotonically with round trips while the contract accumulates an unbounded absorbed pile.

4. **Overstated privacy and inaccuracies about the extended library.** Non-exported ledger fields are not private (all Compact ledger state is public on-chain), so "keep `mintNonce` private" provides no protection; shield outputs with public nonce evolution are recipient-linkable. The current OZ `AccessControl` authenticates via witness-derived hash commitments, not `ownPublicKey()`; and `approve`/`allowance`/`transferFrom` work for user spenders today (only contract *recipients* are guarded pending C2C), so deferring them is unnecessary.

A detailed findings list is maintained alongside the reference implementation. This proposal keeps what MIP-0004 got right — call-time color derivation, zero-amount reverts, hash-based caller authentication, a stored single domain — and replaces the conversion mechanics and supply model.

## Specification

The key words MUST, MUST NOT, SHOULD, and MAY are to be interpreted as in RFC 2119. **Color**, **domain separator**, **same-tx coin**, and the **burn addresses** (zero `ZswapCoinPublicKey` for shielded, zero `UserAddress` for unshielded) are as defined in the Native Token Standards family ([shielded](./mip-xxxx-native-shielded-token.md), [unshielded](./mip-xxxx-native-unshielded-token.md)).

### Required State

```typescript
export sealed ledger _domain: Bytes<32>;
export ledger _nonce: Bytes<32>;
export ledger _counter: Counter;
```

- `_domain`: fixed at construction (`sealed`); with the contract address it determines the color of both UTXO representations. A single-token extension stores its domain, per MIP-0004's rationale (no caller-supplied domain misuse). The color MUST be computed at call time via `tokenType(_domain, kernel.self())` — never in the constructor.
- `_nonce` / `_counter`: the internal nonce chain for shielded mints. All ledger state is public on-chain regardless of `export`; see Security Considerations for what this implies.

### Initialization

```typescript
export circuit initialize(domainSep: Bytes<32>, initNonce: Bytes<32>): []
```

Called from the consuming contract's constructor alongside `FungibleToken_initialize` (which owns the shared `Initializable` flag — this circuit therefore MUST NOT call `Initializable_initialize` itself). Writing the sealed `_domain` makes the circuit constructor-only by the sealed-write rule. `initNonce` SHOULD be chosen unpredictably.

### The Reserve Account

```typescript
RESERVE() = right<Bytes<32>, ContractAddress>(kernel.self())
```

The contract's own address in the FungibleToken `_balances` map. Normative rules:

- Outbound conversions (`_shield`, `_shieldWithNonce`, `_toUnshielded`) MUST move the converted amount from the caller's Map balance to the reserve (the reference implementation uses `FungibleToken__unsafeTransfer(RESERVE(), value)`, which authenticates the caller through the base token's witness identity and permits the contract-address recipient).
- Inbound conversions (`_unshield`, `_fromUnshielded`) MUST pay the Map credit from the reserve (`FungibleToken__transfer(RESERVE(), creditTo, amount)`).
- Conversion circuits MUST NOT modify `totalSupply` and MUST NOT mutate balances by any other path.

Consequences (all normative):

- `sum(Map balances) == totalSupply` holds exactly at all times.
- `utxoSupply() == balanceOf(RESERVE())` — the outstanding UTXO-side value, with no separate counter.
- Inbound conversions are structurally capped: only this contract mints its colors, so UTXO-side value can never exceed what outbound conversions placed in the reserve, and the reserve transfer cannot underflow for honestly obtained UTXOs.

### Supply Circuits

```typescript
export circuit tokenColor(): Bytes<32>
export circuit utxoSupply(): Uint<128>
```

`utxoSupply` covers both representations combined. It is an **upper bound** on live UTXO-side value: holders who send UTXO value directly to a burn address (bypassing the contract) leave the corresponding reserve balance permanently locked — the honest-accounting caveat shared with the native standards.

### Outbound Conversion Circuits

```typescript
export circuit _shield(
  recipient: Either<ZswapCoinPublicKey, ContractAddress>,
  value: Uint<64>
): ShieldedCoinInfo

export circuit _shieldWithNonce(
  recipient: Either<ZswapCoinPublicKey, ContractAddress>,
  value: Uint<64>,
  nonce: Bytes<32>
): ShieldedCoinInfo

export circuit _toUnshielded(
  recipient: Either<ContractAddress, UserAddress>,
  value: Uint<64>
): Bytes<32>
```

1. MUST revert if not initialized, if `value == 0`, or if `recipient` is zero (either branch; the zero values are the burn addresses).
2. MUST transfer `value` from the caller's Map balance to the reserve (reverting on insufficient balance) and mint the corresponding representation to `recipient`.
3. `_shield` MUST derive the coin nonce from the internal chain in a domain-separated namespace (`persistentHash([pad(32, "FungibleTokenConverter:nonce"), chainValue])`) and MUST be documented as recipient-public. `_shieldWithNonce` uses the caller's nonce (recipient-private with a secret uniform nonce; caller responsible for uniqueness). `_toUnshielded` needs no nonce.
4. The recipient is an explicit parameter (conversion-to-other and contract recipients are legitimate); implementations MUST NOT silently substitute a witness-derived caller identity.
5. Callers MUST deliver the returned `ShieldedCoinInfo` to the recipient out of band (contract-initiated outputs carry no ciphertexts); the unshielded output needs no delivery.

The `Uint<64>` caps are imposed by the protocol mints; larger conversions take multiple calls.

### Inbound Conversion Circuits

```typescript
export circuit _unshield(
  coin: ShieldedCoinInfo,
  amount: Uint<128>,
  creditTo: Either<Bytes<32>, ContractAddress>,
  refundTo: Either<ZswapCoinPublicKey, ContractAddress>
): Maybe<ShieldedCoinInfo>

export circuit _fromUnshielded(
  creditTo: Either<Bytes<32>, ContractAddress>,
  amount: Uint<128>
): []
```

1. MUST revert if not initialized or if `amount == 0`.
2. `_unshield`: MUST assert `coin.color` equals the token's color and `amount <= coin.value`; MUST receive the same-tx coin and destroy `amount` at the shielded burn address via the **transient spend path** (`sendImmediateShielded`); MUST revert if `refundTo` is zero; if `amount < coin.value`, MUST forward the remainder to `refundTo` and return its coin info (else `none`).
3. `_fromUnshielded`: MUST absorb `amount` via `receiveUnshielded(color, amount)` and destroy it by `sendUnshielded(color, amount, unshieldedBurnAddress())`.
4. Both MUST pay `amount` from the reserve to `creditTo`. The destroyed value MUST NOT remain in the contract's shielded holdings or unshielded balance.
5. The credit amount derives from the destroyed amount, never from an unvalidated caller parameter (for `_unshield`, `amount` is validated against `coin.value`; MIP-0004's rule of deriving from the coin is preserved with partial-amount support added).

### Access Control

The circuits are unrestricted building blocks. Conversion is value-preserving, so consumers MAY leave it open to all holders or gate it as policy requires, and MUST NOT authenticate callers via `ownPublicKey()` (the base token's witness-commitment identity already authenticates the Map-balance debit on outbound conversions; inbound conversions are self-authorizing — the caller must contribute the UTXO value being converted).

## Rationale

### Why destroy inbound value instead of holding it?

Held value is one CMA verifier-key rotation away from being spendable. Even a perfectly honest issuer cannot prove they will never add such a circuit; the trust assumption is structural. Value at the burn addresses (zero shielded key, zero `UserAddress`) is unspendable under any verifier key, present or future. The cost — re-minting on the next outbound conversion rather than releasing held value — is one mint claim per conversion.

### Why a reserve account instead of `_deductBalance`/`_creditBalance`?

Three reasons. First, invariants: supply-neutral balance mutation breaks `Σ balances == totalSupply`, the single most load-bearing ERC-20 property for audits and indexers; the reserve transfer preserves it exactly. Second, accounting: a separate `utxoSupply` counter must be incremented and decremented correctly in four places to stay truthful; `balanceOf(RESERVE)` cannot drift because it *is* the accounting. Third, surface: the reserve model reuses the audited base-token transfer circuits instead of introducing new balance-mutating helpers.

### Why explicit recipients?

MIP-0004's `shield(amount)` mints to an implicit caller identity. Making the recipient a parameter costs nothing, enables shield-to-other and contract recipients, and removes a hidden witness dependency from the interface. The Map-balance *debit* is still authenticated via the base token's caller identity; only the *destination* is caller-chosen, which is the caller's prerogative.

### Why partial unshield?

A shielded coin is indivisible; all-or-nothing unshielding forces wallets to pre-split coins in a separate transaction. The refund path (destroy `amount`, refund the remainder as a shielded coin) is the same pattern as the native shielded standard's `_burn` and costs one additional transient send.

### What is kept from MIP-0004

Call-time color derivation (the constructor `kernel.self()` mismatch finding), zero-amount reverts, the stored single `domain` for a single-token extension, deriving credits from validated coin values, hash-based caller authentication and the prohibition on `ownPublicKey()` — and the overall four-circuit shape and naming spirit.

### Relationship to the Native Token Standards family

This extension is the account-model column of the representation matrix; the [Native Token Conversion Extension](./mip-xxxx-native-shielded-token-conversion-extension.md) is the native-token column. They share conventions (burn addresses, nonce domain separation, recipient-private variants, honest supply bounds) but compose different bases: this one extends `FungibleToken`, that one composes the two native base standards.

| Conversion | Standard |
|---|---|
| Map ↔ shielded UTXO | **this MIP** (`_shield`/`_unshield`) |
| Map ↔ unshielded UTXO | **this MIP** (`_toUnshielded`/`_fromUnshielded`) |
| shielded ↔ unshielded (native) | Native Token Conversion Extension |

## Path to Active

### Acceptance Criteria

- Reference implementation merged into the [OpenZeppelin Compact Contracts library](https://github.com/OpenZeppelin/compact-contracts) with simulator-based tests, including the reserve invariant (`Σ balances == totalSupply` and `utxoSupply == balanceOf(RESERVE)` after arbitrary operation sequences).
- Testnet deployment exercising all five conversion circuits, including a partial `_unshield` with refund and a Zswap atomic swap using shielded output from `_shield`.
- Review through the [MIP process](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0001-mip-process.md); security audit of the reference implementation.
- Disposition of MIP-0004 agreed with its authors (supersession or merge of fixes).

### Implementation Plan

1. Land `FungibleTokenConverter` in OpenZeppelin Compact Contracts as `token/extensions/`.
2. Add the test suite (see Testing); validate against the existing `FungibleToken` suite for non-interference.
3. Engage the MIP-0004 authors on the findings; deploy to testnet; submit for formal review.

## Backwards Compatibility Assessment

Purely additive to `FungibleToken`: no changes to base circuits, no protocol changes. Not wire-compatible with MIP-0004 deployments (different state layout and inbound semantics); since both proposals are Draft and Compact ledger layouts are fixed at deploy, supersession before adoption is the cheap moment to fix the mechanics. Coexists with the Native Token Standards family; the shielded coins minted by `_shield` are ordinary Zswap coins interoperable with wallets and atomic swaps.

## Security Considerations

### No custodial pile, by construction

Inbound destruction (Motivation, item 1) removes the upgrade-rug vector. Auditors SHOULD verify that no circuit in a consuming contract can spend from the burn addresses' value or mint the token's colors outside the conversion and base-token paths — outside mints break the reserve cap.

### Reserve-account hygiene

The reserve is an ordinary Map account at the contract's own address. The consuming contract MUST NOT expose any circuit that transfers from the reserve other than the inbound conversions (e.g. MUST NOT mint to it, MUST NOT include it in administrative sweep circuits). Auditors SHOULD treat any other reserve debit as a critical finding: it lets Map value be extracted against UTXOs that still circulate.

### Recipient linkability of `_shield`

Derived nonces make `_shield` recipient-public (commitment brute-force over candidate keys), and the kernel discloses mint amount and domain. `_shieldWithNonce` with a secret uniform nonce hides the recipient. Note that declining to `export` the nonce fields would change nothing: ledger state is public on-chain.

### Coin delivery

The `ShieldedCoinInfo` returned by `_shield`/`_shieldWithNonce` and the refund from `_unshield` are the only copies available to their recipients (no ciphertexts). DApps MUST capture and deliver them; test suites SHOULD assert on returned coin info.

### Zero-address footguns

Both burn addresses are default struct values; the mandated zero-checks on `recipient` and `refundTo` exist because defaulted arguments silently burn value. `creditTo` is zero-checked by the base token's transfer path.

### Out-of-band burns lock reserve value

A holder who sends UTXO value directly to a burn address makes the matching reserve balance permanently unreachable — economically a burn whose amount remains inside `totalSupply`. Indexers SHOULD treat `utxoSupply` as an upper bound on live UTXO-side value.

## Implementation

### Components

1. **New Compact module**: [`FungibleTokenConverter.compact`](https://github.com/OpenZeppelin/compact-contracts/tree/main/contracts/src/token/extensions) — state and circuits as specified, composing `FungibleToken`, `Initializable`, and `Utils`.
2. **Mock + simulator + tests**: `MockFungibleTokenConverter.compact` composing base + extension.
3. **No protocol changes required.**

### Dependencies

- [OpenZeppelin Compact Contracts](https://github.com/OpenZeppelin/compact-contracts): `FungibleToken`, `Initializable`, `Utils`.
- [Compact Standard Library](https://docs.midnight.network/compact): `mintShieldedToken`, `receiveShielded`, `sendImmediateShielded`, `shieldedBurnAddress`, `mintUnshieldedToken`, `receiveUnshielded`, `sendUnshielded`, `evolveNonce`, `tokenType`, `Counter`, `UserAddress`.
- Compact language version >= 0.21.0. The reference implementation compiles against this toolchain.

## Testing

### Unit Tests

- Outbound: caller balance decreases and reserve increases by `value`; `totalSupply` unchanged; returned coin/color correct; reverts on zero value, zero recipient, insufficient balance.
- `_shield` nonce chain evolves per spec; `_shieldWithNonce` uses the caller's nonce.
- `_unshield`: reserve decreases and `creditTo` increases by `amount`; destroyed value at the shielded burn address; partial conversion returns refund with `refund.value == coin.value - amount`; reverts on wrong color, `amount > coin.value`, zero amount, zero refund.
- `_fromUnshielded`: absorbed value ends at the zero `UserAddress`, not in the contract balance; reserve-to-`creditTo` transfer correct.
- Invariants after arbitrary sequences: `Σ balances == totalSupply`; `utxoSupply() == balanceOf(RESERVE())`.

### Integration Tests

- Round-trips: mint → `_shield` → `_unshield` (full and partial) → balances restored; mint → `_toUnshielded` → wallet-to-wallet unshielded transfer → `_fromUnshielded`.
- Zswap atomic swap between two tokens implementing this standard (mirroring MIP-0004's demonstration).
- Non-interference: the full base `FungibleToken` test suite passes unchanged on the composed contract.

## References (Optional)

- [MIP-0004: Fungible Token Standard with UTXO Conversion Extensions](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0004-fungible-token-standard-with-utxo.md) (superseded by this proposal)
- [Native Shielded Token Standard (this series)](./mip-xxxx-native-shielded-token.md)
- [Native Unshielded Token Standard (this series)](./mip-xxxx-native-unshielded-token.md)
- [Native Token Conversion Extension (this series)](./mip-xxxx-native-shielded-token-conversion-extension.md)
- [MIP-0001: Midnight Improvement Proposal Process](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0001-mip-process.md)
- [OpenZeppelin Compact Contracts — FungibleToken](https://github.com/OpenZeppelin/compact-contracts/blob/main/contracts/src/token/FungibleToken.compact)
- [Midnight Zswap Documentation](https://docs.midnight.network/concepts/zswap)
- [Midnight UTXO Model Documentation](https://docs.midnight.network/concepts/utxo)
- [The Compact Language](https://docs.midnight.network/compact)

## Acknowledgements

This proposal builds directly on MIP-0004 by Guido De Vita (Sommet Labs), whose groundwork — the conversion-circuit shape, call-time color derivation, and hash-based authentication guidance — it retains. The findings motivating the revised mechanics were identified while drafting the Native Token Standards family. Thanks to the Midnight protocol and documentation teams.

## Copyright Waiver

All contributions (code and text) submitted in this MIP must be licensed under the Apache License, Version 2.0.
Submission requires agreement to the Midnight Foundation Contributor License Agreement [Link to CLA], which includes the assignment of copyright for your contributions to the Foundation.
