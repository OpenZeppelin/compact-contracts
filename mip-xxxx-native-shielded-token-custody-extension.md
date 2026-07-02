---
MIP: XXXX
Title: Native Shielded Token Custody Extension
Authors:
  - Iskander Andrews (0xisk)
  - Andrew Fleming (andrew-fleming)
Status: Draft
Category: Standards
Created: 2026-06-11
Requires: Native Shielded Token Standard (MIP-XXXX)
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

This MIP defines an OPTIONAL extension to the Native Shielded Token Standard that adds a **policy-enforceable custodial representation**: value held in contract-ledger state, where every movement is a circuit call and issuer policy (freeze, pause) is enforceable. Two profiles are specified. The **Transparent Custody** profile keeps a public balance map — simplest, fully auditable, supports administrative seizure. The **Shielded Custody** profile keeps custodial value as notes (hash commitments spent by nullifier), hiding individual balances, holders, and the internal transfer graph from public observers while preserving freeze and pause; its disclosure properties are specified in [Privacy Analysis](#privacy-analysis). Both profiles share the conversion boundary: `_deposit` (native coin in, custodial credit out — the coin is destroyed) and `_withdraw` (custodial debit in, fresh native coin out — the **irrevocable policy exit**). Custody is burn-and-mint, never lock-and-hold. Reference implementations are provided as `extensions/NativeShieldedTokenCustody.compact` and `extensions/ShieldedCustody.compact` in the [OpenZeppelin Compact Contracts library](https://github.com/OpenZeppelin/compact-contracts).

## Motivation

The Midnight protocol attaches no spend logic to native shielded UTXOs. A Zswap spend proves exactly three things: knowledge of the holder's secret key, Merkle membership of the coin commitment, and nullifier correctness. The ledger state carries no per-token policy fields of any kind — no freeze flags, no pause, no allow/deny lists, no issuer hooks — and the token type is never re-checked against the issuing contract at spend time. Once a coin reaches a user wallet it is an unconditional bearer instrument; the issuer has zero residual control. Protocol-level programmable spend conditions are under separate discussion ([MPS-0013](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mps/mps-0013-zswap-business-logic.md), [MPS-0021](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mps/mps-0021-phase2-contract-to-contract.md)) and have not landed.

Regulated issuers — bank deposits, e-money, RWA issuance — cannot ship on bearer-only semantics: they are required to freeze accounts, pause transfers during incidents, and execute court-ordered seizures. Today the only place such policy is enforceable is contract ledger state, where every movement is a circuit call the contract can refuse.

This extension standardizes that pattern as **freeze-until-exit**: value is custodied by default and fully policy-governed; exiting to a native shielded coin is an explicit, separately gated, irrevocable act. Issuers choose per deployment where they sit on the spectrum — from never exposing the exit (pure account semantics) to leaving it open (custody as a convenience layer over a bearer asset). Without a standard, every regulated issuer hand-rolls this composition and re-discovers its failure modes, the worst of which (holding deposited coins instead of destroying them) silently creates an issuer-controlled double-spend (see [Rationale](#why-burn-and-mint-instead-of-lock-and-hold)).

## Specification

### Terminology

- **Custodial balance**: Contract-ledger account entry representing a claim denominated in the token. Not a coin; no Zswap object exists for it.
- **Account**: `Either<Bytes<32>, ContractAddress>`, as in the account-based token standards. The left branch is an opaque 32-byte identifier (e.g. a hash commitment to a secret key per MIP-0004).
- **Deposit**: Conversion of a native shielded coin into custodial balance. The coin is destroyed.
- **Withdraw (exit)**: Conversion of custodial balance into a freshly minted native shielded coin. The policy boundary.
- **Freeze**: Per-account state blocking that account's participation in custodial movement and conversion.
- **Pause**: Contract-wide flag blocking all custodial movement and conversion.
- **Note** (Shielded profile): An opening `(ownerId, value, rho)` represented on-ledger only by its commitment. The custodial analog of a coin.
- **Nullifier** (Shielded profile): A per-note tag, computable only with the owner's secret key, disclosed at spend to prevent double-spends without linking to the commitment.
- **Account id / `ownerId`** (Shielded profile): `H(ownerDomain, secretKey)` — the pseudonymous identity the issuer authorizes at onboarding.

### Profiles

- **Transparent Custody** (reference module `NativeShieldedTokenCustody`): public balance map keyed by account. Specified by the sections below ([Required State](#required-state) through [Custodial Circuits](#custodial-circuits)).
- **Shielded Custody** (reference module `ShieldedCustody`): note commitments and nullifiers; specified in [Shielded Custody Profile](#shielded-custody-profile).

Both profiles share [Conversion Circuits](#conversion-circuits) semantics, [Supply Accounting](#supply-accounting) structure, and [Access Control](#access-control). An issuer picks exactly one profile per deployment. Selection criterion in one line: Transparent if policy must include seizure (moving value out of an account against its will) or regulator-facing per-account auditability; Shielded if holder privacy against public observers is required and freeze (immobilization) is a sufficient sanction.

### Required State

```typescript
export ledger _custodyBalances: Map<Either<Bytes<32>, ContractAddress>, Uint<128>>;
export ledger _custodySupply: Uint<128>;
export ledger _frozen: Map<Either<Bytes<32>, ContractAddress>, Boolean>;
```

- `_custodySupply` MUST equal the sum of `_custodyBalances` entries at all times.
- All of this state is public on-chain (as is all Compact ledger state): custodial balances and freeze flags are visible to any observer. See [Security Considerations](#custodial-state-is-public).
- The pause flag is composed from a pausable module (reference: the library `Pausable`), not duplicated here.

### Policy Matrix

Which checks each circuit MUST perform (beyond initialization):

| Circuit | not paused | account not frozen | notes |
|---|---|---|---|
| `_transfer` | ✔ | ✔ both parties | |
| `_deposit` | ✔ | ✔ credited account | |
| `_withdraw` | ✔ | ✔ debited account | the exit |
| `_mint` | ✔ | ✔ credited account | custodial issuance |
| `_burn` | ✔ | ✘ deliberately | seizure/redemption path |
| `_freeze` / `_unfreeze` | ✘ deliberately | — | compliance ops work while paused |

### Custodial Circuits

```typescript
export circuit balanceOf(account: Either<Bytes<32>, ContractAddress>): Uint<128>
export circuit custodySupply(): Uint<128>
export circuit isFrozen(account: Either<Bytes<32>, ContractAddress>): Boolean

export circuit _freeze(account: Either<Bytes<32>, ContractAddress>): []
export circuit _unfreeze(account: Either<Bytes<32>, ContractAddress>): []

export circuit _mint(account: Either<Bytes<32>, ContractAddress>, amount: Uint<128>): []
export circuit _burn(account: Either<Bytes<32>, ContractAddress>, amount: Uint<128>): []
export circuit _transfer(fromAccount: ..., to: ..., amount: Uint<128>): []
```

- `_mint` is custodial issuance: tokens policy-governed from birth, no native coin minted. It MUST NOT touch the base standard's native supply counters.
- `_burn` is the administrative redemption/seizure path. It MUST work against frozen accounts (consumers whose policy forbids seizure add the check in their wrapper).
- `_transfer` moves custodial balance with no Zswap interaction.
- Zero accounts MUST be rejected; balance debits MUST revert on insufficiency; `_custodySupply` MUST revert on overflow.

### Conversion Circuits

```typescript
export circuit _deposit(
  coin: ShieldedCoinInfo,
  amount: Uint<128>,
  creditTo: Either<Bytes<32>, ContractAddress>,
  refundTo: Either<ZswapCoinPublicKey, ContractAddress>
): Maybe<ShieldedCoinInfo>

export circuit _withdraw(
  account: Either<Bytes<32>, ContractAddress>,
  amount: Uint<64>,
  recipient: Either<ZswapCoinPublicKey, ContractAddress>,
  nonce: Bytes<32>
): ShieldedCoinInfo
```

- `_deposit` MUST destroy the absorbed native value via the base standard's `_burn` (transient receive + spend to the burn address; color and value checks inherited; partial amounts refunded to `refundTo`), then credit `creditTo`. The base `totalBurned` increments accordingly.
- `_deposit` MUST NOT retain the incoming coin as a contract holding (see [Rationale](#why-burn-and-mint-instead-of-lock-and-hold)).
- `_withdraw` MUST debit `account`, then mint a fresh native coin via the base standard's `_mint` (caller-supplied nonce; `Uint<64>` cap inherited from the protocol's mint). The base `totalMinted` increments accordingly.
- The coin returned by `_withdraw` is the only copy of its info; callers SHOULD deliver it out of band (no ciphertexts exist for contract-initiated outputs).
- Conversion amounts MUST be greater than zero.

### Supply Accounting

- `custodySupply()` is **exact** (sum of balances by construction).
- The base standard's `totalSupply()` remains the **upper bound on native circulating supply**: deposits increment `totalBurned`, withdrawals increment `totalMinted`, so the base bound stays correct without modification.
- The logical token's circulating supply is bounded by `custodySupply() + totalSupply()` — an exact custodial term plus the native upper bound.

### Construction and Composition

- The consuming contract's constructor MUST initialize the base token module (which owns the shared initialization flag). The Transparent profile requires no initializer of its own; the Shielded profile's `initialize` writes only its sealed instance salt (constructor-only by the sealed-write rule).
- The reference implementations compose the Fungible profile (`NativeShieldedToken`). Family-profile variants (per-domain custody) are structurally straightforward and deferred until a concrete consumer needs them.

### Shielded Custody Profile

#### State and Witnesses

```typescript
export sealed ledger _instanceSalt: Bytes<32>;
export ledger _notes: HistoricMerkleTree<20, Bytes<32>>;
export ledger _nullifiers: Set<Bytes<32>>;
export ledger _authorizedAccounts: MerkleTree<20, Bytes<32>>;
export ledger _custodySupply: Uint<128>;

witness wit_secretKey(): Bytes<32>;
witness wit_notePath(commitment: Bytes<32>): MerkleTreePath<20, Bytes<32>>;
witness wit_authPath(ownerId: Bytes<32>): MerkleTreePath<20, Bytes<32>>;
```

- `commitment = H(noteDomain, instanceSalt, H(ownerId, value, rho))`; `nullifier = H(nullifierDomain, instanceSalt, secretKey, rho)`. The instance salt prevents cross-contract linkability of identical openings. Domain tags MUST separate the owner-id, note, and nullifier derivations.
- `_notes` MUST be historic (spend proofs survive concurrent inserts; double-spends are prevented by nullifiers, not roots).
- `_authorizedAccounts` MUST be checked against its CURRENT root only. This is load-bearing for freeze: a historic-root check would let a frozen account keep proving membership against pre-freeze roots.
- Merkle paths supplied by witnesses MUST NOT be disclosed; implementations disclose only the computed root fed to the root check. Disclosing a note path links the spend to the deposit/transfer that created the note.

#### Spend Semantics

Every note spend (`_transfer`, `_burn`, `_withdraw`) MUST:

1. Bind ownership: recompute the commitment from the secret-key witness and the `(value, rho)` opening.
2. Prove membership of the commitment in `_notes` with a private path.
3. Disclose the nullifier, assert it unseen, and record it.
4. Prove the owner's `ownerId` is in `_authorizedAccounts` against the current root (the freeze check), with a private path.

#### Policy Circuits

```typescript
export circuit _authorizeAccount(ownerId: Bytes<32>): []
export circuit _freeze(index: Uint<64>): []
export circuit _unfreeze(ownerId: Bytes<32>, index: Uint<64>): []
```

- Onboarding inserts `ownerId` as an allowlist leaf; the issuer records the leaf index off-chain.
- `_freeze` overwrites the leaf at `index` with a tombstone: the current root changes and every note of that account becomes unspendable immediately — without the issuer knowing which notes those are. `_unfreeze` restores the id at the index.
- The circuits cannot verify which account occupies `index`; the issuer's `ownerId -> index` bookkeeping is trusted (see [Security Considerations](#shielded-profile-freeze-is-index-trusted)).
- `_freeze`/`_unfreeze`/`_authorizeAccount` MUST work while paused; all value movement MUST NOT.

#### Value Circuits

```typescript
export circuit _mint(ownerId: Bytes<32>, amount: Uint<128>, rho: Bytes<32>): []
export circuit _burn(value: Uint<128>, rho: Bytes<32>, amount: Uint<128>, rhoChange: Bytes<32>): []
export circuit _transfer(value: Uint<128>, rho: Bytes<32>, sendValue: Uint<128>,
                         recipientId: Bytes<32>, rhoOut: Bytes<32>, rhoChange: Bytes<32>): []
export circuit _deposit(coin: ShieldedCoinInfo, amount: Uint<128>, creditId: Bytes<32>,
                        rho: Bytes<32>, refundTo: ...): Maybe<ShieldedCoinInfo>
export circuit _withdraw(value: Uint<128>, rho: Bytes<32>, amount: Uint<64>,
                         recipient: ..., nonce: Bytes<32>, rhoChange: Bytes<32>): ShieldedCoinInfo
```

- `_mint` is custodial issuance to a note; the amount MUST be disclosed (aggregate supply auditability), the recipient stays inside the commitment. Recipients of mints, deposits, and transfers MUST be proven authorized.
- `_burn` is HOLDER-driven redemption only. **There is no administrative burn in this profile**: the issuer cannot spend notes it cannot see, so seizure is not representable — freezing (permanent immobilization) is the strongest sanction. Issuers requiring confiscation use the Transparent profile.
- Spends MUST always create the change note, even when its value is zero, so exact-amount operations are indistinguishable from partial ones (a conditional insert would also force disclosing the condition).
- Note openings travel out of band (sender to recipient; issuer to holder at mint), exactly like native coin info.

### Access Control

Every circuit in this extension is an ungated building block. Consumers MUST gate:

- Both profiles: pause/unpause and `_mint` behind issuer authorization; freeze circuits (`_freeze`, `_unfreeze`, and the Shielded profile's `_authorizeAccount`) behind compliance authorization.
- Transparent profile: `_burn` (seizure) behind issuer authorization; `_transfer`, `_deposit`, `_withdraw` behind caller-identity binding for the `fromAccount` / `creditTo` / `account` arguments.
- Shielded profile: `_transfer`, `_burn`, `_deposit`, `_withdraw` self-authenticate via the secret-key witness and MAY be left open; consumers add gating only where operational policy requires it.

Consistent with MIP-0004 and the base standard, implementations MUST NOT authenticate callers via `ownPublicKey()`.

## Policy Coverage and Seizability

This section answers a cross-cutting question directly: **can the full issuer policy set — including hard policies such as seize — be expressed in Compact under the custodial model, with no protocol-level custom spend logic and without leaving Zswap?** Every soft policy is expressible in both profiles. Seize is expressible in the Transparent profile only. Seize and per-holder privacy are mutually exclusive in a contract-custodial model without key escrow: the custodial model does not escape that tension, it relocates where the choice is made.

### Coverage matrix

| Policy | Transparent | Shielded | Mechanism |
|---|---|---|---|
| mint (custodial issuance) | ✔ | ✔ | credit balance / insert note; amount disclosed |
| burn (holder redemption) | ✔ | ✔ | debit balance / holder spends note |
| pause | ✔ | ✔ | composed `Pausable`; gates all value movement |
| freeze / unfreeze | ✔ | ✔ | balance-keyed flag / allowlist-leaf tombstone (immediate) |
| allow / blocklist / KYC | ✔ | ✔ | gate on account / `_authorizeAccount` membership |
| transfer restriction | ✔ | ✔ | wrapper gates on `_transfer` |
| **seize** (forced move/burn) | ✔ | ✘ | admin `_burn` rewrites a contract-controlled balance / **not representable** |
| per-account auditor visibility | ✔ (all public) | partial (aggregate public; per-account hidden) | viewing key / escrow needed for Shielded |
| amount privacy | ✘ | ✔ | — |
| holder + graph privacy | ✘ | ✔ | — |

Each soft policy is a guard or a state write the contract performs inside a circuit it controls, so it holds in both profiles. This matches the per-circuit obligations in [Policy Matrix](#policy-matrix). Only seize splits the profiles.

### Why seize works in Transparent and not in Shielded

Seize is the one policy that moves value out of an account against the holder's will. Whether that is possible is decided entirely by who controls the custodial representation:

- **Transparent.** Custodial value is a plaintext balance in a `Map` the contract owns. A gated circuit can overwrite any entry. `_burn` (the seizure path) deliberately skips the freeze check (see [Why does `_burn` skip the freeze check?](#why-does-_burn-skip-the-freeze-check)) so a frozen account stays reachable by the authority that froze it. Seize is a trivial state rewrite, identical in power to an account-based token. The cost: balances, pseudonymous identities, and the full transfer graph are public.
- **Shielded.** Custodial value is a note spendable only by disclosing a nullifier derived from the holder's secret key. The issuer holds no such key and cannot see which notes an account owns, so it cannot construct the spend. This is the same wall that makes seize impossible on native shielded coins: a Zswap spend requires the holder's secret, and no contract can spend a user's coin (the protocol Self-determination property). Private custody re-imports that wall. Freeze (permanent immobilization via the allowlist tombstone) is the strongest sanction; it immobilizes but never recovers value. Confiscation needs the Transparent profile or key escrow outside this standard.

### "Bank custody of the UTXOs" does not recover seize

A tempting intuition: if the bank holds the backing UTXOs inside the contract (the contract is the Zswap owner) while users hold notes as claims, that custody is enough to recover seize without leaving Zswap. It is not, for two compounding reasons:

1. **It is unsound.** Holding deposited coins as a contract-owned pile while crediting users is a latent issuer-controlled double-spend: a CMA verifier-key rotation can later add a spend circuit for the held pool, re-monetizing value already credited. This standard therefore mandates burn-and-mint, not lock-and-hold (see [Why burn-and-mint instead of lock-and-hold?](#why-burn-and-mint-instead-of-lock-and-hold)). In the sound design the bank holds no user-backing UTXOs; custody is pure ledger state.
2. **Even granting lock-and-hold, custody of the UTXOs is not the lever.** The thing seized is never the UTXO, it is the user's *claim*. A public ledger claim, the contract rewrites (and you have rebuilt the Transparent profile, public graph and all). A private note, the contract cannot touch (Shielded profile, no seize). Who owns the backing coins is orthogonal: seizability is decided by whether the claim is contract-controlled or holder-controlled.

Seize is recovered by moving the source of truth into contract-controlled ledger state, not by custodying UTXOs. The moment that state is made private to the holder, seize is lost again for the same reason it is lost on native coins.

### Migration when custom spend logic lands

If protocol-level programmable spend conditions ship ([MPS-0013](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mps/mps-0013-zswap-business-logic.md) / [MPS-0021](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mps/mps-0021-phase2-contract-to-contract.md), see [Future protocol work](#future-protocol-work)):

- **Soft policies migrate cleanly.** Freeze, pause, KYC, and transfer restriction are enforceable at a contract-mediated spend hook on native coins, so they carry to a native (holder-controlled) world without the custodial detour. The custodial control surface is expected to survive; the conversion boundary softens.
- **Seize does not migrate for free.** Seize works in Transparent only because the value sits in contract-controlled plaintext state, which is exactly the holder-control that a native model restores. A native-coin world recovers seize only if the protocol itself grants an authority a spend path (authority-spend predicate, viewing-key escrow, or similar). That is a protocol-design decision, not a gift of the custodial shortcut. Soft policies are portable; seize is the one that is load-bearing on the shortcut and must be re-earned at the protocol layer.

## Rationale

### Why burn-and-mint instead of lock-and-hold?

A custody design that holds deposited coins as a contract-owned pile is unsound on Midnight. Contract ledger layouts are fixed, but circuits are not: a CMA verifier-key rotation can add a spend circuit for held coins later, re-monetizing value that was already credited to custodial balances — an issuer-controlled double-spend, invisible at deposit time. Destroying the deposited coin (and minting fresh on exit) makes the absorbed value unspendable under any future verifier key. Color derivation guarantees equivalence: only the issuing contract can ever mint its color, so a withdrawal coin is the same token as a deposited one. This mirrors the reserve/destroy design of the `FungibleTokenConverter` extension. It also eliminates the entire treasury-coin state machine (persisting `QualifiedShieldedCoinInfo`, merging change, tracking `mt_index`).

### Why is the exit irrevocable and opt-out?

A coin minted by `_withdraw` is subject to the protocol's spend rules only — no freeze, pause, or clawback can reach it, ever. Pretending otherwise would be dishonest; gating the exit is the only honest control point. The standard therefore makes `_withdraw` a separate, separately gated circuit: issuers requiring perpetual policy simply do not expose it (the extension then degenerates to a pure account-based token), and issuers exposing it accept exits as deliberate and final, typically routing them through their compliance process.

### Why does `_burn` skip the freeze check?

Freezing exists for compliance, and the operations that follow a freeze (court-ordered seizure, forced redemption) act on the frozen account. A freeze check on `_burn` would make frozen funds unreachable to the very authority that froze them. The asymmetry is deliberate and documented; consumers whose policy forbids seizure add the check in one line.

### Why is freeze in the module but pause composed?

Per-account freeze is the extension's reason to exist and is checked in five circuits with account-specific semantics. Pause is a generic contract-wide switch the library already provides (`Pausable`); duplicating it would create two pause flags with unclear precedence.

### Why identity-agnostic accounts?

The library convention: modules ship mechanism, consumers bind identity (hash-commitment per MIP-0004, `Ownable`, `AccessControl`). Baking one identity scheme into the custody layer would force it on every issuer; banks in particular are expected to bind accounts to their own KYC-derived identifiers.

### Relation to MIP-0004

MIP-0004 starts from an account-based token and adds UTXO conversion; this extension starts from a native shielded token and adds an account-based policy layer. The compositions meet in the middle but answer different questions: MIP-0004's source of truth is the Map (supply exact, UTXOs derivative); here the native coin is the primary asset (base supply bounds unchanged) and custody is the policy domain around it. An issuer whose asset should never exist as a free bearer instrument is better served by MIP-0004 or a plain `FungibleToken`; this extension is for assets that are genuinely native-shielded but need a governed on-ramp/holding area.

### Why allowlist membership instead of a frozen-list (Shielded profile)?

Freeze needs a NON-membership statement ("this account is not frozen"), and the two natural encodings have opposite privacy costs. A public frozen `Set` checked at spend time requires disclosing the checked account id in every spend — a stable pseudonym that links all of an account's activity (the linkability caveat documented on `ShieldedAccessControl`'s nullifier checks). Inverting to an ALLOWLIST turns the statement into membership, which a Merkle path proves privately: only the computed root is disclosed, identical across all accounts. Freeze then has to be expressible as a tree update, which leaf-overwrite (`insertIndex` with a tombstone) provides — and it composes with the current-root-only check to take effect immediately. The trade is operational: the issuer must keep the `ownerId -> index` mapping off-chain.

### Why is aggregate supply public in the Shielded profile?

Hidden per-account balances and hidden total supply are different products. A custody whose total is hidden cannot prove its issuance to anyone — the issuer could inflate silently, which is disqualifying for exactly the regulated use cases this extension targets. Disclosing amounts only at supply-changing events (mint, burn, deposit, withdraw) keeps the aggregate exact and auditable while distribution and flow remain hidden. This mirrors the protocol's own design, where Zswap deltas and mints are public while coin ownership is not.

### Why always create the change note?

A conditional change note would leak the "exact-amount spend" bit twice: once structurally (one output instead of two) and once in the transcript (a ledger write inside a witness-dependent branch forces disclosure of the branch condition). Unconditionally writing a possibly-zero change note makes every spend shape-identical — the same uniformity argument behind fixed 2-output transactions in Zcash-lineage designs.

### Future protocol work

If protocol-level spend conditions land ([MPS-0013](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mps/mps-0013-zswap-business-logic.md)) or phase-two contract-to-contract custody patterns ([MPS-0021](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mps/mps-0021-phase2-contract-to-contract.md)), policy on native coins themselves becomes possible and this extension's exit boundary softens accordingly. The custodial interface (balances, freeze, pause) is expected to survive as the issuer-side control surface; the conversion circuits would gain policy-carrying alternatives.

## Privacy Analysis

This section specifies what the Shielded Custody profile discloses, to whom. (The Transparent profile discloses everything: balances, identities-as-pseudonyms, amounts, freeze flags, and the full transfer graph — its privacy is limited to whatever unlinkability the account identifiers themselves carry.)

### Observer classes

- **Public observer**: anyone reading chain state and transcripts.
- **Issuer**: performs onboarding (knows `ownerId -> real identity` from KYC and `ownerId -> leaf index`), executes admin circuits.
- **Counterparty**: the other side of a given operation, holding its out-of-band note opening.

### Disclosure by operation (public observer)

| Operation | Disclosed | Hidden |
|---|---|---|
| `_mint` | amount, new commitment, roots | recipient (inside commitment) |
| `_transfer` | one nullifier, two commitments, roots | **sender, recipient, both amounts** |
| `_burn` | amount, nullifier, change commitment, roots | which account redeemed |
| `_deposit` | incoming coin (value, color, nonce), amount, refund coin | which account was credited |
| `_withdraw` | amount, mint per base-module semantics, nullifier, change commitment | which account exited |
| `_authorizeAccount` | `ownerId` (pseudonym), leaf index | real identity |
| `_freeze` / `_unfreeze` | leaf index, tombstone/restored id, root change | which notes are affected |

### Unlinkability properties

- **Nullifier ↔ commitment**: computing a note's nullifier requires the owner's secret key; the derivations are domain-separated and instance-salted. A spend does not reveal which leaf in the notes tree it consumed (the Merkle path is a private witness; only the root is disclosed).
- **Spend ↔ spend**: each nullifier incorporates per-note randomness `rho`, so two spends by the same account share no stable tag. This deliberately avoids the stable-pseudonym linkability of `ShieldedAccessControl`-style deterministic nullifiers.
- **Account id**: `ownerId = H(domain, secretKey)` is preimage-resistant; the public learns pseudonyms at onboarding, never balances or activity attributable to them.
- **Anonymity set**: every unspent note in the tree. Uniform 1-input/2-output spend shape (change always created) prevents partitioning by transaction shape.

### Residual leakage (honest limits)

- **Boundary amounts**: every supply-changing event discloses its amount. Value privacy exists only INSIDE custody; deposits, withdrawals, mints, and redemptions are amount-public by design (supply auditability) and by inheritance (the base module's coin operations disclose coin data).
- **Issuance-time linkage**: a `_mint` or `_deposit` associates the disclosed amount with the commitment created in the same transaction. A note's value becomes private only after its first internal transfer; holders wanting immediate privacy can self-transfer.
- **Freeze events**: the public learns "the account onboarded in slot N was frozen" — pseudonymous, but combinable with onboarding-time observations.
- **Timing/volume correlation**: operation timing, transaction counts, and boundary flows remain correlatable by a global observer, as in any commitment scheme.
- **Proving environment**: witnesses (`secretKey`, openings, paths) are visible to whatever proves the circuit. Holders MUST use a local or trusted proof server; a hosted prover sees everything this design hides on-chain.

### Issuer visibility and the compliance fit

On-chain, the issuer sees no more than the public observer plus its own KYC/index mappings: it can freeze an account it can identify, but it cannot see that account's balance, its notes, or its counterparties. Issuers whose obligations require transaction-level visibility (AML monitoring) have two composition options outside this module: mandate off-chain reporting as a term of service, or gate the value circuits behind an operator role so every operation passes through issuer-run infrastructure — making the scheme private from the public but fully visible to the issuer. The module supports both without modification; the choice is the consumer's governance, not protocol.

The corresponding limitation is stated in [the specification](#value-circuits): no seizure. The issuer can immobilize (freeze) but never move a holder's custodial value, because moving it requires a secret key the issuer does not have. Confiscation-grade policy requires the Transparent profile or key escrow outside this standard.

## Backwards Compatibility Assessment

Purely additive: a contract-level extension over the Native Shielded Token Standard requiring no protocol or network changes. Coins withdrawn through this extension are ordinary Zswap coins, indistinguishable from directly minted ones, and interoperate with existing wallets and DApps. The extension does not alter the base standard's interface or supply semantics.

## Security Considerations

### Ungated circuits

Every circuit is a building block. Ungated `_mint` is infinite custodial issuance; ungated `_burn` is arbitrary seizure; ungated `_freeze` is denial of service against any account; ungated `_withdraw` drains custody to bearer coins. Consumers MUST gate everything per [Access Control](#access-control).

### The exit is forever

Issuer policy ends at `_withdraw`. Threat modeling MUST treat every withdrawn coin as permanently outside the compliance perimeter; "freeze after exit" is not a recoverable error, it is impossible.

### Transparent profile: custodial state is public

Balances, freeze flags, and supply are public ledger state. The Transparent profile trades the native coin's privacy (hidden value, sender, receiver) for enforceability and seizure; account identifiers should be unlinkable commitments where issuer policy allows. Issuers should state this trade-off to holders explicitly — or use the Shielded profile.

### Transparent profile: seizure path

`_burn` working against frozen accounts is a feature with obvious abuse potential. The gating consumer carries the governance burden (multi-party authorization, time locks, audit trails) for it.

### Shielded profile: freeze is index-trusted

`_freeze(index)` cannot verify which account occupies the leaf it tombstones; the issuer's off-chain `ownerId -> index` bookkeeping is the integrity boundary. A wrong index freezes an innocent account (recoverable via `_unfreeze`) while leaving the target live. `_unfreeze(ownerId, index)` is equivalent in power to authorization: a gated admin supplying an arbitrary id at a free or tombstoned slot is onboarding it. Both belong behind the strictest available governance.

### Shielded profile: frozen value is locked, not recovered

Freezing immobilizes; it does not transfer. A frozen account's notes stay in the tree, spendable again only after `_unfreeze`. If the freeze is permanent (or the holder loses the key), the value is dead weight inside `custodySupply` forever — the issuer cannot reclaim it on-chain. Off-ledger settlement (honoring the liability outside the chain) is the issuer's only remedy.

### Shielded profile: lost openings strand value

A note opening `(value, rho)` held only by its owner (and counterparty) is the ONLY way to ever spend the note — there is no ciphertext on chain and no recovery path. This is the custodial analog of the base standard's coin-delivery obligation, and it is stricter: wallets cannot rediscover notes by rescanning under any future tooling, because nothing about them is on chain but a hash.

### Shielded profile: tree capacity

Both trees are fixed at 2^20 leaves with no deletion; every spend consumes two note slots. An open `_deposit` or `_transfer` lets anyone consume slots, and exhaustion bricks all custodial movement except withdrawals of already-provable notes — which also fail, as they too insert change notes. Issuers MUST monitor capacity and SHOULD rate-limit or gate note-creating circuits.

### Inherited base-standard considerations

Coin-delivery obligations (returned `ShieldedCoinInfo` is the only copy), nonce uniqueness on withdrawals, burn-address footguns, and supply-bound interpretation all carry over from the base standard unchanged.

## Implementation

### Components

1. **New Compact modules**: [`extensions/NativeShieldedTokenCustody.compact` (Transparent profile) and `extensions/ShieldedCustody.compact` (Shielded profile)](https://github.com/OpenZeppelin/compact-contracts/tree/main/contracts/src/token/extensions), each composing `NativeShieldedToken`, `Pausable`, and `Initializable` (the Transparent profile additionally `Utils`).
2. **Mocks + tests**: `MockNativeShieldedTokenCustody.compact` and `MockShieldedCustody.compact` exposing the module circuits plus pause controls and a base-mint helper for creating depositable coins; TypeScript simulators (the shielded one implementing the secret-key and Merkle-path witnesses) and Vitest suites.
3. **No protocol changes required.**

### Dependencies

- Native Shielded Token Standard reference modules (`NativeShieldedToken`).
- [OpenZeppelin Compact Contracts](https://github.com/OpenZeppelin/compact-contracts): `Pausable`, `Initializable`, `Utils`.
- Compact language version >= 0.21.0.

## Testing

TBD in full; minimum coverage:

- Policy matrix: every ✔ cell reverts when violated; every ✘ cell succeeds (frozen `_burn` in the Transparent profile, paused freeze circuits in both).
- Conversion round-trip: native mint → `_deposit` (full and partial with refund) → `_transfer` → `_withdraw`; base `totalBurned`/`totalMinted` and `custodySupply` move per the supply rules.
- Invariant: `custodySupply == sum(balances)` (Transparent) / `== sum(live note values)` (Shielded) under arbitrary operation sequences; logical-supply bound holds including out-of-band native burns.
- Exit irrevocability: a withdrawn coin spends wallet-to-wallet with the originating account frozen.
- Shielded spend semantics: double-spend rejected by nullifier; wrong-key, wrong-opening, and stale-allowlist-root proofs rejected; frozen account's notes unspendable immediately and spendable again after `_unfreeze`; zero-value change notes spendable.
- Shielded disclosure assertions: transfer transcripts contain no amounts or identities; nullifiers across two spends by one account share no common value; Merkle paths absent from transcripts (root digests only).

## Path to Active

TBD. Expected criteria mirror the base standard: reference implementation merged with full test coverage, a testnet deployment exercising the policy matrix and conversion round-trip, MIP-process review, and a security audit with emphasis on the seizure and exit paths.

## References (Optional)

- [Native Shielded Token Standard (MIP-XXXX)](./mip-xxxx-native-shielded-token.md)
- [MIP-0004: Fungible Token Standard with UTXO Conversion Extensions](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0004-fungible-token-standard-with-utxo.md)
- [MPS-0013: zswap-business-logic](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mps/mps-0013-zswap-business-logic.md)
- [MPS-0021: contract-to-contract phase 2](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mps/mps-0021-phase2-contract-to-contract.md)
- [OpenZeppelin Compact Contracts — Repository](https://github.com/OpenZeppelin/compact-contracts)
- [Midnight Zswap Documentation](https://docs.midnight.network/concepts/zswap)
- [midnight-ledger source (spend authorization and ledger state)](https://github.com/midnightntwrk/midnight-ledger)

## Copyright Waiver

All contributions (code and text) submitted in this MIP must be licensed under the Apache License, Version 2.0.
Submission requires agreement to the Midnight Foundation Contributor License Agreement [Link to CLA], which includes the assignment of copyright for your contributions to the Foundation.
