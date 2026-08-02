# UintDeltaInbox — design doc

> **Status:** draft (2026-07-24), destination Notion. Module: [`utils/concurrency/UintDeltaInbox.compact`](../UintDeltaInbox.compact). Conflict-model background: repo-root [`concurrency.md`](../../../../../concurrency.md) (§3–§4 mechanics, §9.2 pattern).

## 1. Summary

A **pending-delta inbox** for plain `Uint<128>` accumulators. It splits a hot read-modify-write cell into *credit* (hot, commutes with everything) and *absorb* (cold, serializes only with itself): writers blind-insert `{add, sub}` deltas into a map keyed by their own fresh randomness; a fold drains up to 8 entries per call and returns the netted sums for the consumer to absorb into its own total. A per-domain `Counter` backlog plus an `_assertEmpty` circuit make the fold **provably complete** — a checkpoint fold demonstrates in-circuit that no entry was skipped.

## 2. Motivation

On Midnight, a transaction ships a fixed transcript; every ledger value the circuit consumed is pinned (`popeq`) and re-checked at replay. `x = x + v` on a shared cell therefore serializes all its writers: two transactions built at `x = 100` both bake "read must equal 100", and the second to land is rejected with `ReadMismatch`. Concrete hotspots in this repo:

- `FungibleToken`: `_totalSupply = _totalSupply + value` and the recipient-balance credit `_balances.insert(to, toBal + value)` — **all inbound payments to one account conflict with each other**.
- `NativeShieldedTokenSupplyCore`: `_totalMinted.insert(domain, current + amount)` — concurrent mints of one color serialize.

The loser pays no fees (guaranteed-segment failure) but must re-prove and wait finality again — under load, a hot cell degrades to one landed write per retry cycle. The inbox removes the shared read from the hot path entirely.

## 3. Specification

```typescript
/** One pending delta. Both directions carried so writers never branch. */
export struct Delta { add: Uint<128>; sub: Uint<128>; }

/** Netted result of one consume batch; consumer applies `acc + add - sub`. */
export struct Net { add: Uint<128>; sub: Uint<128>; }

/** Pending deltas, keyed by entryKeyOf(domain, id). */
export ledger _pending: Map<Bytes<32>, Delta>;
/** Per-domain backlog counts (relative Counter ops — maintaining them pins nothing). */
export ledger _pendingCounts: Map<Bytes<32>, Counter>;

/** Up to 8 pending ids to drain; zero = empty slot. Supplied by the folder's indexer. */
witness wit_UintInboxPendingIds(domain: Bytes<32>): Vector<8, Bytes<32>>;

/** Registry key for one entry: H(tag, domain, id). */
export pure circuit entryKeyOf(domain: Bytes<32>, id: Bytes<32>): Bytes<32>;

/**
 * @description Records a pending delta. Reads nothing shared: commutes with
 * all concurrent credits and consumes. `id` MUST come from the writer's own
 * randomness witness (never a ledger read); reuse is rejected.
 */
export circuit _credit(domain: Bytes<32>, id: Bytes<32>, delta: Delta): [];

/**
 * @description Drains up to 8 witness-chosen entries; returns netted sums.
 * Pins only the drained entries → conflicts only with another consume.
 */
export circuit _consume(domain: Bytes<32>): Net;

/**
 * @description Completeness checkpoint: proves in-circuit the domain has NO
 * pending entries. Pins the count (a deliberate barrier against credits).
 */
export circuit _assertEmpty(domain: Bytes<32>): [];
```

One module instance serves many accumulators (entries are `(domain, id)`-keyed); module ledger state is a per-file singleton, so double-importing does not create a second inbox.

## 4. Example flow

