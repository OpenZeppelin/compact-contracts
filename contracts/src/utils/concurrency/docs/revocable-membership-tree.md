# RevocableMembershipTree — design doc

> **Status:** draft (2026-07-24), destination Notion. Module: [`utils/concurrency/RevocableMembershipTree.compact`](../RevocableMembershipTree.compact). Conflict-model background: repo-root [`concurrency.md`](../../../../../concurrency.md) (§5.3 the two `checkRoot`s, §9.4 the pattern).

## 1. Summary

A **ZK membership set whose additions never invalidate in-flight proofs, while removals still revoke instantly**. Membership is proven against a `HistoricMerkleTree`'s root *history*; `_add` appends (old roots stay valid), and `_removeAt` tombstones the leaf **then calls `resetHistory()`**, so only the post-removal root verifies and every stale proof dies at once. It composes the two tree semantics deliberately, where each is wanted.

## 2. Motivation

A membership check a hidden party proves in-circuit (a KYC allowlist at a spend chokepoint) pins a boolean derived from the tree root. The two stock trees each get one half right:

- **Plain `MerkleTree`**: `checkRoot` pins `currentRoot == r` — ANY write changes the root, so **every admin add aborts every in-flight member proof**. Onboarding one user rejects every KYC-proven spend in flight. Revocation, however, is instant.
- **Bare `HistoricMerkleTree`**: `checkRoot` pins `r ∈ history`, and inserts only append — in-flight proofs survive adds. But a *removed* member's old proofs also survive: history keeps every root they were valid under. No revocation.

The note token's Allowlist extension currently uses the plain tree and inherits the liveness coupling (its doc flags it). This module is the replacement shape.

## 3. Specification

```typescript
/** Membership leaves. Historic on purpose: proofs verify against any root
 *  recorded since the last removal/reset. */
export ledger _members: HistoricMerkleTree<16, Bytes<32>>;

/** The prover's own membership path (fetched from the public tree). */
witness wit_RevocableMembershipPath(leaf: Bytes<32>): MerkleTreePath<16, Bytes<32>>;

/**
 * @description Adds a member leaf. Appends to root history: proofs built
 * before this add KEEP verifying — concurrent with every in-flight
 * _assertMember. Composer gates admin.
 */
export circuit _add(leaf: Bytes<32>): [];

/**
 * @description Removes the leaf at `index` (default-leaf tombstone), then
 * RESETS the root history — every outstanding proof, including the removed
 * member's, is invalidated immediately. That abort IS the feature.
 */
export circuit _removeAt(index: Uint<64>): [];

/**
 * @description Proves `leaf` is in the tree without revealing which
 * position. Survives concurrent _add; dies on any removal/reset since the
 * prover fetched their path.
 */
export circuit _assertMember(leaf: Bytes<32>): [];

/**
 * @description Maintenance valve: prunes history to the current root only.
 * Invalidates every in-flight proof — gate it, announce it, schedule it.
 */
export circuit _resetHistory(): [];
```

Leaf derivation stays consumer-side (identity commitments are domain business); tree depth is fixed at 16 (~65k members) because module state is a per-file singleton and cannot be depth-parameterized per consumer.

## 4. Example flow

```typescript
// consumer's leaf policy (salt if dictionary-testing the set matters)
export pure circuit leafOf(pk: Field): Bytes<32> { return persistentHash<...>(...); }

// admin (composer-gated)
export circuit addAllowed(pk: Field): []   { Members__add(leafOf(pk)); }
export circuit removeAllowed(index: Uint<64>): [] { Members__removeAt(index); }

// spend chokepoint: hidden spender proves membership
export circuit transfer(recipientPk: Field, ...): [] {
  Members__assertMember(leafOf(Core__spenderPk()));
  Members__assertMember(leafOf(recipientPk));
  // ...
}
```

Timeline: ten users' transfers are in flight when the admin onboards an eleventh — all ten land (the old root is still in history). Later the admin removes a sanctioned member — history resets, the removed member's (and everyone's) outstanding proofs abort, users re-fetch paths once, and the removed member can never prove again. One-time churn exactly when churn is the point.

## 5. When to use it

| Use case | Why it fits |
| --- | --- |
| KYC allowlists proven at spend time by hidden parties | adds stop hurting user liveness; removals keep instant-revocation semantics |
| Role registries proven in ZK ("some approved reviewer/relayer", never which) | same add-heavy, remove-rare churn profile |
| Any in-circuit membership where additions vastly outnumber removals | the reset cost is paid only on the rare event that *should* be disruptive |

## 6. When NOT to use it

| Anti-case | Why it fails |
| --- | --- |
| Membership checked on **disclosed** identities | a plain `Set.member` is cheaper and per-key concurrent; ZK trees are for HIDDEN provers |
| **Deny-lists / exclusion sets** | this proves membership, not non-membership; exclusion is a different structure (per-key `Set` pins like the Freeze extension, or a sparse-tree non-inclusion design) |
| Remove-heavy sets | every removal is a global proof-invalidation event plus a wallet path-refetch storm; at high removal rates the set is effectively a plain tree |
| Sets larger than ~65k | depth is fixed at 16 (module-state singleton; no per-consumer generic) |
| **AMM-style order-dependent state** | not a membership problem at all; see `concurrency.md` §8.5 |

## 7. Trust model & security considerations

- **Index-bookkeeping trust**: `_removeAt` trusts the composer's off-chain index for which leaf to tombstone. Fail-closed hardening — proving in-circuit that the leaf at `index` matches the member being removed — is a known follow-up (shared with the token allowlist).
- **Unsalted leaves are dictionary-testable**: anyone holding a candidate identity can test membership against public inserts. Spend-time anonymity within the set is unaffected; salting is the consumer's call in `leafOf`.
- **History growth between removals** is unbounded (contract trees get no protocol pruning); `_resetHistory` is the valve, and it is deliberately disruptive — an announced operational window, never routine hygiene.
- Removal takes effect at *landing* order: an in-flight spend racing the removal is decided by the sequencer; the pin guarantees the loser fails rather than sneaking through.

## 8. Costs (measured, compiler 0.31.1)

| Circuit | k | rows |
| --- | --- | --- |
| `_add` | 13 | 2 299 |
| `_removeAt` | 13 | 2 086 |
| `_assertMember` | 13 | 3 063 |
| `_resetHistory` | 5 | 24 |

## 9. Risks & open questions

- **P2 — path-refetch UX after removals**: every wallet must re-fetch its path; indexer support and a "your proof went stale" error path are wallet-side work.
- **P2 — re-wiring the token Allowlist**: the note token's Allowlist extension should migrate to this module (its plain tree has the add-vs-spend liveness coupling); queued in the token doc's TODO.
- **P3 — depth parameterization**: a generic depth needs per-instantiation module state, which Compact does not offer; revisit if the platform adds it.

## 10. Implementation status

| Component | Status |
| --- | --- |
| Module | implemented; skip-zk + full keygen verified |
| Tests / consumer migration (token Allowlist) | not yet (design phase) |
| Audit | not started; DRAFT, not production |
