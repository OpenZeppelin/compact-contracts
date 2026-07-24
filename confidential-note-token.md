# Confidential Note Fungible Token on Midnight

> **Status:** educational draft (2026-07-23), destination Notion. A companion to draft PR [#679](https://github.com/OpenZeppelin/compact-contracts/pull/679) (`feat(token): confidential note token draft`), written to be read **side by side with the code**. Each circuit section links to the exact source lines at the PR's pinned commit [`878aa43`](https://github.com/OpenZeppelin/compact-contracts/commit/878aa438b98879088f13f0ef96e10311ff020257).
>
> **Verification.** External definitions in *Concepts* are quoted verbatim from primary sources (Zcash protocol specification, Zerocash paper, Compact language reference at [`LFDT-Minokawa/compact`](https://github.com/LFDT-Minokawa/compact) @ `c06961e`), with links in *References*. Cost figures (`k`, rows) are the compiler's own `@circuitInfo` numbers from the source. The code is a DRAFT: not audited, not production.
>
> **Naming.** Renames adopted after review (2026-07-23), putting the asset class in the name and keeping the `…FungibleToken` suffix family: `ConfidentialNoteToken` → **`ConfidentialNoteFungibleToken`**, `ConfidentialNoteTokenAudit` → `ConfidentialNoteFungibleTokenAudit`, `ConfidentialNoteTokenDelivery` → `ConfidentialNoteFungibleTokenDelivery`, `ConfidentialNoteTokenSupply` → **`ConfidentialNoteFungibleTokenPrivateSupply`**, `RegulatedConfidentialNoteToken` → `RegulatedConfidentialNoteFungibleToken`. This document uses the new names. The pinned code at `878aa43` still carries the old file and identifier names, so the source links and the verbatim code quotes (including the `CNT_` / `Audit_` / `Delivery_` / `Supply_` import prefixes) show the old naming.

# 0. TODO — working list (2026-07-23)

Missing pieces identified while hardening the draft, grouped by driver. Compliance modules are being added on this branch; the rest are queued.

**Functional gaps**

- [ ] **Note consolidation / multi-input spend** — every spend consumes exactly one input note, so nothing larger than your biggest note is payable and balances fragment forever. Needs a `_join` / two-input `_consumeNote` in the **core** (it needs the tree + nullifiers; not expressible as an extension). Biggest practical hole.
- [ ] **Metadata extension** — no `name`/`symbol`/`decimals` anywhere in the family; NST and CFT both have it. Sealed fields + getters.
- [ ] **Batch outputs** — pay N recipients in one proof (one nullifier, N+1 commitments). Compile-time variant; also reduces transaction-shape leakage.

**Compliance (in progress on this branch)**

- [ ] **Freeze extension** — freeze-before-seize: a frozen-nullifier set checked at the owner-spend chokepoint; seizure of frozen notes still works.
- [ ] **KYC allowlist extension** — Merkle allowlist proven in-circuit at spend time (hidden spender ⇒ ZK membership, not a `Set` lookup); tombstone removal against the current root.
- [ ] **Review (selective disclosure) extension** — per-output encrypted records to an approved reviewer key (custodian/FIU), alongside the global audit channel; final shape pending BitGo FIU feedback.
- [ ] **Role rotation** — self-rotation blocks in Issuer/Audit/Supply (prove the current secret, bind the new key; supply rotation re-encrypts `_encSupply` under the new key in-proof) and `rotateAuthority` in the preset.

**Supply**

- [ ] **PublicSupply extension** — the third row of the supply spectrum (disclosed counters); agreed, trivial.
- [ ] **Capped supply** — easy on PublicSupply; deferred on the encrypted variant (needs a range proof on a ciphertext).

**Composition**

- [ ] **Basic preset** — core + Issuer: gated mint, self-gated transfer/burn, out-of-band notes. The readable entry point next to Regulated.
- [ ] **Multisig-gated roles** — compose issuer/authority with the existing `multisig/` package in a preset; no new module.

**Housekeeping**

- [ ] **Doc sweep** — sections below still describe the pre-refactor draft: issuer split out of the core, preset converted to a module (`initialize` instead of constructor), `Core_`/`Token_` prefixes, `_mint`/`_mintNote` naming.
- [ ] **Domain-tag rename** — on-chain tags still read `OZ:cnt:*`; pick the replacement and sweep once.
- [ ] **CHANGELOG update** — issuer extension, module conversion, renames.
- [ ] **Token-level test suites** — the §12 invariants as Vitest specs.
- [ ] **Re-pin source links** — after the refactor commits land, repoint the doc's deep links from `878aa43`.

# 1. Summary

The **Confidential Note Fungible Token** is a token whose value records live entirely inside a Compact contract as **notes** (UTXOs, in Bitcoin terms): each note is a `(value, nonce)` pair owned by a key, represented on the public ledger only by a *hiding commitment* in a Merkle tree. Spending a note reveals a *nullifier* (preventing double-spends) and proves, in zero knowledge, that the note exists in the tree, without revealing which one.

The result is **full graph privacy**: amounts (including issuance and burns), senders, and recipients are all hidden from the public ledger. This is the property neither of the library's other token designs delivers. The account-based `ConfidentialFungibleToken` hides amounts but keeps the account graph public. The native shielded token hides transfers (Zswap does that at the protocol level) but publishes every mint and burn amount as a supply delta. The note model hides all of it, and it is the only model that can: sender privacy fundamentally requires an unindexed commitment set with ZK membership proofs, which *is* the note model (§3).

The PR builds this as OpenZeppelin-style composable pieces rather than a monolith:

| Piece | File | Role |
| --- | --- | --- |
| **Core** | [`token/ConfidentialNoteToken.compact`](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/ConfidentialNoteToken.compact) | commitment tree, nullifier single-spend, value conservation, issuer gate. A complete token on its own. |
| **Audit extension** | [`extensions/ConfidentialNoteTokenAudit.compact`](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/extensions/ConfidentialNoteTokenAudit.compact) | auditor viewing, complete by construction: every output's nonce is *derived from* an ECDH with the audit key, so an output the auditor cannot open cannot exist |
| **Delivery extension** | [`extensions/ConfidentialNoteTokenDelivery.compact`](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/extensions/ConfidentialNoteTokenDelivery.compact) | on-chain note delivery: recipients discover incoming funds by scanning chain data, no out-of-band channel |
| **Supply extension** | [`extensions/ConfidentialNoteTokenSupply.compact`](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/extensions/ConfidentialNoteTokenSupply.compact) | confidential supply: homomorphic ElGamal running total plus proof-backed public attestation |
| **Preset** | [`presets/RegulatedConfidentialNoteToken.compact`](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/presets/RegulatedConfidentialNoteToken.compact) | the wired-together deployable token: issuer mint, private transfer/burn, escrow-free seizure, attested supply |
| **Crypto primitive** | [`crypto/NoteDelivery.compact`](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/crypto/NoteDelivery.compact) | the ECDH note-delivery channel (this PR); builds on the already-merged `crypto/EcdhMask` and `crypto/ElGamal` |

Three design moves carry most of the system, and each gets a full section below:

- **Audit-derived nonces** (§6): the note's nonce comes out of the audit ECDH, making auditor visibility *structural* rather than policy. A transaction that skips or fakes its audit record cannot exist, because the commitment binds the same fields the record encrypts, inside one proof.
- **Shared nullifiers** (§5, §9): the nullifier preimage is the nonce alone, no owner secret. Anyone who knows the nonce derives the *same* nullifier, which makes regulated seizure escrow-free: owner-spend and seizure are mutually exclusive, first to land wins, and the authority never holds spend keys.
- **Supply as a policy layer** (§8): the core writes no public supply at all. A deployment chooses none, confidential-plus-attested, or fully public.

# 2. Concepts, from the sources

The terms this document relies on, defined by primary sources rather than restated. Quoted text is verbatim.

- **Zero-knowledge proof.** "'Zero-knowledge' proofs allow one party (the prover) to prove to another (the verifier) that a statement is true, without revealing any information beyond the validity of the statement itself." — Zcash, *What are zk-SNARKs?* [[1]](#ref-1). Every state-changing circuit in this design is such a proof: the ledger learns *that* a valid spend happened, not *what* was spent.
- **UTXO.** "An Unspent Transaction Output (UTXO) that can be spent as an input in a new transaction." — Bitcoin developer glossary [[2]](#ref-2). A note is the shielded analogue of a UTXO: value exists as discrete spendable records, not account balances.
- **Note.** "A note is a representation of value held in a shielded pool. … It represents that a value v is spendable by the recipient who holds the spending key corresponding to a given shielded payment address." — Zcash protocol specification, §3.2 [[3]](#ref-3). Here a note is the struct `Note { value: Uint<128>, nonce: Field }`, owned by whoever's public key `pk` was bound into its commitment.
- **Note commitment.** "When a note is created as an output of a transaction, only a commitment … to the note contents is disclosed publically … This allows the value and recipient to be kept private, while the commitment is used by the zk-SNARK proof when the note is spent, to check that it exists on the block chain." — Zcash protocol specification, §3.2.2 [[4]](#ref-4). Here: `cm = H(domain, value, nonce, pk)` with a SHA-256-class `persistentHash`; the 256-bit nonce provides the hiding entropy.
- **Note commitment tree.** "A note commitment tree is an incremental Merkle tree, of fixed depth …, used to store note commitments … Just as the UTXO (unspent transaction output) set used in Bitcoin, it is used to express the existence of value and the capability to spend it. However, unlike the UTXO set, it is not the job of this tree to protect against double-spending, as it is append-only." — Zcash protocol specification, §3.8 [[5]](#ref-5).
- **Nullifier.** "Nullifiers are enforced to be unique within a valid block chain, in order to prevent double-spends." — Zcash protocol specification, §3.9 [[6]](#ref-6). Zcash's design rationale requires that the "nullifier deterministically depends only on values committed to (directly or indirectly) by the note commitment" [[7]](#ref-7) — a requirement this design satisfies with the *minimal* preimage `nf = H(domain, nonce)`, deliberately omitting any owner secret (§14 explains the trade-off).
- **Graph privacy.** The property Zerocash introduced: "the corresponding transaction hides the payment's origin, destination, and transferred amount." — Ben-Sasson et al., *Zerocash: Decentralized Anonymous Payments from Bitcoin* [[8]](#ref-8). "Graph" refers to the who-paid-whom transaction graph, which stays hidden even though every transaction is public.
- **Witness (Compact).** "A circuit can also access or update private state as it operates via *witnesses*. Witnesses are callback functions provided by the TypeScript driver." — Compact language reference [[9]](#ref-9). Witnesses are how secrets (spend keys, input notes, randomness seeds) enter a circuit without touching the chain.
- **Disclosure (Compact).** "Disclosure of private data (exported circuit arguments, witness return values, and anything derived from private data) must be acknowledged by wrapping an expression whose value contains private data in a `disclose()` wrapper before storing it in the public state." — Compact language reference [[10]](#ref-10). Every `disclose()` in this code marks a deliberate crossing of the privacy boundary; §10 justifies each one.
- **`HistoricMerkleTree` (Compact).** "This ADT is a bounded Merkle tree of depth nat where 2 `<=` nat `<=` 32 containing values of type value_type, with history." Its `checkRoot` "tests if the given Merkle tree root is one of the past roots for this Merkle tree." — Compact ledger ADT reference [[11]](#ref-11). The history matters: a proof built against a slightly stale tree still verifies after later inserts.
- **ECDH (elliptic-curve Diffie–Hellman).** The key-agreement construction of Diffie and Hellman [[12]](#ref-12), on an elliptic curve: from one party's public point `pk = g^k` and the other's secret scalar `e`, both reach the same shared point `S = pk^e = (g^e)^k`. The repo's `crypto/EcdhMask` states the concrete use: "`E = g^e` (ephemeral public key), `S = pk^e` (ECDH shared secret point), `mask = KDF(S)`, `ct = value + mask` (field one-time-pad). Recipient recovers: `S = E^ek`, `mask = KDF(S)`, `value = ct - mask`." [[13]](#ref-13)
- **Exponential (lifted) ElGamal.** ElGamal encryption [[14]](#ref-14) with the plaintext lifted into the exponent. The repo's `crypto/ElGamal` module: "In the lifted variant a value `v` is encrypted as the point `g^v`, so the scheme is additively homomorphic in the exponent: ciphertexts of `a` and `b` combine into a ciphertext of `a + b`." [[15]](#ref-15) This is what lets the supply extension update an encrypted total without anyone decrypting it.
- **Jubjub.** "Jubjub is the twisted Edwards curve `-u^2 + v^2 = 1 + d.u^2.v^2`" defined over the scalar field of BLS12-381 [[16]](#ref-16) — an "embedded" curve whose arithmetic is cheap *inside* a proof system over that field. Compact's standard library exposes it as the opaque type `JubjubPoint` with `ecMul` / `ecMulGenerator` operations [[17]](#ref-17). All encryption keys in this design (audit, delivery, supply) are Jubjub points.

# 3. Why notes: the model choice

## 3.1 The privacy spectrum

The exploration branch behind this PR ([`contracts/privacy_readme.md`](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/privacy_readme.md)) built four tiers of confidential token and measured each:

| Tier | Hides | Model | Verdict |
| --- | --- | --- | --- |
| 1 | amounts | account (ElGamal balances) | shippable; public graph |
| 2 | + recipient | account + stealth addresses | works; real UX cost |
| 3 | + sender (weak) | account + ring | dominated, kept as an exhibit |
| 4 | amounts + sender + recipient | **notes** | this PR |

The load-bearing finding: **sender privacy on an account model has no cheap trick.** A debit is a write to *some* public per-account slot, and hiding which slot requires either touch-all-N cover traffic (the ring, which loses on cost) or an unindexed commitment set with ZK membership and nullifiers. The latter *is* the note model. So notes are not "the account model, more private"; they are the shape sender privacy converges to, which is also why Zcash, and Aztec's account-over-notes design, sit on the same skeleton.

## 3.2 Versus native shielded (Zswap) coins

Midnight already has protocol-level shielded UTXOs (Zswap), and the library has a [Native Shielded Token](https://github.com/OpenZeppelin/compact-contracts/issues/544) standard for issuing them. Why build a second UTXO system inside a contract?

| | Native shielded token (Zswap coins) | Confidential note token (this PR) |
| --- | --- | --- |
| Transfers | protocol-level, contract not involved | contract circuit per transfer |
| Transfer privacy | hidden by Zswap by construction | hidden by the note pool |
| **Mint/burn amounts** | **public** (the ledger's `shieldedMints` effect and supply deltas) | **hidden** (only a commitment appears) |
| Auditor viewing | not expressible | opt-in extension; once wired, complete by construction (§6) |
| Seizure / clawback | none (bearer instrument) | escrow-free `seize` (§9) |
| Post-issuance control | none in phase one | issuer/authority policy is ordinary contract code |
| Cost | cheap (protocol does the work) | large circuits (§13) |

The two are complements. Native issuance is the right shape for a plain private bearer asset. The note pool is the shape for a *regulated* confidential asset: hidden issuance amounts, auditor viewing users cannot evade, seizure. It can hide issuance because it never touches Zswap coins; the only channel that would expose amounts is a public supply write, and the core simply never makes one (§8).

## 3.3 The model in one picture

A note's life is three events on the public ledger, none of which name amounts or parties:

```
create                          deliver                        spend
──────                          ───────                        ─────
cm = H(domain,value,nonce,pk)   ciphertext of (value,nonce)    nf = H(domain,nonce)
inserted into                   to the owner's encPk,          inserted into _nullifiers,
_commitments (Merkle tree)      pushed to _deliveries          + a Merkle membership proof
                                                               against some historical root
        "a note exists"         "someone can find it"          "some note was spent"
```

Identity is **two keys per account**, because the two jobs need different math:

- **spend key** `pk = Hf(sk)`: a Field-typed hash of a 32-byte secret. Owns notes. Field-typed so it can ride the field-arithmetic ciphertexts of the audit and delivery records.
- **encryption key** `encPk = g^encSk`: a Jubjub point. Receives note deliveries via ECDH.

The circuits cannot bind the two together; an account publishes them as a pair, and a sender who addresses a delivery to the wrong `encPk` only prevents *discovery*, not the note's existence.

# 4. Architecture: the composition

```
RegulatedConfidentialNoteFungibleToken (preset — the deployable contract)
  ├── ConfidentialNoteFungibleToken                  core: tree, nullifiers, conservation, issuer gate
  ├── ConfidentialNoteFungibleTokenAudit             ext: audit records + DERIVES output nonces
  ├── ConfidentialNoteFungibleTokenDelivery          ext: on-chain (value,nonce) delivery
  │     └── crypto/NoteDelivery                      pure ECDH delivery primitive
  └── ConfidentialNoteFungibleTokenPrivateSupply     ext: homomorphic supply + attestation
        └── crypto/ElGamal             lifted-ElGamal primitives (merged earlier)
  (Audit uses crypto/EcdhMask's KDF; merged earlier)
```

Four conventions to know before reading any circuit:

- **`_`-prefixed circuits are ungated building blocks.** `_mint`, `_transfer`, `_burn`, `_consumeNote` carry *no* authorization; the composing contract gates them. This is the same pattern as the library's `ConfidentialFungibleToken`: the module provides mechanisms, the preset provides policy.
- **Modules are private unless composed.** The preset imports every module under a prefix (`CNT_`, `Audit_`, …). A module's exported circuits become callable *by the preset's code*, not public entry points of the deployed contract; only the preset's own `export circuit` declarations are callable externally. So deploying the preset does not expose `CNT__transfer` to the world.
- **The re-export block surfaces observable state.** A prefix-only import keeps a module's ledger fields out of the generated TypeScript `ledger()` reader. The preset therefore explicitly re-imports and re-exports the fields wallets, auditors, and indexers must read ([source](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/presets/RegulatedConfidentialNoteToken.compact#L60-L87)): `_commitments`, `_nullifiers`, `_auditTrail`, `_deliveries`, the supply cells.
- **Extensions import no token module.** Audit, Delivery, and Supply are standalone; the *consumer* wires them to the core. This keeps each piece independently reusable and independently testable, at the price of a wiring obligation the consumer must not get wrong (§6.2, §8.2).

The wiring itself is one small circuit in the preset, and it is the best single thing to understand in the whole design ([source](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/presets/RegulatedConfidentialNoteToken.compact#L242-L249)):

```compact
// Emission policy for one output note: the audit record derives the nonce,
// the delivery makes the note discoverable. Returns the note for the core to commit.
circuit emitOutput(ownerPk: Field, encPk: JubjubPoint, value: Uint<128>, slot: Bytes<32>): CNT_Note {
  const nonce = Audit__emitAuditedOutput(ownerPk, value, slot);
  Delivery__deliver(encPk, value, nonce, slot);
  return CNT_Note { value: value, nonce: nonce };
}
```

Every output note the preset ever creates (mint output, transfer output, transfer change, burn change, seizure recovery) flows through this one function: audited first (which *produces* the nonce), delivered second, committed by the core third. That single chokepoint is what makes the compliance properties structural.

# 5. The core, circuit by circuit

File: [`token/ConfidentialNoteToken.compact`](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/ConfidentialNoteToken.compact). The core is a complete, self-contained token: `initialize` + `mint` + `transfer` + `burn` work with no extension. In standalone mode, created notes are returned to the caller as a local private result and handed to recipients out of band; the extensions replace that with on-chain delivery.

## 5.1 State and witnesses

```compact
export ledger _isInitialized: Boolean;
export ledger _issuerPk: Field;                              // Hf(issuerSecret)
export ledger _commitments: HistoricMerkleTree<32, Bytes<32>>;
export ledger _nullifiers: Set<Bytes<32>>;
```

Two collections carry the whole model: the append-only commitment tree ("what value exists") and the nullifier set ("what has been spent"). Exactly the Zcash split quoted in §2: the tree proves existence, the set prevents double-spends, and neither reveals amounts or owners.

```compact
witness wit_SecretKey(): Bytes<32>;         // owner's spend secret; pk = Hf(sk)
witness wit_IssuerSecret(): Bytes<32>;      // issuer's secret; issuerPk = Hf(secret)
witness wit_InputNote(): Note;              // the note being consumed
witness wit_Path(cm): MerkleTreePath<32, Bytes<32>>;   // its Merkle path
witness wit_NonceRandomness(): Bytes<32>;   // fresh + secret seed per invocation
```

These are the private inputs (§2, *Witness*). The wallet supplies them per call; nothing here reaches the chain except through an explicit `disclose()`.

> **The one rule that keeps the system alive:** nonces are spend-critical. The nullifier preimage is the nonce alone, so *any* party that knows a nonce derives the same nullifier. That is a feature (it is what makes seizure escrow-free, §9.4) and a hard requirement: output nonces MUST be unique and unpredictable, and `wit_NonceRandomness` MUST return a fresh, secret seed per invocation.

## 5.2 The pure derivations

Three exported `pure` circuits define the note algebra. They are exported precisely so off-chain code (wallets, auditors, tests) derives identities and watches notes *the same way the circuits do*.

**`derivePk(sk: Bytes<32>): Field`** ([source](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/ConfidentialNoteToken.compact#L91-L93))

```compact
return degradeToTransient(persistentHash<Bytes<32>>(sk));
```

The identity hash `pk = Hf(sk)`. `persistentHash` is the SHA-256-class hash; `degradeToTransient` maps the digest into a Field so the pk can participate in field arithmetic (needed by the audit/delivery ciphertexts, which one-time-pad Field values).

**`commitOf(note: Note, pk: Field): Bytes<32>`** ([source](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/ConfidentialNoteToken.compact#L99-L106))

`cm = H("OZ:cnt:commit", value, nonce, pk)`. The commitment binds all three fields; the nonce's 256 bits of entropy make it hiding (§2, *Note commitment*). Note that ownership is bound here, in the commitment, not in the nullifier: this is why only someone who can produce the right `pk` can spend the note (§5.6).

**`nullifierOf(note: Note): Bytes<32>`** ([source](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/ConfidentialNoteToken.compact#L112-L117))

`nf = H("OZ:cnt:null", nonce)`. Derivable by anyone who knows the nonce, and by design *only* from the nonce. Compare Zcash, where nullifier derivation involves a per-account nullifier key, so knowing a note's contents does not let third parties track its spend. Here it does, deliberately: the auditor watches consumption, and the authority seizes, through exactly this property. The cost is that nonce secrecy carries all spend protection (§14).

Both hashes are domain-separated (`OZ:cnt:commit` vs `OZ:cnt:null`), so a commitment can never be replayed as a nullifier or vice versa.

## 5.3 `initialize(issuerPk: Field): []` · k=6, 31 rows

[source](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/ConfidentialNoteToken.compact#L129-L133) — One-shot: asserts not already initialized, stores `_issuerPk`, sets the flag. The issuer is the only role the core itself needs; audit/authority/supply keys belong to the extensions and preset.

## 5.4 The user-facing circuits: `mint`, `transfer`, `burn`

These three are the core's own out-of-the-box token. Each derives output nonces from the caller's randomness witness via the private helper `freshNonce`, and each returns the created note(s) to the caller as a **local private result**: the return value goes to the calling wallet only, nothing extra on-chain. Revealing a returned note publicly would expose its nonce (spend-critical) and its amount.

**`mint(recipientPk: Field, value: Uint<128>): Note`** · k=14, 13 217 rows ([source](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/ConfidentialNoteToken.compact#L148-L155))

- Gate: `_assertIssuer()` — the caller proves the issuer secret in-circuit.
- Builds `Note { value, nonce: freshNonce("OZ:cnt:out") }` and calls `_mint(note, recipientPk)`.
- Public effect: **one commitment insert. The amount is written nowhere.** Issuance stays hidden; this is the headline difference from native shielded tokens (§3.2).
- Returns the note so the issuer can hand it to the recipient out of band (standalone mode).

**`transfer(recipientPk: Field, value: Uint<128>): [Note, Note]`** · k=16, 36 394 rows ([source](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/ConfidentialNoteToken.compact#L172-L184))

- Reads the caller's identity (`_spenderPk()`) and input note (`_inputNote()`), asserts `input.value >= value`.
- Builds the recipient note (`value`) and a change note (`input.value - value`) with distinct nonce slots (`"OZ:cnt:out"` vs `"OZ:cnt:chg"`, so the two nonces differ even within one invocation).
- Delegates to `_transfer`, which consumes the input and commits both outputs.
- Public effect: **one nullifier, two commitments.** No amounts, no parties. Note the UTXO idiom: there is no partial spend; the input is consumed whole and change returns to the sender as a brand-new note, exactly like Bitcoin change outputs.
- Returns `[outNote, changeNote]` to the caller's wallet.

**`burn(value: Uint<128>): Note`** · k=15, 25 584 rows ([source](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/ConfidentialNoteToken.compact#L199-L210))

- Same shape as `transfer` minus the recipient note: consumes the input, re-issues only the change, so `value` leaves circulation.
- Public effect: one nullifier, one commitment. **A burn is publicly indistinguishable from any other spend**, and the burned amount is hidden. (Transaction *shape* still distinguishes a burn/seize from a transfer; see §10.)

## 5.5 The gate and the peek

**`_assertIssuer(): []`** · k=13, 2 277 rows ([source](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/ConfidentialNoteToken.compact#L231-L235)) — asserts initialization and `Hf(wit_IssuerSecret()) == _issuerPk`. Authorization by hash-preimage proof: the secret never leaves the wallet, and there is no signature; the ZK proof itself is the authentication.

**`_spenderPk(): Field`** ([source](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/ConfidentialNoteToken.compact#L217-L219)) — `Hf(wit_SecretKey())`, the caller's spend identity, exposed so composing contracts authorize spends the way the core does.

**`_inputNote(): Note`** ([source](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/ConfidentialNoteToken.compact#L244-L246)) — a peek at the same witness `_consumeNote` will read, so a composer can size the change and run its emission policy *before* the spend. Consistency is not trusted: `_transfer`/`_burn` re-read the witness and enforce conservation against it, so a mismatch between the peek and the spend fails the proof.

## 5.6 `_consumeNote(ownerPk: Field): Note` — the heart · k=14, 12 248 rows

[source](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/ConfidentialNoteToken.compact#L313-L333) — Everything that makes this a shielded pool happens in these twenty lines. Step by step:

```compact
const input = wit_InputNote();                 // (1) the secret: which note
const cm = commitOf(input, ownerPk);           // (2) recompute its commitment
const path = wit_Path(cm);                     // (3) the secret: where in the tree
const root = disclose(merkleTreePathRoot<32, Bytes<32>>(path));
assert(_commitments.checkRoot(root), "...input root not recognized");   // (4)
assert(cm == path.leaf, "...path does not match input commitment");     // (5)
const nf = nullifierOf(input);                 // (6) derive the nullifier
assert(!_nullifiers.member(disclose(nf)), "...note already spent");     // (7)
_nullifiers.insert(disclose(nf));              // (8) mark spent, publicly
return input;                                  // (9) hand back for accounting
```

- **(1)–(3): the private inputs.** The note and its Merkle path enter as witnesses. Nobody watching the chain learns which leaf is being spent.
- **(4): membership at a historical root.** The circuit recomputes the path's root and discloses *only the root*, then checks it against the tree's root history (`HistoricMerkleTree.checkRoot`, §2). Disclosing a root reveals nothing about which leaf: every historical root covers all leaves inserted up to that point. The history is a liveness feature, not a privacy one — a proof built moments before someone else's insert still verifies.
- **(5): the binding.** `cm == path.leaf` ties the witness note to the tree. Combined with (2), the prover must know `(value, nonce)` such that `H(domain, value, nonce, ownerPk)` sits in the tree. This is where **ownership** is enforced: the commitment binds `ownerPk`, and the callers of `_consumeNote` decide what `ownerPk` means. The core's `transfer`/`burn` pass `_spenderPk()`, so spending requires the spend secret. The preset's `seize` passes the *target's* pk with the authority's own gate on top (§9.4).
- **(6)–(8): single-spend.** The nullifier is derived, checked absent, and inserted, all in one circuit. Publishing `nf` says "some note died" and nothing else; linking it to a specific note requires knowing that note's nonce (which the auditor does, by design).
- **(9):** the note returns to the caller so `_transfer`/`_burn` can do value accounting on it.

## 5.7 The ungated building blocks: `_mint`, `_transfer`, `_burn`

These accept **caller-built notes**, which is the entire composition hook: a composing contract can source nonces from its own emission policy (the preset sources them from the audit ECDH) instead of the core default. They carry no authorization; the composer gates them.

**`_mint(note: Note, ownerPk: Field): []`** · k=13, 6 766 rows ([source](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/ConfidentialNoteToken.compact#L255-L258)) — one line: insert `disclose(commitOf(note, ownerPk))` into the tree. Only the hiding commitment crosses to public state. The composer decides who may create value, how the nonce was produced, and how the note reaches its owner.

**`_transfer(spenderPk, recipientPk, outNote, changeNote): []`** · k=15, 25 732 rows ([source](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/ConfidentialNoteToken.compact#L272-L278)) — consume + conserve + re-mint:

```compact
const input = _consumeNote(spenderPk);
assert(input.value == outNote.value + changeNote.value, "...does not conserve value");
_mint(outNote, recipientPk);
_mint(changeNote, spenderPk);
```

The conservation assert is the token's monetary integrity, checked inside the proof on values nobody outside can see. There is no way to satisfy it while creating value from nothing, because `input` is pinned to a committed note by `_consumeNote`.

**`_burn(spenderPk, value, changeNote): []`** · k=15, 19 119 rows ([source](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/ConfidentialNoteToken.compact#L292-L297)) — same, with `input.value == value + changeNote.value` and only the change re-minted. `value` simply stops existing.

## 5.8 `freshNonce(slot: Bytes<32>): Field` (private)

[source](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/ConfidentialNoteToken.compact#L337-L340) — `Hf(wit_NonceRandomness(), "OZ:cnt:nonce:core", slot)`. The seed is per-invocation; the `slot` tag separates the multiple outputs of a single invocation (out vs change). The module-level domain tag also guarantees core-derived nonces can never collide with the audit-derived nonces of §6, even under a misbehaving seed.

# 6. Extension: Audit — auditor viewing, complete by construction

File: [`extensions/ConfidentialNoteTokenAudit.compact`](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/extensions/ConfidentialNoteTokenAudit.compact). The design question this answers: *can a note token satisfy a regulator — who can see what, prove what, and do what?* The answer is yes, and structurally rather than by policy.

## 6.1 The trick: the nonce IS the audit channel

For each output note, `_emitAuditedOutput`:

1. runs an ECDH against the global audit key (`E_a = g^e_a`, `S_a = auditKey^e_a`),
2. **derives the note's nonce from the shared secret**: `nonce = KDF(S_a, "OZ:cnt:nonce")`,
3. publishes an `AuditRecord { ephemeralPk, valueCt, ownerCt }` where value and owner are one-time-padded to the same secret,
4. returns the nonce, which the consumer must commit verbatim.

Because the nonce *comes out of* the audit ECDH, the auditor recovers `(owner, value, nonce)` for every output **by construction**: an output the auditor cannot open cannot exist in a pool that routes all note creation through this circuit. There is no honest-participation assumption; a transaction that skips or fakes the record cannot exist, because the commitment written to the tree binds the same `(value, nonce, owner)` the record encrypts, inside one proof.

Deriving the nonce this way also kills the nonce-freshness footgun: freshness reduces to the freshness of the ephemeral scalar, which the ECDH already requires for its own security.

Scope the word "mandatory" carefully, because it operates at two levels. Composing the extension is the **deployer's** choice: it is an extension, and the core alone has no audit at all. What is not a choice is per-transaction evasion: in a deployment that routes every output through this circuit, as the preset does, a **user** cannot produce a note the auditor can't open. Deployer-optional, user-inescapable. Contrast Zcash viewing keys, where visibility depends on the key holder choosing to share.

From the recovered fields the auditor recomputes every commitment (`commitOf`) and every nullifier (`nullifierOf`), which yields the full compliance dataset:

| Capability | How |
| --- | --- |
| amounts + recipients, per output | decrypt the audit record |
| **sender** of a spend | the published nullifier identifies the consumed note, whose owner the auditor already knows from *that* note's own audit record |
| full transaction-graph reconstruction | watch each note from commitment insert to nullifier publish |
| seizure support | the audit trail supplies exactly the witnesses `seize` needs (§9.4) |

What the audit key cannot do: **spend**. It decrypts; it holds no spend authority (spending needs an owner `sk` or the authority gate). One sharp caveat from the module doc: knowing every nonce means the auditor can derive every nullifier *preimage*, so in a seizure-enabled preset the audit trail is exactly what arms the seizure authority. Handing one party both keys makes that party's compromise equal to full clawback power.

## 6.2 The circuits

**`initialize(auditKey: JubjubPoint): []`** · k=10, 615 rows ([source](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/extensions/ConfidentialNoteTokenAudit.compact#L90-L96)) — one-shot; also rejects the identity point as the audit key, since an identity key would make every "ciphertext" trivially openable (the EcdhMask weak-input rule).

**`_emitAuditedOutput(ownerPk: Field, value: Uint<128>, slot: Bytes<32>): Field`** · k=15, 31 599 rows ([source](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/extensions/ConfidentialNoteTokenAudit.compact#L109-L133))

```compact
const ea = degradeToTransient(persistentHash([wit_AuditRandomness(), "OZ:cnt:ea", slot]));
const eaPk = ecMulGenerator(ea);
assert(eaPk != ecMulGenerator(0 as Field), "...zero audit ephemeral");
const shared = ecMul(_auditKey, ea);
const nonce = EcdhMask_kdf(shared, "OZ:cnt:nonce");
_auditTrail.pushFront(disclose(AuditRecord {
  ephemeralPk: eaPk,
  valueCt: (value as Field) + EcdhMask_kdf(shared, "OZ:cnt:a:value"),
  ownerCt:  ownerPk         + EcdhMask_kdf(shared, "OZ:cnt:a:owner")
}));
return nonce;
```

Reading notes: the ephemeral scalar expands from a witness seed, domain-separated per `slot` so one transaction's several outputs get independent ephemerals. The identity-point guard subsumes `ea != 0` (a zero ephemeral would zero the shared secret and expose the pads). The three KDF calls are domain-separated so nonce, value pad, and owner pad are independent. Each ciphertext is a field one-time-pad: `ct = plaintext + KDF(S, tag)`, recoverable by subtracting the same pad.

**`recoverAuditRecord(record: AuditRecord, auditSk: Field): AuditView`** (pure, [source](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/extensions/ConfidentialNoteTokenAudit.compact#L141-L148)) — the auditor's side, off-chain: `S = ephemeralPk^auditSk`, subtract the pads, re-derive the nonce. Feeding the result to `commitOf` / `nullifierOf` reconstructs the note's lifecycle.

The ledger `_auditTrail: List<AuditRecord>` is the extension's event substitute: Compact has no events, so observable feeds are append-lists the indexer reads.

> **Wiring warning (from the module doc):** audit completeness is a property of the *consumer's* wiring. A note created without `_emitAuditedOutput` is invisible to the auditor. Route every note-creation path through it — the preset's `emitOutput` chokepoint (§4) is exactly that.

# 7. Extension: Delivery — wallets discover notes by scanning

Files: [`extensions/ConfidentialNoteTokenDelivery.compact`](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/extensions/ConfidentialNoteTokenDelivery.compact) and the primitive [`crypto/NoteDelivery.compact`](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/crypto/NoteDelivery.compact).

The problem: the core hands created notes back to the *caller*. The recipient of a transfer is not the caller. Without this extension, note info moves out of band (a real operational burden; the Native Shielded Token doc calls the same issue its "load-bearing operational piece"). With it, a recipient needs only chain data and their own `encSk`.

**`_deliver(encPk: JubjubPoint, value: Uint<128>, nonce: Field, slot: Bytes<32>): []`** · k=15, 23 198 rows ([source](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/extensions/ConfidentialNoteTokenDelivery.compact#L53-L62)) — expands a fresh ephemeral from `wit_DeliveryRandomness`, then publishes `NoteDelivery_deliverNote(encPk, note, ed)` to the `_deliveries` list. Only the ciphertext crosses to public state.

The primitive (`crypto/NoteDelivery`, this PR, 7 passing tests) is stateless and witness-free, pure circuits only:

| Circuit | Direction | Use |
| --- | --- | --- |
| `deliver(encPk, value, e): [Note, Delivery]` | sender | *derives* the nonce from the ECDH itself; a `Delivery` carries only `ephemeral` + `valueCt` |
| `recover(delivery, encSk): Recovered` | recipient | inverse of `deliver` |
| `deliverNote(encPk, note, e): FullDelivery` | sender | for a note whose nonce is fixed **elsewhere** — the token uses this, because the *audit* channel already derived the nonce (§6); both `value` and `nonce` ride explicit pads |
| `recoverNote(delivery, encSk): Recovered` | recipient | inverse of `deliverNote` |

This is the note-scheme counterpart of a Zcash note ciphertext (the "transmitted note ciphertext" of spec §3.2.1), rebuilt in-circuit: same ECDH-to-the-recipient shape, same trial-decryption discovery model.

**Wallet flow:** scan `_deliveries`, trial-decrypt each entry with `encSk` via `recoverNote`, recompute `commitOf(note, myPk)` for the recovered `(value, nonce)`, and keep the notes whose commitment exists in the tree. The final commitment check is what filters garbage decryptions (a wrong-key decryption yields random fields whose commitment matches nothing).

Skipping a delivery does not destroy funds; it only makes the note reachable out of band, since only the creator knows the nonce.

# 8. Extension: Supply — confidential but attestable

File: [`extensions/ConfidentialNoteTokenSupply.compact`](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/extensions/ConfidentialNoteTokenSupply.compact).

## 8.1 Why the core writes no supply

A disclosed supply counter would leak every mint and burn amount as a public delta (each tokenized-deposit position size, timestamped). Native shielded tokens cannot avoid this: `shieldedMints` is a protocol effect. The note pool can, because it never touches Zswap; the only channel that would expose issuance amounts is a supply write the core chooses not to make. Supply becomes a deployment-policy spectrum:

| Shape | Public sees | How |
| --- | --- | --- |
| none | nothing | core only; the auditor reconstructs supply from the audit trail |
| confidential + attested | a proof-backed total, at a chosen cadence | this extension |
| fully public | every mint/burn delta | compose a disclosed counter alongside mint/burn |

The middle row answers the hidden-inflation concern (how do holders know the issuer isn't printing secretly?) without giving up per-transaction amount privacy.

## 8.2 The circuits

**`initialize(supplyKey: JubjubPoint): []`** · k=11, 1 167 rows ([source](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/extensions/ConfidentialNoteTokenSupply.compact#L91-L98)) — binds the ElGamal supply key (identity point rejected) and starts `_encSupply` at the canonical `Enc(0)`. That starting ciphertext is publicly recognizable, which leaks nothing: supply genuinely is zero at that moment.

**`_addMinted(value: Uint<128>): []`** · k=13, 6 569 rows and **`_addBurned(value: Uint<128>): []`** · k=13, 7 683 rows ([source](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/extensions/ConfidentialNoteTokenSupply.compact#L111-L133)) — homomorphically add or subtract `value` inside `_encSupply`, re-randomized with fresh witness-expanded randomness. Two properties do the work here:

- A homomorphic update needs **no knowledge of the running plaintext**, so any user's burn can update the encrypted total, not just the key holder's transactions.
- Because the update happens in the same transaction as the token op, the ciphertext is *trustlessly* the true running total. The public sees only that the ciphertext changed, never by how much.

**`attestSupply(total: Uint<128>): []`** · k=13, 4 720 rows ([source](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/extensions/ConfidentialNoteTokenSupply.compact#L149-L156)) — the supply-key holder proves in-circuit that `_encSupply` decrypts to `total` under the supply key (`ElGamal_assertDecryptsTo`), then discloses only that number into `_attestedSupply`. Run daily, weekly, whatever the deployment picks: public, non-inflatable supply at attestation cadence, k-anonymous amounts in between. The attester learns the plaintext total off-chain (e.g. by summing the audit trail), so no discrete-log search is needed despite the lifted encoding.

> **Wiring warning (from the module doc):** pair every mint with `_addMinted` and every burn with `_addBurned`, on every path. Mis-wiring is security-critical and undetectable on-chain: the ciphertext silently drifts from the pool's true value, and attestation then publishes a wrong-but-proven total. Correct pairing is also what guarantees the plaintext never underflows on `_addBurned` (a burn never exceeds outstanding supply), which the ElGamal layer cannot check itself.

# 9. Preset: RegulatedConfidentialNoteFungibleToken

File: [`presets/RegulatedConfidentialNoteToken.compact`](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/presets/RegulatedConfidentialNoteToken.compact). The deployable contract: core + all three extensions, wired through the `emitOutput` chokepoint (§4), plus the one piece of policy no module owns — seizure.

## 9.1 Constructor: four roles, bound at genesis

([source](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/presets/RegulatedConfidentialNoteToken.compact#L104-L114)) — `constructor(issuerPk, authorityPk, auditKey, supplyKey)` runs the three module initializers and stores the authority pk. Deploy-and-done, no separate initialization transaction, no window where the contract exists ungoverned.

| Role | Key type | Power |
| --- | --- | --- |
| Issuer | `Field` (= `Hf(secret)`) | mint |
| Authority | `Field` | seize |
| Audit | `JubjubPoint` | read everything; never spend |
| Supply | `JubjubPoint` | attest totals |

## 9.2 `mint` · k=17, 69 322 rows

([source](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/presets/RegulatedConfidentialNoteToken.compact#L129-L134))

```compact
CNT__assertIssuer();
const note = emitOutput(recipientPk, recipientEncPk, value, pad(32, "OZ:cnt:out"));
CNT__mint(note, recipientPk);
Supply__addMinted(value);
```

Compare the core's standalone `mint` (§5.4): the preset takes an extra `recipientEncPk` parameter and returns nothing, because delivery is now on-chain; and the note's nonce now comes from the audit channel, not `freshNonce`. One call, four effects: audit record, delivery ciphertext, commitment insert, encrypted supply bump. Publicly: no amount anywhere.

## 9.3 `transfer` · k=18, 135 775 rows and `burn` · k=17, 82 803 rows

([transfer](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/presets/RegulatedConfidentialNoteToken.compact#L150-L168), [burn](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/presets/RegulatedConfidentialNoteToken.compact#L183-L194)) — the core flows with emission wired in. `transfer` peeks at the input via `CNT__inputNote()` to size the change, emits both outputs (recipient's, addressed to `recipientEncPk`; change, addressed back to `senderEncPk`), and hands them to `CNT__transfer`, whose conservation assert re-checks everything against the same witness. `burn` emits only the change and pairs `Supply__addBurned(value)`.

Note what the caller now supplies: the recipient's *two* public keys (`recipientPk` to own the note, `recipientEncPk` to find it) and their own `senderEncPk` (so their change comes back discoverable, making wallet state recoverable from chain data alone).

## 9.4 `seize` · k=17, 75 043 rows — escrow-free clawback

([source](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/presets/RegulatedConfidentialNoteToken.compact#L216-L225))

```compact
assert(CNT_derivePk(wit_AuthoritySecret()) == _authorityPk, "...not the authority");
const target = CNT__consumeNote(targetOwnerPk);
const recoveryNote = emitOutput(recoveryPk, recoveryEncPk, target.value, pad(32, "OZ:cnt:out"));
CNT__mint(recoveryNote, recoveryPk);
_seizureCount = disclose(_seizureCount + 1 as Uint<64>);
```

How the pieces line up:

- **Authorization** is the authority's own gate (first line). The owner's spend key is never involved; there is no key escrow anywhere in the system.
- **Capability** comes from the audit trail (§6): the authority learns the target note's `(value, nonce, ownerPk)` from the auditor, supplies it as the core's input-note witness, and computes the Merkle path from the public tree.
- **Mutual exclusion** is the shared nullifier at work. `nf` depends only on the nonce, so the owner's spend and the authority's seizure derive the *same* nullifier. Whichever transaction lands first inserts it; the other fails `_consumeNote`'s already-spent assert. No freeze step, no race window where both succeed.
- **Conservation and audit still hold**: the full seized value re-mints to `recoveryPk`, and the recovery note is itself audited and delivered like any other output.
- **Accountability**: `_seizureCount` increments publicly. Everyone can see *that* seizures happen and how many; nobody outside learns against whom or how much.

Production hardening named in the source: gate the authority key behind governance (multisig), and replace the single global key with per-user recovery keys for least privilege.

## 9.5 `attestSupply` · k=13, 4 720 rows

([source](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/presets/RegulatedConfidentialNoteToken.compact#L238-L240)) — a passthrough to the supply extension (§8.2), exported so the attester can call it on the deployed contract.

# 10. Privacy and disclosure, stated precisely

Everything a circuit writes to the ledger passes through an explicit `disclose()` (§2), so the disclosure surface is enumerable:

| Disclosed | Reveals | Safe because |
| --- | --- | --- |
| Merkle root (any spend) | one historical root | the path stays witness; a root does not identify a leaf |
| nullifier `nf` | "some note was spent" | preimage hidden; linkable to a note only with its nonce (auditor-only) |
| commitment insert `cm` | "a note was created" | hiding commitment (256-bit nonce entropy from the ECDH) |
| audit records / delivery ciphertexts | nothing without the keys | ECDH one-time pads with fresh, secret ephemerals |
| `_encSupply` update | "supply changed" | ElGamal ciphertext; the delta is unreadable without the supply secret |
| `attestSupply` total | the supply, at attestation time | deliberate, proof-backed disclosure at a chosen cadence |
| `_seizureCount` | number of seizures | intended public accountability |
| role keys (constructor) | who governs the contract | intended; keys are public by nature |

Per-party view of one preset `transfer`:

| Observer | Learns |
| --- | --- |
| Public / indexer | one nullifier, two commitments, two audit records, two deliveries appeared; nothing else |
| Recipient (`encSk`) | their incoming `(value, nonce)`, hence their new note |
| Sender | everything about their own transaction |
| Auditor (`auditSk`) | amounts, sender (via the consumed note's earlier record), recipient, nonces — the full travel-rule dataset |
| Issuer / authority | nothing extra, until the auditor arms the authority for a specific seizure |

What *does* leak, and is accepted: **transaction shape and timing.** A mint (one commitment, no nullifier) is distinguishable from a transfer (one nullifier, two commitments) and from a burn or seize (one nullifier, one commitment); event counts and timestamps are public. Amounts and parties are not. Burns and seizures share a shape, so a burn is not distinguishable from a seizure by shape alone (the `_seizureCount` bump distinguishes them at the transaction level).

Witness discipline underlies all of it: spend secrets, role secrets, and randomness seeds are 256-bit values that must stay fresh and secret. A predictable randomness seed breaks confidentiality outright (one-time-pad reuse opens ciphertexts; a predictable ephemeral lets anyone recompute the shared secret).

# 11. Worked example: the life of a note

The scenario that ties every circuit together. Cast: issuer **I**, users **Alice** and **Bob**, auditor **V**, authority **A**. All on the preset.

**1. Mint.** I calls `mint(alicePk, aliceEncPk, 100)`.
- In-circuit: issuer gate passes; audit ECDH runs, deriving `nonce₁` and encrypting `(100, alicePk)` to V's key; `(100, nonce₁)` is encrypted to Alice's `encPk`; `cm₁ = H(domain, 100, nonce₁, alicePk)` enters the tree; `Enc(supply)` absorbs +100.
- On-chain: `cm₁`, one `AuditRecord`, one `FullDelivery`, a new supply ciphertext. **The number 100 appears nowhere.**
- Alice's wallet scans `_deliveries`, trial-decrypts with `aliceEncSk`, recovers `(100, nonce₁)`, recomputes `cm₁`, finds it in the tree: she owns a 100-note.

**2. Transfer.** Alice calls `transfer(bobPk, bobEncPk, aliceEncPk, 30)`.
- Her wallet supplies witnesses: her `sk`, the input note `(100, nonce₁)`, its Merkle path.
- In-circuit: `_consumeNote` proves `cm₁` sits under a recognized root and publishes `nf₁ = H(domain, nonce₁)`; conservation pins `100 = 30 + 70`; two new audited-and-delivered notes commit: `(30, nonce₂)` to Bob, `(70, nonce₃)` change to Alice.
- On-chain: `nf₁`, `cm₂`, `cm₃`, two audit records, two deliveries. No amounts, no names, no link from `nf₁` back to `cm₁` for the public.
- V decrypts both audit records (learning Bob got 30, Alice kept 70) and attributes the *sender*: `nf₁` matches the nonce V recovered from step 1's record, whose owner was Alice.

**3. Burn.** Bob calls `burn(bobEncPk, 10)`: publishes `nf₂`, commits change `(20, nonce₄)`, supply absorbs −10. Publicly it looks like any spend.

**4. Seizure.** A court order targets Bob's remaining note. V hands A the note data `(20, nonce₄, bobPk)` from the audit trail. A calls `seize(bobPk, recoveryPk, recoveryEncPk)`, supplying that note as the input witness: the authority gate passes, `nf₄` publishes (so Bob's own spend of it can never land afterwards), a recovery note of 20 commits (audited, delivered), `_seizureCount` becomes 1. Bob's key was never touched; Bob's cooperation was never needed.

**5. Attestation.** At month-end, the supply-key holder computes the true total off-chain (90: minted 100, burned 10; seizure conserved value) and calls `attestSupply(90)`. The circuit verifies `Enc(supply)` really decrypts to 90 and publishes exactly that number.

# 12. Invariants

What must always hold, carried into the (planned) test suites:

1. **Conservation**: `transfer` preserves `in == out + change`; `burn` removes exactly `in − change`; `seize` conserves the full target value.
2. **Single spend**: a nullifier is consumable once, whether by owner-spend or seizure (mutual exclusion in both directions).
3. **Membership**: only committed notes are spendable; a bad path or foreign root fails.
4. **Authorization**: mint needs the issuer secret, seize the authority secret, owner-spend the note owner's secret (the commitment binds `pk`).
5. **Audit completeness**: for every output, the audit key recovers `(ownerPk, value, nonce)` and can recompute the exact committed `cm`.
6. **Delivery correctness**: for every output, the owner's `encSk` recovers `(value, nonce)` matching the committed note.
7. **Confidentiality**: a wrong key recovers nothing; ciphertexts of equal values are unlinkable (fresh ephemerals).
8. **One-shot init**: no state-changing circuit runs before initialization; initialization cannot run twice (core, extensions, preset alike).
9. **Supply correctness**: `_encSupply = Enc(Σ minted − Σ burned)` when wired 1:1 with token ops; `attestSupply` succeeds only with the supply secret and the exact total, and discloses nothing else.

# 13. Costs

Compiler figures from `@circuitInfo` (proving cost grows with rows; `k` is the circuit-size exponent):

| Circuit | k | rows |
| --- | --- | --- |
| core `_consumeNote` | 14 | 12 248 |
| core `transfer` | 16 | 36 394 |
| audit `_emitAuditedOutput` | 15 | 31 599 |
| delivery `_deliver` | 15 | 23 198 |
| supply `_addMinted` / `_addBurned` | 13 | 6 569 / 7 683 |
| preset `mint` | 17 | 69 322 |
| preset `transfer` | 18 | 135 775 |
| preset `burn` | 17 | 82 803 |
| preset `seize` | 17 | 75 043 |

Two structural facts explain the numbers. First, the dominant cost everywhere is `persistentHash` (SHA-256-class): commitments, nullifiers, Merkle leaves, KDF invocations. A stable Poseidon-class hasher on the platform would cut roughly 5× across the whole stack. Second, a preset `transfer` carries two full emission pipelines (audit + delivery per output) on top of the core spend, which is why it is ~3.7× the core `transfer`. Emission cannot be a runtime flag: in ZK, both branches of an `if` are always paid for, so optional viewing or delivery would have to be compile-time variants.

For calibration: the pure note spend (~20.5k rows in the spike) is about *half* the account-model CFT transfer (~43.8k). Graph privacy via notes is not intrinsically the expensive option; the compliance channels are what cost.

# 14. Design decisions

- **Notes, not accounts.** Sender privacy requires an unindexed commitment set with ZK membership; no account-model trick avoids it (§3.1).
- **A contract-level pool, not Zswap coins.** Buys hidden issuance amounts, evasion-proof auditor viewing, and seizure, none of which native coins can express today (§3.2). Costs: big circuits and a self-managed tree.
- **Nullifier from the nonce alone, no owner secret.** *The* deliberate deviation from Zcash-style derivation. It makes the audit trail sufficient to arm seizure with no key escrow, and owner-spend/seizure mutually exclusive on one nullifier. The price: any nonce leak is a spend-blocking (griefing) leak, so nonces are handled as spend-critical secrets end to end, and nullifier publication is only reachable through gated spend paths.
- **Output nonces derived from the audit ECDH** (preset). Audit completeness becomes structural rather than policy, and nonce freshness reduces to ephemeral freshness, which the encryption already requires (§6.1).
- **Ungated `_` building blocks + a gating preset.** The library's standard composition pattern: mechanisms in modules, policy in the consumer. The core's default `mint`/`transfer`/`burn` still work standalone, so the simplest deployment needs no extensions at all.
- **Extensions import no token module.** Standalone pieces the consumer wires; the `emitOutput` chokepoint makes correct wiring one small, reviewable function (§4).
- **`List` ledgers as event substitutes.** Compact has no events; `_auditTrail` and `_deliveries` are append-only feeds for indexers and wallets.
- **No public supply in the core; supply as a composable layer.** A disclosed counter would leak every issuance amount; ledger layouts are also fixed at deployment, so the choice is per-deployment policy (§8.1).
- **Field-typed spend pk (`Hf(sk)`).** Lets the owner identity ride the field-arithmetic one-time pads of the audit and delivery records.
- **`HistoricMerkleTree` over a plain tree.** Proofs built against a recent root still verify after later inserts; without history, every insert would invalidate every in-flight proof.
- **Domain separation everywhere.** Commit vs nullifier, core vs audit nonces, out vs change slots, value vs owner pads: every hash and pad carries a distinct `OZ:cnt:*` tag, so no derived value can be replayed in another role.

# 15. Limitations and open questions

- **The audit key is all-seeing and global.** Selective or request-based disclosure (per-custodian review keys, or an issuer-run re-encryption service) is the known Phase-2 design question. Until then, audit-key compromise is total visibility compromise.
- **One global authority key.** Production wants governance gating (compose with `multisig/`) and per-user recovery keys for least privilege.
- **Auditor + authority collusion equals unilateral clawback.** By construction (the audit trail arms seizure). Deployments should treat the two keys as separation-of-duties roles.
- **`_auditTrail` / `_deliveries` grow unboundedly.** Fine for a draft; production needs indexer-side pagination guidance and possibly retention policy.
- **No KYC allowlist yet.** A Merkle-allowlist module composed at the spend chokepoint (a hidden spender must prove membership in-circuit) per the exploration's recommendation.
- **Wallet UX is real work**: scanning, trial decryption, note management, and change tracking all live off-chain.
- **Naming.** Adopted renames (see the header note): `ConfidentialNoteFungibleToken` family, supply extension as `ConfidentialNoteFungibleTokenPrivateSupply`. Applied across the branch code (modules, mocks, simulators, witnesses, CHANGELOG). Still to sweep: the in-repo design doc carries the earlier working name `HybridConfidentialToken`, and the preset header cites a doc path that predates it.

# 16. FAQ

**What does the public ledger actually contain?**<br>Commitment inserts, nullifiers, ciphertexts (audit + delivery), supply ciphertext updates, the seizure counter, attested totals, and the role keys. No amounts, no senders, no recipients, no balances.

**How does a recipient find their money?**<br>Scan `_deliveries`, trial-decrypt with `encSk`, keep entries whose recomputed commitment is in the tree (§7). No out-of-band channel needed on the preset.

**Can the auditor spend or block my notes?**<br>No. The audit key decrypts only. Spending requires an owner secret; seizure requires the authority secret; and publishing a nullifier is only possible through those gated paths, so knowing a nonce alone cannot burn a note on-chain.

**Why can the authority seize without my keys?**<br>Because the nullifier depends only on the nonce, the authority (armed with the note data from the audit trail) derives the same nullifier you would. Consuming the note and re-minting its value to a recovery key needs no secret of yours (§9.4).

**Is this Zcash?**<br>Same skeleton (commitments, nullifiers, Merkle membership; §2 quotes the Zcash definitions this reuses), but rebuilt inside a contract with three deliberate differences: the nullifier omits the owner secret (enabling escrow-free seizure), in the regulated preset every output carries an audit record that cannot be omitted or faked (ECDH-derived nonce), and the pool is one contract's state rather than a protocol-level shielded pool.

**How is supply honest if nobody can see it?**<br>The encrypted total is updated homomorphically in the same transaction as each mint/burn, so it cannot drift from the truth (when correctly wired); `attestSupply` then proves the published number is that ciphertext's decryption (§8).

**Can I deploy just the core?**<br>Yes. `initialize` + `mint` + `transfer` + `burn` form a complete token; created notes return to the caller and move out of band. Extensions add auditor viewing, on-chain delivery, and supply on top.

**What happens if a randomness witness repeats a seed?**<br>Catastrophic loss of confidentiality: one-time-pad reuse lets an observer subtract ciphertexts and recover plaintexts, and predictable ephemerals let anyone recompute shared secrets. Fresh, secret, per-invocation seeds are a hard wallet-side requirement.

**Why `Uint<128>` values?**<br>Headroom, and no protocol coupling: unlike native mints (capped at `Uint<64>` by the ledger's effect encoding), note values never touch a protocol effect.

# 17. Implementation status

| Component | Status |
| --- | --- |
| `crypto/NoteDelivery` | implemented, 7 passing tests |
| `crypto/EcdhMask`, `crypto/ElGamal` | merged earlier (PR [#655](https://github.com/OpenZeppelin/compact-contracts/pull/655) line) |
| Core + 3 extensions + preset | implemented; compile-verified (`@circuitInfo` present) |
| Mocks, simulators, witness harnesses | in the PR |
| Token-level unit suites | not yet (invariants of §12 are the plan) |
| Security audit | not started; DRAFT, not production |

# References

Pinned commits: compact-contracts PR #679 [`878aa43`](https://github.com/OpenZeppelin/compact-contracts/tree/878aa438b98879088f13f0ef96e10311ff020257) · Compact [`c06961e`](https://github.com/LFDT-Minokawa/compact/tree/c06961eb661942f7689c6509d0913326f264e848).

1. <a id="ref-1"></a>[Zcash: What are zk-SNARKs?](https://z.cash/learn/what-are-zk-snarks/) — zero-knowledge proof and zk-SNARK definitions.
2. <a id="ref-2"></a>[Bitcoin developer glossary](https://developer.bitcoin.org/glossary.html) — UTXO definition.
3. <a id="ref-3"></a>[Zcash protocol specification](https://zips.z.cash/protocol/protocol.pdf), §3.2 *Shielded Pools and Notes* — note definition.
4. <a id="ref-4"></a>Zcash protocol specification, §3.2.2 *Note Commitments*.
5. <a id="ref-5"></a>Zcash protocol specification, §3.8 *Note Commitment Trees*.
6. <a id="ref-6"></a>Zcash protocol specification, §3.9 *Nullifier Sets*.
7. <a id="ref-7"></a>[Orchard design book: Nullifiers](https://zcash.github.io/orchard/design/nullifiers.html) — nullifier derivation requirements.
8. <a id="ref-8"></a>[Ben-Sasson et al., *Zerocash: Decentralized Anonymous Payments from Bitcoin*, IEEE S&P 2014](https://eprint.iacr.org/2014/349) — origin of the note/commitment/nullifier payment scheme.
9. <a id="ref-9"></a>[`compact doc/compact-reference.mdx:1489-1506`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/doc/compact-reference.mdx#L1489-L1506) — witnesses.
10. <a id="ref-10"></a>[`compact doc/compact-reference.mdx:3490-3510`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/doc/compact-reference.mdx#L3490-L3510) — `disclose()`.
11. <a id="ref-11"></a>[`compact doc/ledger-adt.mdx:595-608`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/doc/ledger-adt.mdx#L595-L608) — `HistoricMerkleTree`, `checkRoot`.
12. <a id="ref-12"></a>W. Diffie and M. Hellman, [*New Directions in Cryptography*](https://ee.stanford.edu/~hellman/publications/24.pdf), IEEE Trans. Inf. Theory 22(6), 1976 — the key-agreement construction ECDH instantiates.
13. <a id="ref-13"></a>[`crypto/EcdhMask.compact`](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/crypto/EcdhMask.compact) — construction, freshness/secrecy rules, weak-input guards.
14. <a id="ref-14"></a>T. ElGamal, [*A Public Key Cryptosystem and a Signature Scheme Based on Discrete Logarithms*](https://ieeexplore.ieee.org/document/1057074), IEEE Trans. Inf. Theory 31(4), 1985.
15. <a id="ref-15"></a>[`crypto/ElGamal.compact`](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/crypto/ElGamal.compact) — lifted variant, homomorphism, subgroup trust assumption.
16. <a id="ref-16"></a>[zkcrypto/jubjub](https://github.com/zkcrypto/jubjub) — Jubjub curve definition.
17. <a id="ref-17"></a>[`compact compiler/standard-library.compact:47`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/compiler/standard-library.compact#L47) — `export new type JubjubPoint`.
18. <a id="ref-18"></a>[`contracts/privacy_readme.md`](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/privacy_readme.md) — the four-tier exploration, benchmarks, and findings behind the model choice.
19. <a id="ref-19"></a>[`contracts/src/token/docs/hybrid-confidential-token.md`](https://github.com/OpenZeppelin/compact-contracts/blob/878aa438b98879088f13f0ef96e10311ff020257/contracts/src/token/docs/hybrid-confidential-token.md) — the in-PR design doc (compliance mapping, disclosure boundary, open questions).