```typescript
export ledger _totalSupply: Uint<128>;          // folded — only foldSupply touches it
witness wit_CreditId(): Bytes<32>;              // fresh randomness per credit

export circuit mint(to: Field, value: Uint<128>): [] {
  Issuer__assertIssuer();
  // ...create the recipient's value...
  Inbox__credit(supplyDomain(), wit_CreditId(), Inbox_Delta { add: value, sub: 0 });
}

export circuit burn(value: Uint<128>): [] {
  // ...consume the caller's value...
  Inbox__credit(supplyDomain(), wit_CreditId(), Inbox_Delta { add: 0, sub: value });
}

// permissionless: folding cannot corrupt value
export circuit foldSupply(): [] {
  const net = Inbox__consume(supplyDomain());
  assert(_totalSupply + net.add >= net.sub, "underflow");
  _totalSupply = disclose(((_totalSupply + net.add) - net.sub) as Uint<128>);
}
```

Worked example: three mints (50, 30, 20) and a burn (40) land in ONE block — four inserts under four random keys, zero conflicts. One later fold returns `{add: 100, sub: 40}`; the consumer applies `+60` once. Under direct RMW, that block lands one operation and rejects three.

## 5. When to use it

| Use case | Why it fits |
| --- | --- |
| Public supply totals with many writers (mints/burns from issuer + holders) | deltas are order-independent; exact total needed only at checkpoints |
| Per-color minted/burned totals (native shielded token supply) | replaces the pinned `current + amount` map update |
| Recipient-credit inboxes for account tokens (one domain per account) | un-serializes the merchant/exchange inbound hotspot; recipient folds own inbox on next spend |
| Fee/reward accrual pots | many contributors, rare settlement |

## 6. When NOT to use it

| Anti-case | Why it fails |
| --- | --- |
| **AMM reserves / swaps** | a swap's output is a *function of* the reserves — order sets the price, so swaps don't commute semantically; no inbox fixes that (batch auctions do — `concurrency.md` §8.5) |
| Any delta computed FROM the accumulator's current value | same reason: reading the value re-pins it, defeating the split |
| Balances that must gate a debit atomically | the spender needs the exact current balance in the same circuit; inboxes defer *credits*, never debits |
| Values every transaction must read exactly | the fold barrier would dominate; the accumulator is then inherently serial |
| Single-writer cells | the writer's own wallet already orders its transactions; direct RMW is simpler |
| Small counters (`Uint<64>` value, `Uint<16>` steps) | the kernel `Counter` already commutes with zero machinery |

## 7. Trust model & security considerations

- The fold witness picks only WHICH entries to drain; amounts come from the ledger, existence is asserted, entries are removed. It can never invent, alter, or double-count value.
- Skipping is the only misbehavior: harmless to safety (entries stay public and drainable), measurable (`_pendingCounts` on-chain), and provable-absent at checkpoints (`_assertEmpty`).
- Folding cannot corrupt value → it may be **permissionless**; censorship then requires every folder to collude.
- The completeness barrier is fundamental, not incidental: "nothing outstanding" is a statement about a serialization point, so `_assertEmpty` necessarily conflicts with concurrent credits. Routine folds stay barrier-free.
- Transient ordering: draining burns before their offsetting mints can trip the consumer's underflow guard — the fold reverts harmlessly; drain roughly in arrival order or retry.

## 8. Costs (measured, compiler 0.31.1)

| Circuit | k | rows |
| --- | --- | --- |
| `_credit` | 13 | 4 829 |
| `_consume` (8 slots) | 16 | 38 139 |
| `_assertEmpty` | 9 | 340 |

The hot path costs roughly what the pinned RMW it replaces cost; one fold absorbs 8 writers' contention for one mid-size proof.

## 9. Risks & open questions

- **P2 — inbox growth**: bounded by fold cadence; credits are gated by real economic actions, so spam equals real usage. Monitor `_pendingCounts`.
- **P2 — fixed batch size (8)**: compile-time constant (circuits cannot loop dynamically); deep backlogs need repeated folds. A native Queue ADT with stack-side append would obviate the witness entirely — a Compact feature request.
- **P3 — id discipline**: an id derived from a ledger read would re-pin the hot path; enforced by convention + docs, not by the circuit.

## 10. Implementation status

| Component | Status |
| --- | --- |
| Module | implemented; skip-zk + full keygen verified (scratchpad driver) |
| Tests / simulator | not yet (design phase) |
| First consumer | none yet (the ElGamal sibling has one; see its doc) |
| Audit | not started; DRAFT, not production |
