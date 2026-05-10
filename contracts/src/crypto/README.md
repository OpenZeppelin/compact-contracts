# `crypto/` — Cryptographic primitives for OpenZeppelin Compact contracts

Foundational cryptography used by every signature-gated module in the repo
(multisig presets, future token gates, future signature-authorised mints).
Three layers, each callable from both Compact circuits and TypeScript:

| Layer | On-chain (`*.compact`) | Off-chain (`utils/*.ts`) | Used by |
| --- | --- | --- | --- |
| **Jubjub primitives** | [`Jubjub.compact`](Jubjub.compact) | [`utils/jubjub.ts`](utils/jubjub.ts) | every consumer |
| **Schnorr signatures** | [`Schnorr.compact`](Schnorr.compact) | [`utils/jubjubSchnorr.ts`](utils/jubjubSchnorr.ts) | Schemes C, D, E |
| **FROST threshold signing** | _(none — uses Schnorr on-chain)_ | [`utils/frost/`](utils/frost/) | Scheme E (`ShieldedMultiSigFrostV1`) |

Engineering notes — circuit costs, the Fq/Fr trap, identity-rejection
rationale, domain-tag registry — live in
[`CRYPTO_NOTES.md`](CRYPTO_NOTES.md). Read it before extending any module.

---

## 1. Jubjub — generic curve primitives

The Jubjub embedded curve is what Compact's `JubjubPoint` operates on
([standard-library.compact:47](../../../compact-compactc-v0.31.0/compiler/standard-library.compact)).
This module concentrates the patterns every consumer needs.

### Surface

