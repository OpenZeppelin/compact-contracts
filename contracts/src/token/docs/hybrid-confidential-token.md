# HybridConfidentialToken — design (tier-4 notes model)

**Status: draft for review. Unaudited. Not production.**

A note/UTXO-based confidential token with full graph privacy: amounts, sender,
and recipient are hidden from the public ledger. Compliance is built in, not
bolted on: a mandatory audit channel gives a designated auditor complete
transaction visibility, and a seizure authority can claw back notes without any
key escrow.

- Core module: `contracts/src/token/HybridConfidentialToken.compact`
- Supply extension: `contracts/src/token/extensions/HybridConfidentialTokenSupply.compact`
- Crypto deps: `crypto/EcdhMask` + `crypto/ElGamal` (merged), `crypto/NoteDelivery` (this PR)
- Origin: tier 4 of the confidential-token privacy exploration
  (`save-token-info` spike); this document covers the hardened draft.

## The auditor question

> Can a note-based token satisfy a regulator/auditor: who can see what, prove
> what, and do what?

Answer: yes, by construction. Every output note's nonce is **derived from an
ECDH shared secret with the audit key**, and its owner and value are encrypted
to the same key in-circuit. A transaction that skips or fakes the audit record
cannot exist: the commitment written to the tree binds the same
`(value, nonce, owner)` the audit record encrypts, inside the proof.

What the **auditor** (audit-key holder) gets, per output:

| Field | How |
| --- | --- |
| recipient (`ownerPk`) | encrypted in the audit record |
| amount (`value`) | encrypted in the audit record |
| note `nonce` | derived from the audit ECDH — recovered, not trusted |
| sender | derived: the published nullifier identifies the consumed note, whose owner the auditor already knows from that note's own audit record |
| token / timestamp | contract address / transaction metadata (indexer) |

Because the auditor recovers every nonce, they can independently recompute
every commitment `cm = H(domain, value, nonce, pk)` and every nullifier
`nf = H(domain, nonce)`. That yields:

- **Viewing**: full amounts + counterparties for every transaction
  (the travel-rule data set: sender, receiver, token, quantity, timestamp).
- **Investigation**: full transaction-graph reconstruction — watch any note
  from creation (commitment insert) to consumption (nullifier publish).
- **Seizure**: the audit trail supplies exactly the witnesses `seize` needs
  (the target note and its owner), so enforcement requires no cooperation
  from the owner and no escrowed spend keys.

What the **public** sees: commitment inserts, nullifiers, ciphertexts, supply
deltas on mint/burn. No amounts, no identities, no linkage.

What the **auditor cannot do**: spend. The audit key decrypts; it holds no
spend authority. Seizure is a separate, provable authority (below).

## Compliance requirements mapping

| Requirement (source) | Mechanism |
| --- | --- |
| Per-tx sender, receiver, token, quantity, timestamp (BitGo travel-rule data set, Jul 14) | audit records, see table above |
| Seize / claw back (MNF Q3 RWA priorities) | `seize`: shared nullifier + authority proof + re-mint to recovery; no key escrow |
| Auditor viewing without spend rights (steering calls) | audit key is decrypt-only |
| Source-of-funds evidence for incoming assets (MPS-0025) | auditor attributes each incoming note to the consumed note's owner; per-custodian selective evidence is Phase 2 (open question below) |
| Selective / request-based review keys (BitGo FIU, Jul 14) | not in this draft — the global audit key is all-seeing; see Open questions |
| No public traceability by default (MPS-0025 req. 3–4) | public ledger carries only commitments, nullifiers, ciphertexts |
| Public, non-inflatable supply (hidden-inflation concern) | supply extension: homomorphic encrypted supply + periodic `attestSupply` proof; per-tx amounts never public |

## Model

A note is `(value, nonce)` owned by `pk = Hf(sk)` (field-typed hash). The
commitment `cm = H(domain, value, nonce, pk)` lives in a
`HistoricMerkleTree<32>`; the nullifier `nf = H(domain, nonce)` marks it spent.
A spend proves membership of the input note at a historical root without
revealing which leaf.

Identity is two keys per account:

- **spend key** `pk = Hf(sk)` — owns notes (Field, so it can ride the
  field-arithmetic ciphertexts).
- **encryption key** `encPk = g^encSk` (Jubjub) — receives note deliveries.

The **shared nullifier** is the seizure primitive: `nf` depends only on the
nonce, so the owner and the authority derive the *same* nullifier, making
owner-spend and seizure mutually exclusive (first to land wins) with no shared
secrets.

### Per-output emissions

Each output note (mint, transfer out, transfer change, burn change) emits, in
one circuit:

