# ElGamalDeltaInbox — design doc

> **Status:** draft (2026-07-24), destination Notion. Module: [`utils/concurrency/ElGamalDeltaInbox.compact`](../ElGamalDeltaInbox.compact). Conflict-model background: repo-root [`concurrency.md`](../../../../../concurrency.md) (§8.1 the hotspot, §9.2 the pattern). Sibling: [`uint-delta-inbox.md`](./uint-delta-inbox.md) (same architecture, plaintext payload).

## 1. Summary

A **pending-delta inbox for exponential-ElGamal accumulators** — encrypted supplies and encrypted balances. Writers blind-insert *ciphertext* deltas keyed by their own randomness (commutes with everything); a fold drains up to 8 entries and returns their homomorphic sum for the consumer to absorb into its accumulator ciphertext. Burns push a **negated encryption**, so signed semantics live in the exponent: one `ElGamal_add` folds mints and burns alike, and a pending entry does not reveal its direction. A per-domain `Counter` backlog plus `_assertEmpty` make a checkpoint fold provably complete — the required prelude to an exact supply attestation.

## 2. Motivation

An encrypted accumulator is the *worst* pinning case: the homomorphic update is elliptic-curve math, which cannot run in the Impact VM, so the old ciphertext must be read into the circuit — pinned — on **every** update. In the note token's `PrivateSupply`, every mint/burn is `_encSupply = add/sub(_encSupply, …)`: all mints and burns mutually conflict, one landing per retry cycle. The account-model `ConfidentialFungibleToken` has the same shape per recipient balance cell (its design doc names the pull-inbox as the v2 direction — this module is that mechanism). The inbox removes the ciphertext read from the hot path; only the fold touches the accumulator.

## 3. Specification

```typescript
/** Pending ciphertext deltas, keyed by entryKeyOf(domain, id). */
export ledger _pending: Map<Bytes<32>, ElGamal_Ciphertext>;
/** Per-domain backlog counts (relative Counter ops — pin nothing). */
export ledger _pendingCounts: Map<Bytes<32>, Counter>;

/** Up to 8 pending ids to drain; zero = empty slot. */
witness wit_ElGamalInboxPendingIds(domain: Bytes<32>): Vector<8, Bytes<32>>;

export pure circuit entryKeyOf(domain: Bytes<32>, id: Bytes<32>): Bytes<32>;

/**
 * @description Records a pending ciphertext delta (already encrypted to the
 * accumulator's key; negate for subtractions). Commutes with everything.
 */
export circuit _credit(domain: Bytes<32>, id: Bytes<32>, delta: ElGamal_Ciphertext): [];

/**
 * @description Drains up to 8 witness-chosen entries; returns their
 * homomorphic sum (Enc(0) if all slots empty). Conflicts only with another
 * consume.
 */
export circuit _consume(domain: Bytes<32>): ElGamal_Ciphertext;

/** @description Completeness checkpoint: proves the domain's inbox is empty. */
export circuit _assertEmpty(domain: Bytes<32>): [];
```

## 4. Example flow — the shipped consumer

`token/extensions/ConfidentialNoteFungibleTokenConcurrentSupply` (with the `ConcurrentConfidentialNoteFungibleToken` demo preset) wires it end to end:

```typescript
// hot path: per mint / per burn — commutes with everything
export circuit _addMinted(value: Uint<128>): [] {
  const seed = wit_ConcurrentSupplyRandomness();
  const r = ElGamal_expandRandomness(seed, pad(32, "OZ:cnt:csupply:add"));
  Inbox__credit(supplyDomain(), creditIdOf(seed, ...), ElGamal_encrypt(_supplyKey, value, r));
}
export circuit _addBurned(value: Uint<128>): [] {
  // NEGATED encryption: nets as a subtraction in the exponent
  Inbox__credit(supplyDomain(), ..., ElGamal_negate(ElGamal_encrypt(_supplyKey, value, r)));
}

// cold path: permissionless folder
export circuit _foldSupply(): [] {
  _encSupply = disclose(ElGamal_add(_encSupply, Inbox__consume(supplyDomain())));
}

// checkpoint: the attested total PROVABLY includes every mint and burn
export circuit attestSupply(total: Uint<128>): [] {
  Inbox__assertEmpty(supplyDomain());
  ElGamal_assertDecryptsTo(_encSupply, _supplyKey, wit_ConcurrentSupplyKeySecret(), total);
  _attestedSupply = disclose(total);
}
```

