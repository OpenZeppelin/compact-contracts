# ShardedCounter — design doc

> **Status:** draft (2026-07-24), destination Notion. Module: [`utils/concurrency/ShardedCounter.compact`](../ShardedCounter.compact). Conflict-model background: repo-root [`concurrency.md`](../../../../../concurrency.md) (§9.3). Siblings: the delta inboxes (preferred when a folder role is acceptable).

## 1. Summary

An **add-only `Uint<128>` total split across shards**. Each `_add` is a read-modify-write of ONE shard cell chosen from the writer's own randomness, so two concurrent writers conflict only on a shard collision (~1/N per pair) instead of with certainty. No folder role, no witness, no barrier — the trade is that contention is *reduced probabilistically*, not eliminated, and the exact total is a sum over shards.

## 2. Motivation

Two gaps this fills:

- The kernel `Counter` commutes perfectly (relative `addi`, nothing pinned) but is capped: `Uint<64>` value, `Uint<16>` per increment. Token-scale amounts don't fit.
- The delta inboxes eliminate contention but require a fold role and cadence. Some deployments want *no moving parts*: write-and-forget totals whose exact value is only ever read off-chain.

`ShardedCounter` sits between: `Uint<128>` amounts, zero operational duties, contention reduced by the shard fan-out.

## 3. Specification

```typescript
/** Shard cells, keyed by shardKeyOf(domain, shard). */
export ledger _shards: Map<Bytes<32>, Uint<128>>;

/** Registry key for one shard: H(tag, domain, shard). Exported so indexers
 *  sum totals the way the circuits write them. */
export pure circuit shardKeyOf(domain: Bytes<32>, shard: Uint<8>): Bytes<32>;

/**
 * @description Adds `amount` to one shard of `domain`'s total. Pins only the
 * chosen shard cell. `shard` MUST derive from the writer's own randomness.
 */
export circuit _add(domain: Bytes<32>, shard: Uint<8>, amount: Uint<128>): [];

/** @description Reads one shard (0 if never written). Pins that shard. */
export circuit _shardTotal(domain: Bytes<32>, shard: Uint<8>): Uint<128>;
```

The consumer fixes the shard-space size by bounding the index it passes (e.g. derive `shard = randomness mod 8`): fewer shards = fewer cells to sum, more collisions; more shards = the reverse.

## 4. Example flow

```typescript
witness wit_StatsRandomness(): Bytes<32>;

circuit volumeDomain(): Bytes<32> { return pad(32, "MyApp:volume"); }

export circuit recordTrade(amount: Uint<128>): [] {
  // shard from the writer's OWN randomness — never from a ledger read
  const shard = (degradeToTransient(persistentHash<Bytes<32>>(wit_StatsRandomness()))
                 as Uint<8>);  // consumer bounds the space, e.g. via % 8
  Sharded__add(volumeDomain(), shard, amount);
}
// total volume = Σ shards, summed off-chain by the indexer
```

Eight writers land in one block: with 8 shards, most pick distinct shards and all land; the occasional pair that collides retries once. With a single cell, seven of eight would have failed.

## 5. When to use it

| Use case | Why it fits |
| --- | --- |
| Monotone volume metrics (total minted per color, cumulative trade volume, fee totals) | add-only, exact value read off-chain/rarely |
| High-write gauges in folderless deployments | no crank, no witness, no ops duty |
| Per-pair AMM *statistics* (cumulative volumes) once swaps are batched | stats writes stop being per-swap hot; sharding absorbs residual bursts |

## 6. When NOT to use it

| Anti-case | Why it fails |
| --- | --- |
| **Anything needing decrements** | a subtraction can underflow ONE shard even when the cross-shard total suffices; decrements need global knowledge sharding is designed to avoid. Track decreasing quantities as a second domain (`minted`/`burned`) and net at read time, or use a delta inbox |
| **AMM reserves / swaps** | order-dependent state AND every swap needs the exact value — both disqualifiers (`concurrency.md` §8.5) |
| Exact totals read in-circuit frequently | the reader pins every shard it sums — it conflicts with all writers, same as before sharding |
| Supply that must attest exactly | use `ElGamalDeltaInbox`/`UintDeltaInbox` + `_assertEmpty`: sharding has no completeness checkpoint |
| Small counters | the kernel `Counter` fully commutes with zero machinery — always prefer it when `Uint<64>`/`Uint<16>` bounds fit |
| Low-write cells | contention was never the problem; a plain cell is simpler |

## 7. Trust model & security considerations

- No witness, no folder: nothing to trust beyond the writers themselves.
- The one discipline: **shard choice must come from writer randomness**, never a ledger read (that read would pin and reintroduce the conflict) and never a fixed constant (all writers would share one shard — a hotspot with extra steps).
- Overflow is guarded per shard; the off-chain sum of ≤256 `Uint<128>` shards is the indexer's to widen.
- Probabilistic by construction: adversarial writers *can* deliberately collide shards to grief each other's transactions — but they only delay (retry), never corrupt, and they pay proving cost to do it.

## 8. Costs (measured, compiler 0.31.1)

| Circuit | k | rows |
| --- | --- | --- |
| `_add` | 13 | 4 634 |
| `_shardTotal` | 13 | 4 261 |

## 9. Risks & open questions

- **P2 — silent hotspotting**: a consumer that derives the shard from anything low-entropy (timestamp bucket, user id) recreates the hotspot; the circuit cannot detect it.
- **P3 — shard-count tuning**: 1/N collision math assumes uniform choice; the right N is workload-dependent and baked into the consumer, not the module.
- **P3 — read-side ergonomics**: no in-circuit "sum all shards" is provided on purpose (it would pin everything); if a bounded-staleness in-circuit total is ever needed, that is an inbox-with-fold design, not this module.

## 10. Implementation status

| Component | Status |
| --- | --- |
| Module | implemented; skip-zk + full keygen verified |
| Tests / consumer | not yet (design phase) |
| Audit | not started; DRAFT, not production |
