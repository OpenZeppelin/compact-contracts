---
stage: review
project: allowlist
mode: greenfield
extends: null
status: draft
timestamp: 2026-06-26
author: claude (midnight-basic-review)
previous_stage: null
tags: [security, permit-list, membership, public-ledger, compact-contracts, pr-625]
---

# Allowlist — Basic Review Report

## Summary

PR #625 adds `security/Allowlist.compact`: a minimal public permit-list keyed by an abstract
`Bytes<32>` account, the mirror of the sibling `Blocklist` (#626). One ledger `Set`, two views
(`isAllowed`, `assertAllowed`), two ungated mutators (`_allow`, `_disallow`). No witnesses, no
private state, no authorization (intentionally a mechanism, not a policy).

- **Findings:** 0 Critical, 0 High, 0 Medium, 3 Informational.
- **Overall:** Ready. The code is correct, idiomatic, well-documented, and a clean mirror of
  `Blocklist`. No code defects.
- **Privacy-claim verdict:** **Supported.** Stated posture is *public / transparent* (membership
  publicly readable, set publicly enumerable). Every `disclose(...)` is wrapped at the leaf account
  value; the doc steers graph-private assets to a shielded allowlist.
- **Note vs the sibling:** Allowlist is **fail-closed** (an empty set rejects everyone — the safe
  default), where Blocklist is fail-open. The doc here is also slightly more complete than
  Blocklist's: it already gives the "enforce only while an eligibility-required flag is set"
  example. So the Blocklist MED-1 (fail-open security note) has no equivalent-severity analog here;
  the fail-closed consequence is a liveness/lockout note (INFO-1), not a bypass risk.

## Invariant Verification

Standalone review — invariants inferred from the code and tests.

| Invariant | Property | Enforced? | Location | Notes |
|-----------|----------|-----------|----------|-------|
| INV-1 | `isAllowed(a)` ⇔ `a ∈ _allowed` | ✅ | `Allowlist.compact:50` | `Set.member` |
| INV-2 | `assertAllowed(a)` succeeds ⇔ `a ∈ _allowed` | ✅ | `:71` | assert |
| INV-3 | after `_allow(a)`, `a ∈ _allowed` | ✅ | `:87` | `Set.insert` |
| INV-4 | `_allow` idempotent (allowing twice = allowed once) | ✅ | `:87` | Set semantics; tested |
| INV-5 | after `_disallow(a)`, `a ∉ _allowed` regardless of prior allow count | ✅ | `:99` | binary membership; tested |
| INV-6 | `_disallow` on a non-member is a no-op (no throw) | ✅ | `:99` | `Set.remove`; tested |
| INV-7 | ops on account A never affect account B | ✅ | `:87,:99` | set isolation; tested |
| INV-8 | default/constructor state is empty (nobody allowed; `assertAllowed` throws for all) | ✅ | `:35` | tested |
| INV-9 | every value crossing into `_allowed` is `disclose`-wrapped at the leaf | ✅ | `:50,:87,:99` | minimal wraps |
| INV-10 | mutators carry no in-module access control (ungated by design) | ✅ (intentional) | `:86,:98` | composition obligation |

All inferred invariants are enforced. INV-10 is a deliberate design property.

## Findings

### Critical
None.

### High
None.

### Medium
None. (Allowlist is fail-closed — the safe default. The default-state consequence is a
liveness/lockout note, filed Informational as INFO-1, not the Medium that the fail-open Blocklist
warranted.)

### Informational

#### INFO-1: Fail-closed lockout consequence is implied, not stated

**Location:** `Allowlist.compact:11-19` (the mechanism-vs-policy doc paragraph)

An allowlist is fail-closed: an empty set rejects everyone. If a composing contract enforces
`assertAllowed` unconditionally before the set is populated, it bricks access for all accounts —
potentially including the operator who needs to add members. The doc already mitigates this well by
recommending enforcement "only while an 'eligibility required' flag is set," so this is a small
polish, not a gap: one explicit sentence on the empty-set-locks-everyone-out consequence (and that
the operator must populate and/or gate enforcement first) would complete it. Fails safe, so lower
severity than the inverse note on Blocklist.

#### INFO-2: Disclosure caveat lives only at module level, not on the circuits that disclose

**Location:** `Allowlist.compact:49` (`isAllowed`), `:70` (`assertAllowed`)

`isAllowed` and `assertAllowed` both `disclose(account)`. The privacy posture is documented in the
module `@notice`, but a consumer reading only a circuit's generated API-ref entry sees
`@param account` with no hint that calling it reveals the account publicly. Correct for a public
allowlist, but a dev composing it into an otherwise-private contract could leak an identifier they
assumed stayed private. Suggest a one-line `@notice`/`@dev` on `isAllowed` (inherited by
`assertAllowed`): "Discloses `account` to the public transcript." (Identical to the Blocklist note.)

#### INFO-3: Module placement — `security/` vs `accesscontrol/`

**Location:** `contracts/src/security/Allowlist.compact`

PR #625's own body flags this as an open author opinion ("there is an argument that this belongs in
`accesscontrol/`"). Surfacing it so the decision is made deliberately and consistently for both
Allowlist and Blocklist. Non-blocking. (See Open Questions.)

## Security Checklist Results

- **Privacy & Disclosure** — Pass. Every `disclose` is at the leaf account; no broad wraps; public
  exposure matches the documented posture. INFO-2 is a doc-surface nicety, not a leak.
- **Circuit Soundness** — Pass. No arithmetic, no `Field`/`Uint` wrap surface. All circuits are
  straight `Set` ops. `pure circuit` is not applicable (every circuit reads/writes the ledger).
- **Authorization & Replay** — N/A by design. No `msg.sender`; mutators are ungated internal
  primitives. No nullifiers / commitments.
- **State Management & Integrity** — Pass. `Set` membership is binary and order-independent;
  idempotent insert and no-op remove are tested.
- **Economic Security** — Pass. `@circuitInfo` shows constant ~303–305 rows (Merkle-backed set,
  not O(n)); no unbounded in-circuit loop. Ledger state grows with the allowlist size, inherent and
  expected.
- **Composability** — Pass. TOCTOU between `_disallow` and a member's own tx is the standard
  on-chain race (resolves at inclusion time); inherent, not a defect.
- **Upgradeability (CMA / VK)** — N/A. No upgrade surface in the module itself.

## Test Coverage Assessment

Strong for the primitive, and a clean mirror of the Blocklist suite. Covers: empty default
(rejects all), allow, idempotent double-allow, disallow, no-op disallow on non-member,
allow→disallow→allow, multi-account isolation, and direct `getPublicState` ledger wiring. Maps
cleanly onto INV-1…INV-8. No witness-substitution tests, but there are no witnesses and no
authorization to substitute. The compact-contracts simulator is dual-backend (mock + live local
infra), so the real prover path can be exercised via the live backend — not a coverage gap to flag.

Incremental gaps worth closing (all low-priority; filed as test followups TC-1…TC-4, mirror of the
Blocklist set):

- **TC-1 — disallow not asserted against the raw ledger.** The `simulator wiring` test asserts an
  `allow` *appears* in `Allowlist__allowed`, but never asserts a `disallow` *removes* it. Close the
  asymmetry; indexers subscribe to that field.
- **TC-2 — all-zero `Bytes<32>` account.** No test pins that the zero account is an ordinary member
  with no implicit sentinel exemption.
- **TC-3 — `assertAllowed` after a single disallow of a multiply-allowed account.** The
  allow→allow→disallow case is asserted only via `isAllowed`; the check seam (`assertAllowed`
  throwing) isn't exercised on that path.
- **TC-4 — `isAllowed` has no write side-effect.** Assert the raw ledger is unchanged after an
  `isAllowed` call.

Composition-level coverage (gating, enforcement timing) belongs to consumers, not this PR.

## Artifact Drift
None (standalone review; no prior pipeline artifacts).

## Extension Mode: Compatibility Check
N/A — new standalone module; no existing circuits modified. CHANGELOG entry present.

## Recommendation

- **Overall verdict:** Ready for deploying (as a library primitive).
- **Blocking issues:** None.
- **Suggested improvements:** INFO-1…INFO-3 are optional polish; INFO-2 (disclosure note) and the
  TC followups are the most worthwhile, and should be applied consistently with Blocklist.

## Out of Scope
- The composing/consumer contracts that will gate and enforce this list — not part of this PR.
- The `security/` vs `accesscontrol/` repo-organization decision (raised, not adjudicated here).
- The sibling `Blocklist` (#626) beyond parity comparison.
- `@openzeppelin/compact-simulator` internals (experimental, unaudited — assumed as given).

## Dev Notes
Allowlist and Blocklist are mirror modules: same shape, same docs, inverted predicate and error
message. Review focused on the one place the mirror matters — fail-closed vs fail-open default —
plus disclosure-surface and parity. The Allowlist doc is marginally more complete than Blocklist's
(it includes the eligibility-flag enforcement example); worth back-porting that clause to Blocklist.

## Open Questions
- Placement: is `security/` final, or should both Allowlist and Blocklist live under
  `accesscontrol/`? (#625 flags this; decide once for both.)
- Should the module ship a thin "enforced" wrapper that pairs `assertAllowed` with the
  eligibility-required flag the doc describes, or is leaving that entirely to consumers the intent?
