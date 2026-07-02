# Native Shielded Token — Specification Testing Plan

**Targets (3 contracts):** `NativeShieldedToken` (Fungible), `NativeShieldedTokenFamily`
(Family), `extensions/NativeShieldedTokenDerivedNonce`. (Presets removed 2026-06-19 — gating is a
consumer concern; see §3.2 "unrestricted".)
**Spec:** `mip-xxxx-native-shielded-token.md` (§Testing, §Security Considerations, §Path to Active).
**Infra:** the local stack + integration harness from
[PR #489](https://github.com/OpenZeppelin/compact-contracts/pull/489)
(`local-env.yml`, `contracts/test/integration/`).
**Toolchain:** Compact **0.31.0**, `pragma language_version >= 0.23.0`.

This plan exists because the standard's defining behaviors are protocol-level (Zswap spend paths,
color derivation, recipient privacy, coin conservation, out-of-band delivery). A `--skip-zk`
simulator cannot prove any of them. The integration suite on the local infra is where this
standard is actually verified.

---

## 0. Preconditions (blockers)

**Compile gate: GREEN (2026-06-19).** All three contracts + both mocks compile on toolchain
0.31.0, and `contracts/artifacts/` was regenerated (the deployable mocks carry all 12 circuits'
prover/verifier keys). Status of the original preconditions:

1. ~~**Fix CRIT-1.**~~ **DONE** — `NativeShieldedTokenDerivedNonce.compact:106` tag changed from
   the 37-byte `"NativeShieldedTokenDerivedNonce:nonce"` to the MIP's 25-byte
   `"NativeShieldedToken:nonce"`. Extension + both mocks now build; the derived-nonce mint path is
   testable.
2. ~~**Regenerate artifacts.**~~ **DONE** — the stale 2026-06-11 dirs were replaced; the missing
   `MockNativeShieldedTokenFamily` artifact was created.
3. **Pin the toolchain to 0.31.0** for both unit and integration builds (PR #489 currently pins
   0.30.0 for integration — MED-3). Still to wire into the integration script.

Re-verify the gate any time:

```sh
COMPACT_TOOLCHAIN_VERSION=0.31.0 yarn workspace @openzeppelin/compact-contracts compact:token
COMPACT_TOOLCHAIN_VERSION=0.31.0 yarn workspace @openzeppelin/compact-contracts compact:mocks:token
# the 3 contracts + both mocks must compile clean
```

---

## 1. Test layers — what each can and cannot prove

