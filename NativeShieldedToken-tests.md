---
stage: tests
project: native-shielded-token
mode: extension
extends: contracts/src/token
status: draft
timestamp: 2026-06-19
author: 0xisk (via midnight-tests)
previous_stage: NativeShieldedToken-testing-plan.md
tags: [zswap, shielded, token, integration, proof-loop, privacy, vitest, fast-check]
---

# Native Shielded Token — Test Suite

## Summary

Two layers, both green. A fast `--skip-zk` **unit layer** (simulators over the
compiled mocks) covers every accounting, shape, and revert-guard invariant —
the `--skip-zk` simulator executes the Zswap primitives (`mintShieldedToken`,
`receiveShielded`, `sendImmediateShielded`, `sendShielded`), so mint/burn/derive
happy paths and reverts all run without proving. The **network integration
layer** drives the full prove → verify → apply loop against the local stack
(proof-server + indexer + node) through one deployable, `NativeShieldedTokenV1`
(Fungible module + derived-nonce extension), and covers the proof-loop-only
behaviors: real color enforcement, supply reconstruction from public effects,
and the **P0 recipient-privacy claim (HIGH-1)**. The remaining unbuilt specs
(burn happy paths, treasury Merkle spend, round-trip, bypass burns) share one
documented blocker — the testkit wallet cannot import/spend a contract-minted
coin — see Out of Scope.

## Layout

```
contracts/src/token/test/
  simulators/NativeShieldedTokenSimulator.ts          # unit, Fungible + extension
  simulators/NativeShieldedTokenFamilySimulator.ts    # unit, Family
  NativeShieldedToken.test.ts                          # base unit suite
  NativeShieldedTokenFamily.test.ts                    # Family + multi-domain isolation
  NativeShieldedTokenDerivedNonce.test.ts              # extension chain + seed guards
  NativeShieldedToken.property.test.ts                 # fast-check invariant fuzzing
  mocks/MockNativeShieldedToken{,Family}.compact       # + init flag, initializeNonce, ledger re-exports

contracts/test/integration/
  _harness/{network,providers,wallet,walletPool,deploy,globalTeardown,cma}.ts   # PR #489, verbatim
  _harness/effects.ts                                  # NEW: decode shieldedMints / commitments / public blob
  _mocks/NativeShieldedTokenV1.compact                 # the one deployable (full ZK keys)
  fixtures/nativeShieldedToken.ts                      # deploy / readLedger / as(alias) / teardown
  specs/nativeShieldedToken/{smoke,mint,supply,effects,privacy,burn,unrestricted,collision}.spec.ts
contracts/vitest.integration-net.config.ts             # network suite (globalSetup, serial)
local-env.yml, Makefile                                # make env-up: proof-server :6300 / indexer :8088 / node :9944
```

