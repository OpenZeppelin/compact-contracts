---
stage: review
project: elgamal
mode: greenfield
extends: null
status: draft
timestamp: 2026-06-26
author: 0xisk
previous_stage: null
tags: [crypto, elgamal, jubjub, homomorphic, privacy, pr-617]
---

# ElGamal Module — Basic Review Report

Reviews PR [OpenZeppelin/compact-contracts#617](https://github.com/OpenZeppelin/compact-contracts/pull/617)
("Add elgamal", fixes #606) at branch `add-elgamal`. Standalone mode: no pipeline
artifacts. The module's doc comments are exhaustive and were treated as the de-facto
design + invariants spec; inferred invariants are listed below.

## Summary

- **Scope:** a new `crypto/` family with one stateless module: single-receiver
  ElGamal over Jubjub, plus its lifted (exponential) variant, additive-homomorphic
  ops, rerandomization, and in-circuit decryption/key-binding verification. No
  ledger state, no witnesses, no `disclose(...)` in the module itself.
- **Overall:** **Ready, with minor follow-ups.** The cryptography is correct, the
  two non-hiding edge cases are guarded in-circuit, and the residual obligations
  the circuit cannot enforce are documented to an unusually high standard. Findings
  are testing-adequacy and documentation/hardening items, not correctness or
  privacy breaks.
- **Privacy-claim verdict:** **Supported.** The module's stated guarantee —
  IND-CPA confidentiality of single-receiver ElGamal with additive homomorphism —
  holds *as scoped*, conditioned on the documented caller obligations (uniform,
  fresh, secret randomness `r < ℓ`; non-identity `pk`; bounded plaintext for the
  lifted variant). The module enforces the two trivial mask-zeroing cases
  (`pk = identity`, `r = 0`) in-circuit and correctly delegates the statistical
  obligations it structurally cannot check. The disclosure boundary belongs to the
  importing module and is explicitly called out as such.
- **Findings:** Critical 0 · High 0 · Medium 2 · Informational 6.

## Invariant Verification

Inferred from the code and module doc comments (standalone mode — no invariants
artifact).

| Invariant | Enforced? | Location | Notes |
|-----------|-----------|----------|-------|
| INV-1: non-identity `pk` (mask cannot be trivially zeroed) | ✅ Yes | `encryptPoint` `assert pk != ecMulGenerator(0)` | All encryption paths route through `encryptPoint`. |
| INV-2: non-zero `r` (mask cannot be zeroed) | ✅ Yes | `encryptPoint` `assert r != 0` | Covers `encrypt`, `rerandomize`, `addEncrypted`, `subEncrypted`. |
| INV-3: decryption correctness — `Enc(m)` opens to `m` under matching `(pk,ek)` | ✅ Yes | `assertDecryptsToPoint` / `assertDecryptsTo` | `m = c2 - ek·c1`; verified, tested. |
| INV-4: key binding — reject `(pk,ek)` where `derivePk(ek) != pk` | ✅ Yes | `assertKeyPair`, inlined check in `assertDecryptsToPoint` | Tested both directions. |
| INV-5: additive homomorphism — `add`/`sub`/`scalarMul`/`negate` map to plaintext ops | ✅ Yes | by construction | Componentwise EC algebra; tested incl. weighted sum. |
| INV-6: hash-to-scalar always yields a valid Jubjub scalar (`< ℓ`) | ⚠️ Partial | `secretToScalar` / `expandRandomness` via `degradeToTransient` | Mechanism sound (31-byte ⇒ `< 2^248 < ℓ`, verified numerically), but tested on only 2–3 fixed inputs — see M-2. |
| INV-7: negation identity `ecNeg(P) = -P` | ⚠️ Partial | `ecNeg = ecMul(P, ℓ-1)` | Correct **only** for prime-order-subgroup `P`; rests on INV-8, which the simulator does not test — see M-1. `ℓ-1` constant verified correct. |
| INV-8: every `JubjubPoint` reaching a curve op is in the prime-order subgroup | ⚠️ Partial | runtime/prover constraint (cofactor clearing) | Load-bearing for INV-5/INV-7. Asserted in prose, **not** in-circuit and **not** simulator-tested — see M-1. |
| INV-9: same-key requirement — cross-key combine opens under neither key | ✅ Yes (fails safe) | math of `add`/`sub` | Tested: mixed-key sum throws `plaintext mismatch` under both keys. |
| INV-10: no assert message embeds witness-derived data | ✅ Yes | all `assert` sites | Static strings only. |
| INV-11: lifted subtraction does not guard underflow (caller must check) | ✅ Documented | `sub` / `subEncrypted` `@notice` | Wraps mod `ℓ`; test documents the contract. |
| INV-12: `encryptZero` is the fixed, non-hiding, publicly recognizable `(O,O)` | ✅ Documented | `encryptZero` `@notice` | Tested; flagged as never-written marker. |

## Findings

### Critical

None.

### High

None.

### Medium

#### MEDIUM-1: Prover-level guarantees (subgroup membership, scalar validity) are unverified outside the simulator

**Location:** `contracts/src/crypto/test/ElGamal.test.ts` (whole suite); design dependency in `ElGamal.compact` module-level "Subgroup membership" note.
**Invariant:** INV-7, INV-8.

**Issue:** Every test runs against the `compactc`-emitted simulator
(`@openzeppelin/compact-simulator`), none through the proof server. The
correctness of `ecNeg` (and therefore `negate`/`sub`/`assertDecryptsToPoint`) and
the homomorphic algebra rest on INV-8 — that the runtime constrains every assigned
`JubjubPoint` into the prime-order subgroup via cofactor clearing. That constraint
lives at the ZK-constraint level. The simulator's curve arithmetic operates on the
witness point values and does **not** necessarily reproduce the prover's rejection
of an off-subgroup / low-order / mixed-order point. So the single most load-bearing
security assumption in the module is exercised by nothing in the test suite.

This is consistent with the rest of the repo (no module ships a proof-loop test
today), and it is partly *structurally* untestable: `JubjubPoint` is opaque and
every point in a test is produced by a curve op, so you cannot construct an
off-subgroup point to feed in and confirm it is rejected.

**Impact:** If the subgroup-clearing assumption is ever weaker than documented (a
`compactc`/`midnight-ledger` change, or a misread of current behavior), an
importing module that forwards a caller-supplied `pk` or message point could
operate on a non-subgroup point where `ecNeg(P) != -P`, breaking decryption
verification or the homomorphism in ways the simulator would never reveal.
`compactc`/`midnight-ledger` are unaudited as of mainnet launch, so this is a
high-prior assumption to pin down rather than trust.

**Recommendation:**
- Add at least one full-proof (non-`--skip-zk`) smoke test of a representative path
  — e.g. `derivePk` → `encrypt` → `assertDecryptsTo` → `negate` round-trip — to
  confirm the circuits are satisfiable under the real proof system and that
  well-formed inputs are not rejected.
- Promote INV-8 to an **explicit, named trust assumption** in the module header
  (it is currently prose inside a `@dev` block) and, if possible, get it confirmed
  by the `compactc`/ledger team. The negation identity and all homomorphic
  correctness inherit from it.

**Status:** Open

#### MEDIUM-2: "`degradeToTransient` always yields a valid scalar" is load-bearing but tested on 2–3 fixed inputs

**Location:** `contracts/src/crypto/test/ElGamal.test.ts` (`secretToScalar`,
`expandRandomness`, `derivePk` describes).
**Invariant:** INV-6.

**Issue:** The whole reason `secretToScalar`/`expandRandomness` wrap
`persistentHash` in `degradeToTransient` is that a raw `persistentHash` output
"would occasionally exceed the Jubjub scalar field order and fault `ecMulGenerator`
at runtime" (module note). The fix is sound — 31-byte truncation gives `< 2^248`,
and `2^248 < ℓ` (verified numerically). But the tests only check determinism and
distinctness on `EK_A`, `EK_B`, and a couple of seeds. They never stress the
"always valid" property that motivated the design, even though `ecMulGenerator`
faulting on an out-of-range scalar *is* reproduced by the simulator (it is exactly
the failure they observed), so a stress test is both feasible and cheap here.

**Impact:** A regression in `degradeToTransient` semantics (or a wrong assumption
about its output width) would surface as intermittent prover/runtime faults for
some secrets/seeds in production — never caught by the current suite.

**Recommendation:** Add a property/fuzz test (the repo already uses `fast-check`
elsewhere by hand) over many random 32-byte secrets and `(seed, tag)` pairs,
asserting `secretToScalar` / `expandRandomness` return `> 0` and that
`derivePk` / `encrypt` never throw. A few hundred iterations is enough to back the
"always a valid scalar" claim empirically.

**Status:** Open

### Informational

#### INFO-1: `Uint<128>` plaintext type far exceeds the lifted variant's decryptable range

`encrypt` / `addEncrypted` / `subEncrypted` take `value: Uint<128>`. The lifted
scheme only recovers `v` off-chain via a discrete-log search, feasible for roughly
`2^32`–`2^48`, not `2^128`. The module documents the bound thoroughly, and
`assertDecryptsTo` verifies a *claimed* value (no in-circuit DL search, so the type
is sound in-circuit). But the signature itself communicates a much larger safe
range than exists. Consider documenting a recommended maximum at the circuit level,
or noting that importers must cap `value` to their DL-recovery budget. Non-blocking.

#### INFO-2: No domain separation between the key-derivation and randomness hashes

`secretToScalar` hashes `[secret]` (arity 1); `expandRandomness` hashes
`[seed, tag]` (arity 2). They are distinguished only by input arity, not by an
explicit domain tag. Collisions are already implausible, but a one-byte/one-field
domain constant per usage ("EG-KEY" vs "EG-RAND") is cheap defense-in-depth against
a consumer that reuses one 32-byte secret as both `ek` and randomness seed.

#### INFO-3: `scalarMul(ct, 0)` silently collapses to the recognizable identity ciphertext

`scalarMul` scales both components by `k`, so `k = 0` yields `(O, O)` — the same
publicly-recognizable non-hiding value as `encryptZero()`, regardless of input.
Mathematically it is `Enc(0)`, but hiding is lost. The `scalarMul` doc covers the
`k < ℓ` obligation but not the `k = 0` hiding edge; a one-line `@notice` would round
it out. (Tested behavior is correct — `scaling by 0 decrypts to 0` — this is just a
documentation gap.)

#### INFO-4: The recommended randomness path (`expandRandomness` → `encrypt`) is never exercised end-to-end

`expandRandomness` is the module's recommended way to produce `r`, but tests feed
only the small constants `R1/R2/R3` into `encrypt`, and test `expandRandomness` only
for determinism/distinctness. Add one test that encrypts with
`r = expandRandomness(seed, tag)` and round-trips through `assertDecryptsTo`, so the
recommended integration path is covered (and confirms a ~248-bit `Field` works as
encryption randomness).

#### INFO-5: Confidentiality only, not ciphertext integrity — make the malleability contract explicit for integrators

ElGamal here is intentionally malleable (that is the homomorphism). Importers must
not treat a ciphertext as authenticated or non-replayable; binding to authorization
is the importer's job via `assertDecryptsTo` against committed state plus their own
nullifiers/commitments. This is implicit in the design but never stated in one
place. A short "Integrity & authorization" `@dev` note pointing integrators at the
`assertDecryptsTo` binding pattern would prevent a foreseeable misuse.

#### INFO-6: No module-level API doc / README for the new `crypto/` family

The new `crypto/` directory ships no `.adoc`/README entry (docs live outside `src/`
in this repo and are a separate pipeline stage). Flagging as a docs follow-up so
the module surfaces in the published API reference alongside `token`/`access`/etc.

*Minor test nit:* `contract` is assigned at `describe`-body scope (runs at
collection time). A `const` at module scope or a `beforeAll` reads more
conventionally. Trivial.

## Security Checklist Results

- **3.1 Privacy & Disclosure** — **Pass (N/A surface).** No `disclose(...)`, no
  ledger, no witnesses in the module; the boundary is the importer's and is
  documented. No assert message leaks witness data (INV-10). Note: these are pure
  circuits returning values derived from secret args, so the importer owns the
  `disclose(...)` at its own boundary — correctly delegated.
- **3.2 Circuit Soundness** — **Partial.** Curve scalars correctly use `Field`;
  monetary plaintext correctly uses bounded `Uint<128>` (no unintended `Field`
  wrap). All circuits are `pure circuit`. Gaps: no proof-loop test (M-1) and the
  hash-to-scalar validity claim is thinly tested (M-2). Depends on unaudited
  `compactc`/`midnight-ledger` curve gadgets — flagged.
- **3.3 Authorization & Replay** — **Pass (delegated).** No `msg.sender`; key
  ownership is a knowledge-of-preimage check (`assertKeyPair` /
  `assertDecryptsTo`). The module provides no nullifier/replay machinery by design;
  randomness-reuse leakage is documented and `expandRandomness` mitigates it. See
  INFO-5 for the integrator-facing malleability note.
- **3.4 State Management & Integrity** — **N/A.** Stateless module; no ledger
  fields, no Merkle trees, no counters.
- **3.5 Economic Security** — **Pass.** Costs are bounded (fixed curve ops, no
  loops, no runtime-sized data). No fee sponsorship. Token-style balance sums are
  the importer's concern; the homomorphism preserves sums by construction.
- **3.6 Composability** — **Pass (by design).** Pure primitives; cross-key combine
  fails safe (INV-9). No cross-contract calls. The TOCTOU surface is the importer's
  (it owns the ledger reads); the module is timing-agnostic.
- **3.7 Upgradeability (CMA / VK)** — **N/A for the module.** Recompiling under a
  different `compactc` (the `>= 0.23.0` pragma matches repo convention) changes the
  verifier key for any *importer* — standard VK churn, called out repo-wide, no
  ElGamal-specific concern.

## Test Coverage Assessment

Coverage of documented behavior is excellent: every exported circuit has positive
and negative cases, including wrong-plaintext / wrong-`ek` / wrong-`pk` rejection,
identity-`pk` and zero-`r` rejection, cross-key non-combination, the underflow
contract, the weighted-sum composition, and a running-balance flow. Negative tests
assert on the resulting verification (the decryption oracle), not on witness inputs.

Gaps, in priority order:
1. **No full-proof test** (M-1) — the prover-level subgroup/scalar guarantees are
   never exercised; partly structurally untestable, so pair a smoke test with an
   explicit trust assumption.
2. **Hash-to-scalar validity under-tested** (M-2) — fuzz `secretToScalar` /
   `expandRandomness` to back the "always valid scalar" claim.
3. **Recommended randomness path uncovered** (INFO-4) — wire
   `expandRandomness` → `encrypt` → decrypt.

## Artifact Drift

None. Standalone review — no upstream pipeline artifacts to drift from. The module
doc comments are internally consistent with the implementation (spot-checked: the
`ℓ-1` negation constant, the `degradeToTransient` width reasoning, and every
"Requirements" block match the code).

## Recommendation

- **Overall verdict:** Ready for merge / deploy as a primitive library, with the
  two Medium items addressed as fast follow-ups (neither blocks correctness).
- **Blocking issues:** None.
- **Suggested improvements (recommended before downstream modules build on it):**
  M-1 (one full-proof smoke test + promote INV-8 to an explicit trust assumption),
  M-2 (fuzz the hash-to-scalar validity). Then the informational doc/test polish.

## Out of Scope

- **`compactc` / `midnight-ledger` internals** — the embedded-curve subgroup
  clearing and `ecMul`/`degradeToTransient` semantics are taken as documented;
  auditing the unaudited runtime is outside a basic review (and underpins M-1).
- **Importing modules** — confidential-balance / token consumers that will use
  these primitives are not in this PR; their disclosure boundaries, nullifier
  schemes, and DL-bound enforcement are their own review.
- **Cryptographic hardness assumptions** — DDH on Jubjub and the security of
  `persistentHash` are assumed, not analyzed.
- **Build/CI execution** — wiring was inspected (turbo `compact:crypto` + scripts
  added, mock under the conventional `test/mocks/` path, aggregator updated); the
  suite was not run locally. PR CI: CodeQL / semgrep / analyze green, "Run Test
  Suite" pending at review time.

## Dev Notes

- Documentation quality is a standout: the module header's hash-to-scalar,
  subgroup, weak-key, and randomness notes pre-empt most of what a reviewer would
  otherwise flag. The findings here are mostly "make the test suite assert what the
  prose already claims."
- Version banner `v0.2.0` and pragma `>= 0.23.0` match every existing module —
  intentionally not flagged.
- `crypto/` is a brand-new top-level family; ElGamal is its first member.

## Open Questions

- Confirm INV-8 (prime-order-subgroup clearing on every `JubjubPoint` assignment)
  with the `compactc`/`midnight-ledger` team, or capture it as a stated trust
  assumption — it is the foundation of `ecNeg` and the homomorphism (M-1).
- Is a proof-loop test wanted for this PR, or deferred to a repo-wide effort? The
  module is the strongest case for one (first nontrivial in-circuit EC crypto), but
  no module has one today.
- Should the lifted `value` type be narrowed (or a recommended cap documented) to
  signal the discrete-log bound (INFO-1)?
