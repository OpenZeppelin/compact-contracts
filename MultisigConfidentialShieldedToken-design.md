---
stage: design
project: nst-phase1-confidential-balances
mode: extension
extends: contracts/src (NST MIP-0011 + multisig presets on feat/native-shielded-custody-hybrid)
status: draft
timestamp: 2026-07-02
author: 0xisk
previous_stage: null
tags: [nst, mgbp, balances, elgamal, confidential, multisig, phase1]
---

# NST Phase 1 — Confidential Balance Model (Design)

## Summary

Phase 1 (MGBP) balance-model replacement after the 2026-06-30 BitGo<>MNF<>OZ
decision: an internal (off-chain) per-customer ledger is not acceptable; the
blockchain must be the ledger. Phase 1 becomes the confidential preset:
per-customer balances ON-CHAIN as exponential-ElGamal ciphertexts under an
operator key, on top of the unchanged 2-of-3 ECDSA omnibus reserve. This
formalizes and revises the existing `MultisigConfidentialShieldedToken` draft:
the ledger extension splits into Supply and Balances modules, gains an
`encUnallocated` solvency cell, moves guards into the mutators, and caps
balances at `2^48` for BSGS recoverability. Candidate (b) "smart accounts"
(per-user multisig contracts) is rejected with a C2C-contingent argument
recorded below.

## Requirement Mapping (2026-06-30 meeting)

| Meeting requirement | This design |
|---|---|
| "Internal ledger is not acceptable" (Aligned) | Balances are ledger state: `encBalances` on-chain, updated in the same circuits that move value. No off-chain book of record. |
| "Blockchain acts as the ledger" | Supply, burned, unallocated, and per-customer cells all on-chain; solvency (`reserve == supply + unallocated`) checkable from chain data by the key holder. |
| "Users track their minting activity on-chain" | Every credit/redeem writes the customer's ciphertext delta on-chain; the operator issues receipts (`(amount, blind)` opening + per-op randomness) so a customer verifies their delta against the indexer without key material. |
| "Each user has an individual wallet" (segregated custody) | NOT met by Phase 1, by decision. Met by Phase 2's note pool (per-user on-chain claims, user-held keys) without per-user deploys. Stated explicitly for the BitGo conversation. |
| Balances hidden from the public | Amounts never appear in plaintext; only hiding ciphertexts and the protocol-forced (unattributed) `mintReserve` amount. |

## Contract Layout

```
contracts/src/
├── token/extensions/NativeShieldedTokenConfidentialSupply.compact    (NEW — split)
├── token/extensions/NativeShieldedTokenConfidentialBalances.compact  (NEW — split)
├── token/extensions/NativeShieldedTokenConfidentialLedger.compact    (RETIRED — replaced by the split)
├── multisig/presets/MultisigConfidentialShieldedToken.compact        (REVISED in place — MGBP Phase 1 target)
├── multisig/presets/MultisigNativeShieldedToken.compact              (UNCHANGED — minimal off-chain-balances sibling, no longer the MGBP target)
└── multisig/presets/witnesses.ts                                     (NEW — the family's first witness surface)
```

