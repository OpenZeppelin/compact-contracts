# crypto/ — Engineering Notes

Working record of cryptographic-engineering findings for the `crypto/` package. Pin a row here when a non-obvious behaviour gets locked in by code or by a passing test, so future readers don't have to re-derive it. Mirror of the question-table style used by the integration test [README](../../test/integration/README.md).

| #   | Question                                                                                            | Status | Where pinned                                                                                            |
| --- | --------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| C1  | Is `JubjubPoint` hashable directly via `transientHash<JubjubPoint>`?                                | ◐      | Worked around — we hash via `jubjubPointX(p)` + `jubjubPointY(p)` decomposition. See `Schnorr.challenge`. Direct opaque-typed hashing not pursued. |
| C2  | How is `JubjubPoint == JubjubPoint` expressed?                                                      | ✅     | Via coordinate decomposition: `jubjubPointX(a) == jubjubPointX(b) && jubjubPointY(a) == jubjubPointY(b)`. See [`Schnorr.pointsEqual`](Schnorr.compact). |
| C3  | Does Compact v0.31 expose Jubjub coordinate accessors?                                              | ✅     | Yes — `jubjubPointX(p): Field`, `jubjubPointY(p): Field`, `constructJubjubPoint(x, y): JubjubPoint`. Source: [compactc-v0.31.0/examples/jubjubpoint/examples.compact](../../../compact-compactc-v0.31.0/examples/jubjubpoint/examples.compact). |
| C4  | Can off-chain TS code reproduce on-chain `transientHash` bit-for-bit?                               | ✅     | Yes — both go through `@midnight-ntwrk/compact-runtime`'s `transientHash`. Pinned in [`Schnorr.test.ts`](test/Schnorr.test.ts) ("off-chain schnorrChallenge matches on-chain Schnorr_challenge bit-for-bit"). |
| C5  | Does the runtime auto-reduce `Field` (Fq) inputs to `ecMul`/`ecMulGenerator` mod the Jubjub scalar order (Fr)? | ❌     | **No.** `JubjubFr::from_bytes` returns `None` for any Field value ≥ Fr's modulus, surfacing as a WASM "failed to decode for built-in type EmbeddedFr after successful typecheck" error. ~7/8 of random Field values fall in the bad range (Fq ≈ 8·Fr). See [§ Fq vs Fr](#fq-vs-fr-the-field-mismatch-trap) below. |
| C6  | What's the safe-by-construction reduction strategy for an Fq value into Fr?                         | ✅     | Truncate to 248 bits by zeroing the top byte of the LE encoding. 2^248 < Fr ≈ 2^252, so the result is always valid as a Jubjub scalar. Loses ~4 bits of challenge entropy → ~124-bit Schnorr forgery resistance, well above 128-bit target. See [`Schnorr.fitInJubjubScalar`](Schnorr.compact). |
| C7  | Should `sigma` (the Schnorr response scalar) also be truncated on-chain?                            | ❌     | No. Off-chain `jubjubSign` already computes `sigma = (r + c·s) mod JUBJUB_SCALAR_ORDER`, so it's always in [0, Fr) and safe to pass to `ecMulGenerator` directly. Truncating it on-chain would be incorrect — values in (2^248, Fr) are valid sigmas and must not be altered. |
| C8  | What's the byte order of `upgradeFromTransient` / `degradeToTransient`?                             | ✅     | **Little-endian.** Byte 0 is the LSB; byte 31 is the MSB. Sourced from [midnight-ledger-ledger-8.0.3/zkir-v3/src/ir_vm.rs:193](../../../../midnight-ledger-ledger-8.0.3/zkir-v3/src/ir_vm.rs) (`to_bytes_le()`) and confirmed empirically via the bit-for-bit cross-side challenge test. |
| C9  | Does `slice<n>(bytes, offset)` work in Compact circuits?                                            | ✅     | Yes — see [Compact reference §slice](../../../compact-compactc-v0.31.0/compiler/compact-reference-proto.mdx) (line 2380+). Result type is `Bytes<n>`. Used in `fitInJubjubScalar`. |
| C10 | Can Compact build a `Bytes<32>` by spreading a `Bytes<31>` and appending a `Uint<8>`?               | ✅     | Yes — `[...(slice<31>(b, 0) as Bytes<31>), 0 as Uint<8>] as Bytes<32>` compiles cleanly in v0.31. |

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

In Compact:

```compact
export pure circuit fitInJubjubScalar(c: Field): Field {
  const cBytes: Bytes<32> = upgradeFromTransient(c);
  const truncated: Bytes<32> =
    [...(slice<31>(cBytes, 0) as Bytes<31>), 0 as Uint<8>] as Bytes<32>;
  return degradeToTransient(truncated);
}
```

Off-chain mirror in TS (`@midnight-ntwrk/compact-runtime` exposes the same primitives, but the bit-mask form is faster):

```ts
export const JUBJUB_TRUNCATION_BITS = 248;
const JUBJUB_TRUNCATION_MASK = (1n << BigInt(JUBJUB_TRUNCATION_BITS)) - 1n;

export function fitInJubjubScalar(c: bigint): bigint {
  return c & JUBJUB_TRUNCATION_MASK;
}
```

Bit-mask `c & ((1n<<248n) - 1n)` is equivalent to zeroing the top byte of the LE encoding because LE byte 31 represents bits 248..255.

### Security analysis

The truncation removes ~7 bits of challenge entropy (4 bits effectively, given Fr is ~252-bit and we cap at 248). Schnorr's forgery security in the random-oracle model is roughly half the challenge bit-length:

- 252-bit challenge (full Fr): ~126-bit forgery resistance.
- 248-bit challenge (our truncation): ~124-bit forgery resistance.

124-bit security is well above the 128-bit target for production use cases (∗) and consistent with industry practice (Zcash Sapling RedJubjub uses Blake2b-512 followed by reduction mod Fr; we cap at 2^248 to avoid the reduce-mod-Fr operation, which Compact's `Field` arithmetic does not natively support).

(∗) Strictly, "128-bit security" usually refers to the cost of the cheapest known attack against the underlying primitives (DL on Jubjub, Poseidon as ROM, etc.). The challenge length only bounds Schnorr's tightness; the ECDLP cost on Jubjub remains the dominant attack vector at ~126-bit cost. Trimming the challenge to 248 bits does not reduce the ECDLP-bound security.

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

## Domain Tags

Each cryptographic primitive in this package bakes a 32-byte ASCII tag into its hash preimage to prevent cross-protocol replay. Allocating new tags here as a single source of truth — never overload a tag for two primitives.

| Tag                       | Used by                              | Defined in                          |
| ------------------------- | ------------------------------------ | ----------------------------------- |
| `Schnorr:Jubjub:v1`       | `Schnorr.challenge` Fiat-Shamir hash | [Schnorr.compact](Schnorr.compact)  |

When adding a primitive: extend this table BEFORE writing the hash call, and keep the tag in lockstep with the off-chain TS reference.
