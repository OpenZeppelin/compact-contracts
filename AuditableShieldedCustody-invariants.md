---
stage: invariants
project: nst-phase2-auditable-custody
mode: extension
extends: contracts/src/token (NST MIP-0011 + custody explorations on feat/native-shielded-custody-hybrid)
status: draft
timestamp: 2026-07-02
author: 0xisk
previous_stage: AuditableShieldedCustody-design.md
tags: [nst, custody, privacy, elgamal, notes, multisig, mgbp, invariants]
---

# NST Phase 2 — Auditable Shielded Custody (Invariants)

## Summary

Correctness properties for the `AuditableShieldedCustody` extension and the
`MultisigAuditableShieldedToken` preset. The organizing principle: the note
pool must be sound (spend soundness, consume-once, conservation), the public
ledger must reveal only commitments/nullifiers/roots/ciphertexts (disclosure
discipline, constant write shape), and the custodian must be able to
reconstruct every balance and flow from chain data alone (memo↔note binding).
The most critical invariants are INV-7 (spend soundness), INV-19 (reserve
backing), INV-32 (custodian completeness), INV-38 (multisig replay binding),
and INV-40 (ECDSA destub gate).

Naming note: enforcement sketches use design names (`_spendNote`,
`wit_*`, `Custody_` prefix). Preserved-invariant references cite actual
file:line on `feat/native-shielded-custody-hybrid`.

## Type-Level / Circuit-Shape Invariants

### INV-1: Compiler-Enforced Disclosure Boundary

**Category:** Type-level / circuit-shape
**Statement:** Every witness-derived value that reaches the ledger or an exported return crosses through `disclose(...)`; the complete set of crossings is: note commitments, nullifiers, `merkleTreePathRoot(path)` values, `NoteMemo` ciphertexts, allowlist leaves/indices, and encrypted-cell writes. Nothing else derived from `wit_*` crosses.
**Applies to:** All circuits; witnesses `wit_secretKey`, `wit_spentNote`, `wit_opAmount`, `wit_notePath`, `wit_authPath`, `wit_recipientOwnerId`, `wit_custodianEk`, `wit_plain*`, `wit_seed`, `wit_redeemCoin`.
**Enforcement mechanism:**
- Compiler: `compactc` aborts on any undisclosed witness-tainted ledger write or return.
- Test: review of generated circuit + the disclosure table in the design doc; each `disclose` site named in code comments.
**Violation scenario:** A forgotten crossing (e.g. returning a computed change value) compiles only with an added `disclose`, making the leak explicit and reviewable; a deliberate wrong `disclose` publishes a secret (e.g. a plaintext amount) permanently.
**Severity:** Critical

### INV-2: Sealed Constructor-Only Parameters

**Category:** Type-level / circuit-shape
**Statement:** `_instanceSalt` and `_custodianPk` are `sealed` — written exactly once at construction, immutable afterwards. Custodian key rotation is impossible without redeploy.
**Applies to:** `initialize`; every derivation using `_instanceSalt`; every memo encryption using `_custodianPk`.
**Enforcement mechanism:**
- Compiler: `sealed ledger` rejects post-constructor writes.
- Test: simulator assert that no exported circuit mutates either field.
**Violation scenario:** A mutable custodian key lets a compromised admin path swap the audit key mid-life, splitting the memo stream across keys and silently breaking custodian reconstruction (INV-32).
**Severity:** High

### INV-3: Fixed-Size State, Bounded Circuits

**Category:** Type-level / circuit-shape
**Statement:** All collections are compile-time sized: `HistoricMerkleTree<20>` (notes), `MerkleTree<20>` (allowlist), `Vector<2>` pubkeys/signatures, fixed-arity hash inputs. No recursion, no runtime-sized data anywhere in a circuit.
**Applies to:** Whole module + preset.
**Enforcement mechanism:**
- Compiler: sized-only types; loop bounds compile-time known.
- Runtime check: capacity asserts pair with this (INV-13).
**Violation scenario:** N/A at runtime — a design needing unbounded iteration would fail to compile; the depth-20 cap (~1M notes / ~1M allowlist slots) is the hard lifetime capacity.
**Severity:** Medium

### INV-4: `computeOwnerId` Is Pure

**Category:** Type-level / circuit-shape
**Statement:** `computeOwnerId(secretKey)` reads no ledger state and calls no witness; it is a deterministic function of its argument (domain-tagged `persistentHash`), so ownerIds are stable across deployments of the same instance and computable off-chain.
**Applies to:** `computeOwnerId`, `_spendNote` ownership binding, key issuance tooling.
**Enforcement mechanism:**
- Compiler: `pure circuit` rejects ledger reads and witness calls.
**Violation scenario:** An impure derivation (e.g. mixing `_instanceSalt` implicitly) would break off-chain key issuance and custodian reconstruction, which precompute ownerIds from the HSM master secret.
**Severity:** Medium
**Note:** Because `computeOwnerId` must be salt-free for off-chain issuance, ownerId is portable across instances; per-instance separation enters at the commitment/nullifier layer via `_instanceSalt` (INV-24 caveat).

### INV-5: No Undisclosed Branch Gates a Ledger Write

