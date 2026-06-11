# PR #559 review — draft (local, not yet posted)

Target: [OpenZeppelin/compact-contracts#559 — Add shielded token](https://github.com/OpenZeppelin/compact-contracts/pull/559) (draft for #544).

Verified against: compactc v0.31.0 stdlib (`compiler/standard-library.compact`), midnight-ledger 8.0.3 spec, and ecosystem reference contracts (`ShieldedERC20.compact`, `LunarswapLiquidity.compact`).

> GitHub status: the 12 inline comments + summary I posted have been **deleted**; the review body is blanked to "withdrawn". Nothing substantive is live on the PR. Edit below, then tell me to repost.

---

## Summary comment (PR-level)

Pass against the local toolchain and ecosystem reference contracts. The headline is the `_burn` spend path.

**Standard shape (ERC20 mapping for native shielded coins):**
- `name`/`symbol`/`decimals`: covered.
- `totalSupply`: exact supply is impossible, but `totalMinted` is exact (only this contract can mint its colors) and contract-mediated `totalBurned` is a lower bound. Ledger layout is fixed at deploy (#544: "Ledger state must be designed up front"), so consumers who deploy without supply tracking can never add it. Suggest shipping the `SupplyTracker` extension in this PR rather than deferring.
- `balanceOf`/`allowance`/`transfer`: not representable for native shielded UTXOs; phase two per #544. Worth stating explicitly in module docs.
- `mint`/`burn`: covered, with the inline fixes. Consider splitting burn into a user-coin variant and a treasury (contract-held coin) variant.
- Suggest a `tokenColor(domain: Bytes<32>): Bytes<32>` getter (`tokenType(domain, kernel.self())`) so integrators / future c2c callers don't re-derive the color by hand.

**Wallet visibility caveat (document at module level):** contract-initiated sends create no coin ciphertexts (stdlib note on `sendShielded`), so wallets cannot detect coins minted or refunded to them. DApps must capture the returned `ShieldedCoinInfo` and hand it to the recipient out of band.

**Tests:** only `Utils.downcastQualifiedCoin` is covered. A `ShieldedTokenSimulator` + suite is needed: mint (counter/nonce evolution, returned coin info, zero recipient, uninitialized), `_mintWithNonce` (nonce reuse), burn (wrong color, amount > value, full-burn no-change path, partial-burn refund path).

`@circuitInfo` values need regeneration after the burn changes.

---

## Inline comments

### 1. `ShieldedToken.compact` lines 232–253 — `_burn` spend path (BUG)
Spend path is inconsistent for a same-tx coin. `receiveShielded` claims a fresh output paying the contract in *this* tx, but `sendShielded` (stdlib `standard-library.compact:161-168`) does `createZswapInput(input)` — a spend proven against the global commitment tree. The just-received commitment isn't in the tree yet, and the caller-supplied `mt_index` can't point at it. Same-tx coins go through `sendImmediateShielded`, which upcasts with `mt_index: 0` into the transient path (ledger applies output + nullifier atomically; see `spec/zswap.md` `apply_transient`).

The archived module, `ShieldedERC20.compact`, and `LunarswapLiquidity.compact` all use `receiveShielded` → `sendImmediateShielded`.

Suggestions:
- User-initiated burn: take `ShieldedCoinInfo` (drop `mt_index`, meaningless here) and use `sendImmediateShielded`. `Utils.downcastQualifiedCoin` then becomes unnecessary.
- If treasury burns (contract-held coins) are in scope: a second variant taking `QualifiedShieldedCoinInfo`, no `receiveShielded`, plain `sendShielded` — change is auto-received by the contract (stdlib lines 186–194), so no refund forwarding needed there.

### 2. `ShieldedToken.compact` lines 245–252 — refund result discarded
The refund send's result is discarded, and the returned `sendRes.change` describes a coin this circuit has already re-spent. Contract sends create no coin ciphertexts, so `refundTo`'s wallet cannot discover the refund coin on its own — the caller needs the second send's `sent` info. Suggest a richer return, e.g. `struct BurnResult { sent: ShieldedCoinInfo; refund: Maybe<ShieldedCoinInfo>; }`.

### 3. `ShieldedToken.compact` line 236 — `refundTo` not zero-checked
The all-zero key equals `shieldedBurnAddress()`, so a zeroed `refundTo` silently burns the change too. Either assert `!Utils_isKeyOrAddressZero(refundTo)` (consistent with `_mint`'s recipient check) or call the footgun out in the docs.

### 4. `ShieldedToken.compact` line 66 — public nonce ⇒ recipient-public mints
Public evolving nonce matches `ShieldedERC20`/`Lunarswap`, so no objection — but worth a design note: with `nonce`, `color`, `value`, and the counter all public, a minted coin's commitment is recomputable by brute-forcing candidate recipient keys, so `_mint` is effectively recipient-public. `_mintWithNonce` with a secret random nonce is the recipient-private mint; the docs currently frame it only as an operator-flow tool.

### 5. `ShieldedToken.compact` lines 186–196 — nonce-space overlap griefing
Internal nonces evolve deterministically from public state, so anyone who can reach `_mintWithNonce` can precompute `evolveNonce(counter + n, _nonce)` and pre-mint a colliding commitment (same domain + value + recipient), making that future `_mint` fail on duplicate-commitment rejection. Narrow griefing vector, but cheap to close: domain-separate the internal evolution (e.g. hash in a module tag) or document that consumers shouldn't expose both variants for the same domain.

### 6. `ShieldedToken.compact` lines 87–100 — hand-rolled init + "Optional" params
Why hand-rolled init instead of the `Initializable` module (the `FungibleToken` convention)? If deliberate — sealed fields already force constructor-only writes, and two modules importing `Initializable` would share one flag — a short note here would save the next reviewer the question.

Also: `name_`/`symbol_` are documented as "Optional" but the params are required (the archive used `Maybe<Opaque<"string">>`). Either restore `Maybe` or reword.

### 7. `ShieldedToken.compact` lines 49–53 — supply tracking should ship now
Agreed exact supply is impossible, but the standard can commit to honest bounds: `totalMinted` is exact (color derivation guarantees only this contract mints these tokens), contract-mediated `totalBurned` is a lower bound, so circulating ≤ minted − burned. Since ledger layout is fixed at deploy, consumers who deploy without the `SupplyTracker` extension can never add it — suggest shipping it in this PR rather than deferring.

### 8. `ShieldedToken.compact` line 264 — trailing whitespace
Trailing whitespace.

### 9. `MockShieldedToken.compact` line 14 — restore type export
Restore this export (and add `QualifiedShieldedCoinInfo`) — without it the generated `index.d.ts` inlines the struct shapes instead of naming them, which the simulator/test typings will want. If it was commented out due to a compile error, worth surfacing that instead.

### 10. `MockShieldedToken.compact` line 20 — formatting / naming
Nit: `_decimals:Uint<8>` → `_decimals: Uint<8>`. Also the module uses the `name_` suffix convention for params while the mock uses `_name` — pick one.

### 11. `Utils.compact` lines 108–114 — `downcastQualifiedCoin` likely dead
If `_burn` moves to `ShieldedCoinInfo` + `sendImmediateShielded` (see comment 1), this helper has no remaining callers — the stdlib keeps its own private `downcastQualifiedCoin` for internal use. Suggest dropping it (and its mock/simulator/test plumbing) unless another consumer is in sight.

### 12. `utils.test.ts` lines 161–164 — deterministic assert
These four asserts collapse into one deterministic check: `expect(downcasted).toStrictEqual({ nonce, color, value });` — it also covers the absent `mt_index`. Nit: trailing space on `456n ` above.