| Symbol | Where | Purpose |
| --- | --- | --- |
| `pointsEqual(a, b): Boolean` | [`Jubjub.compact`](Jubjub.compact) | Coordinate-by-coordinate equality. |
| `isIdentity(p): Boolean` | [`Jubjub.compact`](Jubjub.compact) | True iff `p == (0, 1)` (the curve identity). |
| `assertNonIdentity(p)` | [`Jubjub.compact`](Jubjub.compact) | Asserts `p != identity`. Used by signer registrations to refuse degenerate keys. |
| `fitInJubjubScalar(c: Field): Field` | [`Jubjub.compact`](Jubjub.compact) | Truncates a Field value (Fq, ~2^254) to `[0, 2^248)` so it can be passed to `ecMul` without the `EmbeddedFr` decode error. See [§ Fq vs Fr](CRYPTO_NOTES.md#fq-vs-fr--the-field-mismatch-trap) for the full story. |
| `JUBJUB_SCALAR_ORDER` | [`utils/jubjub.ts`](utils/jubjub.ts) | The Jubjub scalar field modulus, `r = 0x0e7d…cb7`. |
| `JUBJUB_TRUNCATION_BITS = 248` | [`utils/jubjub.ts`](utils/jubjub.ts) | The on-chain truncation width; the TS mirror uses the same. |
| `isIdentity(p)`, `fitInJubjubScalar(c)`, `modJubjubOrder(x)` | [`utils/jubjub.ts`](utils/jubjub.ts) | Bit-for-bit mirrors of the on-chain helpers. |

### Why the truncation exists

Compact's `Field` is BLS12-381's scalar field (~2^254 bits). `ecMul` / `ecMulGenerator`
expect a Jubjub scalar (~2^252 bits). The runtime rejects out-of-range inputs
with `"failed to decode for built-in type EmbeddedFr"`. `fitInJubjubScalar`
zeros the top byte of the LE encoding, guaranteeing the value fits.

Concrete security cost: 4 bits of challenge entropy (~124-bit forgery vs the
~126-bit DLP ceiling on Jubjub). Same envelope as Zcash Sapling RedJubjub.
See [`CRYPTO_NOTES.md` § Circuit-cost measurements](CRYPTO_NOTES.md#circuit-cost-measurements).

---

## 2. Schnorr — signatures on Jubjub

Standard Schnorr over Jubjub. Produces signatures bit-compatible with Zcash
Sapling RedJubjub. The verifier is a single circuit consumed unchanged by
Schemes C, D, and E.

### Verifier equation

```
σ * G == R + c * P
```

where:

- `P` is the signer's public key (`P = s * G`),
- `(R, σ)` is the signature,
- `c = challenge(R, P, m)`, a Poseidon-derived scalar truncated via `Jubjub.fitInJubjubScalar`.

### Surface

| Symbol | Where | Purpose |
| --- | --- | --- |
| `JubjubSchnorrSignature { R, sigma }` | [`Schnorr.compact`](Schnorr.compact) | The signature struct passed to `verify` / `assertValid`. |
| `challenge(R, P, m): Field` | [`Schnorr.compact`](Schnorr.compact) | Fiat-Shamir challenge. Domain-separated by tag `"Schnorr:Jubjub:v1"`. |
| `verify(P, m, sig): Boolean` | [`Schnorr.compact`](Schnorr.compact) | Validates the signature. Rejects identity `P` or `R`. |
| `assertValid(P, m, sig): []` | [`Schnorr.compact`](Schnorr.compact) | Like `verify`, but reverts the tx on failure with `"Schnorr: invalid signature"`. |
| `jubjubKeypairFromSecret(secret)` | [`utils/jubjubSchnorr.ts`](utils/jubjubSchnorr.ts) | Deterministic keypair generation from a `bigint` secret. |
| `jubjubSign(secret, message)` | [`utils/jubjubSchnorr.ts`](utils/jubjubSchnorr.ts) | Production signer — fresh CSPRNG nonce per call. |
| `jubjubSignDeterministic(secret, message, nonceSeed)` | [`utils/jubjubSchnorr.ts`](utils/jubjubSchnorr.ts) | **TEST-ONLY.** Caller-supplied nonce. Reusing the same nonce across two messages leaks the secret. |
| `schnorrChallenge(R, P, m)` | [`utils/jubjubSchnorr.ts`](utils/jubjubSchnorr.ts) | Bit-for-bit mirror of on-chain `challenge`. |
| `jubjubVerify(P, m, sig): boolean` | [`utils/jubjubSchnorr.ts`](utils/jubjubSchnorr.ts) | Off-chain reference verifier. |

### Critical security caveats

1. **Identity-point rejection.** `verify` returns `false` if either `P` or
   `R` is the curve identity. Without this check, `P = identity` collapses
   the verify equation to `σ·G == R`, which anyone can satisfy.
2. **Nonce reuse leaks the secret.** Schnorr `σ = r + c·s`; given two
   signatures `(σ_1, σ_2)` with the same nonce on different messages,
   `s = (σ_1 - σ_2) / (c_1 - c_2)`. The TS API enforces this by splitting
   into `jubjubSign` (random nonce, production) and `jubjubSignDeterministic`
   (caller-supplied, test-only).
3. **Cross-side parity.** On-chain `Schnorr.challenge` and off-chain
   `schnorrChallenge` agree bit-for-bit. Pinned by
   [`test/Schnorr.test.ts`](test/Schnorr.test.ts) → "off-chain
   `schnorrChallenge` matches on-chain `Schnorr_challenge` bit-for-bit".

---

## 3. FROST — threshold Schnorr signing (off-chain)

Implements [RFC 9591](https://datatracker.ietf.org/doc/rfc9591/) FROST for
K-of-N threshold signing on Jubjub. The off-chain protocol collapses K
participants into one Schnorr signature; the on-chain side uses the existing
`Schnorr.compact` verifier unchanged. This is what makes Scheme E's preset
([`multisig/presets/ShieldedMultiSigFrostV1.compact`](../multisig/presets/ShieldedMultiSigFrostV1.compact))
so small: no per-signer loop, no Merkle tree, no nullifier set.

### Surface

All in [`utils/frost/`](utils/frost/):

| File | What it provides |
| --- | --- |
| [`polynomial.ts`](utils/frost/polynomial.ts) | `evalPoly`, `lagrangeCoefficient`, `invMod`, `randomPolynomial`, `sampleScalar`. Scalar-field math over Fr. |
| [`dkg.ts`](utils/frost/dkg.ts) | Pedersen DKG: `dkgPropose`, `dkgVerifyAndFinalize`, `runDkgInProcess`. **No trusted dealer** — every participant contributes to the secret. |
| [`frostSign.ts`](utils/frost/frostSign.ts) | 3-round signing: `frostNonceCommit`, `frostBindingFactor`, `frostGroupCommitment`, `frostPartialSign`, `frostAggregateScalars`. Single-use `NonceHandle` blocks reuse. |
| [`frostCoordinator.ts`](utils/frost/frostCoordinator.ts) | `runFrostSigning(states, subset, msg)` — in-process orchestrator for tests and demos. |

### Tests

- [`test/frost.test.ts`](test/frost.test.ts) — 29 unit tests covering
  polynomial primitives, DKG correctness + tamper detection, FROST 2-of-3
  across every signer subset, malicious-partial rejection, nonce-reuse
  rejection, and **cross-side parity** with the on-chain `Schnorr.verify`
  via the simulator.

### User-scenario diagram

The diagram below traces a 2-of-3 multisig **payment** from the perspective
of three real users (`ADMIN`, `ALICE`, `BOB`):

- Phase 1 happens **once** at multisig setup (Pedersen DKG).
- Phase 2 + 3 happen **per transaction** (off-chain FROST signing →
  on-chain execute). `ADMIN` is offline for this transaction; `ALICE` and
  `BOB` produce the aggregated signature between them.

Colour bands group phases. Off-chain steps are above the dashed boundary;
the only on-chain content is one `execute` call carrying one Schnorr
signature.

```mermaid
sequenceDiagram
  autonumber
  participant A as ADMIN (user 1)
  participant B as ALICE (user 2)
  participant C as BOB (user 3)
  participant K as Coordinator (off-chain)
  participant N as Midnight node + proof server

  rect rgb(218, 232, 252)
    note over A,C: Phase 1 — Pedersen DKG (one-time setup; all 3 participants required)

    A->>A: sample polynomial f_1, compute commitments C_1
    B->>B: sample polynomial f_2, compute commitments C_2
    C->>C: sample polynomial f_3, compute commitments C_3

    par share distribution
      A->>B: private share s_{1→2}
    and
      A->>C: private share s_{1→3}
    and
      B->>A: private share s_{2→1}
    and
      B->>C: private share s_{2→3}
    and
      C->>A: private share s_{3→1}
    and
      C->>B: private share s_{3→2}
    end

    note over A,C: commitments C_1, C_2, C_3 broadcast publicly

    A->>A: verify each s_{i→1}·G == Σ_k 1^k · C_{i,k}; reject on mismatch
    B->>B: verify each s_{i→2}·G == Σ_k 2^k · C_{i,k}; reject on mismatch
    C->>C: verify each s_{i→3}·G == Σ_k 3^k · C_{i,k}; reject on mismatch

    A->>A: secret share s_1 = Σ_i s_{i→1};  P_agg = Σ_i C_{i,0}
    B->>B: secret share s_2 = Σ_i s_{i→2};  P_agg (same)
    C->>C: secret share s_3 = Σ_i s_{i→3};  P_agg (same)

    note over A,N: P_agg is the only public DKG output
    K->>N: deploy ShieldedMultiSigFrostV1(P_agg)
  end

  rect rgb(213, 232, 212)
    note over B,C: Phase 2 — FROST 2-of-3 signing (ADMIN offline; B + C cooperate)

    B->>B: sample nonces (d_2, e_2); commit (D_2, E_2) = (d_2·G, e_2·G)
    C->>C: sample nonces (d_3, e_3); commit (D_3, E_3) = (d_3·G, e_3·G)

    B->>K: round 1: publish (D_2, E_2)
    C->>K: round 1: publish (D_3, E_3)

    K->>K: round 2: ρ_i = H(i, msg, B-list); R = Σ_i (D_i + ρ_i·E_i); c = challenge(R, P_agg, msg)
    K->>B: (R, c, B-list, ρ_2)
    K->>C: (R, c, B-list, ρ_3)

    B->>B: λ_2 = lagrangeCoeff(2, {2,3});  z_2 = d_2 + ρ_2·e_2 + λ_2·c·s_2
    C->>C: λ_3 = lagrangeCoeff(3, {2,3});  z_3 = d_3 + ρ_3·e_3 + λ_3·c·s_3

    B->>K: round 3: partial signature z_2
    C->>K: round 3: partial signature z_3

    K->>K: σ = (z_2 + z_3) mod r
    note over K: aggregated signature = (R, σ)
  end

  rect rgb(248, 206, 204)
    note over K,N: Phase 3 — On-chain execute (one tx, one Schnorr verify)

    K->>B: deliver (R, σ) for submission
    B->>N: callTx.execute(to, amount, coin, sig = (R, σ))
    N->>N: proof server generates ZK proof over Schnorr.execute circuit
    N->>N: Schnorr.assertValid(P_agg, msg, (R, σ))  →  σ·G == R + c·P_agg ✓
    N->>N: treasury transfer: coin → recipient
    N-->>B: tx finalised
  end
```

### Reading the diagram

- **Blue band (Phase 1)** — Pedersen DKG. Happens **once** at multisig
  creation. All three participants must successfully complete this phase.
  The output is each participant's secret share `s_i` (private,
  non-recoverable) and the aggregated public key `P_agg` (public, deployed).
- **Green band (Phase 2)** — FROST 2-of-3 signing. Happens **per
  transaction**. Any two of the three participants can run this; the third
  may be offline. Output: a single Schnorr signature `(R, σ)` valid under
  `P_agg`.
- **Red band (Phase 3)** — On-chain execute. **One** transaction carrying
  **one** signature. The on-chain verifier cannot tell whether the
  signature was produced by FROST, MuSig2, or a single-key holder — that
  privacy property is exactly the value proposition of Scheme E.

### Security caveats (FROST-specific)

1. **Nonce uniqueness is non-negotiable.** A signer who reuses `(d_i, e_i)`
   across two distinct messages leaks `s_i`. The TS API enforces this via
   the single-use `NonceHandle` returned by `frostNonceCommit`; calling
   `frostPartialSign` twice on the same handle throws.
2. **DKG in-process limitation.** The current implementation runs all
   participants synchronously in one JS process. Production deployment
   needs a real message-passing layer (websockets / libp2p / etc.) with
   retry + Byzantine-fault handling. See [`scheme-e1-frost.md`](../../../.claude/plans/multisig/scheme-e1-frost.md)
   § Phasing.
3. **Cryptographic review.** This is a custom FROST-on-Jubjub
   implementation. Treat it as a research-grade prototype until an
   external cryptographic review signs off. The on-chain `Schnorr.verify`
   is well-trodden; the off-chain FROST stack is new code.
4. **Aggregator-protocol equivalence.** The on-chain side is identical
   for MuSig2 or any other aggregation scheme producing a valid
   Schnorr-on-Jubjub signature. The preset's "FROST" name reflects the
   recommended off-chain protocol, not an on-chain constraint.

---

## See also

- [`CRYPTO_NOTES.md`](CRYPTO_NOTES.md) — engineering record. Circuit
  costs, Fq/Fr field-mismatch, domain-tag registry.
- [`Multisig on Midnight — Cryptographic Design Proposal.md`](../../../.claude/plans/multisig/Multisig%20on%20Midnight%20%E2%80%94%20Cryptographic%20Design%20Proposal.md)
  — umbrella plan covering all multisig schemes.
- Scheme-specific plans:
  - [Scheme C — Schnorr per-signer](../../../.claude/plans/multisig/scheme-c-schnorr-jubjub-per-signer.md)
  - [Scheme D — Schnorr + Merkle-hidden membership](../../../.claude/plans/multisig/scheme-d-schnorr-jubjub-merkle-hidden.md)
  - [Scheme E — FROST / MuSig2 aggregated](../../../.claude/plans/multisig/scheme-e-frost-musig2-aggregated.md)
  - [Scheme E.1 — FROST 2-of-3 focused plan](../../../.claude/plans/multisig/scheme-e1-frost.md)
