---
MIP: XXXX
Title: Native Unshielded Token Standard
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

This MIP defines a standard contract interface for **native unshielded tokens** on Midnight: tokens that exist as protocol-level, publicly visible (Schnorr-signed) [UTXOs](https://docs.midnight.network/concepts/utxo) rather than as balances in contract ledger state. It is the transparent sibling of the [Native Shielded Token Standard](./mip-xxxx-native-shielded-token.md) and shares its structure: the issuing contract is not a balance keeper — once minted, value moves wallet-to-wallet at the protocol level with no contract involvement — and the contract's role reduces to metadata (`name`, `symbol`, `decimals`, `tokenColor`), issuance (`_mint`), destruction (`_burn` for transaction-provided value, `_burnFromContract` for the contract's own balance), and supply accounting (`totalMinted` — exact, `totalBurned` — a lower bound, `totalSupply` — an upper bound). The unshielded setting removes the shielded standard's hardest problems: there are no coin commitments, hence no nonce machinery, no out-of-band coin delivery, and no transient-vs-Merkle spend split. The standard also defines the **unshielded burn address** (the all-zero `UserAddress`) as a shared ecosystem convention. A reference implementation is provided as the `NativeUnshieldedToken` module in the [OpenZeppelin Compact Contracts library](https://github.com/OpenZeppelin/compact-contracts); together with the shielded base standard it underpins the [Native Token Conversion Extension](./mip-xxxx-native-shielded-token-conversion-extension.md).

## Motivation

Native unshielded UTXOs are the right representation for assets that want protocol-level transferability *without* privacy: governance tokens, transparent treasuries, exchange-facing assets, and the publicly auditable half of dual-representation tokens. They are wallet-discoverable, indexer-friendly, and transferable peer-to-peer with no contract interaction.

As with the shielded case, there is no standard for issuing them. The primitives (`mintUnshieldedToken`, `receiveUnshielded`, `sendUnshielded`) are lower-level than they look:

- **No burn primitive.** The protocol offers no way to destroy unshielded value; without a shared convention, every project picks its own sink address, and indexers cannot recognize burns across projects.
- **Pass-through vs balance semantics.** Value provided to a contract within a transaction and value held in the contract's ledger-level balance require different handling (claim-and-forward vs balance spend), a distinction analogous to — though simpler than — the shielded transient/Merkle split.
- **Supply accounting.** As in the shielded case, holders can burn out-of-band, so contract-tracked supply is an upper bound and should be presented as such.

A standard also creates symmetry: the [Native Token Conversion Extension](./mip-xxxx-native-shielded-token-conversion-extension.md) converts between shielded and unshielded representations by composing one burn and one mint from the two base standards. Without an unshielded base standard, the conversion extension would have to hand-roll unshielded issuance and accounting — duplicating logic that deserves to be specified, audited, and reused once.

## Specification

The key words MUST, MUST NOT, SHOULD, and MAY are to be interpreted as in RFC 2119. Terminology (color, domain separator) is shared with the [Native Shielded Token Standard](./mip-xxxx-native-shielded-token.md); the per-call `domain` design and its rationale (multi-token contracts, no clone factories on Midnight) carry over unchanged.

### Required State

```typescript
export ledger _totalMinted: Map<Bytes<32>, Uint<128>>;
export ledger _totalBurned: Map<Bytes<32>, Uint<128>>;

export sealed ledger _name: Opaque<"string">;
export sealed ledger _symbol: Opaque<"string">;
export sealed ledger _decimals: Uint<8>;
```

No counter or nonce state: unshielded mints create no commitments.

### Initialization

```typescript
export circuit initialize(
  name_: Opaque<"string">,
  symbol_: Opaque<"string">,
  decimals_: Uint<8>
): []
```

1. MUST be invoked exactly once, from the consuming contract's constructor. All other circuits MUST revert if the module is not initialized.
2. **Composition rule:** when this module is composed with the shielded base standard in one contract (the dual-representation pattern), the initialization state is shared. The consumer MUST call exactly one base module's `initialize` (a second call reverts) and SHOULD expose metadata getters from that module only.

### Metadata Circuits

```typescript
export circuit name(): Opaque<"string">
export circuit symbol(): Opaque<"string">
export circuit decimals(): Uint<8>
export circuit tokenColor(domain: Bytes<32>): Bytes<32>
```

Identical semantics to the shielded standard: `tokenColor` MUST compute `tokenType(domain, kernel.self())` at call time, never in the constructor. Note that the shielded and unshielded representations of one domain share the same color bytes; the ledger distinguishes them structurally.

### Unshielded Burn Address

```typescript
export pure circuit unshieldedBurnAddress(): Either<ContractAddress, UserAddress> {
  return right<ContractAddress, UserAddress>(default<UserAddress>);
}
```

The all-zero `UserAddress`, for which no Schnorr signing key is known — mirroring the shielded zero-key burn address. Defining it in the standard makes burns recognizable to indexers across all implementations.

### Supply Circuits

```typescript
export circuit totalMinted(domain: Bytes<32>): Uint<128>
export circuit totalBurned(domain: Bytes<32>): Uint<128>
export circuit totalSupply(domain: Bytes<32>): Uint<128>
```

Same bound semantics as the shielded standard: `totalMinted` is exact (only this contract can mint its colors; all mints flow through `_mint`), `totalBurned` is a lower bound (out-of-band burns to the zero address are invisible to contract state), and `totalSupply` MUST equal their difference — an upper bound on circulating supply.

One transparency dividend: unlike the shielded case, the unshielded UTXO set is public, so indexers CAN compute exact circulating supply off-chain (subtracting value held at the burn address). The on-chain bound exists for in-circuit use and parity with the shielded standard.

### Mint Circuit

```typescript
export circuit _mint(
  domain: Bytes<32>,
  recipient: Either<ContractAddress, UserAddress>,
  amount: Uint<64>
): Bytes<32>
```

1. MUST revert if the module is not initialized, or if `recipient` is the zero address or zero `UserAddress` (the latter is the burn address).
2. MUST add `amount` to `_totalMinted[domain]` (reverting on overflow) and call `mintUnshieldedToken(domain, amount, recipient)`, returning the color.
3. No nonce, no variants, no out-of-band delivery: the output is publicly visible and wallet-discoverable. The `Uint<64>` cap is imposed by the protocol's mint.

### Burn Circuits

```typescript
export circuit _burn(domain: Bytes<32>, amount: Uint<128>): []
export circuit _burnFromContract(domain: Bytes<32>, amount: Uint<128>): []
```

**Common:** MUST revert if not initialized; MUST compute the color at call time; MUST send `amount` to `unshieldedBurnAddress()` and add `amount` to `_totalBurned[domain]`. The destroyed value MUST NOT remain in the contract's balance.

**`_burn` (transaction-provided value):** for value contributed by the caller's wallet within the current transaction. MUST absorb it via `receiveUnshielded(color, amount)` before forwarding to the burn address. There is no remainder to refund: unshielded value is absorbed by amount, not by coin, so the caller contributes exactly `amount`.

**`_burnFromContract` (contract-held value):** for the contract's own ledger-level balance. MUST NOT call `receiveUnshielded`; SHOULD assert sufficient balance via the balance *comparison* functions (`unshieldedBalanceGte`) for a readable error. Note the protocol caveat: balance reads reflect the balance at the start of the current execution and are not updated by sends, receives, or mints within the same call.

### Access Control

As in the shielded standard: the circuits are unrestricted building blocks; consumers MUST gate `_mint` and both burn circuits, and MUST NOT authenticate callers via `ownPublicKey()`.

### Out of Scope

`balanceOf` (of users), `allowance`, transfer mediation, and post-issuance controls are not representable: the contract cannot observe or restrict protocol-level UTXO movement. Conversion to and from the shielded representation is specified by the [Native Token Conversion Extension](./mip-xxxx-native-shielded-token-conversion-extension.md).

## Rationale

### Why a third standard instead of folding this into the shielded MIP?

The two asset classes have different guarantees and different audiences, and a combined document would force every section to fork ("if shielded … if unshielded …"). Concretely, the unshielded standard has no nonce machinery, no recipient-privacy variants, no coin-delivery obligations, and a simpler burn split — roughly half the shielded standard's security surface. Keeping them separate lets each be adopted, reviewed, and audited on its own, while the conversion extension formally ties them together for dual-representation tokens.

### Why `Uint<128>` burn amounts but `Uint<64>` mints?

The asymmetry is protocol-imposed, exactly as in the shielded standard: mints are recorded as `u64` in transaction effects, while unshielded receive/send operate on `u128`. Burning more than `2^64 - 1` in one call is legitimate (the value may aggregate many mints).

### Why two burn variants when unshielded value is account-like for contracts?

A contract's unshielded holdings are a ledger-level balance, but value arriving *in the current transaction* must still be explicitly claimed (`receiveUnshielded`) before it can be forwarded — the pass-through pattern. Conflating the two (e.g. always claiming a receive) would either fail for treasury burns (no transaction input exists to claim) or silently double-claim. The split mirrors the shielded standard's `_burn` / `_burnFromContract` for interface symmetry.

### Why specify the burn address?

"Send to a dead address" is only a burn if everyone agrees which address is dead. A per-implementation choice fragments indexer logic and invites rugs-by-typo (a "burn" address someone can actually spend from). The all-zero `UserAddress` is unambiguous, key-less, and symmetric with the shielded convention.

## Path to Active

### Acceptance Criteria

- Reference implementation merged into the [OpenZeppelin Compact Contracts library](https://github.com/OpenZeppelin/compact-contracts) with simulator-based tests.
- Testnet deployment exercising mint, both burn paths, and supply getters; minted value transferred wallet-to-wallet without contract interaction.
- Review through the [MIP process](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0001-mip-process.md); security audit together with the sibling standards.

### Implementation Plan

1. Land `NativeUnshieldedToken` in OpenZeppelin Compact Contracts alongside the shielded base module (tracking [issue #544](https://github.com/OpenZeppelin/compact-contracts/issues/544)).
2. Add the test suite (see Testing); validate the dual-representation composition with the conversion extension.
3. Deploy to testnet; submit for formal review with the sibling MIPs.

## Backwards Compatibility Assessment

Purely additive: no protocol changes; all primitives exist in the current Compact Standard Library. Coexists with the shielded base standard (including in a single dual-representation contract, subject to the shared-initialization rule) and with [MIP-0004](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0004-fungible-token-standard-with-utxo.md) contracts. As with the sibling standards, Compact ledger layouts are fixed at deploy: consumers cannot add this module to an already-deployed contract.

## Security Considerations

### Unrestricted issuance

Identical to the shielded standard: ungated `_mint` means an infinitely mintable token; ungated `_burnFromContract` lets anyone destroy treasury holdings. Gate everything; never `ownPublicKey()`.

### Zero-address footgun

The zero `UserAddress` is simultaneously the default struct value and the burn address. The mandated zero-check on `recipient` exists because a defaulted recipient would silently burn the minted value.

### Balance-read semantics

`_burnFromContract`'s balance check reads the balance at the start of execution; multiple balance-spending operations in one call sequence can pass individual checks while jointly overdrawing — the ledger-level balance enforcement is the real guard, and the in-circuit assert is for readable errors only. Implementations MUST NOT treat the assert as the safety mechanism.

### Supply interpretation

On-chain `totalSupply` is an upper bound (out-of-band burns). For this standard, exact circulating supply IS computable off-chain from the public UTXO set; indexers SHOULD prefer that and subtract burn-address holdings.

### No post-issuance control

As in the shielded standard: minted value is an unconditionally transferable bearer instrument. No pause, freeze, or clawback at this layer.

### Transparency is the point — and a commitment

Everything about this token is public: amounts, holders, transfers. Issuers MUST NOT treat it as "shielded later": an unshielded history is permanent even if value is subsequently converted to the shielded representation via the conversion extension.

## Implementation

### Components

1. **New Compact module**: [`NativeUnshieldedToken.compact`](https://github.com/OpenZeppelin/compact-contracts/tree/main/contracts/src/token) in OpenZeppelin Compact Contracts, composed with the library's `Initializable` module.
2. **Mock + simulator + tests**: `MockNativeUnshieldedToken.compact` with a TypeScript simulator and Vitest suite.
3. **No protocol changes required.**

### Dependencies

- [Compact Standard Library](https://docs.midnight.network/compact): `mintUnshieldedToken`, `receiveUnshielded`, `sendUnshielded`, `unshieldedBalanceGte`, `tokenType`, `UserAddress`.
- [OpenZeppelin Compact Contracts](https://github.com/OpenZeppelin/compact-contracts): `Initializable` module.
- Compact language version >= 0.21.0. The reference implementation compiles against this toolchain.

## Testing

### Unit Tests

- `initialize`: all circuits revert before initialization; double-initialize reverts; metadata getters return constructor values; shared-flag composition (initializing the shielded sibling satisfies this module's initialization assert).
- `_mint`: returns the correct color; `_totalMinted[domain]` incremented; revert on zero recipient and zero `UserAddress`; overflow guard.
- `_burn`: value absorbed and forwarded to the burn address; `_totalBurned[domain]` incremented; nothing remains in the contract balance.
- `_burnFromContract`: revert on insufficient balance; burns from contract holdings; no receive claim emitted.
- Supply getters: `totalSupply == totalMinted - totalBurned`; unknown domains return 0; multi-domain isolation.

### Integration Tests

- Round-trip on network: mint to user wallet → wallet-to-wallet transfer (no contract interaction) → holder contributes value into `_burn`.
- Treasury flow: mint to `kernel.self()` → `_burnFromContract`.
- Burn-address verification: burned value sits at the zero `UserAddress` and is unspendable.
- Dual-representation composition with the shielded base + conversion extension (covered in the extension MIP's tests).

## References (Optional)

- [Native Shielded Token Standard (sibling base MIP, this series)](./mip-xxxx-native-shielded-token.md)
- [Native Token Conversion Extension (this series)](./mip-xxxx-native-shielded-token-conversion-extension.md)
- [MIP-0001: Midnight Improvement Proposal Process](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0001-mip-process.md)
- [MIP-0004: Fungible Token Standard with UTXO Conversion Extensions](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0004-fungible-token-standard-with-utxo.md)
- [OpenZeppelin Compact Contracts — Repository](https://github.com/OpenZeppelin/compact-contracts)
- [Midnight UTXO Model Documentation](https://docs.midnight.network/concepts/utxo)
- [The Compact Language](https://docs.midnight.network/compact)

## Acknowledgements

This proposal mirrors the structure of the Native Shielded Token Standard and inherits conventions from MIP-0004 (call-time color derivation, hash-based caller authentication). Thanks to the Midnight protocol and documentation teams.

## Copyright Waiver

All contributions (code and text) submitted in this MIP must be licensed under the Apache License, Version 2.0.
Submission requires agreement to the Midnight Foundation Contributor License Agreement [Link to CLA], which includes the assignment of copyright for your contributions to the Foundation.
