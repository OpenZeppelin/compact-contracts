# MIP-0004 review — Fungible Token Standard with UTXO Conversion Extensions

Reviewed against: compactc v0.31.0 stdlib, midnight-ledger 8.0.3 spec, the OZ
`FungibleToken.compact` it claims to extend, and the native-token standards
family drafted in this repo.

Verdict: the goal is right and several conventions are good (call-time color
derivation, zero-amount reverts, hash-based caller auth, no `ownPublicKey()`).
The conversion mechanics and the supply model have structural problems that
justify a competing proposal. Findings ordered by severity.

---

## F1 — HIGH: absorbed UTXO value is held, not destroyed → latent issuer double-spend via CMA upgrade

- `unshield(coin)` does `receiveShielded(coin)` + Map credit. The coin becomes
  a live **contract-owned shielded UTXO**. Nothing destroys it.
- `fromUtxo(amount)` does `receiveUnshielded` + Map credit. The value sits in
  the contract's ledger-level unshielded balance. Nothing destroys it.
- No circuit spends the absorbed pile **today**. But the CMA can rotate
  verifier keys and add circuits later: an upgraded contract could spend the
  accumulated absorbed value — value that was *already credited back* to Map
  balances. That is an issuer-controlled double-spend held in escrow by the
  upgrade mechanism.
- Fix: destroy inbound value at conversion time — `receiveShielded` +
  `sendImmediateShielded` to the shielded burn address; `receiveUnshielded` +
  `sendUnshielded` to the zero `UserAddress`. Burned value is unspendable
  under any future verifier key.

## F2 — HIGH: the stated supply invariant is false at ledger level

- The MIP states `totalSupply = Σ Map balances + Σ shielded UTXOs +
  Σ unshielded UTXOs`. After any `unshield`/`fromUtxo`, the absorbed value
  still exists as a UTXO / contract balance (F1) **and** was credited to Map —
  the equation double-counts unless "UTXOs" silently excludes contract-held
  value, which the MIP never says.
- Separately, `_deductBalance` breaks the basic ERC-20 invariant
  `Σ Map balances == totalSupply` (after `shield`, balances shrink but
  `totalSupply` doesn't). The MIP patches over this with the `utxoSupply`
  counter instead of preserving the invariant.
- Fix (used in our alternative): model conversion as a Map **transfer to a
  reserve account** (the contract's own address). `Σ balances == totalSupply`
  stays exactly true, `utxoSupply` is simply `balanceOf(reserve)` (no separate
  counter to drift), and inbound conversions are structurally capped by the
  reserve balance.

## F3 — MEDIUM: inconsistent conversion semantics (mint-outbound, hold-inbound)

- Outbound (`shield`/`toUtxo`) mints fresh UTXO value; inbound absorbs and
  holds. This is neither a vault (lock/release) nor burn-and-mint: ledger
  totals for the color grow monotonically with every round trip and the
  contract accumulates an unbounded absorbed pile.
- Fix: burn-and-mint on both directions — symmetric, stateless, and honest to
  ledger-level observers.

## F4 — MEDIUM: privacy claims are overstated; "private ledger state" doesn't exist

- "`mintCounter`/`mintNonce` SHOULD be private to reduce information leakage":
  non-exported ledger fields are still public on-chain. `export` only affects
  the generated TS API. The recommendation provides zero privacy and implies
  otherwise.
- With public nonce evolution, `shield` outputs are recipient-linkable
  (commitment brute-force over candidate keys), and the kernel discloses mint
  amount + domain regardless. The Motivation's "shielded UTXOs hide the
  sender, receiver, and amount" is not true of the coins `shield` creates.
- Fix: document the linkability honestly and offer a caller-nonce
  (recipient-private) variant, as the native standards do.

## F5 — MEDIUM: misstates the OZ library it extends

- Claims OZ `AccessControl` "currently authenticates via `ownPublicKey()`".
  False for the current library: `AccessControl.compact` uses witness-derived
  hash commitments (`wit_AccessControlSK` + `persistentHash`), i.e. exactly
  the pattern the MIP prescribes.
- Claims `approve`/`allowance`/`transferFrom` are "unusable" without C2C and
  defers them. OZ `FungibleToken` ships all three and they work for **user**
  spenders today; only contract *recipients* are guarded. Deferring them
  contradicts the MIP's own "MUST implement the core FungibleToken interface"
  and "MUST NOT alter existing circuits".

## F6 — LOW: `shield` has no recipient parameter and no nonce variant

- Mint-to-caller is implicit (presumably `ownPublicKey()`-derived). Fine for
  self-receive, but it precludes shield-to-other and contract recipients, and
  hides an interface dependency on a witness. Make the recipient explicit;
  add a `WithNonce` variant for recipient privacy.

## F7 — LOW: no partial unshield

- `unshield(coin)` is all-or-nothing; splitting is pushed to the wallet
  pre-transaction. A refund path (burn `amount`, refund the remainder as a
  shielded coin) costs little and matches the native standards.

## F8 — LOW: factual nits

- "The current compiler silently truncates values to 64 bits": the v0.31
  stdlib signature is `Uint<64>` — a type error, not silent truncation.
- `utxoSupply` is a single scalar conflating the shielded and unshielded
  portions; they cannot be decomposed on-chain.

---

## What we adopt from MIP-0004 unchanged

- Call-time color derivation (`kernel.self()` differs in constructors) — adopted everywhere in our family.
- Zero-amount reverts on conversion circuits.
- Hash-based commitment auth; never `ownPublicKey()` for caller verification.
- Stored single `domain` for a single-token extension (eliminates caller-supplied domain misuse).
- Deriving the unshield credit from `coin.value`, never from a separate caller-supplied amount parameter (we keep the cap `amount <= coin.value` with refund instead).

## Disposition

Our alternative — the Fungible Token Native Conversion Extension
(`FungibleTokenConverter.compact` + its MIP in this repo) — keeps MIP-0004's
goals and fixes F1–F7: reserve-account supply model, burn-and-mint inbound
destruction, explicit recipients, private-nonce variant, partial unshield,
and accurate statements about the OZ library.
