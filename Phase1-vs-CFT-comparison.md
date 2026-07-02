---
title: MGBP balance model — Confidential preset vs CFT + multisig
timestamp: 2026-07-02
author: 0xisk
status: draft (for the CFT review call, Friday 2026-07-10)
sources:
  - MNF x OZ meeting notes + transcript, 2026-07-02
  - BitGo "Midnight Onboarding — Architecture & Design Decisions" doc
  - ConfidentialFungibleToken.compact (PR #602, branch pr-602-add-cft, commit 170eeaa)
  - MultisigConfidentialShieldedToken-design.md (Phase 1 design artifact, v1)
---

# MGBP balance model — full comparison

**A** = `MultisigConfidentialShieldedToken` (our Phase 1 preset: native Zswap
omnibus reserve + operator-keyed encrypted ledger, custodial).
**B** = `ConfidentialFungibleToken` + multisig front (the CFT track:
account-based contract token, per-user keys, transfers; ECDH memos planned).

Framing: no delivery-time pressure assumed. The question is the best base for
the project, not the fastest ship.

## Architecture & trust model

| Dimension | A — Confidential preset | B — CFT + multisig |
|---|---|---|
| Token substance | Native Zswap coins (contract-owned reserve) + encrypted claims | Pure contract state; no Zswap coin (MNF signals acceptable — Jul 2) |
| Key model | ONE operator ElGamal key for all ciphertexts | Per-user keypairs (`_encryptionKeys` registry); users own their secrets |
| Custody model | Fully custodial; users are keyless | Self-custodial by design; custodial mode possible (custodian holds user keys) |
| Who proves | Operator only (backend + local proof server) | Each user proves their own transfers (local proof server per user) |
| Multisig gating | Built in (EcdsaSignerManager + msgHash + replay nonce) | Not present; needs a wrapper — our multisig front is reusable as-is |

## Privacy, property by property

| Property | A | B (as coded, PR #602) | B (CFT roadmap) |
|---|---|---|---|
| Transfer amounts | n/a (no transfers) | Hidden | Hidden |
| Per-customer issuance amounts | **Hidden** (`credit` amount-private; mint aggregate, unattributed) | **Public** — `_mint(account, value)` leaks (accountId, amount) via plaintext `totalSupply` delta | Fixable with our credit pattern (mint to authority, transfer out) |
| Total supply | Encrypted cells + public aggregate mints (invariant formally accepted Jul 2) | Plaintext `_totalSupply`; mint AND burn amounts public | Same |
| Burn/redemption amounts | Hidden (amount-private reserve burn) | Public (supply delta) | Same unless redesigned |
| Counterparty graph | Operator↔customer star only; no user-to-user edges exist | (sender, recipient) pseudonym pair public per transfer — the known "CFT gap" | Recipient hidden via ECDH; sender: weak anonymity set (unsolved) |
| Caller anonymity | Moot — users never touch the chain | Users submit txs; weak set | Weak set |
| User count visibility | # of touched customer ids | # of registered accounts + registration txs | TBD |
| Balance recoverability | Regulator: BSGS under 2^48 balance cap | Wallet caches plaintext; memos BSGS-recovered ≤ 2^48 per transfer; balances `Uint<128>` uncapped | ECDH memos: read directly; cap lifted |

## Compliance & custody capability

| Capability | A | B |
|---|---|---|
| Auditor/regulator view | Operator key decrypts everything; receipts for customers | None in v1 (module header: "deliberately left to companion modules"); viewing keys = roadmap, TBD Friday |
| Seize | Trivial (operator debit, non-consenting redeem) | Explicitly out of scope v1 — needs authority balance visibility |
| Freeze / allowlist | Implicit (operator only serves KYC'd ids) | `register()` is open; needs an allowlist companion module |
| Solvency / backing proof | Strongest point: reserve coins == Enc(supply) + Enc(unallocated), enforced in-circuit, O(1) audit | Plaintext supply is honest, but backing is off-chain attestation (no reserve, no unallocated concept) |
| Escrowed allowances | n/a | `approve`/`transferFrom` with private caps (genuinely good) |

## Functionality & future

| Dimension | A | B |
|---|---|---|
| Customer↔customer transfers | None — that is our entire Phase 2 | Native, today, amounts hidden |
| DeFi/ecosystem trajectory | Bespoke custody product | ERC20-shaped standard surface; likely ecosystem CFT standard |
| Concurrency | Replay nonce serializes all ops (fine, custodial) | Two transfers to same recipient in one block conflict (documented v1 limit) |
| 2^48 cap | On balances (marked interim in design v2) | Per-transfer only; lifted entirely by ECDH |

## Wallet integration & UX

| Dimension | A | B |
|---|---|---|
| End-user wallet | None needed. Monument UI + operator API; optional receipt verification | Bespoke wallet required: 2 secrets (SK + EK), registration tx, scan own memo list, decrypt + BSGS each memo, maintain a plaintext balance cache that is load-bearing for the user's own next transfer (`wit_PlaintextBalance`) |
| Existing wallet support | Irrelevant | Lace does not speak CFT; SDK/wallet build-out is real work; events (ledger 9) needed for sane indexing |
| Proof server | Operator-side only | Per-user local proof server (or the custodian proxies it — then privacy-from-custodian is gone) |
| BitGo's role | ECDSA signing oracle, zero crypto burden | Signing oracle + (custodial mode) key custody, memo scanning, per-user balance caches — heavier |
| UX failure modes | Operator books wrong → receipts catch it | Stale balance cache → own transfers fail; missed memo → invisible funds until rescan |

## Strategic

| Dimension | A | B |
|---|---|---|
| MNF backing | Accepted fallback (Phase 1 supply invariant formally accepted Jul 2) | Explicitly favored by MNF ("CFT with a multisig in front"; decouple BitGo from Monument) |
| Maturity | Design v1 done, draft compiles, deployable on Midnight 1.0 today | Module + tests exist (PR #602); custody-relevant half does not; ECDH not started in-lib; review Friday |
| Maintenance | Bespoke stack owned by us indefinitely | Shared standard, shared audits |

## Verdict (no time pressure)

B is the better base token; A is not a competing token — it decomposes into
exactly the companion modules B is missing. Best-for-project path:

- Adopt CFT as the token layer.
- Re-target our work as the custody layer on top:
  - multisig front (as-is);
  - issuance privacy — our `credit` pattern fixes B's public per-account mint leak;
  - solvency accounting — our Supply module (token-agnostic after the split);
  - seize / freeze / allowlist companion modules;
  - auditor access (converge with viewing-keys design).
- That package is precisely what "CFT with a multisig in front" needs to be
  deployable for BitGo/Monument, and nobody else is building it.

## Conditions to settle at the Friday review

1. Issuance privacy: is public per-account mint acceptable, or does Monument's
   hidden-issuance need our credit pattern added to the CFT track first?
2. Viewing keys / seize: companion-module shape, authority model, timeline.
3. ECDH cost with the persistent hasher pre-Poseidon — measured, not estimated.

## Out of scope of this comparison

- BitGo's V2+V3 smart-account architecture — orthogonal custody-topology
  question (per-user contracts vs omnibus); either token model can sit behind
  it. Gated on the Stagenet C2C verification list, tracked separately.
