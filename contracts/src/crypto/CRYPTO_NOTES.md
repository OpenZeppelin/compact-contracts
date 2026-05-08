# crypto/ — Engineering Notes

Working record of cryptographic-engineering findings for the `crypto/` package. Pin a row here when a non-obvious behaviour gets locked in by code or by a passing test, so future readers don't have to re-derive it. Mirror of the question-table style used by the integration test [README](../../test/integration/README.md).

The package is layered as:

- **[`Jubjub.compact`](Jubjub.compact)** — generic primitives shared across every Jubjub-touching module: `pointsEqual`, `isIdentity`, `assertNonIdentity`, `fitInJubjubScalar`. Off-chain mirror at [`utils/jubjub.ts`](utils/jubjub.ts). Question prefix `J*`.
- **[`Schnorr.compact`](Schnorr.compact)** — Schnorr-on-Jubjub verifier built on top of `Jubjub`. Off-chain mirror at [`utils/jubjubSchnorr.ts`](utils/jubjubSchnorr.ts). Question prefix `S*`.

Future modules (Pedersen commitments, FROST aggregator, ECDH, hash-to-curve nullifiers, …) sit alongside `Schnorr.compact` and reuse `Jubjub`.

| #   | Question                                                                                            | Status | Where pinned                                                                                            |
| --- | --------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| #   | Module     | Question                                                                                            | Status | Where pinned                                                                                            |
| --- | ---------- | --------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| J1  | `Jubjub`   | Is `JubjubPoint` hashable directly via `transientHash<JubjubPoint>`?                                | ◐      | Worked around — we hash via `jubjubPointX(p)` + `jubjubPointY(p)` decomposition. Direct opaque-typed hashing not pursued. |
| J2  | `Jubjub`   | How is `JubjubPoint == JubjubPoint` expressed?                                                      | ✅     | Via coordinate decomposition: `jubjubPointX(a) == jubjubPointX(b) && jubjubPointY(a) == jubjubPointY(b)`. See [`Jubjub.pointsEqual`](Jubjub.compact). |
| J3  | `Jubjub`   | Does Compact v0.31 expose Jubjub coordinate accessors?                                              | ✅     | Yes — `jubjubPointX(p): Field`, `jubjubPointY(p): Field`, `constructJubjubPoint(x, y): JubjubPoint`. Source: [compactc-v0.31.0/examples/jubjubpoint/examples.compact](../../../compact-compactc-v0.31.0/examples/jubjubpoint/examples.compact). |
| J4  | `Jubjub`   | Does the runtime auto-reduce `Field` (Fq) inputs to `ecMul`/`ecMulGenerator` mod the Jubjub scalar order (Fr)? | ❌     | **No.** `JubjubFr::from_bytes` returns `None` for any Field value ≥ Fr's modulus, surfacing as a WASM "failed to decode for built-in type EmbeddedFr after successful typecheck" error. ~7/8 of random Field values fall in the bad range (Fq ≈ 8·Fr). See [§ Fq vs Fr](#fq-vs-fr-the-field-mismatch-trap) below. |
| J5  | `Jubjub`   | What's the safe-by-construction reduction strategy for an Fq value into Fr?                         | ✅     | Truncate to 248 bits by zeroing the top byte of the LE encoding. 2^248 < Fr ≈ 2^252, so the result is always valid as a Jubjub scalar. Loses 4 bits of challenge entropy → ~124-bit security versus the ~126-bit DLP ceiling on Jubjub (2-bit measurable loss vs RedJubjub's full-Fr challenge). See [`Jubjub.fitInJubjubScalar`](Jubjub.compact) and the security-analysis section below. |
| J6  | `Jubjub`   | What's the byte order of `upgradeFromTransient` / `degradeToTransient`?                             | ✅     | **Little-endian.** Byte 0 is the LSB; byte 31 is the MSB. Sourced from [midnight-ledger-ledger-8.0.3/zkir-v3/src/ir_vm.rs:193](../../../../midnight-ledger-ledger-8.0.3/zkir-v3/src/ir_vm.rs) (`to_bytes_le()`) and confirmed empirically via the bit-for-bit cross-side challenge test. |
| J7  | `Jubjub`   | Does `slice<n>(bytes, offset)` work in Compact circuits?                                            | ✅     | Yes — see [Compact reference §slice](../../../compact-compactc-v0.31.0/compiler/compact-reference-proto.mdx) (line 2380+). Result type is `Bytes<n>`. Used in `fitInJubjubScalar`. |
| J8  | `Jubjub`   | Can Compact build a `Bytes<32>` by spreading a `Bytes<31>` and appending a `Uint<8>`?               | ✅     | Yes — `[...(slice<31>(b, 0) as Bytes<31>), 0 as Uint<8>] as Bytes<32>` compiles cleanly in v0.31. |
| S1  | `Schnorr`  | Can off-chain TS code reproduce on-chain `transientHash` bit-for-bit?                               | ✅     | Yes — both go through `@midnight-ntwrk/compact-runtime`'s `transientHash`. Pinned in [`Schnorr.test.ts`](test/Schnorr.test.ts) ("off-chain schnorrChallenge matches on-chain Schnorr_challenge bit-for-bit"). |
| S2  | `Schnorr`  | Should `sigma` (the response scalar) also be truncated on-chain?                                    | ❌     | No. Off-chain `jubjubSign` already computes `sigma = (r + c·s) mod JUBJUB_SCALAR_ORDER`, so it's always in [0, Fr) and safe to pass to `ecMulGenerator` directly. Truncating it on-chain would be incorrect — values in (2^248, Fr) are valid sigmas and must not be altered. |
| S3  | `Schnorr`  | What is the relative circuit cost of one `Schnorr.verify` call? Where is it spent?                 | ✅     | Measured via zkir instruction count and prover-key size (the v0.31 CLI doesn't expose exact `k`/rows). See [§ Circuit-cost measurements](#circuit-cost-measurements) below. **Headline: a single `Schnorr.verify` is dominated by `Jubjub.fitInJubjubScalar` (~75% of cost); the actual `ecMul`/`ecAdd`/`pointsEqual` are cheap.** |

Status: ✅ Answered · ◐ Partial · ❌ Counterintuitive answer worth pinning

---

## Fq vs Fr — the Field-Mismatch Trap

**TL;DR.** Compact's `Field` is BLS12-381's scalar field Fq (modulus ≈ 2^254). Jubjub's scalar field Fr (modulus ≈ 2^252) is what `ecMul` / `ecMulGenerator` accept. Fq is roughly 8× larger than Fr; the runtime does NOT auto-reduce; passing a Field value ≥ Fr triggers a generic decode error, NOT a clean "out-of-range" message. Any circuit that takes a `Field` derived from a hash and multiplies it by a Jubjub point MUST reduce explicitly.

### The numbers

| Field           | Modulus                                                                | Bit-length                |
| --------------- | ---------------------------------------------------------------------- | ------------------------- |
| BLS12-381 Fq    | `0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001`   | ~254.86 bits              |
| Jubjub Fr       | `0x0e7db4ea6533afa906673b0101343b00a6682093ccc81082d0970e5ed6f72cb7`   | ~251.8 bits (252-bit cap) |

Source for Fq: [midnight-zk-main/curves/src/bls12_381/fq.rs:43](../../../../midnight-zk-main/curves/src/bls12_381/fq.rs).
Source for Fr: [midnight-zk-main/curves/src/jubjub/fr.rs:76](../../../../midnight-zk-main/curves/src/jubjub/fr.rs).

The ratio Fq / Fr ≈ 8.07, so a uniformly-random Fq value is < Fr with probability ≈ 1/8 only.

### How the failure surfaces

Run a Schnorr verify with `c = transientHash(...)` passed directly to `ecMul`:

```
Error: failed to decode for built-in type EmbeddedFr after successful typecheck
 ❯ Module.ecMul .../onchain-runtime-v3/midnight_onchain_runtime_wasm_bg.js:604:22
 ❯ Contract._verify_0 src/crypto/Schnorr.compact:104:26
```

Root cause: the WASM runtime calls `JubjubFr::from_bytes(&native.to_bytes_le())` (see [zkir-v3/src/ir_vm.rs:192-193](../../../../midnight-ledger-ledger-8.0.3/zkir-v3/src/ir_vm.rs)). `JubjubFr::from_bytes` returns `Option<JubjubFr>` and yields `None` for any byte sequence whose integer interpretation is ≥ Fr's modulus. The `?` propagation in the IR VM surfaces as the generic "failed to decode for built-in type EmbeddedFr" anyhow error.

### The fix — `fitInJubjubScalar`

Conceptually: zero the top byte of the LE encoding to guarantee `value < 2^248 < Fr`.

In Compact ([Jubjub.compact](Jubjub.compact)):

```compact
export pure circuit fitInJubjubScalar(c: Field): Field {
  const cBytes: Bytes<32> = upgradeFromTransient(c);
  const truncated: Bytes<32> =
    [...(slice<31>(cBytes, 0) as Bytes<31>), 0 as Uint<8>] as Bytes<32>;
  return degradeToTransient(truncated);
}
```

Off-chain mirror in TS ([utils/jubjub.ts](utils/jubjub.ts)) — `@midnight-ntwrk/compact-runtime` exposes the same primitives, but the bit-mask form is faster:

```ts
export const JUBJUB_TRUNCATION_BITS = 248;
const JUBJUB_TRUNCATION_MASK = (1n << BigInt(JUBJUB_TRUNCATION_BITS)) - 1n;

export function fitInJubjubScalar(c: bigint): bigint {
  return c & JUBJUB_TRUNCATION_MASK;
}
```

Bit-mask `c & ((1n<<248n) - 1n)` is equivalent to zeroing the top byte of the LE encoding because LE byte 31 represents bits 248..255.

### Security analysis

Schnorr signatures over a curve of group order `n` provide at most `~log2(n) / 2` bits of security, capped by the discrete-log cost on that curve (Pollard rho ≈ `sqrt(n)`). For Jubjub, `Fr ≈ 2^252`, so the **DLP ceiling is ~2^126** regardless of any choice elsewhere in the scheme.

The relevant question for our truncation is: **does shrinking the challenge from 252 bits to 248 bits reduce security below that 126-bit ceiling?**

Under the random-oracle model for Poseidon, Schnorr's tight ROM security bound is `min(challenge_bits / 2, log2(n) / 2)`. For us:

- DLP cost on Jubjub: `2^126`.
- Birthday-style attack on 248-bit challenge space: `2^124`.
- Tight ROM security: `min(2^124, 2^126) = 2^124`.

So the truncation does cost us 2 bits relative to a full-Fr challenge — but the gap is bounded *because the challenge space is still well above the curve security*. Were the challenge ever to drop below `2 * log2(n)` bits (i.e. ~252 bits), the curve security would no longer be the bottleneck, and the gap would be more meaningful. We are 4 bits below that comfort margin, which translates to a 2-bit measurable security loss in the worst case.

For comparison:

- **Zcash Sapling RedJubjub:** Blake2b-512 → `mod Fr` → 252-bit challenge → DLP-bound ~126-bit security.
- **Bitcoin BIP-340:** SHA-256 → 256-bit challenge → secp256k1 DLP-bound ~128-bit security.
- **Our scheme:** Poseidon → 248-bit truncated challenge → DLP-bound, but challenge-cost capped at ~124 bits.

The 2-bit loss versus RedJubjub is the price of avoiding an in-circuit `mod Fr` reduction (which Compact's `Field` arithmetic doesn't natively support). Acceptable for an experiment-grade module; if a production audit later wants to close the gap, it can be done by replacing the byte-truncation with a bounded conditional-subtraction reduction (up to ⌈Fq/Fr⌉ ≈ 8 conditional subtracts). Cost in rows: ~50-100 per subtract, so ~400-800 added rows total.

### Why we didn't pursue alternatives

| Alternative                                                                          | Why rejected for now                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reduce mod Fr via repeated subtraction (`while c >= Fr: c -= Fr`).                   | Compact circuits can't loop a data-dependent number of times. Bounded subtractions (≤ 8 iterations to cover `c < 8·Fr`) compile, but the per-iteration conditional logic is fiddly and adds rows for marginal gain (4 bits of entropy) over `fitInJubjubScalar`. |
| Use SHA-256 (`persistentHash`) and reduce mod Fr off-chain, then commit a witness.   | Breaks chain-enforced soundness — the prover gets to choose `c_reduced` with no on-chain check that it actually equals `H(...) mod Fr`.                                                                                                              |
| Wait for Compact to expose `as EmbeddedFr` or a built-in `mod Fr` operation.         | Out of scope for v0.31; not expected to land in the near term.                                                                                                                                                                                       |

### What other crypto routines are affected?

Anywhere a Field-typed hash output flows into `ecMul` / `ecMulGenerator`. So far in this package, only `Schnorr.challenge` has that shape. When future crypto modules (Pedersen, FROST aggregation, hash-to-curve nullifiers, …) land they should be reviewed against this trap and reuse `fitInJubjubScalar` where appropriate.

The dual-form scalar `sigma` in `JubjubSchnorrSignature` is **not** truncated on-chain because it's already produced in [0, Fr) by the off-chain signer (`jubjubSign` reduces mod `JUBJUB_SCALAR_ORDER`). Truncating it would be incorrect: a sigma in (2^248, Fr) is valid and must round-trip exactly.

---

## Identity-Element Rejection

`Schnorr.verify` rejects signatures where either the public key `P` or the commitment `R` is the curve identity (`(0, 1)` in twisted-Edwards form). Without this check, a degenerate `P = identity` would let any prover produce a signature trivially: `c * identity = identity` collapses the verify equation to `sigma * G == R`, which only requires knowing `r = log_G(R)` rather than the secret `s`. The off-chain `jubjubVerify` mirrors the same rejection so test vectors agree.

This is defence-in-depth — production contracts that maintain a registry of allowed signer keys should also reject `identity` at registration time, the same way `Ownable` rejects the zero `ZswapCoinPublicKey` ([Ownable.compact](../access/Ownable.compact)).

The `Jubjub.isIdentity(p)` pure circuit is exposed for that purpose and mirrored on the TS side as `isIdentity(p)` in [`utils/jubjub.ts`](utils/jubjub.ts). `Jubjub.assertNonIdentity(p)` is the assertion variant for callers that want a chain-level revert rather than a boolean.

---

## Nonce-Reuse Footgun

Schnorr signatures leak the secret if the same nonce `r` is ever used to sign two different messages under the same secret:

```
sigma_1 = r + c_1 * s   (mod Fr)
sigma_2 = r + c_2 * s   (mod Fr)
⇒  s = (sigma_1 - sigma_2) * (c_1 - c_2)^{-1}   (mod Fr)
```

This is a generic Schnorr-implementation hazard, not specific to our truncation. The TS API in [`utils/jubjubSchnorr.ts`](utils/jubjubSchnorr.ts) is split into two entrypoints to make the safe path obvious:

- **`jubjubSign(secret, message)`** — production-safe; samples a fresh CSPRNG nonce per call.
- **`jubjubSignDeterministic(secret, message, nonceSeed)`** — test-only; takes a caller-supplied nonce. The function name is intentionally verbose to discourage accidental production use. Documented with a `WARNING — TEST/CEREMONY USE ONLY` block.

Production callers MUST use `jubjubSign`. Test fixtures use `jubjubSignDeterministic` for reproducible vectors. Future protocol primitives that need pre-committed nonces (e.g. FROST round-1 commitments) should derive nonces via their own audited mechanism rather than reaching for `jubjubSignDeterministic`.

---

## Circuit-Cost Measurements

The Compact v0.31 compiler CLI does not expose exact `k` / row counts. We use two indirect cost proxies that are precise enough for sizing decisions:

- **zkir instruction count** — number of operations in the generated [Halo2 IR](https://github.com/zcash/halo2). Linear in circuit complexity.
- **prover-key size** — bytes on disk for the proving key. Roughly `O(2^k)` where `k` is the PLONK SRS size selector.

Numbers below were captured by inspecting `contracts/artifacts/MockJubjub/{zkir,keys}/*` and `contracts/artifacts/MockSchnorr/{zkir,keys}/*` after a clean `yarn compact --dir crypto` run.

| Circuit                       | zkir instructions | prover-key bytes | Approx. `k` |
| ----------------------------- | ----------------: | ---------------: | ----------- |
| **Jubjub primitives**         |                   |                  |             |
| `Jubjub.isIdentity`           |                36 |           22,716 | ~8          |
| `Jubjub.assertNonIdentity`    |                21 |           39,239 | ~8          |
| `Jubjub.pointsEqual`          |                36 |           39,435 | ~8          |
| `Jubjub.fitInJubjubScalar`    |               188 |       16,894,078 | ~14-15      |
| **Schnorr composition**       |                   |                  |             |
| `Schnorr.challenge`           |               191 |       16,899,744 | ~14-15      |
| `Schnorr.verify`              |               208 |       21,104,591 | ~14-15      |
| `Schnorr.assertValid`         |               192 |       21,104,428 | ~14-15      |

### What the numbers say

- **`fitInJubjubScalar` is the dominant cost.** The `upgradeFromTransient` → `slice<31>` → spread → `degradeToTransient` round-trip is 188 zkir instructions and ~17 MB of prover key. The actual EC arithmetic (`ecMulGenerator`, `ecMul`, `ecAdd`) accounts for only 17 instructions and a small fraction of the prover key (compare `verify` 208 vs `challenge` 191).
- **A single `Schnorr.verify` lives at `k ≈ 14-15`** based on the prover-key size scaling. That corresponds to roughly 16k–32k rows in the underlying PLONK arithmetisation.
- **The tiny primitives (`isIdentity`, `pointsEqual`, `assertNonIdentity`) are essentially free.** A Compact circuit can sprinkle these over identity/equality checks without measurable cost.

### Implications for `MAX_THRESHOLD` (consumer choice)

Compact circuits compose linearly: a preset that performs `K` independent `Schnorr.verify` calls has roughly `K * verify_cost` rows. Per the project memory note, the Midnight local-node deploy ceiling sits around `k = 18-20` (≈ 250K–1M rows). Working backwards from the per-verify cost:

| K | Estimated rows | Estimated `k` | Local-node fit |
| - | -------------: | ------------- | -------------- |
| 1 |          ~32K | ~15           | ✅ comfortable |
| 2 |          ~64K | ~16           | ✅ comfortable |
| 3 |          ~96K | ~17           | ✅ probable    |
| 4 |         ~128K | ~17           | ✅ probable    |
| 5 |         ~160K | ~18           | ◐ near edge    |
| 7 |         ~224K | ~18           | ◐ at edge      |

**Recommended default: `MAX_THRESHOLD = 4`** for first-cut presets. K=5-7 should be empirically validated by deploying the actual preset against a local node before committing — those are at the ceiling per project memory.

### Cost-reduction options worth considering

1. **Replace `fitInJubjubScalar` with conditional subtraction** (8 conditional `c -= Fr` iterations to reduce mod Fr). Removes the bytes round-trip but keeps the ~250 instruction cost. Probably similar total.
2. **Aggregate to a single Schnorr verify via FROST/MuSig2** ([Scheme E](../../../.claude/plans/scheme-e-frost-musig2-aggregated.md)). On-chain becomes one `verify` regardless of K — the cleanest cost win.
3. **Persistent-hash challenge instead of Poseidon truncation.** SHA-256 is more expensive in-circuit than Poseidon, so this is likely a regression.

---

## Domain Tags

Each cryptographic primitive in this package bakes a 32-byte ASCII tag into its hash preimage to prevent cross-protocol replay. Allocating new tags here as a single source of truth — never overload a tag for two primitives.

| Tag                       | Used by                              | Defined in                          |
| ------------------------- | ------------------------------------ | ----------------------------------- |
| `Schnorr:Jubjub:v1`       | `Schnorr.challenge` Fiat-Shamir hash | [Schnorr.compact](Schnorr.compact)  |

When adding a primitive: extend this table BEFORE writing the hash call, and keep the tag in lockstep with the off-chain TS reference.
