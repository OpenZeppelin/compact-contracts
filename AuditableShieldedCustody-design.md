---
stage: design
project: nst-phase2-auditable-custody
mode: extension
extends: contracts/src/token (NST MIP-0011 + custody explorations on feat/native-shielded-custody-hybrid)
status: draft
timestamp: 2026-07-02
author: 0xisk
previous_stage: null
tags: [nst, custody, privacy, elgamal, notes, multisig, mgbp]
---

# NST Phase 2 — Auditable Shielded Custody (Design)

## Summary

Phase 2 custody for UTXOs minted under the Phase 1 multisig preset (#632).
Note-commitment pool (graph-private transfers) where every note carries an
on-chain ElGamal memo encrypted to the custodian key, so the custodian can
reconstruct all balances and flows from chain data alone. Seize works against
any note via custodian-derived keys; the public ledger sees only commitments,
nullifiers, roots, and hiding ciphertexts. Phase 1 UTXOs stay contract-owned
and are never burned or re-minted.

Chosen as Candidate C over: (A) ElGamal account ledger — fails graph privacy
(public touch-graph, the CFT gap); (B) escrowed note custody as prototyped —
custodian view depends on an off-chain note DB, violating the fully-on-chain
requirement once clients self-serve.

## Contract Layout

- New extension module: `contracts/src/token/extensions/AuditableShieldedCustody.compact`
  - Self-contained note machinery (same decision as `EscrowedShieldedCustody`:
    seize needs the private helpers, so no import of `ShieldedCustody`).
  - Reuses `crypto/ElGamal.compact` (merged, #617/#643) and stdlib Merkle trees.
- New preset: `contracts/src/token/presets/MultisigAuditableShieldedToken.compact`
  - Composes (all unchanged): `token/NativeShieldedToken` (`Token_`),
    `token/extensions/NativeShieldedTokenDerivedNonce` (`TokenNonce_`),
    `multisig/EcdsaSignerManager` (`Signer_`), `security/Pausable`, plus the new
    extension (`Custody_`).
  - Phase 1 `mint`/`burn` circuit bodies carry over as `mintReserve`/`redeemNote`
    internals; msgHash discipline identical (domain tag + `self` + `_replayNonce`).
- Companion TS: `contracts/src/token/test/witnesses/AuditableShieldedCustodyWitnesses.ts`,
  mocks + simulators following the existing `test/mocks` / `test/simulators` layout.
- OpenZeppelin compact-contracts modules are experimental/unaudited; the ECDSA
  verifier is stubbed (`stubVerifySignature` always true) until the secp256k1 +
  Keccak primitive lands. MUST NOT hold real value before destub.

## Ledger Schema

Extension module (`Custody_` prefix in the preset):

```compact
export sealed ledger _instanceSalt: Bytes<32>;          // per-deployment domain separation
export sealed ledger _custodianPk: JubjubPoint;         // memo/audit ElGamal key (rotation = redeploy)
export ledger _notes: HistoricMerkleTree<20, Bytes<32>>; // note commitments (historic: spends survive concurrent inserts)
export ledger _nullifiers: Set<Bytes<32>>;              // consumed notes
export ledger _authorizedAccounts: MerkleTree<20, Bytes<32>>; // allowlist; NON-historic (current-root check is load-bearing for freeze)
export ledger _memos: Map<Bytes<32>, NoteMemo>;         // commitment -> custodian-keyed ciphertexts
export ledger _encCustodySupply: ElGamal_Ciphertext;    // Enc(Σ unspent note values), custodian key
export ledger _encUnallocated: ElGamal_Ciphertext;      // Enc(minted reserve − credited), custodian key
export ledger _custodyInit: Boolean;                    // per-module init flag (compact#270 workaround)
```

Preset adds `export ledger _replayNonce: Counter;` (multisig replay protection,
same as Phase 1) plus the composed modules' state.

Collection choices:
- `HistoricMerkleTree<20>` for notes: spend proofs against any past root, ~1M leaves.
- Plain `MerkleTree<20>` for the allowlist: current-root-only check is what makes
  tombstone-freeze immediate (the `ShieldedCustody` idiom, kept verbatim).
- `Map` for memos: unbounded, keyed by an already-public value (the commitment);
  indexers subscribe to inserts. Never deleted (pruning out of scope).
- Encrypted cells replace `ShieldedCustody`'s public `_custodySupply: Uint<128>`:
  boundary amounts (credit/redeem/seize) stay private; only `mintReserve` amounts
  are public (forced by the protocol `shieldedMints` effect).

## User-Defined Types

```compact
struct Note {                 // never on ledger; hashed into commitments
  ownerId: Bytes<32>;
  value: Uint<64>;            // asserted < 2^48 (MAX_NOTE_VALUE)
  rho: Bytes<32>;
}

export struct NoteMemo {
  encValue: ElGamal_Ciphertext;   // Enc(g^value)          — lifted, BSGS-recoverable (< 2^48)
  encOwner: ElGamal_Ciphertext;   // Enc(hashToCurve(ownerId)) — point ElGamal, KYC-list lookup
}
```

Derivations (all `persistentHash`, domain-tagged with `"AuditableShieldedCustody:*"`
+ `_instanceSalt`):

| Value | Derivation |
|---|---|
| `ownerId` | `H(tag_owner, secretKey)` |
| `commitment` | `H(tag_note, _instanceSalt, H(Note))` |
| `nullifier` | `H(tag_null, _instanceSalt, secretKey, rho)` |
| `rho_out` (transfer/seize) | `H(tag_rho_out, spenderSecretKey, recipientOwnerId, spentNullifier)` |
| `rho_change` | `H(tag_rho_change, spenderSecretKey, spentNullifier)` |
| `rho_credit` | `H(tag_rho_credit, recipientOwnerId, replayNonce)` |
| memo randomness | `degradeToTransient(H(tag_r_*, spenderSecretKey, spentNullifier)))` per ciphertext tag; credit path uses a custodian witness seed via `ElGamal_expandRandomness` |

Notes on the derivations:
- rho is derived in-circuit, not a free witness — transfer signatures shrink and
  the custodian can reconstruct every note inductively (see Disclosure Boundary).
- In-circuit memo randomness removes the client-RNG hazard for self-serve wallets
  (a weak wallet RNG cannot degrade confidentiality); uniqueness comes from the
  once-only nullifier, secrecy from `secretKey`.
- Key issuance (off-chain, at KYC onboarding): `secretKey_i = PRF(masterSecret,
  customerId_i)`, master secret in the custodian HSM. No per-user escrow DB.

## Exported Circuits and Witness Signatures

Extension module (internal `_` circuits; preset wraps them with gating):

```compact
witness wit_secretKey(): Bytes<32>;                          // spender key (user's own, or custodian-derived for seize/redeem)
witness wit_notePath(commitment: Bytes<32>): MerkleTreePath<20, Bytes<32>>;
witness wit_authPath(ownerId: Bytes<32>): MerkleTreePath<20, Bytes<32>>;
witness wit_spentNote(): [Uint<64>, Bytes<32>];              // (value, rho) of the note being spent
witness wit_opAmount(): Uint<64>;                            // credit/redeem/seize amount
witness wit_opBlind(): Bytes<32>;                            // binds op params to the multisig msgHash
witness wit_recipientOwnerId(): Bytes<32>;
witness wit_custodianEk(): Bytes<32>;                        // decrypt-verify path (credit overdraw check)
witness wit_plainUnallocated(): Uint<128>;                   // claimed plaintext of _encUnallocated
witness wit_plainSupply(): Uint<128>;                        // claimed plaintext of _encCustodySupply
witness wit_seed(): Bytes<32>;                               // credit-path memo randomness
witness wit_redeemCoin(): QualifiedShieldedCoinInfo;         // reserve coin to burn on redeem/seizeBurn

circuit initialize(instanceSalt: Bytes<32>, custodianPk: JubjubPoint): [];
export pure circuit computeOwnerId(secretKey: Bytes<32>): Bytes<32>;
circuit _authorize(ownerId: Bytes<32>): [];
circuit _freeze(index: Uint<64>): [];                        // tombstone leaf
circuit _unfreeze(ownerId: Bytes<32>, index: Uint<64>): [];
circuit _credit(): [];        // reads op witnesses; note+memo insert, supply +=, unallocated -= (overdraw-checked)
circuit _transfer(sendValue: Uint<64>, recipientOwnerId: Bytes<32>): [];  // authorized spend, 2 outputs
circuit _redeem(): [];        // unchecked spend + supply -=  (preset pairs with reserve-coin burn)
circuit _seizeTo(): [];       // unchecked spend, out-note to custodian-chosen owner, change to victim
```

`_spendNote` (private): recompute `ownerId` and commitment from witnesses →
`_notes.checkRoot(disclose(merkleTreePathRoot(path)))` → derive + disclose
nullifier, assert fresh, insert → allowlist membership check (skipped by the
unchecked variant used in `_redeem`/`_seizeTo`). Both spend variants keep
ownership, membership, and consume-once; only the allowlist check differs.

Preset exported surface:

```compact
// multisig-gated (msgHash = H(domainTag, self, _replayNonce, opCommitment); opCommitment = persistentCommit(privateParams, wit_opBlind()))
export circuit mintReserve(amount: Uint<64>, pubkeys: Vector<2, Bytes<64>>, signatures: Vector<2, Bytes<64>>): ShieldedCoinInfo;
export circuit creditNote(opCommitment: Bytes<32>, pubkeys: ..., signatures: ...): [];
export circuit redeemNote(opCommitment: Bytes<32>, pubkeys: ..., signatures: ...): Maybe<ShieldedCoinInfo>;
export circuit seizeTo(opCommitment: Bytes<32>, pubkeys: ..., signatures: ...): [];
export circuit seizeBurn(opCommitment: Bytes<32>, pubkeys: ..., signatures: ...): Maybe<ShieldedCoinInfo>;
export circuit authorizeAccount(ownerId: Bytes<32>, pubkeys: ..., signatures: ...): [];
export circuit freeze(index: Uint<64>, pubkeys: ..., signatures: ...): [];
export circuit unfreeze(ownerId: Bytes<32>, index: Uint<64>, pubkeys: ..., signatures: ...): [];
export circuit pause(pubkeys: ..., signatures: ...): [];
export circuit unpause(pubkeys: ..., signatures: ...): [];

// self-authenticating (note key = authorization; no multisig)
export circuit transfer(sendValue: Uint<64>, recipientOwnerId: Bytes<32>): [];

// views — keep MINIMAL (see block-limit note): tokenColor(), getNonce(), custodianPk()
// everything else is read off-chain from exported ledger fields via the indexer
```

Policy matrix:

| Circuit | not-paused | spender-authorized | multisig |
|---|---|---|---|
| mintReserve, creditNote | ✓ | n/a | ✓ |
| transfer | ✓ | ✓ (allowlist) | — |
| redeemNote, seizeTo, seizeBurn | — | — (unchecked spend) | ✓ |
| freeze/unfreeze/authorize/pause/unpause | works while paused | n/a | ✓ |

Semantics notes:
- `redeemNote` = customer-consented exit: spend the customer's note (custodian
  derives the key), burn a reserve coin of equal value via `Token__burnFromSelf`,
  `_encCustodySupply -= amount`. `seizeBurn` = the same effects without consent.
  `seizeTo` moves the claim to another account; reserve untouched.
- Every spend always inserts a change note (zero-value allowed) — constant shape;
  seizure and exact-amount transfers are indistinguishable from partial transfers.
- No `withdraw` to a bearer Zswap coin: no policy-free exit (same rationale as
  `ShieldedCustodyMultiSig`). Redemption settles off-ledger against the burn.

## State Partitioning & Disclosure Boundary

| Value | Location | Crossing / what is revealed |
|---|---|---|
| secretKey, ownerId (as identity) | witness | never; only inside hashes and point-ElGamal |
| note value, rho | witness | never in plaintext |
| commitment | crosses (`_notes.insert`) | random-looking 32 bytes; hiding rests on ownerId+rho secrecy |
| nullifier | crosses (`disclose` + Set insert) | unlinkable to commitment without secretKey |
| Merkle paths | witness | only `disclose(merkleTreePathRoot(path))` — the root, never the path (leaf index/position stays hidden) |
| NoteMemo ciphertexts | cross (Map insert) | hiding to everyone except custodian-key holder |
| memo randomness | derived in-circuit from secretKey | never |
| credit/redeem/seize amounts | witness | never; bound to multisig sigs via `persistentCommit` (`opCommitment`) |
| `_encCustodySupply`, `_encUnallocated` plaintexts | witness (custodian cache) | one bit per overdraw check (`claimed >= amount` success); recoverable from chain by decrypting per-op ciphertext deltas |
| mintReserve amount | public | forced by the protocol `shieldedMints` effect |
| circuit identity per tx | public | which operation ran (see seize-visibility decision) |
| signer set / threshold / salt | public ledger | same as Phase 1 |

Custodian reconstruction (the requirement-3 argument): custodian holds
`masterSecret` + `custodianEk`. Credits are custodian-authored (or recoverable:
decrypt memo value + owner, recompute `rho_credit` from the public nonce). For
each transfer: every known note's expected nullifier is computable
(`H(tag, sk_owner, rho)`), so the disclosed nullifier identifies the spender;
`rho_out`/`rho_change` then derive from the spender's key + nullifier; memo
decryption yields value and recipient; recompute both commitments and
cross-check. Induction covers the entire note set from genesis using only chain
data + the HSM master secret. The circuit enforces memo↔note consistency (same
witnesses feed both), so a sender cannot corrupt the custodian's view without
failing the proof.

Grinding caveat (accepted): deterministic rho concentrates commitment-hiding on
secretKey/ownerId secrecy. Transfer-note rhos include `spenderSecretKey` (HSM-
derived, never in any DB) — strong. Credit-note rhos depend on `recipientOwnerId`
only: if the KYC↔ownerId table leaks, credit amounts become 2^48-grindable.
Documented trade; revisit if credit-note hiding must survive a KYC-table leak.

Entropy/nonce checklist (per skill): commitments carry ≥256-bit secret input
(ownerId or secretKey); nullifier keyed on secretKey; memo randomness unique per
(nullifier, tag) and secret; no low-entropy witness is ever hashed to a public
value. No conditional ledger writes: spends always write nullifier + 2
commitments + 2 memos; failures abort the whole tx.

## Integration Patterns

- **Custodian side (operator-mediated mode)**: bank back-end holds witnesses
  (HSM-derived keys, amounts, cached plaintexts); proof server local to the bank
  boundary. BitGo remains an ECDSA signing oracle over msgHash — unchanged from
  Phase 1; it never sees witnesses and needs no proof server. Relayer submits.
- **Client side (self-serve mode)**: client wallet holds its issued `secretKey`,
  runs a local proof server, reads state via the indexer (memo map, roots,
  nullifier set) — never via view circuits. Incoming-note discovery via the
  custodian API (it can decrypt everything anyway); on-chain recipient-encrypted
  memos are a documented optional extension for self-sovereign discovery.
- Both modes are the same contract and circuits; the mode is a key-distribution
  and proving-topology decision, deferrable per deployment.

```ts
const deployed = await deployContract(providers, {
  contract: MultisigAuditableShieldedToken,
  privateStateId: 'nstCustody',
  args: [domainSep, name, symbol, decimals, instanceSalt,
         signerCommitments, threshold, initCoinNonce, custodianPk],
});
await deployed.callTx.transfer(sendValue, recipientOwnerId); // self-serve client
```

## Error Handling

- `const` strings at module top, prefix `"AuditableShieldedCustody: "` (repo
  convention), short/stable/lowercase after prefix: `not initialized`,
  `not authorized`, `note already spent`, `unknown note root`, `value bound
  exceeded`, `insufficient balance`, `insufficient unallocated reserve`,
  `zero recipient`, `paused`.
- Never include amounts, ownerIds, or indices in assert messages.

## Indexer-Visible Ledger Fields

- `_memos` — the custodian's subscription feed (event substitute; no `emit` in Compact).
- `_notes` (root, firstFree) + `_nullifiers` — client wallets track spendability.
- `_encCustodySupply` / `_encUnallocated` — regulator/auditor ciphertext reads.
- `_replayNonce` — off-chain signing flow reads the next nonce (Phase 1 pattern).

## Change Plan (Extension Mode)

- **New**: `AuditableShieldedCustody.compact`, `MultisigAuditableShieldedToken.compact`,
  mocks/simulators/witnesses/tests.
- **Modified**: none. Phase 1 modules (`NativeShieldedToken`, `DerivedNonce`,
  `EcdsaSignerManager`) and `crypto/ElGamal` are composed as-is.
- **Unchanged but superseded for the MGBP track**: `EscrowedShieldedCustody` +
  `ShieldedCustodyMultiSig` (Candidate B). Position the new module as the fourth
  custody profile ("Auditable") in the custody-extension MIP, or as Escrowed's
  replacement — decide at MIP-update time.
- **API compatibility**: additive; no existing dApp integrator affected. New
  preset = new verifier keys; nothing deployed yet, so no CMA implications.

### Migration path (Phase 1 → Phase 2)

1. Compose, don't migrate: the preset ships Phase 1's mint/burn machinery and
   the custody overlay in one contract, one deploy. Recommended deployment
   target from day one (#632 is an unmerged draft; nothing is in production).
2. UTXO continuity is automatic: reserve coins sit at `kernel.self()`;
   `creditNote` is ledger-only accounting against that reserve. No coin is
   spent, no burn-and-remint (requirement 6 satisfied by construction).
3. No `_deposit` path: the burn-and-mint discipline in the custody MIP protects
   user-held coins entering custody; the omnibus reserve never leaves the contract.
4. Already-deployed Phase 1 instances (preprod only): composition can't be
   retrofitted. CMA verifier-key rotation may add circuits but new ledger fields
   are a state-shape change — verify before promising. Fallback: one-time
   multisig rollover (Phase 1 `burn` → Phase 2 `mintReserve`), which publishes
   the migrated total via the public mint effect. Direct contract→contract coin
   transfer is not available (unclaimed-output rejection without C2C; would also
   leak the recipient contract address).

## Design Decisions Log

- **Candidate C over A/B** — only design meeting all six requirements (A: public
  touch-graph; B: off-chain note DB is trusted bookkeeping).
- **ElGamal over Pedersen** — custody needs key-decryptability (memos, aggregates,
  seize evidence); Pedersen is not decryptable and not implemented. Hash
  commitments carry the notes (no homomorphism needed inside a note; conservation
  `in = out + change` is enforced in-circuit); ElGamal only where decryptability
  is required.
- **D1 rho derived in-circuit** — kills the 256-bit-encryption problem, shrinks
  memos to 2 ciphertexts, enables inductive custodian reconstruction; grinding
  trade documented above.
- **D2 custodian-issued keys** (`PRF(masterSecret, customerId)`) — escrow DB
  collapses to one HSM secret; closes B's requirement-3 gap.
- **D3 one contract, both modes** — self-serve vs operator-mediated is
  key-distribution + proving topology, not a circuit fork; `transfer` stays
  self-authenticating in both.
- **D4 seize as separate circuits** — occurrence public (countable, regulator-
  friendly), target/amount/victim private. Folding multisig verification into
  every transfer rejected: prohibitive once real secp256k1 (foreign-field)
  replaces the stub. Softener: non-frozen accounts are seizable through plain
  `transfer` with the derived key — indistinguishable from ordinary activity.
- **D5 per-note value < 2^48** — CFT-precedent BSGS bound; balances are sums of
  notes, so no decryption ceiling (improves on CFT's balance-ciphertext limit).
- **In-circuit memo randomness** — removes the self-serve wallet-RNG hazard.
- **Encrypted supply/unallocated cells** — replace B's public `_custodySupply`
  so boundary amounts stay private; overdraw checks use the
  `assertDecryptsTo` + witnessed-plaintext pattern from
  `MultisigConfidentialShieldedToken.redeem`.
- **Minimal view circuits** — the preset is near the composite-deploy block-limit
  ceiling (~15–20 circuits); exported ledger fields are indexer-readable without
  view circuits, so views are cut to the in-circuit-needed set.
- **Rough constraint cost** (anchors: depth-20 membership + commitment ≈ 10 MB
  prover key / `assertOnlyRole`; Forwarder-class spend = k=16 ≈ 42k rows):
  `transfer` ≈ 2 membership checks + ~15 persistentHash + 2 memos
  (~8 scalar-muls + 2 hashToCurve) → k≈16–17. Multisig-gated ops similar minus
  one membership, plus ECDSA cost post-destub (unknown, upstream-dependent).

## Out of Scope

- Recipient-encrypted discovery memos (optional extension; custodian API covers discovery).
- Memo pruning / ledger growth management.
- Custodian key rotation (`_custodianPk` sealed; rotation = redeploy — same
  limitation as `NativeShieldedTokenConfidentialLedger`).
- Threshold/multi-party custodian decryption (single ElGamal key now; threshold
  ElGamal is a later hardening).
- Family (multi-domain) custody variant — deferred until a consumer needs it.
- Wallet/SDK build-out (BSGS table, note cache, reconciliation) — tracked as
  integration work, not contract work.
- C2C-based composition and post-deploy CMA upgrade mechanics.

## Dev Notes

- Housekeeping before code: `_burnFromContract` → `_burnFromSelf` rename break
  in 6 preset files on this branch; ECDSA stub is the known production blocker.
- Compile early: memos + spends push circuits toward k=17; measure and check the
  deploy block-limit with the trimmed circuit set.

## Open Questions

1. `Uint<48>` as a native type vs `Uint<64>` + `MAX_NOTE_VALUE` assert (compiler
   support / codegen cost) — code-draft stage to verify.
2. `hashToCurve` is unused anywhere in the repo so far — verify availability and
   cost at the pinned compiler before relying on it for `encOwner`.
3. Should `transfer` also be pausable-exempt for frozen-account remediation
   flows, or is the matrix above final? (Current: transfer pause-gated.)
4. Credit-note grinding resistance after a KYC-table leak — accept, or add a
   custodian-secret component to `rho_credit` (needs a sealed commitment to bind
   the witness)?
5. Seize change-note semantics: change back to the victim (current) vs sweep
   full note to the target — confirm with product.
6. Preset placement: `token/presets/` (chosen, matches `ShieldedCustodyMultiSig`)
   vs `multisig/presets/` (where `MultisigNativeShieldedToken` lives).
