---
stage: review
project: blocklist
mode: greenfield
extends: null
status: draft
timestamp: 2026-06-26
author: claude (midnight-basic-review)
previous_stage: null
tags: [security, deny-list, membership, public-ledger, compact-contracts, pr-626]
---

# Blocklist — Basic Review Report

## Summary

PR #626 adds `security/Blocklist.compact`: a minimal public deny-list keyed by an abstract
`Bytes<32>` account, the inverse mirror of the sibling `Allowlist` (#625). One ledger `Set`,
two views (`isBlocked`, `assertNotBlocked`), two ungated mutators (`_block`, `_unblock`). No
witnesses, no private state, no authorization (intentionally a mechanism, not a policy).

- **Findings:** 0 Critical, 0 High, 1 Medium, 2 Informational.
- **Overall:** Ready. The code is correct, idiomatic, and well-documented. The only substantive
  item is a documentation/guidance gap, not a code defect.
- **Privacy-claim verdict:** **Supported.** The module's stated posture is *public / transparent*
  (membership publicly readable, set publicly enumerable). Every `disclose(...)` is wrapped at the
  leaf account value, and the public exposure is exactly what the `@notice` promises. The doc
  explicitly steers graph-private assets to a shielded blocklist instead.

## Invariant Verification

Standalone review — invariants inferred from the code and tests.

| Invariant | Property | Enforced? | Location | Notes |
|-----------|----------|-----------|----------|-------|
| INV-1 | `isBlocked(a)` ⇔ `a ∈ _blocked` | ✅ | `Blocklist.compact:48` | `Set.member` |
| INV-2 | `assertNotBlocked(a)` succeeds ⇔ `a ∉ _blocked` | ✅ | `:69` | negated assert |
| INV-3 | after `_block(a)`, `a ∈ _blocked` | ✅ | `:85` | `Set.insert` |
| INV-4 | `_block` idempotent (blocking twice = blocked once) | ✅ | `:85` | Set semantics; tested |
| INV-5 | after `_unblock(a)`, `a ∉ _blocked` regardless of prior block count | ✅ | `:97` | binary membership; tested |
| INV-6 | `_unblock` on a non-member is a no-op (no throw) | ✅ | `:97` | `Set.remove`; tested |
| INV-7 | ops on account A never affect account B | ✅ | `:85,:97` | set isolation; tested |
| INV-8 | default/constructor state is empty (nobody blocked) | ✅ | `:33` | tested |
| INV-9 | every value crossing into `_blocked` is `disclose`-wrapped at the leaf | ✅ | `:48,:85,:97` | minimal wraps |
| INV-10 | mutators carry no in-module access control (ungated by design) | ✅ (intentional) | `:84,:96` | composition obligation, see MED-1 |

All inferred invariants are enforced. INV-10 is a deliberate design property, not a gap.

## Findings

### Critical
None.

### High
None.

### Medium

#### MED-1: Fail-open default and the composition burden are not framed as a security obligation

**Location:** `Blocklist.compact:11-17` (the mechanism-vs-policy doc paragraph)

**Issue:** Unlike `Allowlist` (fail-*closed*: an empty set rejects everyone until explicitly
added), `Blocklist` is fail-*open*: an empty set permits everyone until explicitly added. The
security of a deny-list therefore rests entirely on the composing contract doing two things
correctly: (a) gating `_block` / `_unblock` behind access control, and (b) calling
`assertNotBlocked` on **every** guarded path. A single missed path silently lets a blocked /
sanctioned account through, and nothing in-module signals that enforcement was wired. The doc
explains the mechanism/policy split well, but never spells out the fail-open consequence as a
security obligation.

**Impact:** A careless consumer (forgets one entry point, or forgets to gate a mutator) gets a
deny-list that quietly does nothing, or one anyone can edit. For a `_mint`-style primitive the
blast radius is funds; for a sanctions/freeze control it is a compliance/safety bypass.

**Recommendation:** Add a short "Security note" to the module doc making the obligation explicit,
e.g.:

```compact
/**
 * @notice SECURITY: this list is fail-open. An account is permitted unless it is
 * explicitly blocked AND `assertNotBlocked` is called on the path. The composing
 * contract MUST (1) gate `_block` / `_unblock` behind access control, and
 * (2) call `assertNotBlocked` on every path that must exclude blocked accounts.
 * A missed path silently permits a blocked account.
 */
```

**Status:** Open. Doc-only; non-blocking. The primitive itself is correctly implemented and the
underscore-prefix ungated convention matches the rest of the library.

### Informational

#### INFO-1: Disclosure caveat lives only at module level, not on the circuits that disclose

**Location:** `Blocklist.compact:47` (`isBlocked`), `:68` (`assertNotBlocked`)

`isBlocked` and `assertNotBlocked` both `disclose(account)`. The privacy posture is documented in
the module `@notice`, but a consumer reading only a circuit's generated API-ref entry sees
`@param account` with no hint that calling it reveals the account publicly. Correct for a public
blocklist, but a dev composing it into an otherwise-private contract could leak an identifier they
assumed stayed private. Suggest a one-line `@notice`/`@dev` on `isBlocked` (inherited by
`assertNotBlocked`): "Discloses `account` to the public transcript."

#### INFO-2: Module placement — `security/` vs `accesscontrol/`

**Location:** `contracts/src/security/Blocklist.compact`

The sibling PR #625 explicitly flags this as an open author opinion ("there is an argument that
this belongs in `accesscontrol/`"). Surfacing it here so the decision is made deliberately and
consistently for both modules, not by default. Non-blocking. (See also Open Questions.)

## Security Checklist Results

- **Privacy & Disclosure** — Pass. Every `disclose` is at the leaf account; no broad wraps; no
  commitment scheme involved; public exposure matches the documented posture. INFO-1 is a
  doc-surface nicety, not a leak.
- **Circuit Soundness** — Pass. No arithmetic, no `Field`/`Uint` wrap surface. All circuits are
  straight `Set` ops. `pure circuit` is not applicable (every circuit reads/writes the ledger).
- **Authorization & Replay** — N/A by design. No `msg.sender` semantics; mutators are ungated
  internal primitives (MED-1 covers the composition obligation). No nullifiers / commitments.
- **State Management & Integrity** — Pass. `Set` membership is binary and order-independent;
  idempotent insert and no-op remove are tested. No `Counter`/Merkle-root staleness surface.
- **Economic Security** — Pass. `@circuitInfo` shows constant ~303–308 rows (Merkle-backed set,
  not O(n)); no unbounded in-circuit loop. Ledger state grows with the blocklist size, which is
  inherent and expected for a deny-list.
- **Composability** — Pass, with MED-1. TOCTOU between `_block` and a victim's own tx is the
  standard on-chain deny-list race (resolves at inclusion time); inherent, not a defect.
- **Upgradeability (CMA / VK)** — N/A. No upgrade surface in the module itself.

## Test Coverage Assessment

Strong for the primitive. Covers: empty default, block, idempotent double-block, unblock,
no-op unblock on non-member, block→unblock→block, multi-account isolation, and direct
`getPublicState` ledger wiring. Maps cleanly onto INV-1…INV-8. No witness-substitution tests, but
there are no witnesses and no authorization to substitute. The compact-contracts simulator is
dual-backend (mock + live local infra), so the real prover path can be exercised via the live
backend — not a coverage gap to flag.

Incremental gaps worth closing (all low-priority; filed as test followups TC-1…TC-4):

- **TC-1 — unblock not asserted against the raw ledger (INV-5/6 at the output level).** The
  `simulator wiring` test asserts a `block` *appears* in `Blocklist__blocked`, but never asserts an
  `unblock` *removes* it from the raw state. The skill wants state invariants asserted against the
  resulting ledger output, and indexers subscribe to that field — close the asymmetry.
- **TC-2 — all-zero `Bytes<32>` account.** No test pins that the zero account is an ordinary
  member with no implicit sentinel exemption (OZ Solidity treats `address(0)` specially; this
  module does not). Cheap edge-case guard against a future regression that special-cases it.
- **TC-3 — `assertNotBlocked` after a single unblock of a multiply-blocked account.** The
  block→block→unblock case is asserted only via `isBlocked`; the check seam (`assertNotBlocked`)
  isn't exercised on that path.
- **TC-4 — `isBlocked` has no write side-effect.** A query should not mutate the set; assert the
  raw ledger is unchanged after an `isBlocked` call. Paranoid but trivial.

Composition-level coverage (gating, multi-path enforcement) belongs to consumers, not this PR.

## Artifact Drift
None (standalone review; no prior pipeline artifacts).

## Extension Mode: Compatibility Check
N/A — new standalone module; no existing circuits modified. CHANGELOG entry present.

## Recommendation

- **Overall verdict:** Ready for deploying (as a library primitive).
- **Blocking issues:** None.
- **Suggested improvements:** MED-1 (fail-open security note in the module doc) is the one worth
  doing before this is consumed by a real asset; INFO-1…INFO-4 are optional polish.

## Out of Scope
- The composing/consumer contracts that will gate and enforce this list — not part of this PR.
- The `security/` vs `accesscontrol/` repo-organization decision (raised, not adjudicated here).
- The sibling `Allowlist` (#625) beyond parity comparison.
- `@openzeppelin/compact-simulator` internals (experimental, unaudited — assumed as given).

## Dev Notes
Blocklist is a near-exact inverse of Allowlist (#625): same shape, same docs, inverted predicate
and error message. Review focused on the one place the inverse matters — fail-open vs fail-closed
default — plus disclosure-surface and parity.

## Open Questions
- Placement: is `security/` final, or should both Blocklist and Allowlist live under
  `accesscontrol/`? (#625 flags this; decide once for both.)
- Is the fail-open default an intentional, documented contract you want consumers to rely on, or
  should the module ship a thin "enforced" wrapper that pairs `assertNotBlocked` with a flag the
  way the Allowlist doc hints at for its eligibility seam?
