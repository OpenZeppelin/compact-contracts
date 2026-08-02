# Confidential token privacy: exploration branch

**Status: exploratory spike. Unaudited. Not production.** This branch prototypes the
full spectrum of confidential-token privacy on Midnight, end to end in Compact, to
answer the questions that decide the architecture *before* committing a production
track. Everything here compiles and is covered by passing tests, but it is research
scaffolding: some modules are deliberately throwaway (see "What ships vs what was
learning" at the end).

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./privacy-spectrum-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="./privacy-spectrum-light.svg">
    <img alt="Confidential token privacy spectrum: an animation cycling through four tiers that progressively hide the amount, recipient, and sender of a transaction, with the constraint-row cost of each." src="./privacy-spectrum-light.svg" width="720">
  </picture>
</p>

> The animation above cycles the four tiers. Warm fields are exposed on-chain; cool
> fields are encrypted. An **interactive** version (drag the slider yourself) lives at
> [`privacy-spectrum.html`](./privacy-spectrum.html) — open it locally or via GitHub
> Pages; the draggable controls can't run inside a rendered README.

If you read one thing: the account model and the note model are **two products for
two markets**, not two rungs of a ladder. The account model gives hidden amounts +
public graph + cheap native seizure (institutional/compliance). The note model gives
hidden amounts + hidden graph, and, as we proved here, is also seizable and
regulator-viewable (privacy-first + regulated). Graph privacy is a confirmed
requirement, and only notes deliver it.

---

## How to read this branch

The work is layered: reusable crypto primitives in `crypto/`, token variants in `token/`. The token variants map to a privacy tier:

| Tier | Hides                       | Model            | Module                                                | Status                      |
| ---- | --------------------------- | ---------------- | ----------------------------------------------------- | --------------------------- |
| 1    | amounts                     | account          | `ConfidentialFungibleToken` (+ dual-balance, `_move`) | built, tested               |
| 2    | + recipient                 | account, stealth | `StealthConfidentialToken`                            | built, working (round-trip) |
| 3    | + sender (weak)             | account, ring    | `ConfidentialTokenRing`                               | exhibit only, dominated     |
| 4    | amount + sender + recipient | notes            | `HybridConfidentialToken`                             | built, working (9 tests)    |

Supporting crypto:

| Module                  | Role                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `crypto/ElGamal`        | homomorphic encrypted balances; `assertDecryptsTo(Scalar)` for spend checks                 |
| `crypto/EcdhMask`       | ECDH one-time-pad memo: delivers a value to a pubkey, direct-decrypt, no discrete-log bound |
| `crypto/StealthAddress` | dual-key stealth one-time addresses (+ witness-assisted mod-l reduction)                    |
| `crypto/NoteDelivery`   | encrypted note-delivery: recovers `(value, nonce)` from chain + the recipient key           |

---

## The approach and the hypotheses we tested

We treated privacy as a spectrum and built one tier at a time, using each build to
test a specific hypothesis in code rather than argue it on paper:

1. **"Amounts can be hidden cheaply on an account model."** Confirmed. ElGamal balances
   + a direct-decrypt memo. Tier 1.
2. **"The recipient can be hidden while keeping the account model."** Confirmed, with a
   real UX cost (one-time addresses, scanning, fragmentation). Tier 2 (stealth).
3. **"The sender can be hidden on the account model."** Disproven for any practical
   scheme. A debit is a write to a public per-account slot; hiding *which* slot
   requires either touch-all-N cover traffic (the ring, dominated) or an unindexed
   commitment set with ZK membership + nullifiers (which *is* the note model). Tier 3
   is the exhibit that measures why the ring loses.
4. **"Notes can satisfy the institutional must-haves (seizure, regulator viewing)."**
   Confirmed. The "notes aren't seizable" blocker is solved here. Tier 4.

The through-line: **sender privacy is a conservation law, not a free lunch.** It is
paid for in cover traffic, a trusted party, or note machinery; you can move where you
pay, not eliminate it. The efficient form of "a ring without fetching N candidates" is
a Merkle membership proof, which is exactly the note model. So the account model and
notes are not competitors at different maturity; they are different points on a
custody/privacy spectrum.

---

## Key findings

- **Sender-hiding converges on notes.** No account-model trick avoids it; the field
  (Zcash, Monero rings, Aztec's account-over-notes) confirms it, and so does the
  sibling `AuditableShieldedCustody` effort, which reached for notes for the same
  reason.
- **Notes are seizable AND auditable, together.** `HybridConfidentialToken` proves a
  shielded pool can carry: graph-private transfers, regulated seizure (shared
  nullifier + authority branch + re-mint to recovery, no key escrow), and auditor
  viewing (per-output ciphertext to an audit key). 9 passing tests.
- **The note core is cheaper than the account transfer.** A pure shielded spend is
  ~20.5k rows, about half the account CFT transfer (~43.8k). Merkle membership over a
  depth-32 tree is cheap because internal nodes use the transient (Poseidon-class)
  hash.
- **The dominant cost everywhere is `persistentHash` (SHA-256).** Memos, commitments,
  nullifiers, and the Merkle *leaf* all use it. A stable Poseidon-class hasher is a
  ~5x cut across the whole stack and is the single highest-value platform ask.
- **Accumulator choice is settled: Merkle + Poseidon.** KZG/RSA accumulators give small
  proofs for *native* verification but explode *in-circuit* (pairings / big-int
  modexp are non-native). Witness-verification does not change this: you cannot
  witness away a hash (verify = compute) or foreign-field arithmetic. The in-circuit
  cost *is* the cost of hiding which leaf; that is irreducible and follows the privacy
  boundary (public facts like nullifiers are checked cheaply by the ledger kernel).
- **Total supply is policy, not core safety.** No-overspend is enforced locally
  (per-account / per-note). Supply is an accounting/audit layer, so it should be
  composable, not baked into the base.

---

## Benchmarks (compiler constraint rows)

| Circuit              | Model            | rows   | Note                                   |
| -------------------- | ---------------- | ------ | -------------------------------------- |
| `seize`              | notes            | 20,564 | core shielded spend, no viewing        |
| `mint`               | notes            | 20,594 | + 1 audit viewing                      |
| `transfer`           | notes            | 54,271 | + 2 audit viewings (~32k of the total) |
| `transfer`           | account (CFT)    | 43,821 | baseline                               |
| `stealthMint`        | account, stealth | 28,391 | one-time address + announcement        |
| `stealthClaim`       | account, stealth | 18,057 |                                        |
| `ringTransfer` (N=4) | account, ring    | 71,683 | O(N), size-4 anonymity set             |

Reading them: each `EcdhMask` viewing/delivery ciphertext is ~16k rows, all
`persistentHash`. A runtime `if (enabled)` does **not** save those constraints in ZK
(guarded emissions are always compiled in), so optional viewing/delivery should be
**compile-time variants**, not runtime flags.

---

## Production plan for the tier-1 CFT ("hide amounts")

The recommended first shippable product, distilled:

1. **Base off the drafted CFT**, but use the **`EcdhMask` direct-decrypt memo**, not the
   original exponential-ElGamal + BSGS memo. The memo is core (it is how a recipient
   learns their incoming amount), and `EcdhMask` removes the `2^48` amount cap and the
   wallet BSGS table. Sequence the dependency: `EcdhMask` is on its own branch pending
   crypto review.
2. **Make the base supply-free**; expose the conserving `_move` / `transfer` surface
   only. Supply is a composable layer (No / Public / Confidential). **Ship
   `PublicSupply` in the first PR** so the base is fundable and testable; a supply-free
   base alone has no way for value to enter. `_mint`/`_burn` (and the burn underflow
   asserts) live in the supply layer.
3. **Include the dual-balance griefing fix**, and treat it as behavioral: credits land
   in `pending`, the owner `sweep()`s into `spendable`, total = `balanceOf + pendingOf`.
   This closes a liveness grief (spam can't invalidate in-flight spends) but changes
   the wallet flow and breaks the single-balance tests, so test/doc reconciliation is
   part of this step.
4. **Document the stealth (tier-2) plan** rather than build it: separate variant module,
   one-time addresses, `EcdhMask` ephemeral doubles as the announcement, real UX cost
   (scanning + fragmentation).
5. **Carry the invariants that are easy to lose:** `balanceOf` returns a well-formed
   `Enc(0)` (on-curve) for unregistered accounts; `wit_RandomnessSeed` must be fresh
   *and secret* (a predictable seed lets observers recover incoming amounts); the
   wallet's plaintext cache (rebuilt from credit-only memos) is the authoritative
   balance; the witness-identity c2c limitation stands.

---

## Recommendations for the notes/custody design (draft, pending review)

Cross-pollination with the sibling `AuditableShieldedCustody` /
`EscrowedShieldedCustody` effort, which independently converged on the same note +
custodian-memo + KYC-allowlist + multisig-seize shape. What we would recommend
changing there:

1. **Replace the lifted-ElGamal value memo with a direct-decrypt (`EcdhMask`) memo** to
   delete the `2^48` note-value cap and the BSGS indexer. Highest-value change.
2. **Offer shared-nullifier seizure as an alternative to full key escrow**, so the
   authority is constrained to seize-to-recovery rather than able to spend anything
   from a master secret.
3. **Harden `_freeze`** to prove the leaf at `index` matches the claimed `ownerId`
   (fail closed on a mis-index) instead of trusting off-chain bookkeeping.
4. **Document the `_encUnallocated` genesis window** (publicly decryptable until the
   first secret credit).
5. **Elevate the custodian-master-secret compromise to the headline trust risk** with
   explicit mitigations.

What we would adopt **from** them, kept generic. The rule: state/policy becomes
standalone modules, authorization lives in the consumer, things that must sit in the
value-movement circuit and cannot be toggled for free become compile-time variants,
and only spend-soundness goes in the base. The generic base stays lean; a "regulated"
flavor is a variant that composes modules, not a monolith.

- **Nullifier-bound `rho`** → the base note spend (this is the only one that belongs
  baked in; it is spend soundness, not policy).
- **KYC allowlist + tombstone freeze** → a standalone module + a check at the
  chokepoint. Set-backed for the account model (we have Allowlist/Blocklist); a
  Merkle-allowlist module for notes, because a hidden spender's membership must be
  proven in-circuit.
- **`opCommitment` / multisig gating** → the consuming preset, not the module (matches
  their own "ungated building blocks for a gating preset" design).
- **Confidential supply** → a supply variant (No / Public / Confidential), not baked in.
- **Owner-carrying viewing** → key management as a module; the per-output emission is a
  compile-time variant (it must sit at the credit chokepoint and, being always compiled
  into the circuit in ZK, cannot be a free runtime toggle).
- **Invariant-catalog rigor** → a review/documentation practice applied to all of the
  above, not code.

---

## Platform requests to Midnight

1. **Stable Poseidon-class hasher** (high): `persistentHash` (SHA-256) dominates every
   expensive path; a stable cheap hasher is a ~5x cut and cheapens memos, commitments,
   nullifiers, and the Merkle leaf at once.
2. **Native mod-l / scalar arithmetic** (low): nice to have, not needed; the
   witness-assisted reduction we built is ~6 constraints and hash-derived keys avoid it.

---

## What ships vs what was learning

- **Production track:** `ConfidentialFungibleToken` (tier 1) as the near-term product;
  `HybridConfidentialToken` (tier 4) as the graph-privacy track once hardened
  (per-user recovery keys, governance-gated authority, full-identity viewing, private
  issuance, audit).
- **Standalone-useful:** the `crypto/` primitives (`ElGamal`, `EcdhMask`,
  `StealthAddress`, `NoteDelivery`).
- **Exhibit / drop:** `ConfidentialTokenRing` (tier 3) exists only to measure why the
  weak ring is dominated by notes. Keep it as evidence, do not invest in it.