1. **Audit record** (to the global `auditKey`): ephemeral `E_a = g^e_a`,
   `S_a = auditKey^e_a`, then
   `nonce = KDF(S_a, "nonce")`, `valueCt = value + KDF(S_a, "value")`,
   `ownerCt = ownerPk + KDF(S_a, "owner")`.
2. **Recipient delivery** (to the output owner's `encPk`): ephemeral
   `E_r = g^e_r`, `S_r = encPk^e_r`, then `valueCt`, `nonceCt` — the recipient
   recovers `(value, nonce)` from chain data alone, no out-of-band channel
   (`crypto/NoteDelivery`).

Deriving the nonce from the audit ECDH kills two birds: audit completeness is
structural (no nonce the auditor can't recover), and the "fresh output nonce"
witness footgun disappears — freshness reduces to the already-required
freshness of the ephemeral scalar.

### Circuit surface

Core:

```
initialize(issuerPk, authorityPk, auditKey)      // one-shot; all roles bound at genesis
mint(recipientPk, recipientEncPk, value)         // issuer-only; amount hidden
transfer(recipientPk, recipientEncPk, senderEncPk, value)  // fully private
burn(senderEncPk, value)                         // spends a note; amount hidden
seize(targetOwnerPk, recoveryPk, recoveryEncPk)  // authority-only clawback
```

Supply extension (standalone module; the consuming contract wires it):

```
initialize(supplyKey)      // one-shot; ElGamal key, attester holds the secret
_addMinted(value)          // homomorphic add, paired with every mint
_addBurned(value)          // homomorphic subtract, paired with every burn
attestSupply(total)        // proves Dec(_encSupply) == total, discloses only total
```

- `mint` requires the issuer secret (`Hf(issuerSecret) == _issuerPk`).
- `transfer`/`burn` spend the caller's input note (membership + nullifier +
  conservation `in == out + change`); change returns to the sender with its own
  audit record + self-delivery.
- `seize` requires the authority secret, consumes the target note via the
  shared nullifier, re-mints full value to `recoveryPk`; `_seizureCount`
  records it.

### Supply is a policy layer

The core writes NO public supply: a disclosed counter would leak every mint
and burn amount as a public delta (each tokenized-deposit position size,
timestamped). Native shielded tokens cannot avoid this (`shieldedMints` is a
protocol effect); the note pool can, because it never touches Zswap coins —
the only channel that would expose issuance amounts is a supply write we
choose not to make. A deployment picks its point on the spectrum:

| Shape | Public sees | How |
| --- | --- | --- |
| none | nothing | core only; auditor reconstructs supply from the audit trail |
| confidential + attested | proof-backed total at a chosen cadence | `HybridConfidentialTokenSupply` extension (this PR) |
| fully public | every mint/burn delta | compose a disclosed counter alongside `mint`/`burn` |

The extension keeps `_encSupply` as an exponential-ElGamal ciphertext updated
homomorphically inside the same transaction as the token op (trustlessly
correct, no readable delta; a homomorphic update needs no knowledge of the
running total, so user burns can update it). `attestSupply` proves in-circuit
that the ciphertext decrypts to the claimed total and discloses only that
number — public, non-inflatable supply at attestation cadence, k-anonymous
amounts in between. Mint *events* remain visible either way (a mint has a
distinctive shape: one commitment, no nullifier); only amounts hide.

### Ledger schema

Core:

| Field | Type | Why |
| --- | --- | --- |
| `_isInitialized` | `Boolean` | one-shot role binding |
| `_commitments` | `HistoricMerkleTree<32, Bytes<32>>` | note set; historical roots let proofs lag inserts |
| `_nullifiers` | `Set<Bytes<32>>` | double-spend prevention |
| `_issuerPk` | `Field` | mint authorization |
| `_authorityPk` | `Field` | seizure authorization |
| `_auditKey` | `JubjubPoint` | mandatory viewing key |
| `_seizureCount` | `Uint<64>` | public audit trail of enforcement |
| `_auditTrail` | `List<AuditRecord>` | per-output audit ciphertexts (indexer-observable) |
| `_deliveries` | `List<FullDelivery>` | per-output recipient ciphertexts (indexer-observable) |

Supply extension:

| Field | Type | Why |
| --- | --- | --- |
| `_supplyKey` | `JubjubPoint` | ElGamal key the supply is encrypted under |
| `_encSupply` | `ElGamal.Ciphertext` | outstanding supply, homomorphically maintained, no readable deltas |
| `_attestedSupply` | `Uint<128>` | last proof-backed public total |
| `_attestationCount` | `Uint<64>` | attestation freshness for indexers |

`_auditTrail` and `_deliveries` exist for observation: wallets scan
`_deliveries` (trial-decrypt with `encSk`), auditors scan `_auditTrail`. They
are the module's event substitute.

## Disclosure boundary

Everything a circuit writes to the ledger is witness-derived and passes
through explicit `disclose(...)`:

| Disclosed | Reveals | Safe because |
| --- | --- | --- |
| Merkle root (transfer/burn/seize) | one historical root | path stays witness; root ⇏ leaf |
| `nf` | "some note was spent" | preimage hidden; linkable only with the nonce (auditor-only) |
| `cm` inserts | "a note was created" | hiding commitment (256-bit nonce entropy from ECDH) |
| audit record / delivery ciphertexts | nothing without the keys | ECDH one-time pads (EcdhMask rules: fresh + secret ephemerals) |
| `_encSupply` updates (extension) | "supply changed" | ElGamal ciphertext; delta unreadable without the supply secret |
| `attestSupply` total (extension) | the supply at attestation time | deliberate, proof-backed disclosure at a chosen cadence |
| `_seizureCount` | number of seizures | intended public accountability |

Transaction *shape* is public: a mint (one commitment, no nullifier) is
distinguishable from a transfer (one nullifier, two commitments) and from a
burn/seize (one nullifier, one commitment). Event counts and timing leak;
amounts and parties do not.

Witness entropy: spend secrets, issuer/authority secrets, and the randomness
seed are 256-bit; ephemerals expand from the seed, domain-separated per output.
A predictable seed breaks confidentiality (EcdhMask secrecy rule) — same class
of requirement as CFT's `wit_RandomnessSeed`.

## Invariants (carried into tests)

1. **Conservation**: `transfer` preserves `in == out + change`; `burn`
   removes exactly `in - change` from circulation; `seize` conserves value.
2. **No double spend**: a nullifier can be consumed once, whether by owner
   spend or seizure (mutual exclusion both directions).
3. **Membership**: only committed notes are spendable; a bad path or foreign
   root reverts.
4. **Authorization**: mint requires the issuer secret; seize requires the
   authority secret; a spend requires the note owner's secret (the commitment
   binds `pk`).
