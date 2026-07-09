# Plan — generic shielded-coin tracker (QualifiedShieldedCoinInfo bookkeeper)

## TL;DR
Build a stateful, backend-aware tracker that maintains the `QualifiedShieldedCoinInfo`
(coin fields + real global `mt_index`) for every shielded coin the suite touches —
**wallet-owned and contract-owned** — so any live spend can be constructed for any
owner. Source of truth: the indexer's **`zswapLedgerEvents`** stream, whose events
already carry `{commitment, contract, mtIndex}` (outputs) and `{nullifier, contract}`
(spends). Replaces the one-shot `qualifyDepositedCoin` and its hardcoded `deposit`
circuit; deletes the fragile `tryApply`-against-a-snapshot approach.

## Why (the gap)
- Live spends need the coin's global `mt_index`. The wallet SDK tracks a wallet's OWN
  coins; **nothing tracks contract-owned coins** a contract didn't store on-chain
  (ForwarderPrivate, stateless treasury).
- `qualifyDepositedCoin` solves exactly one deposit→drain and hardcodes the `deposit`
  circuit. It does not follow coins across contract→contract, contract→wallet,
  change re-deposits, or multi-hop; and its `tryApply(preSnapshot, offer)` assumes the
  snapshot is the exact pre-tx tree (only true when the suite is the sole actor).

## Key insight (drives the whole design)
`ledger-v8` ledger `Event`s are authoritative and self-describing:
- `{ tag:'zswapOutput', commitment, contract: ContractAddress|undefined, mtIndex }`
- `{ tag:'zswapInput',  nullifier,  contract: ContractAddress|undefined }`

So we never compute an index — we **read** it. The indexer exposes them as
`zswapLedgerEvents` (range query for backfill + `Subscription.zswapLedgerEvents` for the
tail); each `ZswapLedgerEvent.raw` → `Event.deserialize(hex)`. This is the same stream
`@midnight-ntwrk/wallet-sdk-shielded` `Sync.js` consumes.

## Architecture
`ShieldedCoinTracker` (test-util, `contracts/test-utils/live/shieldedCoinTracker.ts`):
- Consumes `zswapLedgerEvents` in order and maintains:
  - `byCommitment: Map<CoinCommitment, { contract?: ContractAddress; mtIndex: bigint }>`
  - `spentNullifiers: Set<Nullifier>`
- Resolves a coin → its qualified form by computing the coin's commitment and looking
  it up:
  - contract-owned: `ZswapOutput.newContractOwned(coin, undefined, addr).commitment`
  - wallet-owned:   `coinCommitment(coin, coinPublicKey)` (ledger-v8)
- No `ZswapChainState`/`firstFree`/`tryApply`. Robust to interleaved txs (events carry
  the true global index regardless of who produced the tx).

## Data model
```
Owner   = { kind:'contract', address } | { kind:'wallet', coinPublicKey }
Coin    = { nonce, color, value }                       // EncodedShieldedCoinInfo
Record  = Coin & { owner: Owner; mtIndex: bigint; spent: boolean }
```
`qualify(owner, coin) → { ...coin, mt_index }` (throws if unresolved/spent).

## Ingestion
- **Backfill**: on init, query `zswapLedgerEvents(offset)` from a start height to head.
- **Tail**: subscribe to `Subscription.zswapLedgerEvents` (or poll the range query).
- Every event updates `byCommitment` / `spentNullifiers` — independent of what the
  suite drives. (We no longer need to capture each tx's offer, so the hardcoded
  `handle.callTx.deposit` disappears — deposits go through the normal `sim.deposit`.)

## Wallet vs contract
- **Contract coins**: fully owned by this tracker (no other component tracks them).
- **Wallet coins**: two options —
  - (A) delegate to the wallet provider / a `ZswapLocalState` (it already yields
    `QualifiedShieldedCoinInfo` via `.coins`, auto-decrypted from ciphertexts); the
    tracker just unifies the query surface. ← preferred, less to maintain.
  - (B) track them ourselves from the same event stream (needs the coin's
    `coinPublicKey`; no auto-discovery of unknown coins since we match by commitment).
  Decision: (A) for the wallet's own coins; (B)-style commitment match only for
  cross-boundary coins where we already know the fields.

## API (sketch)
```ts
const tracker = await ShieldedCoinTracker.create(publicDataProvider, { fromHeight });
tracker.trackContract(address);
tracker.trackWallet(coinPublicKey /*, secretKeys? */);
await tracker.sync();                                  // drain backfill + tail
tracker.qualify(owner, coin): QualifiedShieldedCoinInfo;
tracker.coinsOf(owner): QualifiedShieldedCoinInfo[];
tracker.isSpent(owner, coin): boolean;
```