**Category:** Type-level / circuit-shape
**Statement:** No `if` whose condition is witness-tainted gates a ledger write. The design commits to zero conditional ledger writes; if one is ever introduced, its condition must be wrapped in `disclose(...)` (the branch bit becomes an explicit, reviewed leak).
**Applies to:** All circuits; spends (INV-29) are the load-bearing case.
**Enforcement mechanism:**
- Compiler: `compactc` rejects tainted conditions gating public writes without `disclose` (the audit L-01/L-02 lesson from PR #616).
- Test: grep-level review — no `if` around `_notes.insert` / `_memos.insert` / `_nullifiers.insert` / cell updates.
**Violation scenario:** `if (amount > 0) { insert change }` leaks "amount was zero" per tx — exactly the seize/transfer distinguisher the constant-shape design removes.
**Severity:** High

## Runtime Invariants

### INV-6: Per-Module Initialization Gate

**Category:** Runtime
**Statement:** `initialize` runs exactly once (`assert(!_custodyInit)` then set); every state-touching circuit asserts `_custodyInit`. The flag is an inline per-module boolean (compact#270 workaround) — never the shared `Initializable` module.
**Applies to:** `initialize`, `_authorize`, `_freeze`, `_unfreeze`, `_credit`, `_transfer`, `_redeem`, `_seizeTo`; preset constructor wires each composed module's own init exactly once.
**Enforcement mechanism:**
- Runtime check: `assert(_custodyInit, "AuditableShieldedCustody: not initialized")`; `assert(!_custodyInit, ...)` in `initialize`.
- Pattern reference: inline flag as in `NativeShieldedTokenCore.compact:71`; compact#270 hazard documented at `security/Initializable.compact:10-25`.
**Violation scenario:** Shared-flag dedup (two modules importing Initializable from one directory) lets one module's init mark the other initialized — uninitialized salt/pk would make every commitment derivable with a default salt.
**Severity:** Critical

### INV-7: Spend Soundness

**Category:** Runtime
**Statement:** A spend is valid iff (a) the recomputed commitment from `(computeOwnerId(wit_secretKey()), value, rho)` equals the witnessed path leaf, (b) `_notes.checkRoot(disclose(merkleTreePathRoot(path)))` passes (historic), and (c) the derived nullifier is not in `_nullifiers`. All three are asserted in `_spendNote`/`_spendNoteUnchecked` before any state write.
**Applies to:** `_transfer`, `_redeem`, `_seizeTo` (and `seizeBurn` in the preset).
**Enforcement mechanism:**
- Runtime check: `assert(path.leaf == commitment, "path leaf mismatch")`; `assert(_notes.checkRoot(...), "unknown note root")`; `assert(!_nullifiers.member(nullifier), "note already spent")` — mirror of `ShieldedCustody.compact:571-578`.
- Cryptographic: commitment binding (`persistentHash` collision resistance) prevents spending a value other than the committed one.
- Test: wrong secretKey / wrong value / wrong rho / fabricated path / double-spend each ⇒ assert or proof failure.
**Violation scenario:** Any relaxation forges value: spending a non-existent note inflates custody supply against the reserve; skipping (c) is a double-spend.
**Severity:** Critical

### INV-8: Per-Spend Value Conservation

**Category:** Runtime
**Statement:** Every spend creates outputs summing exactly to the spent value: `out + change == in` with `assert(value >= out)` and `change = value - out` computed in-circuit. Zero-value outputs are legal (shape uniformity); no path creates or destroys note value except `_credit` (+), `_redeem`/`seizeBurn` (−), which move value across the notes↔reserve boundary under INV-11/INV-19.
**Applies to:** `_transfer` (out to recipient + change to spender), `_seizeTo` (out to target + change per Q5), `_redeem`/`seizeBurn` (amount debited + change back).
**Enforcement mechanism:**
- Runtime check: `assert(value >= sendValue, "insufficient balance")` then construct both notes from the same in-circuit arithmetic — mirror of `ShieldedCustody.compact:435-441`.
- Test: sum-of-note-values conservation across randomized transfer sequences (simulator, custodian-view reconstruction as oracle).
**Violation scenario:** An output not tied to `value - out` mints unbacked claims inside the pool — undetectable publicly (values are hidden) until redemption drains the reserve.
**Severity:** Critical

### INV-9: Note Value Bound (BSGS Decryptability)

**Category:** Runtime
**Statement:** Every note value is `< 2^48` (`MAX_NOTE_VALUE`), asserted at the value-injection point (`_credit`). Transfer/seize outputs inherit the bound inductively (`out <= value`, `change = value - out`, and `value` is bound by the commitment of a previously bound note).
**Applies to:** `_credit` (mandatory assert); optionally defensive asserts at other note-creation sites.
**Enforcement mechanism:**
- Runtime check: `assert(amount < 2^48, "value bound exceeded")` (or native `Uint<48>` param if compiler support confirms — open Q1).
- Cryptographic: bound is what keeps `encValue = Enc(g^v)` BSGS-recoverable by the custodian.
**Violation scenario:** A note above 2^48 produces a memo the custodian cannot decrypt by discrete-log search — the fully-on-chain audit requirement silently fails for that note and all descendants of its value.
**Severity:** High

### INV-10: Transfer Allowlist Gating

**Category:** Runtime
**Statement:** `_transfer` requires both the spender's ownerId and `recipientOwnerId` to be current members of `_authorizedAccounts` (current-root check, non-historic), and `recipientOwnerId != default<Bytes<32>>`. Unchecked spends (INV-37) skip the spender check only per the policy matrix.
**Applies to:** `_transfer`; `_seizeTo` recipient-side check (target account must be authorized).
**Enforcement mechanism:**
- Runtime check: `assert(path.leaf == ownerId)` + `assert(_authorizedAccounts.checkRoot(disclose(merkleTreePathRoot(authPath))), "not authorized")` — mirror of `ShieldedCustody.compact:595-596`; `assert(recipientOwnerId != default<Bytes<32>>, "zero recipient")`.
- Test: frozen spender ⇒ abort; frozen recipient ⇒ abort; pre-freeze auth path ⇒ abort (root changed).
**Violation scenario:** Historic-root allowlist check would let a frozen account keep transferring against pre-freeze roots — freeze becomes advisory.
**Severity:** Critical

### INV-11: Encrypted-Cell Overdraw Guards

**Category:** Runtime
**Statement:** Homomorphic subtraction cannot detect underflow (wraps mod ℓ), so every decrement of an encrypted cell is guarded by the decrypt-verify pattern: witness the claimed plaintext, `ElGamal_assertDecryptsTo(cell, _custodianPk, wit_custodianEk(), claimed)` (which also binds `derivePk(ek) == pk`), then `assert(claimed >= amount)`. Applies to `_credit` against `_encUnallocated` AND `_redeem`/`seizeBurn` against `_encCustodySupply`.
**Applies to:** `_credit` (`wit_plainUnallocated`), `_redeem`/`seizeBurn` (`wit_plainSupply`).
**Enforcement mechanism:**
- Runtime check: pattern verbatim from `MultisigConfidentialShieldedToken.compact:358-362` (`assertDecryptsTo` + `assert(bal >= amount, "insufficient ...")`).
- Test: credit exceeding unallocated ⇒ abort; redeem exceeding supply ⇒ abort; stale witnessed plaintext (cell changed) ⇒ `assertDecryptsTo` fails.
**Violation scenario:** Unguarded `subEncrypted` wraps: crediting more than was minted fabricates unbacked claims (fractional reserve); the custodian's decrypted supply goes nonsensical (≈ℓ), destroying the audit view.
**Severity:** Critical
**Note:** the design text makes the guard explicit only for credit; this doc extends it to every decrement — deviation flagged in Dev Notes.

### INV-12: Reserve-Burn Coin Checks (Preserved from NST)

**Category:** Runtime
**Statement:** Reserve burns (`redeemNote`, `seizeBurn`) go through `Token__burnFromSelf` with `assert(coin.color == tokenType(_domain, kernel.self()))` and `assert(coin.value >= amount)`; the burned amount equals the note amount debited from `_encCustodySupply` in the same circuit.
**Applies to:** `redeemNote`, `seizeBurn`; witness `wit_redeemCoin`.
**Enforcement mechanism:**
- Runtime check: `NativeShieldedTokenCore.compact:336-337`; equality of burn amount and supply decrement by construction (single `amount` variable).
- Test: wrong-color coin ⇒ abort; burn amount ≠ note amount unrepresentable (one variable).
**Violation scenario:** Burning a different amount than debited desynchronizes reserve vs `Enc(supply)+Enc(unallocated)` — INV-19 breaks silently (values encrypted).
**Severity:** Critical

### INV-13: Capacity Guards

**Category:** Runtime
**Statement:** Every tree insert is preceded by a fullness assert: `!_notes.isFull()` before each note insert, `!_authorizedAccounts.isFull()` before authorize.
**Applies to:** `_insertNote` (all spend/credit paths), `_authorize`.
**Enforcement mechanism:**
- Runtime check: mirror of `ShieldedCustody.compact:263,619`.
**Violation scenario:** Insert into a full tree corrupts/aborts at the runtime layer with an unhelpful failure; the assert gives a stable, diagnosable error at ~1M lifetime notes.
**Severity:** Medium

### INV-14: Witness Read-Once Discipline

**Category:** Runtime
**Statement:** Each witness is called exactly once per circuit invocation and the value bound to a `const`; all uses (commitment recompute, memo encryption, msgHash binding) reuse that one value.
**Applies to:** All circuits; critical in `_credit`/`_transfer` where the same witnesses feed both the note commitment and the memo (INV-32 depends on them being the same values).
**Enforcement mechanism:**
- Code shape: read-once pattern as in `MultisigConfidentialShieldedToken.compact:329-334`; review + tests with stateful mock witnesses returning different values per call ⇒ proof fails or memo/commitment mismatch is impossible.
**Violation scenario:** A witness read twice can return two different values (witnesses are adversarial TS code) — e.g. commit value v but encrypt memo value v′, corrupting the custodian view while every individual assert passes.
**Severity:** Critical

### INV-15: ElGamal Operand Validity

**Category:** Runtime
**Statement:** `initialize` asserts `custodianPk` ≠ identity (`ElGamal_encryptPoint` re-asserts per encryption); every encryption randomness is nonzero (`encryptPoint` asserts) and a valid Jubjub scalar (< ℓ, guaranteed by the `degradeToTransient` derivation path). Subgroup membership of `custodianPk` is a prover-level trust assumption (cofactor clearing), not an in-circuit check.
**Applies to:** `initialize`, every memo encryption, every cell update.
**Enforcement mechanism:**
- Runtime check: `ElGamal.compact:218-219` (`identity pk`, `zero randomness`); scalar validity via `expandRandomness`/`degradeToTransient` (`ElGamal.compact:29-35,134`).
- Cryptographic: subgroup trust assumption per `ElGamal.compact:37-59`; pinned by `crypto/test/CurveRuntimeInvariants.test.ts` (ElGamal review MEDIUM-1 — full-proof smoke test still open).
**Violation scenario:** Identity pk ⇒ all memos non-hiding; out-of-range scalar ⇒ prover fault; a non-subgroup custodianPk (if the runtime assumption failed) breaks negation-based homomorphism in the cells.
**Severity:** High

## State Transition Invariants

### INV-16: Notes Tree Append-Only, Historic Roots Valid

**Category:** State transition
**Statement:** `_notes` only ever gains leaves (insert; no `insertIndex`, no deletion). Every root the tree has ever had remains accepted by `checkRoot` — a spend proof built against an old root survives concurrent inserts.
**Applies to:** `_insertNote` callers; `_spendNote*` root checks.
**Enforcement mechanism:**
- Type: `HistoricMerkleTree<20, Bytes<32>>` semantics.
- Test: build proof, insert unrelated notes, spend still verifies.
**Violation scenario:** Using a plain tree here would make concurrent activity invalidate in-flight spends (griefing); using `insertIndex` would silently orphan commitments.
**Severity:** High

### INV-17: Nullifier Set Grow-Only

**Category:** State transition
**Statement:** `_nullifiers` is insert-only across the contract lifetime; no circuit removes a member. Once spent, always spent.
**Applies to:** All spend circuits.
**Enforcement mechanism:**
- Code shape: `Set.insert` only; no remove call exists in the module.
- Test: ledger-reader diff across full test suite — set cardinality never decreases.
**Violation scenario:** Any removal re-arms a spent note — direct double-spend.
**Severity:** Critical

### INV-18: Replay Nonce Strictly Monotonic, Consumed Once Per Gated Op

**Category:** State transition
**Statement:** `_replayNonce` is read then incremented exactly once at the top of every multisig-gated circuit; the pre-increment value is what msgHash binds. No gated circuit completes without consuming a nonce; no circuit consumes two.
**Applies to:** `mintReserve`, `creditNote`, `redeemNote`, `seizeTo`, `seizeBurn`, `authorizeAccount`, `freeze`, `unfreeze`, `pause`, `unpause`.
**Enforcement mechanism:**
- Code shape: `const n = _replayNonce; _replayNonce.increment(1);` before verify — pattern from `MultisigNativeShieldedToken.compact:176-177`.
- Type: `Counter` cannot decrement.
- Test: same signatures replayed ⇒ `invalid signature` (post-destub) / msgHash mismatch.
**Violation scenario:** A gated op that skips the increment lets one signature bundle authorize unbounded repeats of the operation.
**Severity:** Critical

### INV-19: Reserve Backing / Global Conservation

**Category:** State transition
**Statement:** At every block height, with `Dec` = custodian decryption:
1. `Dec(_encCustodySupply)` = Σ values of unspent notes;
2. `Dec(_encUnallocated)` = Σ `mintReserve` amounts − Σ credited amounts;
3. value of reserve coins held at `kernel.self()` = `Dec(_encCustodySupply)` + `Dec(_encUnallocated)`.
Circuit-level deltas maintain this: `mintReserve` (+unallocated, +reserve coin), `_credit` (−unallocated, +supply, +note), `_redeem`/`seizeBurn` (−supply, −note value, −reserve coin), `_transfer`/`_seizeTo` (no cell/reserve change).
**Applies to:** Every circuit that touches a cell, a note value, or the reserve.
**Enforcement mechanism:**
- Runtime check: per-circuit paired updates from one `amount` variable + INV-8 + INV-11 + INV-12.
- Cryptographic: additive homomorphism of lifted ElGamal (`add`/`sub` correctness, `ElGamal.compact:273-290`).
- Test: simulator oracle — decrypt cells with test ek after randomized op sequences and compare to a TS model of note values and reserve balance.
**Violation scenario:** Any drift means redeem eventually fails against a drained reserve, or a seized/burned claim remains redeemable — the institutional-solvency headline breaks.
**Severity:** Critical
**Dev validation:** confirmed 2026-07-02 — items 1–3 are the solvency definition; no additional economic invariants required.

### INV-20: Allowlist Slot Lifecycle (Tombstone Freeze)

**Category:** State transition
**Statement:** Allowlist slots move only through: empty → `ownerId` (authorize, append at next free index) → tombstone `pad(32, frozen-tag)` (freeze, `insertIndex` overwrite) → `ownerId` (unfreeze, restore). Freeze takes effect immediately for all future membership checks because checks are against the current root only (INV-10). The `index` argument is admin-trusted bookkeeping.
**Applies to:** `_authorize`, `_freeze`, `_unfreeze`.
**Enforcement mechanism:**
- Code shape: verbatim idiom from `ShieldedCustody.compact:261-316`; non-historic `MerkleTree` type is load-bearing.
- Test: freeze then attempt transfer with pre-freeze path ⇒ abort; unfreeze restores; freeze of a wrong index tombstones the wrong account (documented admin risk, multisig-gated).
**Violation scenario:** Switching the allowlist to a historic tree (or checking historic roots) makes freeze non-effective — sanctioned accounts keep moving funds.
**Severity:** Critical

### INV-21: Memo Completeness and Key Uniqueness

**Category:** State transition
**Statement:** Every commitment inserted into `_notes` has exactly one `_memos` entry written in the same circuit invocation, keyed by that commitment. Memos are never overwritten or deleted; key collisions cannot occur because commitments are unique (INV-23).
**Applies to:** `_credit`, `_transfer`, `_redeem`, `_seizeTo` (every `_insertNote` site pairs with a `_memos.insert`).
**Enforcement mechanism:**
- Code shape: `_insertNote` helper takes the memo and performs both writes, so no call site can skip one.
- Test: ledger reader — |memos| == number of leaves inserted, ∀ leaf: memo exists.
**Violation scenario:** A note without a memo is invisible to the custodian's reconstruction — the fully-on-chain audit requirement fails for that note; an overwritten memo destroys the record of a prior note.
**Severity:** Critical

### INV-22: Constructor Establishes the Assumed Initial State

**Category:** State transition
**Statement:** The preset constructor: initializes each composed module exactly once (`Token_`, `TokenNonce_`, `Signer_`, custody), seals `_instanceSalt`/`_custodianPk`, seeds `_encCustodySupply` and `_encUnallocated` with `ElGamal_encryptZero()` (canonical identity ciphertext `{(0,1),(0,1)}`, never the Map default `{(0,0),(0,0)}`), and asserts `threshold` within the verifiable range (≤ 2 with `Vector<2>` signatures).
**Applies to:** Constructor / `initialize`.
**Enforcement mechanism:**
- Runtime check: `assert(threshold <= 2, ...)` (pattern `ShieldedCustodyMultiSig.compact:145`); `encryptZero` seeding per `NativeShieldedTokenConfidentialLedger.compact:118-127` (off-curve default hazard documented there at L49-57).
- Test: deploy then decrypt both cells ⇒ 0; second `initialize` ⇒ abort.
**Violation scenario:** Cells left at the struct default `(0,0)` are off-curve — first homomorphic update faults and strands the accounting; threshold 3 with 2 signature slots bricks every gated op.
**Severity:** Critical

### INV-23: Rho and Commitment Uniqueness

**Category:** State transition
**Statement:** Every created note has a globally unique `rho`, hence a unique commitment and a unique future nullifier: `rho_credit` binds the strictly-monotonic `_replayNonce`; `rho_out`/`rho_change` bind the spent note's nullifier (globally unique by INV-17/36) under distinct domain tags. No two notes ever share (commitment) or (nullifier-to-be).
**Applies to:** All note-creation sites; derivation table in the design doc.
**Enforcement mechanism:**
- Cryptographic: injectivity of domain-tagged `persistentHash` inputs (collision resistance) + uniqueness of the bound nonce/nullifier.
- Test: TS model asserts no duplicate commitments/nullifiers across randomized runs.
**Violation scenario:** Duplicate rho for the same owner+value ⇒ identical commitment ⇒ second `_memos.insert` overwrites the first (INV-21 breaks) and both notes share one nullifier — spending one voids the other (fund loss).
**Severity:** Critical

## Privacy & Disclosure Invariants

### INV-24: Identity Secrecy

**Category:** Privacy & disclosure
**Statement:** `secretKey` and `ownerId` never appear on the ledger, in returns, or in assert messages. They enter public values only as preimages of domain-tagged hashes (commitment, nullifier, rho derivations) or inside the point-ElGamal `encOwner` ciphertext.
**Applies to:** All circuits; TS witnesses.
**Enforcement mechanism:**
- Compiler: INV-1 (no undisclosed crossing exists to leak them).
- Cryptographic: preimage resistance of `persistentHash`; DDH-hiding of `encOwner`.
- Test: ledger-state dump contains no value equal to (or derivable by one hash from) any test secretKey/ownerId.
**Violation scenario:** A leaked ownerId links all of that account's credit notes (rho_credit grinding, INV-31) and, joined with the KYC table, deanonymizes flows.
**Severity:** Critical

### INV-25: Amount Privacy

**Category:** Privacy & disclosure
**Statement:** No plaintext amount reaches public state except the `mintReserve` amount (forced by the protocol `shieldedMints` effect). Credit/transfer/redeem/seize amounts exist publicly only as hash preimages, ElGamal ciphertexts, or ciphertext deltas. There is no public `_custodySupply` counter (deliberate difference from Candidate B: `ShieldedCustody.compact:139`, whose supply writes reveal every boundary amount).
**Applies to:** All circuits; `_encCustodySupply`/`_encUnallocated` updates.
**Enforcement mechanism:**
- Compiler: INV-1; no `Uint` supply field exists in the schema to leak into.
- Cryptographic: ElGamal IND-CPA under fresh randomness (INV-28).
- Test: ledger diff after credit/transfer/redeem contains only commitments, nullifiers, roots, ciphertexts, counters.
**Violation scenario:** A public supply delta on credit/redeem reveals institutional flow volumes — the confidentiality requirement that motivated Candidate C.
**Severity:** Critical

### INV-26: Merkle Path Privacy

**Category:** Privacy & disclosure
**Statement:** For both trees, only `merkleTreePathRoot(path)` is disclosed — never the path, the leaf index, or the leaf position. Which note was spent and which allowlist slot proved membership stay hidden.
**Applies to:** `_spendNote*`, `_assertAuthorized`.
**Enforcement mechanism:**
- Code shape: `checkRoot(disclose(merkleTreePathRoot(path)))` idiom only (`ShieldedCustody.compact:572,596`); no other path component crosses.
- Test: circuit disclosure audit.
**Violation scenario:** Disclosing the path or index links the spend to a specific insertion (deanonymizes the graph exactly where the note pool is supposed to hide it).
**Severity:** Critical

### INV-27: Nullifier Unlinkability

**Category:** Privacy & disclosure
**Statement:** Without `secretKey`, a disclosed nullifier is computationally unlinkable to its commitment: the two are outputs of differently-tagged hashes whose shared preimage components (`secretKey`/`ownerId`, `rho`) are secret. The custodian (holding the master secret) links them by design; nobody else can.
**Applies to:** All spends; derivation table.
**Enforcement mechanism:**
- Cryptographic: domain separation (`tag_note` vs `tag_null`) + ≥256-bit secret preimage entropy (INV-31).
- Test: statistical/structural — nullifiers share no algebraic relation with commitments in ledger data.
**Violation scenario:** Linkable nullifiers rebuild the transaction graph publicly — the CFT gap (Candidate A failure) reintroduced.
**Severity:** Critical

### INV-28: Memo Randomness Freshness and Secrecy

**Category:** Privacy & disclosure
**Statement:** Every ElGamal ciphertext written (memos and cell updates) uses randomness that is (a) unique per ciphertext — distinct domain tag per ciphertext within a call, uniqueness across calls from the once-only spent nullifier (spend paths) or fresh `wit_seed` per credit (credit path); (b) secret — derived from `secretKey` (spend) or the custodian seed (credit); (c) nonzero and in scalar range (INV-15). Randomness is never reused under `_custodianPk` with two different plaintexts.
**Applies to:** All memo encryptions; `addEncrypted`/`subEncrypted` cell updates.
**Enforcement mechanism:**
- Code shape: `degradeToTransient(persistentHash([tag_r_<ciphertext>, sk, nullifier]))` per design table; credit path `ElGamal_expandRandomness(wit_seed(), tag)` with distinct tags (`ElGamal.compact:134`).
- Test: extract all `c1` values from ledger — no duplicates across the suite.
**Violation scenario:** Reused `r` under the same pk gives identical `c1`; any observer computes `m − m′` between the two plaintexts (e.g. exact difference of two credit amounts) — confidentiality broken without any key.
**Severity:** Critical
**Hardening (adopted 2026-07-02):** mix `_replayNonce` into the credit-path tags (`tag = H(tag_r_credit_*, nonce)`) so even a reused or misconfigured `wit_seed` cannot repeat `(seed, tag)` across credits. Cheap in-circuit; closes the only client-supplied-randomness hazard left.

### INV-29: Constant Write Shape Per Circuit

**Category:** Privacy & disclosure
**Statement:** Each circuit's ledger-write shape is fixed and input-independent: `_transfer`/`_seizeTo` always write 1 nullifier + 2 commitments + 2 memos; `_redeem`/`seizeBurn` always 1 nullifier + 1 commitment + 1 memo + 1 cell update + reserve burn; `_credit` always 1 commitment + 1 memo + 2 cell updates. Change notes are written even at zero value; zero-value seize/transfer is legal (no `amount > 0` assert on `_seizeTo`/`_transfer`, matching `EscrowedShieldedCustody.compact:568`). Failures abort the whole tx — no partial-progress observable.
**Applies to:** All state-writing circuits.
**Enforcement mechanism:**
- Code shape: no conditional writes (INV-5); unconditional change-note insert.
- Test: ledger-diff shape identical across (full-value transfer, partial transfer, zero-value transfer) and across (seizeTo vs transfer) up to circuit identity.
**Violation scenario:** Skipping the zero-value change note makes exact-amount spends distinguishable, leaking amount relations per tx.
**Severity:** High
**Note:** circuit identity per tx is public by design (D4) — the shape invariant hides parameters, not operation type. This corrects the design's blanket "2 commitments + 2 memos" phrasing to per-circuit constants (deviation noted in Dev Notes).

### INV-30: Bounded Auxiliary Leakage

**Category:** Privacy & disclosure
**Statement:** Beyond the intended public surface (commitments, nullifiers, roots, ciphertexts, circuit identity, mintReserve amounts, nonce values), the only accepted side-channel is one bit per successful cell-guarded op: "witnessed plaintext ≥ amount" (INV-11 success). Assert messages are compile-time constants (no witness-derived content).
**Applies to:** `_credit`, `_redeem`, `seizeBurn`; all assert sites.
**Enforcement mechanism:**
- Code shape: `const` error strings, prefix `"AuditableShieldedCustody: "`; leak budget documented per circuit.
- Test: string audit of compiled artifact.
**Violation scenario:** A data-bearing assert message or an extra success/failure distinction widens the oracle beyond the accepted bit.
**Severity:** Medium

### INV-31: Grinding Resistance of Public Hashes

**Category:** Privacy & disclosure
**Statement:** Every publicly visible hash output has ≥256 bits of secret preimage entropy: commitments and nullifiers bind `secretKey` or `ownerId` (= H(secretKey), HSM-derived); no low-entropy witness (amount, index) is ever hashed to a public value without such a component. Accepted exception: `rho_credit` binds only `recipientOwnerId` + public nonce — if the KYC↔ownerId table leaks, credit-note values become 2^48-grindable (design decision, open Q4).
**Applies to:** All derivations in the design table.
**Enforcement mechanism:**
- Cryptographic: entropy audit of each derivation's input set (this table is the audit).
- Test: N/A (structural property; verified by review).
**Violation scenario:** A commitment over only (amount, public nonce) is brute-forced offline in 2^48 — amounts public in practice.
**Severity:** High

### INV-32: Custodian Completeness and Soundness (Requirement 3)

**Category:** Privacy & disclosure
**Statement:** Two halves. **Completeness:** from chain data (memos, nullifiers, commitments, public nonces) plus `masterSecret` and `custodianEk` alone, the custodian reconstructs every note's owner, value, and spent-status inductively from genesis — no off-chain note DB. **Soundness:** a prover cannot make the custodian's view diverge from the real pool: the same in-circuit witness values feed both the commitment and the memo (INV-14 + INV-21), so a memo that decrypts to anything other than the committed (owner, value) is unsatisfiable.
**Applies to:** `_credit`, `_transfer`, `_redeem`, `_seizeTo`; memo construction; rho derivations (in-circuit, not free witnesses — the induction step).
**Enforcement mechanism:**
- Cryptographic: in-circuit derivation of `rho_out`/`rho_change` from (spender key, spent nullifier) — the custodian recomputes them after identifying the spender via expected-nullifier matching; memo decryption then cross-checks the recomputed commitments.
- Test: full custodian-reconstruction integration test — run a randomized op sequence, rebuild all balances from ledger + master secret only, compare to the TS model exactly.
**Violation scenario:** Completeness failure = a balance the custodian cannot prove to a regulator (the product requirement). Soundness failure = a customer-side prover corrupts the bank's books while every proof verifies.
**Severity:** Critical

### INV-33: Off-Chain Secret Hygiene

**Category:** Privacy & disclosure
**Statement:** TS witness implementations perform no logging, telemetry, or network calls involving `secretKey`, note plaintexts, cached cell plaintexts, or `custodianEk`; witness state lives in the private-state provider only. The HSM master secret never leaves the custodian boundary; `wit_custodianEk` is only ever provided to custodian-operated provers.
**Applies to:** `AuditableShieldedCustodyWitnesses.ts`; deployment topology (design § Integration Patterns).
**Enforcement mechanism:**
- Test/review: witness-implementation review; no `console.*`/network in witness code paths.
**Violation scenario:** A logging call in a witness re-creates the off-chain leak the on-chain design eliminated.
**Severity:** High

### INV-34: `encOwner` Mapping One-Way and Injective

**Category:** Privacy & disclosure
**Statement:** The map ownerId → JubjubPoint used in `encOwner` is injective (distinct owners ⇒ distinct points, so custodian KYC-lookup is unambiguous) and one-way (the point reveals ownerId only to someone holding a candidate list). The primitive does not exist in the repo yet (design assumed `hashToCurve`); the chosen construction must preserve both properties.
**Applies to:** `NoteMemo.encOwner`; custodian KYC lookup table.
**Enforcement mechanism:**
- Cryptographic: working construction (adopted 2026-07-02) `ecMulGenerator(degradeToTransient(persistentHash([tag_owner_pt, ownerId])))` — injective w.h.p. (hash collision resistance), one-way given ownerId entropy (INV-24/31); known discrete log to `g` is harmless here (the point is a lookup token, not a commitment base). Code stage verifies cost/codegen only.
- Test: distinct test owners produce distinct decrypted points; custodian lookup table round-trips.
**Violation scenario:** A non-injective map mis-attributes seized/credited funds to the wrong KYC identity; an invertible map leaks ownerIds to anyone (ciphertexts are custodian-hiding, but decrypted evidence handed to a regulator would then expose keys).
**Severity:** High

## Authorization & Replay Invariants

### INV-35: Spend Authority = Key Knowledge

**Category:** Authorization & replay
**Statement:** The only authorization to spend a note is knowledge of the `secretKey` whose derived `ownerId` matches the committed note owner — enforced by recomputing the commitment in-circuit from `computeOwnerId(wit_secretKey())` (INV-7a). There is no `msg.sender`; custodian seize authority is the same primitive with a custodian-derived key (D2), not a bypass.
**Applies to:** `_spendNote`, `_spendNoteUnchecked`; all spend circuits.
**Enforcement mechanism:**
- Cryptographic: commitment binding; wrong key ⇒ recomputed commitment ≠ any tree leaf ⇒ INV-7 aborts.
- Test: wrong-witness spend ⇒ proof fails (full-proof e2e, not just `--skip-zk`).
**Violation scenario:** Any spend path not anchored in the commitment recompute lets an arbitrary prover spend arbitrary notes.
**Severity:** Critical

### INV-36: Nullifier Consume-Once Across All Spend Paths

**Category:** Authorization & replay
**Statement:** All four spend circuits derive the nullifier by the identical formula from the identical inputs and check/insert against the single `_nullifiers` set — a note spent via `transfer` cannot be re-spent via `seizeTo` or vice versa.
**Applies to:** `_transfer`, `_redeem`, `_seizeTo`, `seizeBurn`.
**Enforcement mechanism:**
- Code shape: one shared `_spendNote*` helper owns derivation + check + insert; no circuit derives nullifiers independently.
- Test: spend via transfer then seize same note ⇒ `note already spent`.
**Violation scenario:** Divergent derivation (e.g. a tag typo in one path) gives one note two nullifiers — double-spend across paths.
**Severity:** Critical

### INV-37: Unchecked Spends Skip Only the Allowlist

**Category:** Authorization & replay
**Statement:** `_spendNoteUnchecked` (used by `_redeem`, `_seizeTo`, `seizeBurn`) differs from `_spendNote` in exactly one omission: the spender's current-allowlist membership check. Ownership binding, historic-root membership, and consume-once are identical. Frozen accounts therefore remain seizable/redeemable — freeze immobilizes the holder, not the custodian.
**Applies to:** `_redeem`, `_seizeTo`, `seizeBurn`.
**Enforcement mechanism:**
- Code shape: `_spendNote = _spendNoteUnchecked + _assertAuthorized` layering (pattern `EscrowedShieldedCustody.compact:636-641`).
- Test: seize a frozen account's note ⇒ succeeds; transfer from frozen ⇒ aborts.
**Violation scenario:** An unchecked variant that also skipped commitment recompute or nullifier insert would let the multisig seize non-existent value or replay seizures.
**Severity:** Critical

### INV-38: Multisig Message Binding

**Category:** Authorization & replay
**Statement:** Every gated op verifies signatures over `msgHash = persistentHash([domainTag_op, kernel.self().bytes, replayNonce, opCommitment])` where `opCommitment = persistentCommit(privateParams, wit_opBlind())`. This binds: operation type (per-op tag), this contract instance (`self` — cross-contract replay dead), this nonce (INV-18 — same-contract replay dead), and the exact private parameters (commitment binding — a relayer cannot mutate params). The blinding factor keeps params unrecoverable from the public `opCommitment`.
**Applies to:** All 10 gated preset circuits; ops without private params bind a constant params slot (pattern `ShieldedCustodyMultiSig.compact:295`).
**Enforcement mechanism:**
- Runtime check: `assert(persistentCommit(params, blind) == opCommitment, "commitment mismatch")` (pattern `MultisigConfidentialShieldedToken.compact:353-354`) + `Signer_verify`.
- Test: replay same bundle ⇒ abort; bundle for op A submitted to op B ⇒ abort; identical bytecode deployed twice, bundle cross-submitted ⇒ abort; params changed under same commitment ⇒ abort.
**Violation scenario:** Omitting `self` (as `ShieldedCustodyMultiSig.compact:452-454` does — gap NOT to inherit) lets a signature bundle for a test instance drive the production instance.
**Severity:** Critical

### INV-39: Signer Registry Integrity

**Category:** Authorization & replay
**Statement:** Signers are stored as salted commitments (`persistentHash(pk, _signerSalt, domain)`), never plain pubkeys; verification requires `validCount ≥ threshold` with per-signature registry membership and adjacent-duplicate rejection (sound iff signature vector length ≤ 2 — the preset asserts `threshold ≤ 2` accordingly); the signer set and threshold are fixed at construction (EcdsaSignerManager exposes no mutators).
**Applies to:** Constructor, `Signer_verify` in every gated circuit.
**Enforcement mechanism:**
- Runtime check: `EcdsaSignerManager.compact:195,197,200` + `SignerManager.compact:58,65,97`.
- Test: duplicate pubkey pair ⇒ abort; non-signer pubkey ⇒ abort; threshold unmet ⇒ abort.
**Violation scenario:** Widening to `Vector<3>` signatures without replacing adjacency dedup with full pairwise checks lets one signer count twice (A,B,A passes adjacency).
**Severity:** Critical

### INV-40: ECDSA Destub Gate (Known Unenforced Invariant)

**Category:** Authorization & replay
**Statement:** "Gated ops require ≥ threshold valid ECDSA signatures from registered signers" is NOT currently enforced: `stubVerifySignature` returns `true` unconditionally, and msgHash uses `persistentHash` where BitGo-compatible signing needs keccak256. Until both are replaced, every multisig gate reduces to "anyone who can build the proof". The contract MUST NOT hold real value before destub; all other invariants are designed to hold unchanged across the swap (msgHash preimage structure INV-38 is destub-stable).
**Applies to:** All gated circuits; `EcdsaSignerManager.compact:213-219`.
**Enforcement mechanism:**
- Process: release blocker, tracked in Dev Notes of every artifact in this pipeline; tests must be written against the real-verify semantics (signature fixtures) so destub flips them from vacuous-pass to meaningful.
**Violation scenario:** Deploying with value pre-destub: any user mints reserve, credits themselves, seizes anyone.
**Severity:** Critical

### INV-41: No Policy-Free Exit

**Category:** Authorization & replay
**Statement:** No circuit converts a custody note into a bearer Zswap coin under holder-only authority: there is no `withdraw`. Value leaves custody only through multisig-gated `redeemNote`/`seizeBurn`, which burn reserve and settle off-ledger. `transfer` moves claims strictly inside the allowlisted pool.
**Applies to:** Preset exported surface (closed-world property).
**Enforcement mechanism:**
- Code shape: absence — the extension's `_withdraw`-like path is simply not built/exported (rationale as `ShieldedCustodyMultiSig` INV-33 comment, its L370-371).
- Test: exported-circuit list assertion in the artifact test (no withdraw symbol).
**Violation scenario:** A holder-authorized exit path turns freeze/seize into dead letters — a flagged account exits to a bearer coin before the multisig acts.
**Severity:** Critical

## Existing Invariants (Extension Mode)

### Preserved (composed modules, must not break)

- **NST Core**: color = `tokenType(_domain, kernel.self())` computed at call time; `_domain` sealed; burn asserts color + sufficiency (`NativeShieldedTokenCore.compact:289-290,336-337`); `_mint` rejects zero recipient (`:241`); per-module inline init flag (`:71`).
- **NST reserve ownership**: preset mints to `kernel.self()` only (constant recipient, `MultisigNativeShieldedToken.compact:193`) — reserve coins are contract-owned; mintReserve amounts protocol-public.
- **DerivedNonce**: chain seeded once, `_counter` monotonic, derived nonce namespaced by 25-byte tag (`NativeShieldedTokenDerivedNonce.compact:80-108`); mints using it are recipient-public — acceptable, the recipient is the contract itself.
- **EcdsaSignerManager / SignerManager**: commitment storage, threshold range 1 ≤ t ≤ signerCount, adjacency dedup ≤ 2 sigs, no post-init signer mutation (INV-39 sources).
- **Pausable**: `_pause`/`_unpause` are module-level ungated (`Pausable.compact:69-88`) — the preset MUST wrap them in multisig gating (policy matrix rows pause/unpause); admin/compliance ops work while paused.
- **ElGamal**: `r != 0`, identity-pk rejection, `degradeToTransient` scalar validity, subgroup membership as prover-level trust assumption (review MEDIUM-1), intentional malleability — integrity is this module's job via INV-14/21/32, never the ciphertext's (review INFO-5).
- **Custody idioms carried from `ShieldedCustody`/`EscrowedShieldedCustody`**: tombstone freeze on non-historic tree; historic notes tree; unconditional change note; `_spendNote = unchecked + allowlist` layering; seize shape-parity.

### Modified

- **Supply visibility**: Candidate B's public `_custodySupply: Uint<128>` (+ its overflow/underflow asserts) is replaced by encrypted cells — the arithmetic guards become INV-11's decrypt-verify pattern. Public-supply invariants from `ShieldedCustody` intentionally do NOT carry over.
- **msgHash discipline**: adopted from Phase 1 `MultisigNativeShieldedToken` ([tag, self, nonce, params]) — NOT from `ShieldedCustodyMultiSig` ([nonce, selector, paramsHash], which omits `self`; superseded, gap documented in INV-38).
- **Seize visibility**: `EscrowedShieldedCustody` made seizeTo/transfer byte-shape identical; here seize occurrence is public by circuit identity (D4) — the parity invariant narrows to parameter-hiding (INV-29).

### New

- All of INV-1 … INV-41 above; the memo layer (INV-21, INV-28, INV-32, INV-34), encrypted cells (INV-11, INV-19, INV-22), and opCommitment binding (INV-38) have no precedent in the composed modules.

## Invariant Coverage Matrix

| Function | Invariants | Enforcement |
|----------|-----------|-------------|
| constructor / `initialize` | INV-2, INV-6, INV-15, INV-22, INV-39, INV-40 | sealed writes + init asserts + `encryptZero` seeding + threshold assert |
| `mintReserve` | INV-6, INV-12(color), INV-18, INV-19, INV-38, INV-39, INV-40 | nonce consume + msgHash + `Token__mint(self)` + `_encUnallocated += amount` |
| `creditNote` | INV-6..9, INV-11, INV-13, INV-14, INV-19, INV-21, INV-23, INV-25, INV-28..32, INV-38..40 | overdraw decrypt-verify + note+memo insert + cell updates + opCommitment |
| `transfer` | INV-5..10, INV-13, INV-14, INV-16, INV-17, INV-23..29, INV-31, INV-32, INV-35, INV-36 | `_spendNote` + allowlist both sides + 2 notes + 2 memos, pause-gated |
| `redeemNote` | INV-6..8, INV-11, INV-12, INV-14, INV-18, INV-19, INV-21, INV-25, INV-28..30, INV-32, INV-35..38, INV-40, INV-41 | unchecked spend + supply decrypt-verify + `_burnFromSelf` + opCommitment |
| `seizeTo` | INV-6..8, INV-10(recipient), INV-14, INV-18, INV-21, INV-23, INV-25, INV-28, INV-29, INV-32, INV-35..38, INV-40 | unchecked spend + 2 notes + 2 memos + opCommitment |
| `seizeBurn` | same as `redeemNote` | same, without consent semantics |
| `authorizeAccount` | INV-6, INV-13, INV-18, INV-20, INV-38..40 | allowlist append + msgHash |
| `freeze` / `unfreeze` | INV-6, INV-18, INV-20, INV-38..40 | tombstone `insertIndex` + msgHash; works while paused |
| `pause` / `unpause` | INV-18, INV-38..40 (+ Pausable preserved) | multisig-gated wrap of ungated module |
| `computeOwnerId` | INV-4, INV-24 | `pure circuit` |
| views (`tokenColor`, `getNonce`, `custodianPk`) | INV-6, INV-30 | read-only; no witness input |

## Out of Scope

- Custodian key compromise / rotation — `_custodianPk` sealed by INV-2; rotation and threshold-ElGamal are deferred hardening (design Out of Scope).
- Memo pruning / ledger growth — no deletion invariants defined because no deletion exists.
- KYC-table leak resilience of credit-note hiding — accepted exception inside INV-31 (open Q4 owns any hardening).
- Front-running economics of self-serve `transfer` — spends are proof-bound to the spender's key and outputs; mempool-level ordering games move no value, so no commit-reveal invariant is defined.
- Wallet/SDK-side invariants (BSGS table correctness, note cache consistency) — integration work, not contract properties.
- CMA / verifier-key upgrade invariants — nothing deployed; revisit at first release.
- Proof-server / indexer availability and the operator-vs-self-serve key-distribution policy — deployment topology, not circuit properties.

## Dev Notes

Carried from design + new findings during extraction:

- `_burnFromContract` → `_burnFromSelf`: confirmed real break — the shielded token exposes only `_burnFromSelf`; the stale name appears in `MultisigNativeShieldedToken.compact:259`, `MultisigConfidentialShieldedToken.compact:378`, doc comments, and `NativeShieldedTokenOwnable/AccessControl` presets. Fix lands with the code stage; INV-12 is written against `_burnFromSelf`.
- `hashToCurve` does not exist anywhere in the repo — design Q2 confirmed. INV-34 carries the proposed `g^H(ownerId)` construction (known-dlog acceptable for a lookup token); code stage decides.
- INV-11 extends the design: the decrypt-verify overdraw guard is required on `_redeem`/`seizeBurn` supply decrements too, not only credit (homomorphic sub wraps mod ℓ; `wit_plainSupply` already exists in the design's witness list, so this is a clarification, not a new witness).
- INV-29 corrects the design's blanket "spends always write nullifier + 2 commitments + 2 memos" to per-circuit shape constants (redeem/seizeBurn legitimately write 1 note + 1 memo).
- INV-28's nonce-mixed credit-path randomness tags: adopted (cheap hardening against a reused `wit_seed`).
- INV-38: do not inherit `ShieldedCustodyMultiSig`'s msgHash (omits `kernel.self()`); Phase 1 `MultisigNativeShieldedToken` pattern + opCommitment is the binding to implement.
- ECDSA stub + `persistentHash`-not-keccak msgHash remain THE production blockers (INV-40); design Dev Note stands.
- Policy matrix recorded as designed: `transfer` is pause-gated (open Q3 unresolved — if remediation-during-pause is wanted, INV-29's shape and the matrix row change together).
- ElGamal review MEDIUM-1 (subgroup trust assumption never exercised through the proof server) inherits into this project's test plan: at least one full-proof e2e including memo encryption.
- Compile early: `transfer` ≈ k=16–17 estimate; INV-3's depth-20 trees and the trimmed view set are the block-limit levers.

## Open Questions

1. `Uint<48>` native vs `Uint<64>` + assert for INV-9 — code-draft to verify compiler support/codegen cost (design Q1, carried).
2. RESOLVED 2026-07-02: `encOwner` uses the `g^H(ownerId)` construction in INV-34; code-draft verifies cost/codegen only (design Q2, closed).
3. `transfer` pause-gating (design Q3, carried) — affects policy matrix row and coverage matrix only.
4. Credit-rho grinding hardening (design Q4, carried) — INV-31 documents the accepted exception; adding a custodian-secret component needs a sealed commitment to bind the witness.
5. Seize change-note destination (design Q5, carried) — INV-8/INV-29 written for change-to-victim; a sweep variant changes both.
6. RESOLVED 2026-07-02: INV-28's nonce-mixed credit randomness tags adopted.
7. Full-proof smoke test scope for the ElGamal subgroup assumption (inherited MEDIUM-1) — tests stage.
8. Regulator/auditor access model — does an auditor ever hold `custodianEk`, or only receive decrypted evidence the custodian chooses to share? No product input yet; INV-30/INV-33 are written for custodian-only key holding. Carry to code-draft/docs; revisit if the auditor gets key material.