Run: unit — `vitest run src/token/test/NativeShieldedToken*.test.ts` (skip-zk).
Network — `make env-up && yarn test:integration:net` (pinned `COMPACT_TOOLCHAIN_VERSION=0.31.0`).
The pre-existing simulator-only `test/integration/` suite (#556) is untouched; its
`test:integration` config now excludes `specs/nativeShieldedToken/**`.

## Test Plan & Status

### Unit (`--skip-zk` simulator) — all green

| File | Cases | Invariants |
|------|-------|-----------|
| `NativeShieldedToken.test.ts` | init/metadata, pre-init revert table, _mint (color/value/nonce, contract recipient, accumulate, zero recipient), _burn (wrong-color, over-value, zero refundTo, full→none, partial→some, totalBurned), _burnFromContract (reverts, change, totalBurned), supply, MED-1 underflow boundary | 1,2,4,5,6,7,8,10,14,15 (INV-3 `it.skip`, unreachable) |
| `NativeShieldedTokenFamily.test.ts` | per-domain mint/burn/supply, pre-init table, **multi-domain isolation** (independent supplies, distinct colors, A-burn doesn't touch B, cross-domain wrong-color) | 1,2,5,6,7,8,10,14,15 |
| `NativeShieldedTokenDerivedNonce.test.ts` | seed guards (not-seeded, zero-seed, seed-once, ctor-seeded), chain advance, **no repeat over N=25**, derived ≠ chain value | 11,12,13 |
| `NativeShieldedToken.property.test.ts` | fast-check: random mint/burn sequences keep totalMinted exact, totalSupply = minted−burned, burned ≤ minted | 2,5 |

### Integration (network proof loop) — all green

| Spec | What it proves on-chain | Invariants |
|------|--------------------------|-----------|
| `smoke` | deploy + initial ledger (metadata, totals 0, domain, seeded chain) | 1,2,4,13,14,15 |
| `mint` | caller-nonce coin color=tokenColor/value/nonce; derived-nonce chain advance; zero-recipient revert | 1,2,6,11,12 |
| `supply` | multi-mint totalMinted exact; totalSupply = minted − burned | 2,5 |
| `effects` | **shieldedMints[domain] == minted amount** reconstructed from public tx effects (both paths) | 2 |
| **`privacy` (P0)** | secret-nonce mint → nonce absent from public data (recipient **unlinkable**); derived-nonce mint → `coinCommitment(coin, recipientKey)` matches on-chain, wrong key doesn't (recipient **recoverable**) | **HIGH-1** |
| `burn` | wrong-color / over-value / zero-refundTo all reject at proving (asserts fire before `receiveShielded`); same for `_burnFromContract` wrong-color / over-value | 1,7,8 |
| `unrestricted` | a non-deployer (ALICE) mints with no role grant | §Security |
| `collision` | duplicate (nonce,value,recipient) mint rejected by the ledger; recovery with a fresh nonce | 11 (mechanism) |

## Coverage Matrix

| INV | Unit | Integration | Status |
|-----|------|-------------|--------|
| INV-1 color soundness | ✅ (mint color, wrong-color revert) | ✅ mint, burn wrong-color, effects | ✅ both |
| INV-2 totalMinted exact | ✅ | ✅ mint, supply, **effects vs shieldedMints** | ✅ both |
| INV-3 mint overflow | ⏭️ `it.skip` (unreachable: amount Uint<64>, ~2^64 mints needed) | — | documented |
| INV-4 totalBurned counts | ✅ | ✅ (burn reverts; happy via unit) | ✅ unit + reverts |
| INV-5 totalSupply bound | ✅ + property | ✅ supply | ✅ both |
| INV-6 zero recipient | ✅ | ✅ mint | ✅ both |
| INV-7 zero refundTo | ✅ | ✅ burn | ✅ both |
| INV-8 amount ≤ value | ✅ | ✅ burn, burnFromContract | ✅ both |
| INV-9 spend path | — | ⛔ happy burn blocked (see OOS) | reverts only |
| INV-10 refund/change shape | ✅ (none/some) | ⛔ spendability blocked | ✅ unit shape |
| INV-11 derived nonce unique | ✅ (N=25) | ✅ mint (chain advance), collision | ✅ both |
| INV-12 nonce domain separation | ✅ | ✅ mint | ✅ both |
| INV-13 seed once / non-zero | ✅ | ✅ smoke | ✅ both |
| INV-14 immutable metadata | ✅ | ✅ smoke | ✅ both |
| INV-15 init guard | ✅ | ✅ smoke | ✅ both |
| INV-16 no msg.sender / ownPublicKey | — | ⏸ deferred (presets removed) | out of scope |
| **Privacy (HIGH-1)** | — | ✅ **privacy spec (P0)** | ✅ verified |

## Test Notes

- **`--skip-zk` runs the Zswap primitives.** A capability probe confirmed the
  simulator executes `mintShieldedToken`/`receiveShielded`/`sendImmediate/sendShielded`,
  so the unit layer covers happy mint/burn/derive, not just reverts. (The earlier
  worry that primitives were proof-loop-only was wrong.)
- **Stack runs locally.** Docker up; node :9944 + indexer :8088 healthy; a
  pre-existing proof-server answers on :6300 (v8.0.3). Deploy + mint prove in
  ~25–85s. The **ledger 8.1.0 ↔ proof-server 8.0.3** minor skew is tolerated.
- **Deps**: live-stack stack added at latest stable (testkit-js / midnight-js-* 4.1.1,
  compact-js 2.5.1, ledger-v8 8.1.0, pino). `package.json` pins the coupled SDK
  exactly. Install must be run by the dev (`yarn install`) — a `Bash(yarn add *)`
  deny rule blocks the agent from installing.
- **Effects decode**: the indexer exposes no structured effects, but `callTx`'s
  `res.public.tx` is the deserialized `Transaction`. Walk
  `intents.values() → actions → {guaranteed,fallible}Transcript.effects` for
  `shieldedMints` (Map<domainHex, u64>) and `claimedShieldedReceives`. Commitments
  recompute via `coinCommitment(coin, coinPublicKey)` (ledger-v8) — this is the
  basis of the privacy recoverability test.
- **Submitter pays fees; recipient does not.** Pool wallets can run short on dust
  across multiple submissions; supply/effects/privacy specs submit from the
  funded genesis wallet (minting to its own key sidesteps the encryption-key
  resolver, below).
- **MED-1**: unit suite has an explicit "drivable into burned > minted under
  --skip-zk" boundary test documenting that totalSupply underflow safety is
  proof-loop-provided; unit tests respect conservation by construction.
- **Suite stability**: each integration spec file is green in isolation. Running
  all 8 files back-to-back in one process gave 22/23 — one mint hit a transient
  `Wallet.Other: unreachable` (a wallet-SDK WASM trap), not a contract/test
  fault. Mitigation: shard the network suite (fewer files per process) or restart
  the wallet/stack between heavy files; CI should not run all 8 in one process.

## Out of Scope

The following share ONE root cause and are documented, not built:

- **Wallet cannot spend a contract-minted coin.** A contract mint emits no coin
  ciphertext, and the testkit `MidnightWalletProvider` exposes no coin-import
  hook (`ZswapLocalState.watchFor`/`insertCoin` are ledger-level, not on the
  facade). So a wallet can't hold/spend a token-color coin. This blocks:
  - **`_burn` happy paths** (full burn → `none`; partial → `some(refund)`,
    refund spendable) — the same-tx coin-input. Revert guards ARE covered.
  - **`_burnFromContract` happy path** (treasury Merkle spend) — needs a
    contract-held coin + its `mt_index`. Path forward: mint to the contract's
    own `ContractAddress`, await tree residency, `qualify` the coin via
    `queryZSwapAndContractState`, then `_burnFromContract`. Reverts ARE covered.
  - **`roundTrip`** (mint → out-of-band deliver → wallet pays into `_burn` →
    spendable refund).
  - **Supply bypass burns** (direct-to-burn-address send, imbalanced-offer
    protocol burn) — also need a spendable token coin.
  - **Unblock path**: a coin-injecting shielded wallet supplied to
    `WalletFacade.init`'s custom `shielded` initialiser. See "Own wallet tool".
- **Third-party recipient mints** need `additionalCoinEncPublicKeyMappings` via
  `withContractScopedTransaction` / `submitCallTx` (the encryption-key resolver
  error is from `midnight-js-contracts`, not the wallet). Mint specs mint to the
  submitter's own key. Recipient enc keys are available via
  `wallet.getEncryptionPublicKey()` if third-party mints are wanted later.
- **INV-3 overflow** — guard present, unreachable in a test (amount Uint<64>).
- **INV-16 authorization gating** — presets removed; consumer concern.
- **Family integration** — the one deployable is Fungible (per decision); Family
  is fully covered in the unit layer (incl. multi-domain isolation).
- **CMA upgrade specs** (`upgrades/`) — optional; `cma.ts` ported but unused.

## Own wallet tool (testkit-js removal)

The integration harness no longer depends on `@midnight-ntwrk/testkit-js`.

**Why it mattered.** testkit was misread as "the blocker". It is not. testkit's
`MidnightWalletProvider` is a ~30-line adapter over a `wallet-sdk` `WalletFacade`;
`balanceTx`/`submitTx` delegate straight to the facade. The coin-import limit
lives one layer deeper, in `wallet-sdk`'s `WalletFacade` / `ShieldedWalletAPI`
(its shielded state is an indexer-synced `rx.Observable` with no
`insertCoin`/`watchFor` on the facade). Dropping testkit alone changes nothing
about the blocked burns — but it removes a heavy dep (testcontainers, docker
orchestration, a fixed env model) we never used, since we run our own stack via
`make env-up`.

**Phase 1 — done.** `test/integration/_harness/ownWallet.ts` reconstructs the
whole wallet stack directly on `@midnight-ntwrk/wallet-sdk` (the recipe testkit's
`WalletFactory`/`FluentWalletBuilder` used): HD role-seed derivation
(`HDWallet` + `Roles.{Zswap,NightExternal,Dust}`), `ShieldedWallet` /
`UnshieldedWallet` / `DustWallet` factories, `WalletFacade.init`, then
`facade.start(...)`. `OwnWalletProvider` implements `WalletProvider` +
`MidnightProvider`. The harness (`wallet.ts`, `walletPool.ts`, `providers.ts`,
`network.ts`, both `fixtures/*`) imports zero testkit symbols; the full
integration suite typechecks clean (`tsc --noEmit`). `TEST_MNEMONIC` and
`EnvironmentConfiguration` are inlined as `LOCAL_WALLET_MNEMONIC` and
`LocalNetworkConfig`.

**Phase 2 — the actual unblock (designed, not built).** `WalletFacade.init`
accepts custom `shielded`/`dust` initialisers. Supply a *coin-injecting*
shielded wallet: wrap `ShieldedWallet(config).startWithSeed(seed)`, hold a
private `ZswapLocalState`, expose `importCoin(ShieldedCoinInfo)` (→ `insertCoin`
/ `watchFor`), and in `balanceTransaction` build the token-coin `UnprovenInput`
(`state.spend(sk, qualifiedCoin, segment) → ZswapOffer.fromInput`) and merge it
into the SDK's shielded offer. Dust/fee balancing, proving (`HttpProverClient`)
and submission (`PolkadotNodeClient`) are reused unchanged — no fee-math
reimplementation. This unblocks `_burn` happy / `roundTrip` / bypass burns.
**Risk to validate live:** the spent coin's `mt_index` / Merkle path must match
the on-chain commitment tree (seed via `applyCollapsedUpdate` / `replayEvents`
synced from the indexer) or the input proof won't verify.

**Pending mechanical steps (need a `yarn` install — owner runs):**
- promote two now-direct deps: `@midnight-ntwrk/wallet-sdk@1.1.0`,
  `@scure/bip39@2.2.0` (currently present only transitively via testkit);
- drop `@midnight-ntwrk/testkit-js` from `contracts/package.json`;
- live validation: `make env-up` then run the network suite.

## Dev Notes

- Pivots this session: unit-first → integration-first → "build all cases". The
  unit layer ended up covering most invariants cheaply because the simulator runs
  the Zswap primitives; integration adds the proof-loop-only proofs (color
  enforcement, supply-from-effects, privacy).
- The effects decoder (`_harness/effects.ts`) and the `coinCommitment`-based
  privacy check are the reusable harness pieces that unlock the supply and
  privacy specs without the (blocked) coin-spend machinery.

## Open Questions

1. Build the custom `WalletProvider` (watchFor/insertCoin) to unblock burn-happy
   / round-trip / bypass-burn specs? It's the one substantial remaining harness
   piece.
2. `_burnFromContract` happy path via mint-to-self-contract + `qualify` — worth
   attempting before the full custom provider?
3. CMA forward-compat (`upgrades/`) — in scope for this standard, or a separate pass?