| Layer | Runner | Builds with | Can verify | Cannot verify |
|-------|--------|-------------|------------|---------------|
| **Unit** | Vitest + TS simulator over the `compactc`-emitted contract, `--skip-zk` | mocks | accounting arithmetic, revert guards, return-value shape, multi-domain map isolation, derived-nonce chain progression | anything protocol-level: real coin existence, transient vs Merkle spend, color enforcement at receive, recipient privacy, lost-coin/delivery, bypass burns |
| **Integration** | Vitest against local node + indexer + proof server (PR #489 harness) | deployable presets / integration mocks | the full prove→verify→apply loop: spend-path correctness, wrong-witness/wrong-caller rejection, supply vs indexer effects, recipient privacy on public data, wallet round-trip, CMA upgrade path | exact circulating supply (unknowable by design); off-chain key custody |
| **Property (fast-check)** | Vitest + `fast-check`, on the simulator | mocks | invariant fuzzing over random op sequences (MIP §"Invariant fuzzing") | same protocol limits as unit |

**Rule:** every privacy/authorization assertion checks the *resulting ledger or indexer output*,
never the call argument. Every spend-path and color claim has a proof-loop test.

---

## 2. Unit test plan (simulator, `--skip-zk`)

Mirror the existing `token/test/` layout (`simulators/`, `witnesses/`, `<Module>.test.ts`).

**Artifacts to create:**
- `test/simulators/NativeShieldedTokenSimulator.ts`, `…FamilySimulator.ts` — wrap the compiled
  mocks (which expose internal circuits + `_deriveNonce` + a composed `_mintWithDerivedNonce`).
- `test/mocks/MockNativeShieldedToken.compact` / `…Family.compact` — already exist; will compile
  once CRIT-1 is fixed.
- No TS witnesses needed for the base modules (empty private state). Preset unit tests, if added,
  need the `Ownable`/`AccessControl` witness shims already used elsewhere in `token/test/witnesses/`.

**Test files & cases** (named "should …", per house style; each tagged with the INV it pins):

### `NativeShieldedToken.test.ts` (Fungible)
- **initialize / metadata**
  - should revert every circuit before initialize (INV-15)
  - should revert on double-initialize
  - should return constructor `name`/`symbol`/`decimals` (INV-14)
  - should compute `tokenColor` = `tokenType(_domain, self)` at call time (INV-1)
- **_mint**
  - should return coin info with `color == tokenColor()` and `value == amount` (INV-1)
  - should set the coin nonce equal to the caller's nonce
  - should increment `totalMinted` by `amount` (INV-2)
  - should revert on zero recipient (INV-6)
  - should revert on `Uint<128>` overflow of `totalMinted` (INV-3)
- **_burn (same-tx semantics, as far as the simulator models them)**
  - should revert on wrong color (INV-1) — note: simulator caveat, real enforcement is integration
  - should revert on `amount > coin.value` (INV-8)
  - should revert on zero `refundTo` (INV-7)
  - should return `none` on a full burn (`amount == coin.value`) (INV-10)
  - should return `some(refund)` with `refund.value == coin.value - amount` on a partial burn (INV-10)
  - should increment `totalBurned` by `amount` (INV-4)
- **_burnFromContract**
  - should revert on wrong color / `amount > coin.value`
  - should return the change coin and increment `totalBurned`
- **supply getters**
  - should report `totalSupply == totalMinted - totalBurned` after mint/burn sequences (INV-5)
  - **(MED-1 guard test)** should document/handle the `burned > minted` underflow boundary — if no
    defensive guard is added, assert the simulator path that would underflow is never reachable in
    a conservation-respecting sequence, and keep a comment that real safety is proof-loop-provided

### `NativeShieldedTokenFamily.test.ts` (Family)
- All of the above, parameterized by `domain`, plus:
  - should accumulate independent supplies for distinct domains (INV-2)
  - should return 0 from `totalMinted`/`totalBurned`/`totalSupply` for an unknown domain
  - should keep domain A's color check and supply unaffected by domain B activity (multi-domain isolation)

### `NativeShieldedTokenDerivedNonce.test.ts` (extension)
- should revert `_deriveNonce` before seeding
- should revert `initialize` on a zero seed (INV-13)
- should revert a second `initialize` (single-seed) (INV-13)
- should advance `_counter` and `_nonce` on each `_deriveNonce` call
- should never repeat a derived nonce across N calls (INV-11)
- should produce a derived nonce ≠ the public `_nonce` chain value (domain separation, INV-12) —
  i.e. an honest caller echoing `_nonce` cannot collide with a derived mint

### Property tests (`fast-check`) — MIP §"Invariant fuzzing"
- For random mint/burn op sequences over random domains: `totalMinted` equals the sum of minted
  amounts (exact); `totalSupply == totalMinted - totalBurned`; `totalBurned ≤ totalMinted`
  (conservation, respected by construction in the generator).

---

## 3. Integration test plan (local infra)

### 3.0 Environment

`local-env.yml` brings up proof-server (`:6300`), indexer (`:8088`), node (`:9944`), network id
`undeployed`. Lifecycle via the Makefile targets PR #489 adds:

```sh
make env-up      # or: yarn env:up
yarn workspace @openzeppelin/compact-contracts test:integration   # align to 0.31.0
make env-down
```

`vitest.integration.config.ts`: `fileParallelism: false`, `sequence.concurrent: false`,
`testTimeout 180s`, one funded genesis wallet + shared `WalletPool` (`ADMIN`/`ALICE`/`BOB` from
the dev-preset seeds, deployer = `GENESIS`). Reuse it verbatim.

### 3.1 Harness additions (reuse PR #489, add native-token pieces)

Reuse as-is: `_harness/network.ts`, `providers.ts`, `wallet.ts`, `walletPool.ts`, `deploy.ts`,
`globalTeardown.ts`, and the `cma.ts` wrappers (for the forward-compat upgrade specs).

New pieces:

- **Deployable contract(s).** Presets were removed, so the deployable units are the existing
  unit mocks `test/mocks/MockNativeShieldedToken.compact` / `…Family.compact`. They already expose
  the full unrestricted surface needed by the specs — `_mint` (caller nonce),
  `_mintWithDerivedNonce` (composed `_mint` + `_deriveNonce`), `_deriveNonce`, `_burn`,
  `_burnFromContract`, supply getters, `tokenColor` — covering both the recipient-private and
  recipient-public mint paths. Compile via `compact:mocks:token` into `artifacts/MockNativeShieldedToken/`
  and point the fixtures there (no separate integration `_mocks/` contract needed).
  - **Block-limit risk (INFO-4):** the mock wires derived-nonce + base mint + both burns + supply
    in one unit; `_burn` alone is k=16 (≈47786 rows). If a deploy or call exceeds the local node's
    per-tx block limit, split the surface into two deploy units (mint vs burn), mirroring PR #489's
    `TestTokenV1` "pruned for block-limit fit" note.
- **Fixtures** (`fixtures/nativeShieldedToken.ts`, `…Family.ts`) mirroring `testTokenV1.ts`:
  `deploy…()` returns a kit (`deployed`, `providers`, `wallet`, `contractAddress`, `signers`,
  `readLedger()`, `as(alias)`, `teardown()`).
- **Coin-input helper** — pay a wallet-owned shielded coin of the token's color into a `_burn`
  call within the same tx (the same-tx coin path). This is the trickiest harness piece: it must
  attach a shielded coin output→contract within the burn transaction. Encapsulate it so specs
  stay declarative.
- **Out-of-band delivery helper** — capture the `ShieldedCoinInfo` returned by `mint`/`_burn` from
  the finalized tx result, and "deliver" it to a recipient wallet so the recipient can later spend
  it (no ciphertext is emitted; the return value is the only copy — MIP §"Coin delivery").
- **Indexer effect decoder** — read `shieldedMints` effects, disclosed burn transcript values, and
  per-color value deltas from `publicDataProvider`, to assert supply reconstruction and the
  recipient-privacy property. (The cited empirical study,
  `0xisk/exploring-native-shielded-token-indexing`, is the reference for what is decodable.)

### 3.2 Spec list (grouped by surface, mirroring PR #489's `specs/` layout)

Each spec: **what it proves · INV / MIP § · proof-loop or skip-zk · harness pieces used.**

#### `specs/smoke.spec.ts`
- should deploy the mock to the local node and read initial ledger: metadata round-trips,
  `totalMinted/Burned/Supply == 0`, `tokenColor` derivable, nonce chain seeded.
  · INV-1,2,13,14 · proof-loop · fixture.

#### `specs/mint/`
- **caller-nonce mint** — should mint to a user wallet; returned coin info has correct
  color/value/nonce; `totalMinted` increments. · INV-1,2 · proof-loop.
- **derived-nonce mint** — should mint via the composed derived path; chain advances; supply
  increments. · INV-2,11 · proof-loop.
- **zero recipient** — should reject a mint to the zero key/address. · INV-6.
- **overflow** — should reject when `totalMinted` would exceed `Uint<128>`. · INV-3 (may be
  simulator-only if amounts are impractical on-chain; keep in unit layer).
- **multi-domain isolation (Family)** — should keep domain A and domain B supplies and colors
  independent. · INV-2 · proof-loop. (MIP §Integration "Multi-domain isolation".)

#### `specs/burn/` (`_burn`, same-tx coin)
- **full burn** — should accept a coin paid in within the tx, send `coin.value` to the burn
  address, return `none`, increment `totalBurned`. · INV-4,9,10 · proof-loop · coin-input helper.
- **partial burn + refund** — should burn `amount`, forward `coin.value - amount` to `refundTo`,
  return `some(refund)`; the refund coin is then **spendable by `refundTo`**. · INV-9,10 ·
  proof-loop · coin-input + delivery helpers. (MIP §Integration "Round-trip on network".)
- **wrong color** — should reject when `coin.color != tokenColor(domain)` (the protocol receive
  does NOT validate color; this assert is the only barrier). · INV-1 · proof-loop. (MIP §Security
  "Wrong-color burns".)
- **amount > coin.value** — should reject. · INV-8.
- **zero refundTo** — should reject (prevents silently burning the change). · INV-7.

#### `specs/burnFromContract/` (contract-held coin, Merkle spend)
- **treasury partial burn** — should mint to `kernel.self()`, then (in a later tx, once the coin
  is in the tree) `_burnFromContract` a partial amount via `sendShielded`; the returned change is
  owned by the contract and is **burnable again**. · INV-9,10 · proof-loop · delivery/persist
  helper. (MIP §Integration "Treasury flow".)
- **wrong color / over-value** — should reject. · INV-1,8.
- **no receive claim** — should confirm no `receiveShielded` is emitted (Merkle path only). · INV-9.

#### `specs/supply/` (accounting & bounds — MIP §Supply Accounting, §Integration "Invariant fuzzing")
- **totalMinted exact vs indexer** — should match the sum of `shieldedMints` effects decoded from
  the indexer. · proof-loop · effect decoder. (MIP: "independently verifiable from public
  `shieldedMints`".)
- **bypass burn — direct to burn address** — a wallet sends coins straight to
  `shieldedBurnAddress()` (no contract call); `totalBurned` does NOT change; assert
  `circulating ≤ totalSupply` still holds (totalSupply over-reports, as specified). · proof-loop.
- **bypass burn — imbalanced offer** — submit a Zswap offer with a positive value imbalance (no
  contract call); same assertion. · proof-loop.
- **upper-bound semantics** — should confirm `totalSupply == totalMinted - totalBurned` is an
  upper bound, never claimed exact. · INV-5.

#### `specs/privacy/` (HIGH-1 — the load-bearing claim)
- **recipient-private mint** — should mint with a secret uniform nonce, then assert the recipient
  public key is **NOT** recoverable from any public indexer data (contract state, tx effects,
  commitments). · proof-loop · effect decoder. **P0.**
- **recipient-public derived mint** — should mint with the derived (public-state) nonce, then
  assert the recipient **IS** recoverable by enumerating candidate keys against the public
  commitment (confirms the documented trade-off). · proof-loop. (MIP §Security "Recipient
  linkability of derived-nonce mints".)
- **refund target is public** — should confirm `_burn`'s `refundTo` is disclosed in public data
  (documenting, not a regression).

#### `specs/unrestricted/` (modules carry no auth by design)
- **ungated module is unrestricted** — should confirm a bare mock deploy lets *any* caller
  (ADMIN, ALICE, BOB) mint and burn, since the modules deliberately carry no authorization
  (MIP §Security "Unrestricted issuance"). This is the safety baseline that makes the consumer's
  gating obligation explicit. · proof-loop · WalletPool.
- **Authorization gating is out of scope for this suite (presets removed).** Role/owner-gated
  mint-burn specs and the "no `ownPublicKey()` auth" check (INV-16) are deferred until a gated
  consumer returns. The MIP still requires consumers to gate and forbids `ownPublicKey()` auth;
  that is now a documented consumer responsibility, not something this suite exercises. Note: this
  also leaves MIP Implementation-Plan item #3 (a composed gated example) currently unmet.

#### `specs/derivedNonce/` (griefing & recovery — MIP §Security "Commitment collisions")
- **deliberate collision** — should pre-mint a commitment colliding with a future derived mint of
  the same `(nonce, domain, value, recipient)`, then observe that the derived mint fails on
  duplicate-commitment rejection. · proof-loop.
- **recovery** — should confirm any subsequent derived mint with a different tuple advances the
  chain past the collision and succeeds. · proof-loop.

#### `specs/roundTrip/` (MIP §Path to Active acceptance criteria)
- **full wallet round-trip** — should: mint to a user wallet → deliver coin info out of band →
  user pays the coin into `_burn` → refund coin spendable by `refundTo`. Single end-to-end spec
  proving the whole lifecycle. · proof-loop · all helpers. (MIP acceptance: "demonstrated wallet
  round-trip".)

#### `specs/upgrades/` (forward-compat, optional — reuse PR #489 CMA harness)
- **VK rotation survives state** — should rotate `mint`/`burn` VKs and confirm supply ledger
  fields and metadata survive (state survival), and a brand-new phase-2 circuit can be inserted
  via `VerifierKeyInsert` with no ledger migration (MIP §"Forward compatibility with C2C"). ·
  proof-loop · `cma.ts` wrappers. Lower priority than the core token specs.

### 3.3 Mapping to MIP §Testing

- MIP §Unit Tests → §2 above (simulator).
- MIP §Integration "Round-trip on network" → `specs/burn/` partial-burn + `specs/roundTrip/`.
- MIP §Integration "Treasury flow" → `specs/burnFromContract/`.
- MIP §Integration "Multi-domain isolation" → `specs/mint/` + `specs/burn/` (Family).
- MIP §Integration "Invariant fuzzing" → `specs/supply/` (bypass burns) + the `fast-check`
  property tests in §2.

---

## 4. Invariant → coverage matrix

| INV | Unit | Integration | Notes |
|-----|------|-------------|-------|
| INV-1 color soundness | partial (sim caveat) | ✅ `smoke`, `mint`, `burn` wrong-color | real color enforcement is proof-loop-only |
| INV-2 totalMinted exact | ✅ | ✅ `supply` (vs indexer) | |
| INV-3 mint overflow | ✅ | — | impractical on-chain; unit only |
| INV-4 totalBurned counts | ✅ | ✅ `burn` | |
| INV-5 totalSupply bound / no underflow | ✅ | ✅ `supply` | MED-1: conservation dependency |
| INV-6 zero recipient | ✅ | ✅ `mint` | |
| INV-7 zero refundTo | ✅ | ✅ `burn` | |
| INV-8 amount ≤ value | ✅ | ✅ `burn`, `burnFromContract` | |
| INV-9 spend path | — | ✅ `burn`, `burnFromContract` | **proof-loop only** |
| INV-10 refund/change returned | ✅ (shape) | ✅ (spendable) | unit checks shape; integration checks spendability |
| INV-11 derived nonce unique | ✅ | ✅ `mint` derived | |
| INV-12 nonce domain separation | ✅ | ✅ `derivedNonce` | blocked by CRIT-1 until fixed |
| INV-13 seed once / non-zero | ✅ | ✅ `smoke` | |
| INV-14 immutable metadata | ✅ | ✅ `smoke` | |
| INV-15 init guard | ✅ | ✅ `smoke` | |
| INV-16 no msg.sender / ownPublicKey | — | ⏸ deferred | gating specs removed with presets; consumer-layer concern |
| **Privacy (HIGH-1)** | — | ✅ `privacy` | **proof-loop + indexer, P0** |

---

## 5. CI wiring

- **Unit:** existing `test` target (`compact-compiler --skip-zk && vitest run`) picks up the new
  `NativeShieldedToken*.test.ts` once the mocks compile.
- **Integration:** extend PR #489's `test:integration` to compile `test/mocks/` (via
  `compact:mocks:token`) and run the new specs, **pinned to `COMPACT_TOOLCHAIN_VERSION=0.31.0`**
  (MED-3). The CMA integration workflow
  (`.github/workflows/test-integration.yml`) already stands up `local-env.yml`; add the
  native-token specs to its include set.
- **Gating:** integration specs are guarded by `fileParallelism: false` (shared genesis wallet /
  node) — keep native-token specs in the same serialized config.

---

## 6. Risks & open questions

1. **Block-limit fit (INFO-4).** `_burn` is large (k=16, ≈47786 rows). A composite harness
   contract wiring derived-nonce + base mint + both burns may exceed the local node's per-tx
   limit. Mitigation: split the integration mock surface (PR #489's `TestTokenV1` already does
   this "for block-limit fit").
2. **Same-tx coin input plumbing.** Paying a wallet coin into `_burn` within one tx is the least
   trivial harness piece; budget time to get the coin-input helper right against the SDK.
3. **`_burnFromContract` tree residency.** The coin must be a confirmed Merkle entry (a prior
   finalized tx), so the treasury spec needs a two-tx setup (mint-to-self, await inclusion, then
   burn). Sequence it explicitly.
4. **Privacy assertion fidelity (HIGH-1).** "Recipient not recoverable" must be asserted against
   everything the indexer exposes, not just contract state. Use the empirical-study decode as the
   reference for completeness.
5. **Toolchain skew.** Keep unit and integration on 0.31.0; do not let the integration script
   drift back to 0.30.0.

---

## 7. Suggested execution order

1. Fix CRIT-1 (extension tag → `"NativeShieldedToken:nonce"`), regenerate artifacts, get the
   3 contracts + both mocks compiling on 0.31.0.
2. Unit suite (fast feedback): base modules + extension + Family + property tests.
3. Integration harness pieces: fixtures + coin-input + delivery + indexer decoder.
4. Integration specs in priority order: `smoke` → `mint`/`burn`/`burnFromContract` →
   `supply` → **`privacy` (P0, HIGH-1)** → `unrestricted` → `derivedNonce` → `roundTrip`.
5. Optional: `upgrades/` (CMA forward-compat) reusing PR #489's `cma.ts`.