- Split decision: two modules instead of one ConfidentialLedger. Neither
  imports the other (avoids shared-transitive-module-state hazards,
  compact#270 family). Consequence: supply↔balances conservation becomes a
  preset-level pairing invariant (see Disclosure/Decisions); in-module
  conservation (unallocated/supply/burned arithmetic) stays by-construction
  inside Supply's circuits.
- Composed modules unchanged: `token/NativeShieldedToken` (`Token_`),
  `token/extensions/NativeShieldedTokenDerivedNonce` (`TokenNonce_`),
  `multisig/EcdsaSignerManager` (`Signer_`), `crypto/ElGamal` (`ElGamal_`).
- OpenZeppelin compact-contracts modules are experimental/unaudited; the ECDSA
  verifier is stubbed (`stubVerifySignature` always true) and msgHash uses
  `persistentHash`, not keccak256. MUST NOT hold real value before destub.

## Ledger Schema

`NativeShieldedTokenConfidentialSupply` (`Supply_` prefix in the preset):

```compact
export sealed ledger encPk: JubjubPoint;             // operator ElGamal key; rotation = redeploy
export ledger encTotalSupply: ElGamal_Ciphertext;    // Enc(Σ credited − Σ redeemed)  — allocated supply
export ledger encTotalBurned: ElGamal_Ciphertext;    // Enc(Σ redeemed), monotonic
export ledger encUnallocated: ElGamal_Ciphertext;    // Enc(Σ minted − Σ credited)   — solvency cell
export ledger _supplyInit: Boolean;                  // per-module init flag (compact#270)
```

`NativeShieldedTokenConfidentialBalances` (`Bal_` prefix):

```compact
export sealed ledger encPk: JubjubPoint;                        // own sealed copy; equals Supply's by constructor
export ledger encBalances: Map<Bytes<32>, ElGamal_Ciphertext>;  // customer commitment → Enc(balance)
export ledger _balancesInit: Boolean;
```

Preset adds only `export ledger _replayNonce: Counter;` plus composed state.

Field rationale:
- `encPk` duplicated per module (price of the split); preset constructor
  passes one `operatorPk` to both inits, so key equality is by construction.
- `encBalances` keys are backend-issued pseudonymous commitments. The
  touched-key set is public (accepted account-graph trade; Phase 2 closes it);
  values are hiding. Entries never deleted: redeem-to-zero leaves `Enc(0)`.
- All ciphertext cells seed from `encryptZero()` (canonical identity
  ciphertext), never the struct default `{(0,0),(0,0)}` (off-curve; first
  homomorphic op would fault).
- Everything `export`: ciphertexts are the regulator/indexer read surface.

## User-Defined Types

None new. Reuses `ElGamal_Ciphertext` and `JubjubPoint` (via `crypto/ElGamal`)
and the protocol coin types (`ShieldedCoinInfo`, `QualifiedShieldedCoinInfo`),
re-exported as named TS artifact aliases. Customer ids stay bare `Bytes<32>`.

Constants: `MAX_BALANCE = 2^48` (BSGS decryptability cap; CFT precedent,
matches Phase 2's per-note bound). Decimals interaction: at 2 decimals the cap
is ≈ £2.8T per customer, at 6 decimals ≈ £281M. Decimals choice is a deploy
parameter; record the chosen value against the cap at deployment time.

## Exported Circuits and Witness Signatures

Design change vs the draft: guards live INSIDE the module mutators (the draft
kept decrypt-verify + overdraw asserts in the preset ahead of `_debit`; one
call-ordering mistake away from an unguarded homomorphic wrap). Modules stay
witness-free: `ek` and claimed plaintexts arrive as explicit arguments from
the preset's witnesses.

`NativeShieldedTokenConfidentialSupply`:

```compact
export circuit initialize(operatorPk: JubjubPoint): [];
export circuit assertInitialized(): [];

export circuit _recordMint(amount: Uint<64>, r: Field): [];
//   encUnallocated += amount. Keyless. r is PUBLIC-derived by the preset
//   (the amount is protocol-public anyway) — see Disclosure Boundary.

export circuit _allocate(amount: Uint<64>, ek: Bytes<32>, claimedUnallocated: Uint<64>,
                         rUnallocated: Field, rSupply: Field): [];
//   assertDecryptsTo(encUnallocated, ek, claimedUnallocated);
//   assert(claimedUnallocated >= amount);
//   unallocated -= amount; supply += amount.   Guard + both deltas in ONE circuit.

export circuit _recordBurn(amount: Uint<64>, rSupply: Field, rBurned: Field): [];
//   supply -= amount; burned += amount. Keyless: sufficiency implied by the
//   balance guard + pairing invariant (bal >= amount ∧ supply = Σ bal ⇒ supply >= amount).

export circuit encryptedTotalSupply(): ElGamal_Ciphertext;
export circuit encryptedTotalBurned(): ElGamal_Ciphertext;
export circuit encryptedUnallocated(): ElGamal_Ciphertext;
```

`NativeShieldedTokenConfidentialBalances`:

```compact
export circuit initialize(operatorPk: JubjubPoint): [];
export circuit assertInitialized(): [];

export circuit _credit(customer: Bytes<32>, amount: Uint<64>, ek: Bytes<32>,
                       claimedBalance: Uint<64>, rBalance: Field): [];
//   first-touch seed from encryptZero(); assertBalanceDecryptsTo(customer, ek, claimedBalance);
//   assert(claimedBalance + amount < MAX_BALANCE);  then balance += amount.

export circuit _debit(customer: Bytes<32>, amount: Uint<64>, ek: Bytes<32>,
                      claimedBalance: Uint<64>, rBalance: Field): [];
//   assertBalanceDecryptsTo(...); assert(claimedBalance >= amount);  then balance -= amount.

export circuit encryptedBalanceOf(customer: Bytes<32>): ElGamal_Ciphertext;  // Enc(0) if untouched
```

Preset witnesses (implemented in `multisig/presets/witnesses.ts`; read once
per op into a `const`, never logged or transmitted):

```compact
witness elGamalSecret(): Bytes<32>;                    // operator ek
witness accountBalancePlain(customer: Bytes<32>): Uint<64>;
witness unallocatedPlain(): Uint<64>;                  // NEW — claimed plaintext of encUnallocated
witness opAmount(): Uint<64>;
witness opAmountBlind(): Bytes<32>;                    // fresh per op (see entropy checklist)
witness encryptRandomness(): Bytes<32>;                // fresh per-op seed
witness redeemCoin(): QualifiedShieldedCoinInfo;
```

Preset circuits (msgHash discipline identical to the draft:
`H(opTag ‖ self ‖ replayNonce ‖ params)`, nonce consumed once per gated op):

- `mintReserve(amount, pubkeys, sigs): ShieldedCoinInfo` — verify 2-of-3 →
  `Token__mint(right(self), amount, TokenNonce__deriveNonce())` +
  `Supply__recordMint(amount, rPub)`. `rPub` derived in-circuit from public
  `(self, replayNonce)`, so the circuit stays witness-free and relayer-provable.
- `credit(customer, amountCommitment, pubkeys, sigs): []` —
  `assert(persistentCommit(opAmount, blind) == amountCommitment)` binds the
  private amount to the signed hash →
  `Supply__allocate(amount, ek, unallocatedPlain, rU, rS)` +
  `Bal__credit(customer, amount, ek, accountBalancePlain(customer), rB)`
  adjacent, same `amount` const (the pairing invariant). Three randomness
  values from one seed under nonce-mixed distinct tags.
- `redeem(customer, amountCommitment, pubkeys, sigs): []` — commitment check →
  `Bal__debit(...)` (guarded inside) + `Supply__recordBurn(amount, rS, rBu)` +
  `Token__burnFromSelf(redeemCoin, amount)`. Change coin intentionally NOT
  returned (a return is a sink); operator reconstructs it off-chain.
  Note: `_burnFromSelf` is the real token API (the draft's `_burnFromContract`
  is a stale name).
- Views: `encryptedBalanceOf`, `encryptedTotalSupply`, `encryptedTotalBurned`,
  `encryptedUnallocated`, `tokenColor`, `getNonce`, `getSignerCount`,
  `getThreshold`, `isSigner`, pure `_calculateSignerId`.

## State Partitioning & Disclosure Boundary

| Value | Location | Crosses? / what is revealed |
|---|---|---|
| `operatorPk` → `encPk` ×2 | ledger (sealed) | at init via `disclose` — intended public constant |
| `ek` (operator secret) | witness | never; used only inside `assertDecryptsTo` |
| `opAmount` | witness | never in plaintext: hiding commitment (assert-compared, not a sink), hiding ciphertexts, burn effects (commitments/nullifiers only) |
| `opAmountBlind` | witness | never |
| `amountCommitment` | public param | nothing about the amount (256-bit blind); this is what co-signers sign |
| `customer` id | public param + map key | disclosed by design — the account-graph leak, accepted; Phase 2 closes it |
| `accountBalancePlain`, `unallocatedPlain` | witness | never; one success bit per op (leak budget) |
| `encryptRandomness` seed | witness | never raw; ciphertexts hide under DDH |
| `redeemCoin` | witness | only as commitments/nullifiers inside the burn |
| `mintReserve` amount | public param | protocol-forced (`shieldedMints`), unattributed |
| signer pubkeys/sigs, `_replayNonce`, metadata | public | same as Phase 1 |

`disclose()` inventory (complete): module inits (`encPk`, `encryptZero`
seeds); `disclose(customer)` on map ops; `disclose(ciphertext)` on every cell
write (hiding, reveals nothing about amounts). Nothing else witness-derived
crosses.

Per-circuit leak budget:
- `mintReserve`: the amount (protocol-public, unattributed). Intentional
  bonus: `rPub` is public-derived, so ANYONE can verify the `encUnallocated`
  delta equals the public mint amount — the one deliberately non-hiding
  ciphertext update; makes the mint→cell bridge publicly auditable.
- `credit`: customer touched + one success bit
  (`unallocated ≥ amount ∧ bal + amount < 2^48`). Never the amount.
- `redeem`: customer touched + one success bit (`bal ≥ amount`). Never the
  amount, balance, coin value, or change.
- Global public bound (inherent, inherited from public mints):
  `Σ credited ≤ Σ public mint amounts`.

Conditional writes: exactly one branch touches the ledger — first-touch
seeding, keyed on PUBLIC map membership; no private predicate leaks.
Everything else is constant-shape: `credit` always writes 3 ciphertexts,
`redeem` always 3 + burn effects.

Entropy/nonce checklist:
- `opAmountBlind` fresh per op. Reuse with an equal amount produces equal
  public commitments, linking "same amount" across ops — explicit witness
  contract.
- Encryption randomness: per-op seed expanded under nonce-mixed distinct tags
  (`H(tag_op_cell, replayNonce)` style, the Phase 2 INV-28 hardening) — no
  `(r, tag)` reuse even from a misbehaving seed witness.
- Customer ids MUST be backend-issued random 32 bytes (or `H(salt,
  internalId)`), never derivable from public customer data — otherwise the
  pseudonym mapping is grindable. Ops requirement, not circuit-enforceable.
- No low-entropy value is hashed to a public output without a 256-bit secret
  component.

Linkability, stated honestly: a customer id links that customer's op count
and timing (accepted graph leak). Balance trajectory and every amount stay
hidden. "Private" means private from the public indexer and third parties,
not from the 2-of-3 co-signers or the prover (unchanged trust model).

## Integration Patterns

- Custodial topology; no end-user wallets in Phase 1. Monument's backend owns
  all witnesses; proof server runs inside Monument's boundary. BitGo is an
  ECDSA signing oracle over `msgHash` (HSM): learns amounts off-chain from the
  signing payload, never sees witnesses, runs no prover. A relayer submits.
- `mintReserve` is relayer-provable (no witness). `credit`/`redeem` are
  Monument-proven.
- Customer verifiability (receipts): per op, the operator hands the customer
  the `(amount, blind)` opening and the per-op randomness; the customer
  recomputes their ciphertext delta from indexer data. No key material leaves
  the operator.
- Regulator access: ciphertext reads from the indexer; decryption capability
  per the access model open question (Q4).

```ts
const deployed = await deployContract(providers, {
  contract: MultisigConfidentialShieldedToken,
  privateStateId: 'mgbpPhase1',
  args: [domainSep, name, symbol, decimals, instanceSalt,
         signerCommitments, threshold, initCoinNonce, operatorPk],
});
const coin = await deployed.callTx.mintReserve(amount, pubkeys, sigs);
```

## Error Handling

- `const` strings at module top. Prefixes: `"ConfidentialSupply: "`,
  `"ConfidentialBalances: "`; preset reuses module messages plus its own
  `"MultisigConfidentialShieldedToken: "` where needed.
- Messages: `not initialized`, `already initialized`, `amount commitment
  mismatch`, `insufficient balance`, `balance cap exceeded`, `insufficient
  unallocated reserve`. ElGamal's `ek/pk mismatch` / `plaintext mismatch`
  surface as-is.
- Never include amounts, customer ids, or key material in messages.

## Indexer-Visible Ledger Fields

- `encBalances` — regulator reads; customer receipt verification feed.
- `encTotalSupply` / `encTotalBurned` / `encUnallocated` — solvency dashboard
  (`reserve coins at self == Dec(supply) + Dec(unallocated)`).
- `_replayNonce` — off-chain signing flow reads the next nonce (Phase 1 pattern).
- Cell writes + map inserts are the event substitute (no `emit` in Compact).

## Change Plan (Extension Mode)

- **New**: `NativeShieldedTokenConfidentialSupply.compact`,
  `NativeShieldedTokenConfidentialBalances.compact`, preset `witnesses.ts`,
  mocks/simulators/tests for both modules and the revised preset.
- **Modified**: `MultisigConfidentialShieldedToken.compact` revised in place
  (split imports, `encUnallocated` flow, guarded-mutator calls, `_burnFromSelf`
  rename, `unallocatedPlain` witness).
- **Retired**: `NativeShieldedTokenConfidentialLedger.compact` (replaced by
  the split; unmerged exploration, so no deprecation cycle needed).
- **Unchanged**: `MultisigNativeShieldedToken` (stays the minimal off-chain
  sibling), `NativeShieldedToken`, `DerivedNonce`, `EcdsaSignerManager`,
  `crypto/ElGamal`.
- **API compatibility**: additive for the library; nothing deployed, no CMA
  implications. The MGBP track retargets from `MultisigNativeShieldedToken` to
  this preset.
- **Circuit count / block limit**: preset lands at ~14 exported circuits,
  near the observed ~15–20 composite-deploy ceiling. If deploy fails, trim
  view circuits first (all cells are indexer-readable without views).

## Design Decisions Log

- **Candidate (b) "smart accounts" killed** (per-user multisig contracts).
  Without C2C: unbuildable (error-186 unclaimed output; one contract = one
  deploy; no factories). WITH C2C it stays dead: (i) per-customer amounts
  become PUBLIC — a mint to account-contract X publishes the amount
  (`shieldedMints`) attributed to X, and shielded sends to contract recipients
  publish the recipient address in cleartext (forwarder CRIT-1 preprod
  result); (ii) N deploys × verifier keys × upgrade surface; (iii) BitGo's own
  M×N key-indexing blocker (their 06-30 statement: V2/V3 wallets cannot derive
  multiple addresses, no forwarders) is untouched by Midnight shipping C2C;
  (iv) day-one dependency on an unaudited feature. The segregation benefit (b)
  promises is delivered by Phase 2 notes inside one contract.
- **Split ConfidentialLedger into Supply + Balances** (dev decision).
  Consequence: supply↔balances conservation is a preset-level pairing
  invariant (every `Bal_` delta adjacent to its `Supply_` mirror, same
  `amount` const); in-module arithmetic stays by-construction.
- **`encUnallocated` pulled forward from Phase 2.** The value is derivable
  from chain anyway (`Σ mints − supply − burned`); the cell buys the
  IN-CIRCUIT solvency guard (over-crediting unsatisfiable at proof time), an
  O(1) reserve-backing check, and mechanical Phase 2 alignment. Closes the
  keyless-overflow caveat as a side effect (`Σ balances ≤ Σ mints < 2^64`).
- **Guards inside mutators** (`_allocate`, `_credit`, `_debit` carry their own
  decrypt-verify + bound asserts): misuse becomes unsatisfiable rather than a
  preset call-ordering convention. `_recordBurn` stays keyless; its
  sufficiency is implied by the balance guard + pairing invariant (documented,
  invariants stage to formalize).
- **`MAX_BALANCE = 2^48` cap in `_credit`**: keeps every balance ciphertext
  BSGS-recoverable by a key holder without operator cooperation; free now that
  `credit` is key-holding anyway.
- **Both presets kept**: minimal off-chain preset remains a valid library
  product; MGBP retargets to the confidential preset.
- **Public randomness for `_recordMint`**: intentional non-hiding delta
  (amount already protocol-public); preserves relayer-provability and makes
  the mint→cell bridge publicly verifiable.
- **Receipts over view keys** for customer verifiability: no key-model change;
  operator shares per-op openings.

## Out of Scope

- Customer-initiated transfers between customers — Phase 2 (note pool).
- Graph privacy (hiding WHICH customer an op touches) — Phase 2's core gap-close.
- Operator key rotation (`encPk` sealed; rotation = redeploy) and threshold
  ElGamal — deferred hardening, same as Phase 2's stance.
- ECDSA destub (secp256k1 + keccak256) — upstream-dependent; production gate,
  not a design item here.
- `encBalances` pruning / ledger growth management.
- Wallet/SDK build-out (receipt tooling, BSGS table, UTXO store) —
  integration work, not contract work.
- Per-customer on-chain wallets (the literal segregation ask) — deliberately
  deferred to Phase 2; recorded in Requirement Mapping.

## Revision Request

**From stage:** design (`nst-phase1-confidential-balances`, this document)
**Target stage:** design (`nst-phase2-auditable-custody`,
`AuditableShieldedCustody-design.md`; cascades to
`AuditableShieldedCustody-invariants.md` and the WIP code)
**Reason:** Phase 1's balance model changed. Off-chain per-customer balances
were rejected (BitGo<>MNF<>OZ, 2026-06-30); Phase 1 is now
`MultisigConfidentialShieldedToken` with on-chain encrypted balances (split
Supply/Balances extensions + `encUnallocated`). The Phase 2 artifacts assume
Phase 1 = the off-chain-balances preset (#632) and must be revised.

### What needs to change

1. **Baseline framing.** The design's Summary and Candidate analysis treat the
   ElGamal account ledger (Candidate A) as a rejected alternative and Phase 1
   as "the Phase 1 multisig preset (#632)" with no on-chain balance state.
   Candidate A is now the LIVE Phase 1 baseline: Phase 2 supersedes an
   on-chain encrypted-balances ledger, not an off-chain book. Reframe A as
   "Phase 1 production state being migrated from"; the graph-privacy argument
   for C strengthens (the account graph is now a live, demonstrated leak that
   Phase 2 closes).
2. **Migration path** (design § Change Plan → Migration). Current path is
   "compose, don't migrate" from a stateless-balances Phase 1; there is now
   on-chain state to move: `encBalances` → notes. Options to design in
   revision: (a) one preset composing both layers (confidential balances + note
   pool) with an atomic `migrateCustomer` circuit — debit `encBalances`,
   create a note + memo in the same circuit; amount-private, no public
   migration event beyond circuit identity; (b) fresh Phase 2 deploy +
   per-customer redeem/re-credit rollover — publishes only aggregate reserve
   movements but doubles ops and breaks requirement 6's spirit; (c) big-bang
   cutover with an operator attestation. Recommendation to evaluate: (a),
   subject to the composite-deploy block-limit ceiling the design already
   flags (~15–20 circuits; the combined preset may exceed it — measure first).
3. **Preset composition / module reuse.** Phase 2's extension self-contains
   its encrypted cells (`_encCustodySupply`, `_encUnallocated`). Phase 1 now
   ships `NativeShieldedTokenConfidentialSupply` with the same cell semantics
   and guarded mutators. Decide: reuse the Supply module in the Phase 2
   extension/preset, or keep Phase 2 self-contained and justify the
   duplication explicitly (the original self-containment decision predates the
   split module's existence).
4. **Requirement 6 wording** ("Phase 1 UTXOs stay contract-owned and are never
   burned or re-minted"). Holds under migration option (a); violated by (b).
   Re-state it as a migration-path constraint rather than an unconditional
   property.
5. **Invariants doc updates** (`AuditableShieldedCustody-invariants.md`):
   pattern citations reference the pre-split draft
   (`MultisigConfidentialShieldedToken.compact:329-334`, `:353-354`,
   `:358-362` in INV-11/14/38 and the preserved-invariants section) — re-cite
   against the revised files once landed. Add migration invariants if option
   (a) is chosen: per-customer conservation (note value created ==
   balance debited, same circuit), no double-migration (balance zeroed or
   tombstoned), custodian-view continuity across the boundary.

### What must be preserved

- The Candidate C choice and all note-pool machinery: derivations, memo
  layer, seize semantics, policy matrix, INV-1..41. Nothing in the Phase 1
  change weakens the case for C; it strengthens it.
- msgHash discipline (`[tag, self, nonce, opCommitment]`), ECDSA destub gate
  (INV-40), block-limit awareness, the trimmed-views decision.
- Phase 1 decisions now feeding Phase 2: split modules, guards-in-mutators,
  `encUnallocated` semantics, `2^48` bounds, nonce-mixed randomness tags.

### Downstream impact

- `AuditableShieldedCustody-design.md`: revise (v2) per items 1–4.
- `AuditableShieldedCustody-invariants.md`: revise per item 5 (citation
  refresh + migration invariants).
- WIP code (`AuditableShieldedCustody.compact`,
  `MultisigAuditableShieldedToken.compact`): potential refactor to reuse
  `ConfidentialSupply`; add the migration circuit if option (a) is chosen.

### Context from later stages

- None beyond the WIP code itself (Phase 2 has no tests/docs yet). The WIP
  compiles skip-zk on this branch; its `_addUnallocated` public-randomness
  exception and nonce-mixed credit tags are the same patterns this design
  adopted, so the two tracks are already convergent at the idiom level.

## Dev Notes

- Inputs: BitGo<>MNF<>OZ meeting notes 2026-06-30 (local:
  `~/Documents/City Center/City Center/1-Professional/knowledge/meetings/bitgo-mnf-oz/2026-06-30.md`);
  1:1 direction 2026-07-01 (ElGamal balances keyed by backend-issued ids as
  the C2C-independent fallback).
- The draft preset + ConfidentialLedger already carried most of this design;
  this artifact formalizes it and records the deltas (split, `encUnallocated`,
  guarded mutators, cap). Treat the draft's INV numbering as superseded by the
  invariants stage over THIS artifact.
- `_burnFromContract` → `_burnFromSelf` rename break: still open on this
  branch (6 preset files); fix lands with the code stage.
- ECDSA stub + `persistentHash`-not-keccak msgHash remain THE production
  blockers, unchanged.
- Sample mint/burn scripts for BitGo (meeting action item) are unaffected by
  this redesign: `mintReserve`/`redeem` keep Phase 1's signing shape.

## Open Questions

1. Decimals for MGBP (affects `MAX_BALANCE` headroom: 2 decimals ≈ £2.8T,
   6 decimals ≈ £281M per customer) — product input.
2. Receipt format and delivery channel (operator → customer) — SDK/integration
   stage; contract side is complete without it.
3. Should `_recordBurn` get a defensive decrypt-verify guard too (extra
   witness + staleness surface vs. defense in depth if the pairing invariant
   is ever broken by a future preset)? — invariants stage to decide.
4. Regulator access model: does an auditor ever hold `ek`, or only receive
   decrypted evidence + openings? (Same open question as Phase 2's Q8; keep
   the two answers aligned.)
5. Migration option (a) vs (b) vs (c) — owned by the Phase 2 design revision
   (see Revision Request); the block-limit measurement gates (a).