## Integration (final, generic — no per-contract shim)
- `shieldedCoinTracker.ts` owns the tracker AND its generic surface:
  `getShieldedCoinTracker()` (singleton; indexer URL from `MIDNIGHT_INDEXER_PORT`,
  default 8088), `contractOwner(sim)` → `ShieldedOwner`, and the backend-aware
  getter `getQualifiedShieldedCoinInfo(owner, coin)` — dry → `{...coin, mt_index:0n}`;
  live → `getShieldedCoinTracker().resolve(owner, coin)`. Dry-safe: a dry spec can
  import it and simply never hit the live path.
- `liveShielded.ts` stays pure shielded value fixtures (color / coin / recipient /
  parent key); no tracker dependency.
- A spec spends on both backends with: `await sim.<action>(coin); const q =
  await qualifyForSpend(contractOwner(sim), coin);`. No `deposit`-specific wrapper,
  no handle-driven deposit, no `.deposit` string, no offer capture.
- `contractCoin.ts` (the Forwarder-shaped shim) and `depositForDrain` are DELETED —
  the tracker + `qualifyForSpend` are the generic replacement.

## Phasing
1. **Investigate** (½ day): exact `zswapLedgerEvents` query/subscription shape +
   offset semantics; confirm `Event.deserialize` on the `raw` hex; confirm
   `zswapOutput.contract` is set for contract-owned outputs and `mtIndex` is global.
   Reuse or copy the minimal client bits from `wallet-sdk-shielded/Sync`.
2. **Contract-coin MVP**: event-indexed `byCommitment`; port `depositForDrain` +
   ForwarderPrivate off `tryApply`. Validate on live (this also settles the pending
   ForwarderPrivate run).
3. **Spent-tracking**: `zswapInput` nullifiers; `qualify` refuses spent coins;
   confirm contract-coin nullifier match (or mark-spent on driven spend as fallback).
4. **Wallet unification**: option (A) delegation; single query surface across owners.
5. **Multi-hop / cross-boundary**: contract→contract, contract→wallet, change
   re-deposits tracked end-to-end; add regression specs.

## Open questions / risks
- `zswapLedgerEvents` offset/paging + subscription backpressure (Sync.js has answers).
- Contract-owned output: is `event.contract` always populated, and is `mtIndex` the
  same global index `ZswapInput.newContractOwned` validates against? (Phase-1 check.)
- Nullifier derivation for contract-owned coins (to match `zswapInput` events to a
  tracked coin) — may need a runtime helper or driven-spend fallback.
- Indexer lag: `sync()` must confirm head ≥ the block of the just-driven tx before
  `qualify` (bounded poll, like the harness's existing lag absorption).
- Scope: do we need wallet-coin tracking at all, or is delegating to the wallet
  provider enough for the suite? (Cut Phase 4 if so.)

## Decisions (locked 2026-07-06)
- **Go straight to the tracker** (skip validating the old `tryApply` route on live).
- **Unified** API across wallets + contracts. One mechanism where it works: match a
  KNOWN coin's commitment in the global `zswapLedgerEvents` index (`event.contract`
  distinguishes owner; `mtIndex` is read, not computed). Auto-discovery of UNKNOWN
  wallet coins (unknown nonce, ciphertext-only) still delegates to the wallet SDK — that
  is the sole wallet-specific arm (Phase 4).
- **Transport**: HTTP poll of `block(offset:{height})` → `transactions[].zswapLedgerEvents`
  from lastHeight..head; `Event.deserialize(raw)`. No websocket, no new deps (`fetch`).
  Isolated in `ledgerEvents.ts` so the one live-dependent query is easy to fix post-probe.
- **Indexer URL**: `http://127.0.0.1:${PORTS.indexer}/api/v4/graphql` (from the harness).
- Confirmed schema: `Subscription.zswapLedgerEvents(id?)` is GLOBAL (no sessionId);
  `ZswapLedgerEvent = {id, maxId, raw}`; `Transaction.zswapLedgerEvents` per-tx.

## Supersedes / relates
- Overturns `reference_live_contract_coin_index_recovery` (the `tryApply` route) with a
  cleaner event-stream route; that memory + `contractCoin.ts` are the current stopgap.
- First consumer: ForwarderPrivate live (tasks #10/#17).
