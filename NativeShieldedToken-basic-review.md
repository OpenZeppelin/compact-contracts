---
stage: review
project: native-shielded-token
mode: extension
extends: contracts/src/token
status: draft
timestamp: 2026-06-19
author: 0xisk (review via midnight-basic-review)
previous_stage: mip-xxxx-native-shielded-token.md
tags: [zswap, shielded, token, supply-accounting, privacy, cma, compile-blocker]
---

# Native Shielded Token — Basic Review Report

## Summary

- **Scope:** `NativeShieldedToken.compact` (Fungible), `NativeShieldedTokenFamily.compact`
  (Family), `extensions/NativeShieldedTokenDerivedNonce.compact`. The MIP
  (`mip-xxxx-native-shielded-token.md`) is the design+spec reference (standalone review,
  the MIP stands in for the design/invariants artifacts).
- **Findings:** 1 Critical (build-blocking) — **now FIXED**; 1 High, 3 Medium, 4 Informational.
- **Headline:** The two base modules compile and are logically sound. The derived-nonce
  extension had a `pad(32, …)` string exceeding 32 bytes that broke compilation of the extension
  and every consumer. **Fixed 2026-06-19** (tag shortened to the MIP's `"NativeShieldedToken:nonce"`);
  the 3 contracts + both mocks now compile on toolchain 0.31.0 and `artifacts/` was regenerated.
  The remaining open items are verification gaps (HIGH-1 privacy), not build blockers.
- **Privacy-claim verdict:** The stated recipient-privacy guarantee (base `_mint` + secret
  uniform nonce ⇒ recipient unlinkable; derived-nonce mint ⇒ recipient-public) is *plausibly*
  supported by the disclosure boundary and is consistent with the cited empirical study, but
  it is **not verified by any test in this repository**, and the code paths that would make
  it concrete do not currently build. The privacy claim is **unverified in-suite** and must be
  pinned on the local infra before the standard advances.
- **Overall:** Needs fixes. The base logic is close; the blocker is mechanical (string lengths)
  and the gaps are in verification, not (so far) in the core design.

## Invariant Verification

Inferred from the MIP (Specification, Supply Accounting, Security Considerations). Profiles
share the same invariants; rows note where Fungible vs Family differ.

| Invariant | Enforced? | Location | Notes |
|-----------|-----------|----------|-------|
| INV-1 Color soundness — a coin's color is `tokenType(domain, kernel.self())`, computed at call time | ✅ | `tokenColor`, `_mint`→`mintShieldedToken`, burn color asserts | `kernel.self()` resolved at call time, never constructor. Good. |
| INV-2 `totalMinted` exact — every mint increments the counter | ✅ | `_mint`→`_addMinted` before primitive | Fungible scalar; Family per-domain map. |
| INV-3 Mint overflow reverts on `Uint<128>` | ✅ | `_addMinted` (`MAX_UINT128 - total >= amount`) | Readable revert message. |
| INV-4 `totalBurned` counts every contract-mediated burn | ✅ | both burns → `_addBurned` | Lower bound by design. |
| INV-5 `totalSupply = minted − burned`, no underflow | ⚠️ Partial | `totalSupply()` subtraction; no local `burned ≤ minted` guard | Safe under the proof loop (coin conservation). NOT enforced locally, so a `--skip-zk` unit test can drive `burned > minted` and underflow the getter. See M-1. |
| INV-6 Mint recipient non-zero | ✅ | `_mint` assert `!isKeyOrAddressZero` | |
| INV-7 `_burn` refundTo non-zero | ✅ | `_burn` assert | Zero key = burn address; guard prevents silent change burn. |
| INV-8 Burn `amount ≤ coin.value` | ✅ | both burns assert | |
| INV-9 Correct spend path per coin origin | ✅ (static) | `_burn` = `receiveShielded`+`sendImmediateShielded`; `_burnFromContract` = `sendShielded`, no receive | Correct shape. Runtime correctness is **proof-loop-only** (simulator cannot prove it). |
| INV-10 Refund/change coin returned | ✅ | `_burn` returns `some/none`; `_burnFromContract` returns change | Delivery obligation is testable on the return value. |
| INV-11 Derived nonces never repeat | ✅ (logic) | `_deriveNonce`: monotonic `_counter` + `evolveNonce` | Relies on `evolveNonce`/`persistentHash` collision-resistance. |
| INV-12 Derived nonces domain-separated from caller nonces (fixed tag) | ✅ | `_deriveNonce` line 106 `pad(32, "NativeShieldedToken:nonce")` | Fixed (was build-broken, CRIT-1). Tag = `Hash(fixed_tag, chainValue)` ≠ the public chainValue an honest caller echoes. |
| INV-13 Nonce chain seeded once, non-zero | ✅ | `Derived_initialize` two asserts | |
| INV-14 Metadata / domain immutable after construction | ✅ | `sealed ledger` (`_name`,`_symbol`,`_decimals`,`_domain`) | Compiler-enforced. |
| INV-15 Circuits revert before initialization | ✅ | inline `assertInitialized()` on every public circuit (per-module `_isInitialized`) | Migrated off `Initializable` to the #562 inline pattern (2026-06-19). |
| INV-16 No `msg.sender` / no `ownPublicKey()` auth | ✅ | modules unrestricted; presets gate via Ownable witness / AccessControl roles | Matches MIP §Access Control. |

## Findings

### Critical

#### CRIT-1: Derived-nonce tag and Family role IDs exceed 32 bytes — extension, both mocks, and all four presets fail to compile

**Severity axis:** build-blocking (not a runtime privacy/funds Critical, but it stops the
entire deliverable from building, so it is the first thing to fix).

> **Update (2026-06-19, FIXED):** Resolved. The presets were removed (Family role-ID overflows
> moot), and the extension tag at line 106 was changed from the 37-byte
> `"NativeShieldedTokenDerivedNonce:nonce"` to the MIP's 25-byte `"NativeShieldedToken:nonce"`
> (also resolves the spec/code drift). Re-verified on toolchain 0.31.0: the 3 contracts + both
> mocks now compile clean, and `contracts/artifacts/` was regenerated (the deployable mocks carry
> all 12 circuits' prover/verifier keys). See updated Status below.

**Location:**
- `extensions/NativeShieldedTokenDerivedNonce.compact:106` — `pad(32, "NativeShieldedTokenDerivedNonce:nonce")` (37 bytes)
- `presets/NativeShieldedTokenFamilyAccessControl.compact:45` — `pad(32, "NativeShieldedTokenFamily.MINTER_ROLE")` (37 bytes)
- `presets/NativeShieldedTokenFamilyAccessControl.compact:52` — `pad(32, "NativeShieldedTokenFamily.BURNER_ROLE")` (37 bytes)

**Invariant:** INV-12 (and the buildability of every consumer).

**Issue:** `pad(32, s)` is a **compile error** when `s` exceeds 32 UTF-8 bytes. Verified
directly on toolchain 0.31.0:

```
Exception: NativeShieldedTokenDerivedNonce.compact line 106 char 8:
  cannot pad "NativeShieldedTokenDerivedNonce:nonce" to length 32 since its
  utf8-equivalent already exceeds that length
```

Compile matrix (toolchain 0.31.0, `pragma >= 0.23.0` target):

| File | Result |
|------|--------|
| `NativeShieldedToken.compact` | OK |
| `NativeShieldedTokenFamily.compact` | OK |
| `extensions/NativeShieldedTokenDerivedNonce.compact` | **FAIL** (line 106) |
| `presets/NativeShieldedTokenOwnable.compact` | **FAIL** (imports extension) |
| `presets/NativeShieldedTokenAccessControl.compact` | **FAIL** (imports extension; own role strings are 31 bytes, fine) |
| `presets/NativeShieldedTokenFamilyOwnable.compact` | **FAIL** (imports extension) |
| `presets/NativeShieldedTokenFamilyAccessControl.compact` | **FAIL** (own lines 45/52 + extension) |
| `test/mocks/MockNativeShieldedToken.compact` | **FAIL** (imports extension) |
| `test/mocks/MockNativeShieldedTokenFamily.compact` | **FAIL** (imports extension) |

These are the only `pad(32, …)` calls in the whole repo that exceed 32 bytes; every other
usage is ≤ 32. The compiled `contracts/artifacts/NativeShieldedTokenDerivedNonce` and
`MockNativeShieldedToken` directories are **stale** — built 2026-06-11, predating the current
source (2026-06-19) — so any test currently "green" against them is exercising old bytecode.
`MockNativeShieldedTokenFamily` and the presets were never compiled (absent from `artifacts/`).

**Impact:** The extension and every contract that composes it cannot be built. The unit suite
(needs the mocks) and the integration suite (needs deployable presets) cannot run at all. The
MIP acceptance criterion "reference implementation merged … with a full simulator-based test
suite" is unreachable in the current state.

**Recommendation:** Shorten each tag/role string to ≤ 32 bytes. The nonce tag should match the
MIP, which already specifies a 25-byte value:

```compact
// extensions/NativeShieldedTokenDerivedNonce.compact:106 (and the doc-comment at line 23)
// MIP §"Extension: Derived-Nonce Minting" specifies this exact 25-byte tag:
return persistentHash<Vector<2, Bytes<32>>>(
  [pad(32, "NativeShieldedToken:nonce"), chainValue]   // 25 bytes — compiles, matches spec
);
```

```compact
// presets/NativeShieldedTokenFamilyAccessControl.compact
// Drop the "Family" prefix to match the non-Family preset convention (31 bytes, compiles):
export pure circuit MINTER_ROLE(): Bytes<32> {
  return pad(32, "NativeShieldedToken.MINTER_ROLE");   // 31 bytes
}
export pure circuit BURNER_ROLE(): Bytes<32> {
  return pad(32, "NativeShieldedToken.BURNER_ROLE");   // 31 bytes
}
```

After the fix, recompile and regenerate all artifacts; do not rely on the stale `artifacts/`.

**Status:** Fixed (2026-06-19) — tag → `"NativeShieldedToken:nonce"`; artifacts regenerated.

### High

#### HIGH-1: Recipient-privacy guarantee is load-bearing but unverified in-repo

**Location:** `_mint` (`disclose(recipient)`), `_burn` (`disclose(refundTo)`), and the
derived-nonce extension; MIP §"Mint Circuit", §"Recipient linkability of derived-nonce mints".

**Invariant:** the core privacy property of the standard.

**Issue:** The standard's central privacy claim is that a base `_mint` with a secret uniform
nonce is recipient-private (the commitment cannot be linked to a recipient), while a
derived-nonce mint is recipient-public (the public chain value lets anyone recompute the
commitment for candidate recipient keys). The circuit is *forced* by the compiler to
`disclose(recipient)` to pass it into `mintShieldedToken`. The privacy claim therefore depends
entirely on `mintShieldedToken` **not** publishing the raw recipient key in the public
transcript (only folding it into a commitment). That is asserted by the MIP and the cited
external study, but **nothing in this repo tests it**, and the code paths that exercise it do
not currently compile (CRIT-1).

**Impact:** If `disclose(recipient)` did surface the recipient in public data, the
recipient-private mint would be a privacy break (Critical). The evidence says it does not, but
a *standard* should not ship its defining privacy property unverified. The same question
applies to the disclosed `refundTo` in `_burn` (change refunds are recipient-public; consumers
must know this).

**Recommendation:** Make this a P0 integration test on the local infra (see the testing plan,
§3 "Privacy verification"):
1. Mint with a secret uniform nonce; query the indexer's public contract state / tx effects;
   assert the recipient public key is **not** recoverable from public data.
2. Mint with the derived nonce; assert the recipient **is** recoverable by enumerating candidate
   keys against the public commitment (confirming the documented trade-off, not a regression).
3. Document explicitly that `_burn`'s `refundTo` is disclosed (refund target is public).

**Status:** Open

### Medium

#### MED-1: `totalSupply` underflow-safety relies on a protocol invariant with no local guard

**Location:** `NativeShieldedToken.compact:265` and `NativeShieldedTokenFamily.compact:257`
(`totalSupply`); `_addBurned` (no overflow/`burned ≤ minted` check).

**Invariant:** INV-5.

**Issue:** `totalSupply = (minted − burned) as Uint<128>` and `_addBurned` has no overflow
guard. Both are safe **only** because the proof loop forbids burning coins that were never
minted, so `burned ≤ minted` always holds on-chain. There is no in-contract assertion of that
relationship. Under `--skip-zk`, the simulator does not model coin conservation, so a unit test
can call `_burn`/`_burnFromContract` with a fabricated coin and push `burned > minted`, making
`totalSupply()` underflow (revert or wrap, depending on Compact's `Uint` subtraction
semantics).

**Impact:** No production risk (proof loop prevents it). It is a correctness/testing hazard:
unit tests must respect coin conservation manually, and the contract has no defensive net.

**Recommendation:** Either (a) accept and document the proof-loop dependency explicitly in the
module notes and ensure unit tests never fabricate over-value burns, or (b) add a defensive
`assert(_totalMinted >= _totalBurned + amount)` in `_addBurned` for a readable revert. Prefer
(a) for circuit cost, but the dependency must be a written invariant, not implicit.

**Status:** Open

#### MED-2: Source pragma lags the repo standard (`>= 0.21.0` vs `>= 0.23.0`)

**Location:** all five new `.compact` files (`pragma language_version >= 0.21.0`).

**Issue:** The repo raised the language pragma to `>= 0.23.0` (#598) and the toolchain to
0.31.0 (#597). These files still declare `>= 0.21.0`. The MIP §Dependencies also says
">= 0.21.0". The code compiles under 0.31.0, but the declared floor is inconsistent with the
rest of the library.

**Impact:** Inconsistent version floor; a future reviewer/integrator may compile against an
unintended older toolchain. Low runtime risk.

**Recommendation:** Raise the pragma to `>= 0.23.0` across all five files and update the MIP
§Dependencies to match. Confirm with the maintainers that 0.23.0 is the agreed floor.

**Status:** Open

#### MED-3: Integration script in PR #489 pins a stale toolchain (0.30.0)

**Location:** `contracts/package.json` `test:integration` (from PR #489):
`COMPACT_TOOLCHAIN_VERSION=0.30.0 yarn compact && … yarn compact:integration-mocks && …`.

**Issue:** The integration harness pins 0.30.0, but the repo standard is 0.31.0. Native
shielded token specs added on top of this harness should compile under 0.31.0 to match the
library, not 0.30.0.

**Impact:** Version skew between unit and integration builds; risk of "compiles in CI, differs
locally."

**Recommendation:** Align the integration script to `COMPACT_TOOLCHAIN_VERSION=0.31.0` (or
inherit the repo default) when wiring the native-shielded-token integration specs.

**Status:** Open

### Informational

- **INFO-1 (redundant init asserts):** Family `_addMinted`/`_addBurned` call
  `totalMinted/totalBurned(domain)`, which re-run `Initializable_assertInitialized()` after the
  public entrypoint already asserted it. Harmless, slight gate cost. Consider an internal
  unchecked lookup helper.
- **INFO-2 (`_mintWithDerivedNonce` lives only at the consumer layer):** The MIP §Extension
  presents `_mintWithDerivedNonce` as a circuit the extension "adds." The extension module
  actually exposes only `_deriveNonce` (a building block) + `initialize`; the named
  `_mintWithDerivedNonce` circuit exists only in the mocks/presets via composition. This is a
  deliberate design choice (composition over a bundled circuit) and is fine, but the MIP wording
  implies the extension itself exports the circuit. See Artifact Drift.
- **INFO-3 (`disclose` granularity):** Burn paths `disclose(coin)` (whole struct). Acceptable —
  every field (nonce, color, value) is required public by the coin primitives, so this is not
  broad-taint laundering. No change needed; noted for completeness.
- **INFO-4 (block-limit fit for combined surfaces):** `_burn` is large (k=16, rows≈47786) and
  `_mint` (k=14, rows≈11090). A composite test/preset that wires derived-nonce + base mint +
  both burns may approach the local node's per-tx block limit (PR #489's `TestTokenV1` explicitly
  prunes surface "for block-limit fit on the local node"). Plan integration mocks accordingly.

## Security Checklist Results

| Category | Result | Notes |
|----------|--------|-------|
| 3.1 Privacy & Disclosure | ⚠️ Partial | `disclose` sites are leaf-appropriate and compiler-forced. Core recipient-privacy claim is **unverified in-suite** (HIGH-1). `refundTo` disclosed (refund recipient public) — document it. |
| 3.2 Circuit Soundness | ⚠️ Partial | Monetary values use bounded `Uint` (good). **Hard reliance on proof-loop semantics** for spend paths, coin conservation, transient-vs-Merkle correctness — none verifiable under `--skip-zk` (MED-1, INV-9). `compactc` itself is unaudited; the `pad` overflow (CRIT-1) is a compiler-surface footgun caught only by building. |
| 3.3 Authorization & Replay | ✅ (with caveat) | No `msg.sender`/`ownPublicKey()` auth. Modules unrestricted by design; presets gate (Ownable/AccessControl). Derived-nonce griefing (pre-mint a colliding commitment) is documented and accepted; gate both mint paths. |
| 3.4 State Management & Integrity | ✅ | `Counter` for the nonce chain; sealed metadata; `assertInitialized` everywhere; constructor establishes seed/metadata. No Merkle-root-staleness surface in these modules (membership is handled by the protocol primitives, not a contract `MerkleTree` field). |
| 3.5 Economic Security | ⚠️ Partial | Unrestricted module mint/burn is by design but is an infinite-mint / treasury-drain footgun if a consumer forgets to gate (MIP §Security Considerations). Supply counters are honest bounds, not exact — correct. |
| 3.6 Composability | ✅ | No cross-contract calls. No Solidity-style reentrancy. TOCTOU between prove-time and inclusion-time exists for burns (coin spent under you) — the protocol rejects the conflicting tx; the dApp must handle the optimistic-fail/reprove loop (document for integrators). |
| 3.7 Upgradeability (CMA / VK) | ◐ Not in module scope | These modules carry no CMA logic. The MIP's forward-compat story (add phase-2 circuits via CMA VK rotation, fixed ledger layout) is exactly what PR #489's CMA harness can exercise — see the testing plan. Single-key CMA caution applies to consumers, not the modules. |

## Test Coverage Assessment

- **Current state: zero runnable coverage for these modules.** No `NativeShieldedTokenSimulator.ts`,
  no `NativeShieldedToken*.test.ts`, no compiled mocks (the stale `MockNativeShieldedToken`
  artifact predates the source). Until CRIT-1 is fixed, nothing builds, so nothing can run.
- **Proof-loop coverage is mandatory here, not optional.** The defining behaviors of this
  standard — correct spend path (transient vs Merkle), wrong-color burn rejection that the
  protocol receive does NOT enforce, recipient privacy, lost-coin / out-of-band delivery, supply
  bounds vs bypass burns — are precisely the things a `--skip-zk` simulator cannot prove. The
  unit layer can pin accounting arithmetic and revert guards; everything else needs the local
  infra (PR #489).
- **Privacy invariants must assert against the resulting ledger/indexer output, not the witness
  input** (HIGH-1). The recipient-privacy test must read the indexer, not the call arguments.
- **Authorization tests** belong at the preset layer (Ownable/AccessControl): "wrong caller ⇒
  reject" on the proof loop.
- See `NativeShieldedToken-testing-plan.md` for the full unit + integration plan and the
  invariant → test coverage matrix.

## Artifact Drift

Drift between the MIP (spec) and the source. Documentation sync, not security findings.

- **Artifact:** `mip-xxxx-native-shielded-token.md` (lines 278, 437) → **Stale:** nonce tag
  `"NativeShieldedToken:nonce"` → **Current:** code uses `"NativeShieldedTokenDerivedNonce:nonce"`
  → **Suggested update:** the MIP tag is the correct one (it compiles); fix the code to match the
  MIP (also resolves CRIT-1), and keep the MIP as the source of truth.
- **Artifact:** MIP §"Extension: Derived-Nonce Minting" (lines 257–267) → **Stale:** presents
  `_mintWithDerivedNonce(domain, recipient, amount)` as a circuit the extension adds → **Current:**
  the extension exports `_deriveNonce()`; `_mintWithDerivedNonce` exists only in mocks/presets via
  composition → **Suggested update:** reword the MIP to describe `_deriveNonce` as the building
  block and `_mintWithDerivedNonce` as the composed consumer circuit (the mock demonstrates it).
- **Artifact:** MIP §Dependencies (line 550) → **Stale:** "Compact language version >= 0.21.0"
  → **Current:** repo standard is `>= 0.23.0` / toolchain 0.31.0 → **Suggested update:** bump the
  MIP and the source pragmas (MED-2).
- **Artifact:** MIP §Implementation (line 542) and §Testing → **Stale:** implies simulators +
  Vitest suites exist → **Current:** mocks now compile (both, with full ZK keys), but there are
  no simulators or tests yet → **Suggested update:** none to the MIP (it describes the target
  state); tracked as the work in the testing plan.
- **Artifact:** MIP §Out of Scope (lines 340–341) and the module `# Composition` note →
  **Stale:** both justify "dual-representation MUST use the Family profiles" partly via "the
  shared `Initializable` flag allows only one `initialize` call per contract" → **Current:** the
  modules were migrated off `Initializable` to per-module inline `_isInitialized` (the #562
  convention, 2026-06-19), so that specific blocker no longer exists. The module doc note was
  corrected; **the MIP still needs updating** → **Suggested update:** re-justify the Family-profile
  requirement on the remaining grounds (single sealed `_domain` / converter composes Family
  profiles), and drop the shared-init-flag argument. **Decision for the dev** — this may also
  reopen whether two Fungible profiles can now coexist in one contract.

## Extension Mode: Compatibility Check

- These are **new** modules added under `contracts/src/token/`. They do not modify
  `FungibleToken`, `MultiToken`, `NonFungibleToken`, or shared modules (`Initializable`, `Utils`,
  `Ownable`, `AccessControl`). No existing API or invariant is changed.
- The only cross-cutting risk is the `pad(32, …)` footgun (CRIT-1), which is contained to the
  new files; it does not affect existing modules.
- Composition note (MIP §Out of Scope): a single contract can hold only one `Initializable` flag,
  so the Fungible profile cannot be composed with `NativeUnshieldedToken` in one contract.
  Dual-representation tokens must use the Family profiles. This is correctly documented in the
  module headers.

## Recommendation

- **Overall verdict:** Needs fixes — **CRIT-1 now cleared; remaining items are verification, not blockers.**
- **Blocking (must fix before any test run or merge):**
  - ~~**CRIT-1**~~ — **DONE (2026-06-19):** tag shortened to `"NativeShieldedToken:nonce"`; the 3
    contracts + both mocks compile on 0.31.0; `artifacts/` regenerated. No build blockers remain.
- **Required before MIP advances to Active:**
  - **HIGH-1** — pin the recipient-privacy claim with an integration test against the live indexer.
  - Build the unit + integration suites per the testing plan; the proof-loop tests are mandatory.
- **Recommended (non-blocking):**
  - MED-1 (document/guard the `burned ≤ minted` dependency), MED-2 (pragma → 0.23.0),
    MED-3 (integration toolchain → 0.31.0), INFO-1..4.

## Out of Scope

- **TS witness implementations / third-party crypto libraries** — these modules declare no
  witnesses; the presets rely on `Ownable`/`AccessControl` witnesses, whose auditing is outside
  this pass.
- **`FungibleToken`, `MultiToken`, `NonFungibleToken`, `Initializable`, `Utils`, `Ownable`,
  `AccessControl`** internals — reviewed only at the composition boundary, not line-by-line.
- **The Compact compiler / `midnight-ledger` / Zswap protocol** — assumed correct but unaudited
  (mainnet has no third-party audit of `compactc`); flagged where the modules depend on
  edge-case primitive behavior.
- **The companion MIPs** (`NativeUnshieldedToken`, `NativeTokenConverter`) — referenced only for
  composition constraints.

## Dev Notes

- The base-module logic is in good shape; the blocker is mechanical. Fixing the nonce tag to the
  MIP's value kills two birds (CRIT-1 + the drift).
- The standout property of this work is that its *interesting* invariants are all protocol-level
  (spend paths, color, privacy, conservation), so the value of this review converges with the
  value of the integration suite: the local infra is where this standard is actually proven safe.

## Open Questions

1. Is the recipient-private mint actually private on the live indexer (HIGH-1)? Highest-priority
   thing to confirm. The cited study says yes; pin it here.
2. Counter delta semantics for N-SU CMA bundles (PR #489 Q11) — relevant when wiring the
   forward-compat upgrade specs for a deployed token; not blocking for the base standard.
3. Does a combined derived-nonce + base-mint + dual-burn test contract fit the local node block
   limit, or must integration mocks split the surface (INFO-4)?
4. Confirm 0.23.0 is the agreed pragma floor (MED-2) before bumping the MIP.