Worked example (burn-heavy batch): folded supply `Enc(500)`; eight entries land concurrently — mints +50, +30 and burns −100, −40, −60, −20, −80, −10. All commute. One fold: `Enc(500 + 80 − 310) = Enc(270)`; attest → 270. Draining a burn *before* its offsetting mint leaves a transient `Enc(negative)` — a valid group element, order-insensitive, and **unattestable** until the mint folds (`_assertEmpty` blocks while it is pending), so the transient state is unobservable through any proof-backed output.

## 5. When to use it

| Use case | Why it fits |
| --- | --- |
| Confidential supply under concurrent mint/burn (note token) | shipped: mint 27.5k / burn 41k rows, mutually commuting |
| Encrypted per-account credit inboxes (CFT v2 "pull-inbox" direction) | recipient folds own inbox on next spend; kills the inbound-payment hotspot |
| Any Enc-under-one-key running total with many writers | deltas are order-independent in the exponent group |

## 6. When NOT to use it

| Anti-case | Why it fails |
| --- | --- |
| **AMM reserves / swaps** | swap output = f(reserves): order sets price, swaps don't commute semantically; the fix is a batch auction, not an inbox (`concurrency.md` §8.5) |
| Deltas computed from the accumulator's current value | reading it re-pins the hot path |
| Aggregating deltas under different keys | homomorphic sum only decrypts if every delta shares the accumulator's key — the inbox cannot check this; the consumer's emission chokepoint owns it |
| Public totals | use `UintDeltaInbox` — same guarantees, cheaper, no discrete-log bound |
| Debit-side balance checks | a spend needs the current plaintext balance in-circuit; inboxes defer credits, never debits |
| Values outside the discrete-log recovery range | lifted ElGamal is only readable for bounded totals; a mis-wired net below zero is permanently unattestable |

## 7. Trust model & security considerations

- Fold witness: chooses WHICH entries; ciphertexts come from the ledger; can't invent/alter/double-count. Skipping = liveness only — public, measurable (`_pendingCounts`), and provable-absent at checkpoints (`_assertEmpty`). Folding is safely permissionless.
- **Same-key discipline** is the load-bearing consumer obligation (see `crypto/ElGamal.add`): one foreign-key delta makes the folded ciphertext undecryptable under any key.
- **Randomness**: `id` and encryption randomness derive from one fresh witness seed per credit; a repeated seed leaks plaintext relations AND collides the id (credit rejected).
- Checkpoint barrier is inherent: `_assertEmpty` pins the count, so exact attestations serialize against credits — fold-to-empty in a quiet moment, then attest.
- Mis-wiring (a credit without the matching token op) permanently corrupts the accumulator — same class as PrivateSupply's warning; pair 1:1 in one circuit.

## 8. Costs (measured, compiler 0.31.1)

| Circuit | k | rows |
| --- | --- | --- |
| `_credit` (bare; caller's `encrypt` ≈ +2.4k, `negate` ≈ +1.1k) | 13 | 4 598 |
| `_consume` (8 slots) | 16 | 39 757 |
| `_assertEmpty` | 9 | 343 |

Consumer-level (Concurrent preset): mint 27 464, burn 40 945, `foldSupply` 39 462, `attestSupply` 4 694 — vs. the Regulated preset where every mint∥mint is a certain rejection.

## 9. Risks & open questions

- **P2 — attestation freshness**: an attest only speaks for its serialization point; between checkpoints the public total is stale by the (visible) backlog.
- **P2 — fixed batch size (8)** / **P3 — id discipline**: as in the Uint sibling.
- **P3 — direction privacy**: entries hide mint-vs-burn, but transaction *shape* (which circuit ran) may still distinguish them at the consumer level.

## 10. Implementation status

| Component | Status |
| --- | --- |
| Module | implemented; skip-zk + full keygen verified |
| First consumer | `…ConcurrentSupply` extension + `ConcurrentConfidentialNoteFungibleToken` demo preset (PrivateSupply untouched) |
| Tests / simulator | not yet (design phase) |
| Audit | not started; DRAFT, not production |
