---
MIP: XXXX
Title: Native Token Conversion Extension
Authors:
  - Iskander Andrews (0xisk)
  - Andrew Fleming (andrew-fleming)
Status: Draft
Category: Standards
Created: 2026-06-10
Requires: MIP-XXXX (Native Shielded Token Standard), MIP-XXXX (Native Unshielded Token Standard)
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

This MIP defines an optional extension that converts a native token between its two representations — shielded ([Zswap](https://docs.midnight.network/concepts/zswap) coins) and unshielded (Schnorr-signed [UTXOs](https://docs.midnight.network/concepts/utxo)) — by composing the [Native Shielded Token Standard](./mip-xxxx-native-shielded-token.md) and the [Native Unshielded Token Standard](./mip-xxxx-native-unshielded-token.md). It introduces three conversion circuits: `_unshield` (shielded → unshielded) and `_shield` / `_shieldWithNonce` (unshielded → shielded). Each conversion is exactly one base-standard burn plus one base-standard mint, so the extension carries **no ledger state of its own**: all checks (initialization, color, zero targets) and all supply accounting are inherited from the two bases, and the cross-representation sum `shieldedTotalSupply(domain) + unshieldedTotalSupply(domain)` is invariant under conversion — it remains the upper bound on the logical token's circulating supply. Together with [MIP-0004](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0004-fungible-token-standard-with-utxo.md) — which converts between *account-based Map balances* and UTXOs — this completes the representation matrix for Midnight tokens. A reference implementation is provided as the `NativeTokenConverter` module in the [OpenZeppelin Compact Contracts library](https://github.com/OpenZeppelin/compact-contracts).

## Motivation

The shielded base standard issues privacy-first tokens; the unshielded base standard issues transparent ones. Several real flows need the *same logical token* in both forms:

- **Exchange and custodian integration**: custody systems audit holdings against publicly verifiable balances; unshielded value makes reserves provable without disclosure tooling, while retail holders keep shielded privacy.
- **Compliance and transparency**: regulated issuers may need a transparent treasury or a transparent slice of supply.
- **Tooling asymmetry**: explorers, indexers, and accounting systems handle unshielded value natively today; shielded value requires out-of-band coin delivery.

Without a standard conversion path, an issuer needing both representations must deploy two unrelated tokens and operate a trusted bridge between them — exactly the fragmentation and security risk that motivated MIP-0004 on the account-model side. The protocol already supports both representations under one contract: `tokenType(domain, kernel.self())` derives the same color bytes for both variants of a domain, and only that contract can mint either. What is missing is the standard interface, which this MIP provides as a thin, stateless composition of the two base standards.

[MIP-0004](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0004-fungible-token-standard-with-utxo.md) does not cover this case: its conversions move value between *Map balances* and UTXOs, with the account model as the source of truth. For purely native tokens there is no Map; the conversion needed is UTXO-to-UTXO across the privacy boundary.

## Specification

The key words MUST, MUST NOT, SHOULD, and MAY are to be interpreted as in RFC 2119. Terminology is inherited from the base standards.

### Relationship to the Base Standards

This extension MUST be deployed together with both base modules in the same contract (Compact module composition shares each imported module's state). The composition rules of the base standards apply, in particular:

- **Shared initialization**: the consumer MUST call exactly one base module's `initialize` and SHOULD expose metadata getters from that module only.
- **Per-representation accounting**: the shielded base's `totalMinted`/`totalBurned`/`totalSupply` describe the shielded representation; the unshielded base's describe the unshielded one. The logical token's circulating supply is bounded by the sum:

```math
\texttt{circulating}(d) \le \texttt{shieldedTotalSupply}(d) + \texttt{unshieldedTotalSupply}(d)
```

### Required State Extensions

None. The extension module declares no ledger state; conversions mutate only the base modules' state through the base circuits. This is normative: an implementation that duplicates supply accounting in the extension is non-compliant.

### Conversion Circuits

#### `_unshield` (shielded → unshielded)

```typescript
export circuit _unshield(
  domain: Bytes<32>,
  coin: ShieldedCoinInfo,
  amount: Uint<64>,
  recipient: Either<ContractAddress, UserAddress>,
  refundTo: Either<ZswapCoinPublicKey, ContractAddress>
): Maybe<ShieldedCoinInfo>
```

1. MUST revert if `amount == 0`.
2. MUST destroy `amount` of the shielded representation via the shielded base `_burn(domain, coin, amount, refundTo)` — inheriting its initialization assert, color check, value check, transient spend path, refund forwarding, zero-`refundTo` check, and `totalBurned` accounting.
3. MUST mint `amount` of the unshielded representation via the unshielded base `_mint(domain, recipient, amount)` — inheriting its zero-recipient check (the zero `UserAddress` is the unshielded burn address) and `totalMinted` accounting.
4. MUST return the shielded refund coin info (or `none` for a full conversion); the caller MUST deliver it to `refundTo` out of band. The unshielded output is publicly visible and needs no delivery.

The `Uint<64>` cap is imposed by the protocol's unshielded mint. Larger conversions require multiple calls.

#### `_shield` / `_shieldWithNonce` (unshielded → shielded)

```typescript
export circuit _shield(
  domain: Bytes<32>,
  amount: Uint<64>,
  recipient: Either<ZswapCoinPublicKey, ContractAddress>
): ShieldedCoinInfo

export circuit _shieldWithNonce(
  domain: Bytes<32>,
  amount: Uint<64>,
  recipient: Either<ZswapCoinPublicKey, ContractAddress>,
  nonce: Bytes<32>
): ShieldedCoinInfo
```

1. MUST revert if `amount == 0`.
2. MUST destroy `amount` of the unshielded representation via the unshielded base `_burn(domain, amount)` — absorbing the transaction-provided value, forwarding it to the unshielded burn address, with `totalBurned` accounting. The color is derived in-circuit from `domain`, so a caller cannot substitute a foreign token.
3. MUST mint the shielded representation per the shielded base: `_shield` via `_mint` (derived nonce — recipient-public), `_shieldWithNonce` via `_mintWithNonce` (caller nonce — recipient-private). Base zero-recipient checks and `totalMinted` accounting apply.
4. MUST return the new shielded coin's info; the caller MUST deliver it to `recipient` out of band.

### Conversion Invariant

Every conversion burns `amount` in one base's accounting and mints `amount` in the other's:

| Circuit | Shielded base | Unshielded base |
|---|---|---|
| `_unshield` | `totalBurned[d] += amount` | `totalMinted[d] += amount` |
| `_shield`* | `totalMinted[d] += amount` | `totalBurned[d] += amount` |

Therefore `shieldedTotalSupply(d) + unshieldedTotalSupply(d)` is invariant under conversion; it increases only on genuine issuance and decreases only on genuine burns. Implementations MUST preserve this invariant; test suites SHOULD assert it across arbitrary operation sequences.

### Access Control

Like the base standards, the conversion circuits are unrestricted building blocks. Unlike mint/burn, conversion is value-preserving, so consumers MAY expose conversions to all holders (the common case for a freely convertible token) or gate them (e.g. compliance-controlled unshielding). Consumers MUST make this an explicit decision and MUST NOT authenticate callers via `ownPublicKey()`.

## Rationale

### Why a stateless composition of two base standards?

An earlier draft of this extension carried its own unshielded mint/burn accounting (`unshieldedMinted`/`unshieldedBurned` maps) and called the protocol's unshielded primitives directly. Splitting the unshielded half into its own base standard is strictly better: unshielded issuance gets specified, audited, and reused once (standalone transparent tokens need it regardless of conversion); the converter shrinks to one burn plus one mint per direction, inheriting every check instead of duplicating them; and the supply invariant becomes a property of two independently meaningful quantities rather than extension-local bookkeeping. The "no own state" requirement is normative because duplicated accounting is precisely where composed-token implementations drift out of sync.

### Why burn-and-mint instead of a lock-and-release vault?

A vault (lock unshielded on `_shield`, release on `_unshield`) cannot bootstrap: the token starts in one representation, so the first conversion out of it has nothing locked to release and must mint anyway — yielding a hybrid with two code paths and a contract balance that conflates custodied and destroyed value. Burn-and-mint is symmetric, stateless, and makes ledger-level observation honest: destroyed value sits at the burn addresses, not in a live contract balance. MIP-0004 reaches the equivalent conclusion on the account side.

### Why per-representation accounting instead of MIP-0004's supply-neutral rule?

MIP-0004 mandates that conversions MUST NOT modify `totalSupply` because its `totalSupply` is the single logical total with the Map as source of truth. Native tokens have no single exact total — only per-representation bounds. Keeping each base's counters honest and letting the *sum* carry the logical bound achieves the same property (conversion does not change logical supply) without special-casing conversion circuits in the accounting.

### Why does `_unshield` support partial conversion but `_shield` does not?

Protocol-imposed asymmetry. A shielded coin is an indivisible UTXO: converting part of it requires splitting, which the shielded base `_burn` already implements via its refund path — so `_unshield` exposes `amount` + `refundTo` for free. Unshielded value provided to a contract is absorbed by amount, not by coin: the caller's wallet contributes exactly `amount`, so there is no remainder to refund.

### Why two shield variants?

The minted shielded coin has the same nonce trade-off as a base mint: derived nonces are operationally simple but recipient-public; caller nonces are recipient-private. A holder converting their own transparent funds into shielded form plausibly wants privacy for the *destination* — hiding which shielded commitment they now own — so the private variant matters here even more than at issuance. `_unshield` needs no variant: the unshielded side is public by nature, and the shielded refund's nonce is protocol-evolved.

### Relationship to MIP-0004

The standards complete a representation matrix and do not overlap:

| Conversion | Standard |
|---|---|
| Map balance ↔ shielded UTXO | MIP-0004 `shield`/`unshield` |
| Map balance ↔ unshielded UTXO | MIP-0004 `toUtxo`/`fromUtxo` |
| shielded UTXO ↔ unshielded UTXO (native token) | **this MIP** |

A hybrid contract MAY implement both; the accounting domains are disjoint (Map supply vs per-representation native supplies).

## Path to Active

### Acceptance Criteria

- Reference implementation merged into the [OpenZeppelin Compact Contracts library](https://github.com/OpenZeppelin/compact-contracts) alongside both base modules, with simulator-based tests covering the conversion invariant.
- Testnet deployment demonstrating round-trips in both directions, including a partial `_unshield` with shielded refund.
- Demonstrated unshielded interoperability: converted value visible to standard tooling and transferable wallet-to-wallet without contract interaction.
- Review through the [MIP process](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0001-mip-process.md); security audit together with the base modules.

### Implementation Plan

1. Land `NativeTokenConverter` in OpenZeppelin Compact Contracts as `token/extensions/`, composed from both base modules (tracking [issue #544](https://github.com/OpenZeppelin/compact-contracts/issues/544)).
2. Add the conversion-invariant test suite (see Testing).
3. Deploy a composed example (both bases + converter + access control) to testnet; submit for formal MIP review with the base MIPs.

## Backwards Compatibility Assessment

Purely additive: no protocol changes, and no changes to either base standard's circuits. Tokens deployed from a base standard *without* this extension cannot add it later (Compact ledger layouts are fixed at deploy); issuers who may ever need the second representation SHOULD deploy with the extension and both bases compiled in, even if conversions are initially gated off. The extension does not affect MIP-0004 contracts; the standards can coexist in one ecosystem and in one contract.

## Security Considerations

### Conversion inherits issuance risks

`_shield`/`_shieldWithNonce` mint shielded coins and `_unshield` mints unshielded value; all base-standard considerations apply unchanged: out-of-band coin delivery (dropping the returned `ShieldedCoinInfo` strands value), recipient linkability of derived-nonce mints, nonce-collision griefing against `_shieldWithNonce`, and the zero-address footguns on *both* sides (zero `ZswapCoinPublicKey` and zero `UserAddress` are the respective burn addresses; the base zero-checks are inherited).

### Unrestricted conversion as a policy bypass

If a consumer gates the base mints but leaves `_shield` open, anyone holding unshielded value can obtain shielded coins (and vice versa via `_unshield`). That is the *intended* semantics for a freely convertible token — conversion preserves value and the supply sum — but it is a bypass for issuers whose policy distinguishes the representations (e.g. "unshielded only for audited custodians"). Such issuers MUST gate the conversion circuits with the same rigor as mint/burn.

### Accounting integrity across representations

The conversion invariant holds because each base's `totalMinted` is exact, which in turn holds only if all issuance of the contract's colors flows through the base `_mint` circuits. A consumer that calls the protocol's raw `mintShieldedToken`/`mintUnshieldedToken` directly (outside the base modules) silently breaks the bound. Consumers MUST route all issuance of the standards' domains through the base circuits.

### Privacy boundary crossing

Conversion is the designed mechanism for moving value across the privacy boundary, and it leaks exactly what it must: `_unshield` publicly reveals `amount` and the unshielded recipient (the shielded source coin and refund remain unlinkable to third parties); `_shield` publicly reveals `amount` and the absorbed unshielded inputs, while the destination commitment is private if `_shieldWithNonce` is used with a secret nonce. DApps SHOULD warn users that converting reveals the converted amount even when both endpoints are otherwise private, and that repeated round-trips with matching amounts are correlatable.

## Implementation

### Components

1. **New Compact module**: [`NativeTokenConverter.compact`](https://github.com/OpenZeppelin/compact-contracts/tree/main/contracts/src/token/extensions) in OpenZeppelin Compact Contracts — stateless; imports `NativeShieldedToken` and `NativeUnshieldedToken` (shared module state).
2. **Mock + simulator + tests**: a composed mock exposing both bases' and the converter's circuits.
3. **No protocol changes required.**

### Dependencies

- The Native Shielded Token Standard and the Native Unshielded Token Standard, with their reference modules and dependencies.
- Compact language version >= 0.21.0. The reference implementation compiles against this toolchain.

## Testing

### Unit Tests

- `_unshield`: full conversion returns `none`; partial conversion returns shielded refund with `refund.value == coin.value - amount`; reverts on zero amount, zero recipient, zero refund, wrong color, `amount > coin.value`; shielded `totalBurned` and unshielded `totalMinted` both increase by `amount`.
- `_shield`/`_shieldWithNonce`: returned coin matches shielded base mint semantics (color, value, nonce handling per variant); reverts on zero amount and zero recipient; unshielded `totalBurned` and shielded `totalMinted` both increase by `amount`; absorbed unshielded value ends at the zero `UserAddress`, not in the contract balance.
- Statelessness: the extension adds no ledger fields; all observable state changes occur in the base modules.

### Integration Tests

- Round-trip: shielded mint → `_unshield` (full) → unshielded wallet-to-wallet transfer → `_shield` → shielded coin spendable by recipient.
- Partial round-trip: `_unshield` with refund → refund coin spent into a second `_unshield`.
- Invariant fuzzing: for random sequences of base mints, base burns, `_shield`, and `_unshield` across multiple domains, assert `shieldedTotalSupply(d) + unshieldedTotalSupply(d)` changes only on base mints and burns, never on conversions.

## References (Optional)

- [Native Shielded Token Standard (base MIP, this series)](./mip-xxxx-native-shielded-token.md)
- [Native Unshielded Token Standard (base MIP, this series)](./mip-xxxx-native-unshielded-token.md)
- [MIP-0001: Midnight Improvement Proposal Process](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0001-mip-process.md)
- [MIP-0004: Fungible Token Standard with UTXO Conversion Extensions](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0004-fungible-token-standard-with-utxo.md)
- [OpenZeppelin Compact Contracts — Repository](https://github.com/OpenZeppelin/compact-contracts)
- [Midnight UTXO Model Documentation](https://docs.midnight.network/concepts/utxo)
- [Midnight Zswap Documentation](https://docs.midnight.network/concepts/zswap)
- [The Compact Language](https://docs.midnight.network/compact)

## Acknowledgements

This extension adapts the conversion-circuit approach pioneered by MIP-0004 to the native-token setting, including its lessons on call-time color derivation, zero-amount protection, and hash-based caller authentication. Thanks to the MIP-0004 authors and the Midnight protocol and documentation teams.

## Copyright Waiver

All contributions (code and text) submitted in this MIP must be licensed under the Apache License, Version 2.0.
Submission requires agreement to the Midnight Foundation Contributor License Agreement [Link to CLA], which includes the assignment of copyright for your contributions to the Foundation.