5. **Audit completeness**: for every output, the audit-key holder recovers
   `(ownerPk, value, nonce)` and can recompute the exact `cm` inserted.
6. **Delivery correctness**: for every output, the owner's `encSk` recovers
   `(value, nonce)` matching the committed note.
7. **Confidentiality**: a wrong audit/enc key recovers nothing; ciphertexts
   for equal values are unlinkable (fresh ephemerals).
8. **One-shot init**: no state-changing circuit is callable before
   `initialize`; `initialize` cannot run twice (core and extension alike).
9. **Supply extension**: `_encSupply` equals `Enc(Σ minted − Σ burned)` when
   wired 1:1 with token ops; `attestSupply` succeeds only with the supply
   secret and the exact total, and discloses nothing else.

## Costs

Order-of-magnitude from the spike (compiler rows, dominated by
`persistentHash`): core note spend ~20.5k; each ECDH record ~16k. This draft's
`transfer` carries 2 audit records + 2 deliveries — roughly double the spike's
54k. Known platform lever: a stable Poseidon-class hasher (~5x cut across
memos, commitments, nullifiers, Merkle leaf). Runtime `if` does not save
constraints, so optional viewing/delivery would be compile-time variants, not
flags.

## Out of scope (this draft)

- **Request-based / selective review keys** — the global audit key is
  all-or-nothing; per-custodian or per-request disclosure is the Phase-2
  design driven by BitGo's FIU verification (Jul 14 action item).
- **Per-user recovery keys + governance-gated authority** — the draft keeps
  one global authority key; production wants multisig gating (compose with
  `multisig/`) and least-privilege recovery targets.
- **KYC allowlist for notes** — a Merkle-allowlist module composed at the
  spend chokepoint (hidden spender ⇒ in-circuit membership), per the spike's
  recommendations.
- **Attestation governance** — who may attest, at what cadence, and whether a
  stale attestation should block token ops is deployment policy.
- **Multi-asset / family variant** — single asset per contract instance.
- **Fee/gas privacy, wallet scanning UX, proof-server topology** — dApp-layer.

## Open questions

1. Selective disclosure shape for Phase 2: per-account review keys emitted as
   extra records (compile-time variant), or off-chain re-encryption service
   run by the issuer? Depends on BitGo FIU feedback.
2. ~~Should `burn` hide the amount?~~ Resolved: the core hides mint AND burn
   amounts (no public supply write); public supply is delivered by the
   confidential-supply extension's proof-backed attestation instead.
3. Audit-trail retention: `List` grows unboundedly; fine for the draft,
   production wants indexer-side pagination guidance.
4. Naming: keep `HybridConfidentialToken` or align with a future MIP name
   before the PR lands.
