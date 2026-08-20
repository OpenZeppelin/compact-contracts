# Monument RWA Token Specification

> **Status:** draft for review (2026-08-18), written for the Monument Bank tokenized-deposit use case (phase one). Prepared for alignment with the Midnight Foundation: once agreed, this document is the baseline for what will be delivered in the year-end window, and changes to it are scope changes.
>
> **What this is.** A custom real-world asset (RWA) token solution for Monument, not a new library standard. It composes two existing OpenZeppelin workstreams, the ConfidentialNoteFungibleToken family (issue [#722](https://github.com/OpenZeppelin/compact-contracts/issues/722), core PR [#743](https://github.com/OpenZeppelin/compact-contracts/pull/743)) and the `multisig/` package, into one deployable contract. The token half and the multisig half each exist today in draft form; **their composition (§6) is the part that has no prior design artifact, and this document is that design.**
>
> **Verification.** Circuit costs are the compiler's own `@circuitInfo` numbers. Every requirement in §2 carries the date and venue where it was agreed. The code referenced is draft: not audited, not production.

This document answers the five questions the specification was commissioned to answer:

1. Is a note-based confidential token controlled by an Elliptic Curve Digital Signature Algorithm (ECDSA) multisig possible? See §8 (yes, conditional on three named external items: the ECDSA primitive reaching general availability, a passing deploy canary, and two scope decisions landing).
2. How do transfers happen? See §5.3, §6.5 (and why phase one deliberately exposes none).
3. How does accounting happen? See §5.4, §6.4, §7.
4. What is done and what is pending? See §10.
5. Is this realistic for the roughly two-month development-plus-audit window? See §11.

## 1. Summary

The Monument RWA token is a **confidential note token under institutional multisig control**. Value lives entirely inside one Compact contract as **notes**: `(value, nonce)` records owned by a per-customer key, represented on the public ledger only by hiding commitments in a Merkle tree and spent by publishing nullifiers. Amounts (including every issuance and redemption), senders, and recipients are all hidden from the public ledger. The issuer keeps the controls a regulated deposit needs: gated mint and burn, freeze, escrow-free seizure, structural auditor visibility, and provable supply. Every privileged operation is authorized by **M-of-N ECDSA signatures** (2-of-3 for phase one), matching how the custodian's hardware security module (HSM) infrastructure actually signs.

This is **confidentiality, not unaccountability**. Confidentiality means outsiders cannot read amounts, balances, or the payment graph. Unaccountability would mean nobody can, leaving no transaction auditable and no party answerable for it. Privacy systems usually deliver both at once, which is what makes most of them unusable for a regulated deposit: here the public gets confidentiality and the auditor gets everything. The design makes auditor visibility *structural*: every output note's nonce is derived from an elliptic-curve Diffie–Hellman (ECDH) exchange against the audit key, so a note the auditor cannot open cannot exist (§5.5). The regulator's view is complete by construction, not by participants' good behavior. Concretely, for phase one: customers interact only with Monument's banking app; Monument and its custodian run all keys, proving, and accounting; the public chain shows that activity exists but never what it is; and the auditor sees all of it.

**One contract, one address.** Cross-contract calls are live on Stagenet (§3), yet the multisig gates and the token compose at compile time into a single deployed contract, partly by choice and partly by constraint. The choice: one contract keeps the proving surface, the deploy budget, and the audit scope small, and decouples the Monument timeline from cross-contract availability on mainnet. The constraint: a called circuit must be witness-free, and this token's circuits run on witnesses, so the note token cannot sit behind a cross-contract call. A per-user-contract wrapper around it is not buildable today even if it were wanted (§3, §12-Q1). One contract also avoids the earlier per-user design's operational costs: deploying and maintaining a contract per customer with no factory pattern, and moving newly minted value into a customer's contract within one transaction (§6.7). A customer's segregated claim is a note keyed to their identity inside the shared contract: segregation without per-user contracts.

## 2. Requirements and provenance

Every row links the meeting where it was agreed, so this table can serve as the scope baseline. Meeting labels are the exact Google Gemini note titles: **Bitgo <> MNF <> OZ** (the recurring tri-party call between BitGo, the Midnight Foundation (MNF), and OpenZeppelin (OZ)), **MNF x OZ** (the MNF–OZ technical call), **MNF <> OZ - Steering**, **MNF + OZ + Shielded Tech Call**, and **Balance - Openzeppelin**. Requirements agreed on the BitGo-era calls are inherited by the current custodian track unless restated; the 2026-08-18 Bitgo <> MNF <> OZ call ratified the note-based design and the single-contract shape (NFR1–NFR2).

The split: **functional** rows (FR) describe behavior the deployed contract and its operators must exhibit; **non-functional** rows (NFR) constrain how the system is built, operated, and delivered (security invariants, architecture, operations, scope, schedule, dependencies, communication). Each table numbers its rows independently; every statement opens with a one-word kind (Multisig, Token, Compliance, Supply, Auditor, …), the **Phase** column marks when the row binds (phase-one rows first), and the **Owner** column names who delivers it. OZ owns only the contract side (circuits and exposed state); custodian, Monument, and MNF rows are tracked here so the baseline is complete, not because they are OZ deliverables. Scope: OZ delivers the contract side of every row, meaning the circuits and the exposed public state. The systems that call those circuits and read that state (custodian and bank backends, indexers, wallets) are outside OZ scope (§11).

### 2.1 Functional requirements

| # | Requirement | Phase | Owner | Agreed | Satisfied in |
| --- | --- | --- | --- | --- | --- |
| FR1 | **Multisig:** 2-of-3 threshold signing is a hard requirement for privileged operations | 1 | OZ | [Bitgo <> MNF <> OZ 2026-05-05](https://docs.google.com/document/d/1ObPj4JJMOT8VJ7RPEsEuishhM1w20Jt6-i7jk4f4NVo) | §6.1 |
| FR2 | **Multisig:** ECDSA is the authority scheme (operations and contract maintenance) | 1 | OZ (ECDSA primitive: MNF) | [Bitgo <> MNF <> OZ 2026-06-02](https://docs.google.com/document/d/1liZ4Ika9tbU3i1LiJKM9agrFNAcYE7ZALQwJxtZR9yQ) | §6.1, §6.4 |
| FR3 | **Multisig:** ECDSA signatures in low-s form only (malleability rule) | 1 | OZ | [MNF + OZ + Shielded Tech Call 2026-08-03](https://docs.google.com/document/d/1KEYgmB0YgFiQNzz-0JSKKZr9D4E_3uPpXpxHP4sRmmM) | §6.1 |
| FR4 | **Token (mint):** the contract exposes a mint circuit; only the issuer quorum can create value | 1 | OZ | [Bitgo <> MNF <> OZ 2026-07-07](https://docs.google.com/document/d/1bj2-YrpS24bRDl27RYyvTt8H7klpEtfrnW5X81dpXj4), [Balance - Openzeppelin 2026-07-29](https://docs.google.com/document/d/1LZcayo5wY6XVPiTZHnIX3T0jpGZnCrfP4YNfZ5h-urU) | §6.2 |
| FR5 | **Token (burn):** the contract exposes a burn circuit; customers cannot burn unilaterally, because the issuer quorum co-authorizes every redemption | 1 | OZ | [Bitgo <> MNF <> OZ 2026-07-07](https://docs.google.com/document/d/1bj2-YrpS24bRDl27RYyvTt8H7klpEtfrnW5X81dpXj4), [Balance - Openzeppelin 2026-07-29](https://docs.google.com/document/d/1LZcayo5wY6XVPiTZHnIX3T0jpGZnCrfP4YNfZ5h-urU) | §6.2 |
| FR6 | **Supply (total supply):** a tamper-evident on-chain total, readable by designated reviewers (the supply-key holders, e.g. regulator and external auditor); public proof-backed attestation available at any chosen cadence, including on-demand only (§12-Q2) | 1 | OZ (key custody: §12-Q2) | [Balance - Openzeppelin 2026-07-29](https://docs.google.com/document/d/1LZcayo5wY6XVPiTZHnIX3T0jpGZnCrfP4YNfZ5h-urU) | §5.4, §6.4 |
| FR7 | **Supply (total minted):** queryable by the custodian and verifiable by the regulator. Served by the custodian's own transaction records (it originates every mint) and the audit trail; not published on-chain by default, because a public minted counter would disclose each deposit amount as a delta (§5.4, §12-Q2) | 1 | Custodian (audit trail: OZ) | [Balance - Openzeppelin 2026-07-29](https://docs.google.com/document/d/1LZcayo5wY6XVPiTZHnIX3T0jpGZnCrfP4YNfZ5h-urU) | §5.4, §6.4 |
| FR8 | **Supply (total burned):** queryable by the custodian and verifiable by the regulator. Same serving path as FR7; a public burned counter would disclose each redemption amount (§5.4, §12-Q2) | 1 | Custodian (audit trail: OZ) | [Balance - Openzeppelin 2026-07-29](https://docs.google.com/document/d/1LZcayo5wY6XVPiTZHnIX3T0jpGZnCrfP4YNfZ5h-urU) | §5.4, §6.4 |
| FR9 | **Auditor (per-transaction dataset):** sender, receiver, token type, amount. Tracing each unit back to its minting event (genesis tracing) is confirmed not required | 1 | OZ | [Bitgo <> MNF <> OZ 2026-07-21](https://docs.google.com/document/d/1B0dDP3dsJIcBi3J6nKUgvJ171hMtCNrASWJV4CqXJm4), [Bitgo <> MNF <> OZ 2026-07-14](https://docs.google.com/document/d/15AA4kQjE5gG0OUQ8QrBgnPzcderQ7EPoxBM7c7o0kwo) | §5.5, §7 |
| FR10 | **Auditor:** a regulator view that exposes all balances under one key is acceptable to Monument; visibility stays scoped to the individual contract: no chain-wide master viewing key | 1 | OZ | [MNF <> OZ - Steering 2026-07-20](https://docs.google.com/document/d/1-Jf7TnGPRtcvBo4eeG28-ncMCLByaCHs1_uqdbsQNKA); [Bitgo <> MNF <> OZ 2026-08-18](https://docs.google.com/document/d/1pqsNKJH_b5eezxBa9bESYApB_oSrIeEMvsFHg1y6xDU) | §7 |
| FR11 | **Supply (honest and non-inflatable):** the on-chain total cannot be faked or silently inflated: it accumulates inside the mint/burn proofs, and only the true value can be attested. Governs truthfulness; who may read the total is FR6 | 1 | OZ | [MNF x OZ 2026-06-18](https://docs.google.com/document/d/1Us8V74bNPKCPemgqm975-qwUntjjqXLFRqcbfKMkeHI), [MNF x OZ 2026-07-02](https://docs.google.com/document/d/1AgvN-8UfNfP_1f9A1iPpsWgTkVUn3AmPJ9RZfBVCKEw) | §5.4, §12-Q2 |
| FR12 | **Ledger (segregated per-customer claims):** each customer's holding exists on-chain as that customer's own claim, so the chain is the authoritative ledger; an omnibus pot tracked by a bank-internal ledger is not acceptable | 1 | OZ | [Bitgo <> MNF <> OZ 2026-06-30](https://docs.google.com/document/d/1eBA5J4U7Wo-Rgk6TWUpBTciIbqNFRYxFwXhYeD1Ae_k), [Bitgo <> MNF <> OZ 2026-07-07](https://docs.google.com/document/d/1bj2-YrpS24bRDl27RYyvTt8H7klpEtfrnW5X81dpXj4) | §6.7, §12-Q1 |
| FR13 | **Wind-down:** customers must be able to recover funds if the bank winds down | 1 | Monument (process); OZ (recovery path) | [Bitgo <> MNF <> OZ 2026-04-28](https://docs.google.com/document/d/17ncCRGaEqLCxZRLjlFUj4T73mCUTOQUiBE6-0bbiisg) | §12-Q6: procedural in phase one (administrator inherits escrowed keys + multisig control); no on-chain wind-down mechanism exists in the draft implementation |
| FR14 | **Compliance (freeze):** the contract exposes a freeze operation that immediately immobilizes a specific customer claim | 2 operational; the capability ships in the phase-1 deployment (§12-Q4) | OZ | [MNF x OZ 2026-06-04](https://docs.google.com/document/d/1WC_9IR9rSlDTWAEmI5sjFc66OvBsT1zlvtD37Z8pT5Q); [Balance - Openzeppelin 2026-07-29](https://docs.google.com/document/d/1LZcayo5wY6XVPiTZHnIX3T0jpGZnCrfP4YNfZ5h-urU); MNF <> OZ - Steering 2026-06-22 (agenda; no Gemini notes) | §5.6, §6.2 |
| FR15 | **Compliance (unfreeze):** the contract exposes an unfreeze operation that restores a frozen claim | 2 operational; the capability ships in the phase-1 deployment (§12-Q4) | OZ | [MNF x OZ 2026-06-04](https://docs.google.com/document/d/1WC_9IR9rSlDTWAEmI5sjFc66OvBsT1zlvtD37Z8pT5Q); [Balance - Openzeppelin 2026-07-29](https://docs.google.com/document/d/1LZcayo5wY6XVPiTZHnIX3T0jpGZnCrfP4YNfZ5h-urU) | §5.6, §6.2 |
| FR16 | **Compliance (seize):** the contract exposes seizure of a customer claim without holding the customer's keys | 2 operational; the capability ships in the phase-1 deployment (§12-Q4) | OZ | [MNF x OZ 2026-06-04](https://docs.google.com/document/d/1WC_9IR9rSlDTWAEmI5sjFc66OvBsT1zlvtD37Z8pT5Q); MNF <> OZ - Steering 2026-06-22 (agenda; no Gemini notes) | §5.6, §6.2, §12-Q4 |
| FR17 | **Token (transfer):** customers move tokens between each other (customer-initiated transfers) | 2 | OZ (phase 2) | [Bitgo <> MNF <> OZ 2026-05-19](https://docs.google.com/document/d/1E4Vkc21ykf_DxM6t2_w8lBjqcJ6qxfDroZKG6yazJb8), [MNF x OZ 2026-06-04](https://docs.google.com/document/d/1WC_9IR9rSlDTWAEmI5sjFc66OvBsT1zlvtD37Z8pT5Q) | §5.3, §6.5 (capability exists; exposure is a phase-two composition change) |
| FR18 | **Wallets (self-custody):** end users hold their own keys and claims | 2 | OZ + MNF + custodian (phase 2) | [Bitgo <> MNF <> OZ 2026-05-19](https://docs.google.com/document/d/1E4Vkc21ykf_DxM6t2_w8lBjqcJ6qxfDroZKG6yazJb8), [MNF x OZ 2026-06-04](https://docs.google.com/document/d/1WC_9IR9rSlDTWAEmI5sjFc66OvBsT1zlvtD37Z8pT5Q) | §6.5, §12-Q1 (phase-two design) |
| FR19 | **DeFi:** participation of the token in decentralized-finance protocols | 2 | MNF + ecosystem (phase 2) | [Bitgo <> MNF <> OZ 2026-05-19](https://docs.google.com/document/d/1E4Vkc21ykf_DxM6t2_w8lBjqcJ6qxfDroZKG6yazJb8), [MNF x OZ 2026-06-04](https://docs.google.com/document/d/1WC_9IR9rSlDTWAEmI5sjFc66OvBsT1zlvtD37Z8pT5Q) | out of this document's scope (NFR22); phase-two design |

**Phase provenance.** The phase split is [MNF x OZ 2026-06-04](https://docs.google.com/document/d/1WC_9IR9rSlDTWAEmI5sjFc66OvBsT1zlvtD37Z8pT5Q): "phase one, we're just doing mint and burn … phase two is when you have full functionality" (Mahesh Sashital), with freeze and seize named phase-two requirements in the same call (Vineeth Bhuvanagiri). Those statements were made in the earlier UTXO context, where freeze/seize were technically impossible without protocol-level custom spend logic and phase two was assumed to need "an entirely different token". The note design removes that constraint, and the same call demanded the phase-one contract not require a rebuild for phase two. Hence the deployment/operational distinction in the Phase column: freeze, unfreeze, and seize MUST be present in the phase-one deployment (a capability cannot be added after deployment: NFR10, and the ledger layout is fixed at deploy time), while their operational use belongs to phase two unless MNF directs otherwise (§12-Q4).

### 2.2 Non-functional requirements

| # | Requirement | Phase | Owner | Agreed | Satisfied in |
| --- | --- | --- | --- | --- | --- |
| NFR1 | **Architecture:** the note-based architecture is the adopted primary token design for this use case | 1 | OZ | [Bitgo <> MNF <> OZ 2026-08-18](https://docs.google.com/document/d/1pqsNKJH_b5eezxBa9bESYApB_oSrIeEMvsFHg1y6xDU) | whole document; §4 |
| NFR2 | **Architecture:** phase one ships as one composable contract: multisig layer + token + custody extensions in a single deployment (driven by the witness-support gap in contract-type calls) | 1 | OZ | [Bitgo <> MNF <> OZ 2026-08-18](https://docs.google.com/document/d/1pqsNKJH_b5eezxBa9bESYApB_oSrIeEMvsFHg1y6xDU) | §3, §6 |
| NFR3 | **Architecture:** reusable building blocks, not a bespoke one-off: the solution ships as library components (the note-token family, the multisig package) composed by a thin use-case preset, so later institutional deployments reuse the same audited pieces | 1 | OZ | [Bitgo <> MNF <> OZ 2026-05-26](https://docs.google.com/document/d/1V1uUOA4Tts_6GE_CFWrdQKkFC_scWsh9fW73NUG0-0c) (reusable architecture over bespoke, aligned) | §5, §6.2 |
| NFR4 | **Upgradability:** the phase-one contract must not require a rebuild or re-issuance for phase two. Circuit implementations upgrade in place through the contract maintenance authority (CMA): the key set designated at deployment that alone may replace a contract's circuits while the address and ledger state stay unchanged. Upgrading is an operational process run from backend tooling, not an in-language mechanism. Split of duties: OZ implements the new or fixed circuits and produces the verified artifacts; the CMA key holder (the custodian's offline admin keys, NFR6) reviews and submits the upgrade transaction. Phase-two capabilities ship dormant at genesis because the ledger layout cannot change | 1 | OZ (circuit implementations); CMA key holder (applies upgrades) | [MNF x OZ 2026-06-04](https://docs.google.com/document/d/1WC_9IR9rSlDTWAEmI5sjFc66OvBsT1zlvtD37Z8pT5Q) | §2.1 phase note, §6.4 |
| NFR5 | **Custody:** no single key ever controls value. Every value-bearing operation (mint FR4, burn FR5, and freeze/unfreeze/seize FR14–FR16 once operational) and every signer-set change requires the 2-of-3 quorum, and value is never parked at an address controlled by one key at any intermediate step of those flows (the failure mode of the earlier two-transaction mint designs) | 1 | OZ | [BitGo architecture doc](https://docs.google.com/document/d/1IOdmTvO5teU-SE1i-HTCMJnn9M5dXaCCHj9176FrYmA); [Bitgo <> MNF <> OZ 2026-06-30](https://docs.google.com/document/d/1eBA5J4U7Wo-Rgk6TWUpBTciIbqNFRYxFwXhYeD1Ae_k) | §6.7 |
| NFR6 | **Keys:** two tiers of custodian key material. Cold/offline keys guard the rare, high-consequence actions: contract deployment, circuit upgrades via the contract maintenance authority (NFR4), and signer-set or threshold changes. A separate warm key set is available 24/7 for the operational tempo of mint and burn | 1 | Custodian | [Balance - Openzeppelin 2026-07-29](https://docs.google.com/document/d/1LZcayo5wY6XVPiTZHnIX3T0jpGZnCrfP4YNfZ5h-urU) | §6.4 |
| NFR7 | **Security:** the stubbed signature verifier (`stubVerifySignature`, in place until the platform ECDSA primitive is generally available) MUST hard-fail outside test builds, and the contract MUST NOT hold value while any stub is live | 1 | OZ | [Bitgo <> MNF <> OZ 2026-05-12](https://docs.google.com/document/d/17JphsJomKpfiayxjkfuHS5_l5G4Bbc6VojQqcwUkCdo) (mock-signature testing strategy); [#475](https://github.com/OpenZeppelin/compact-contracts/issues/475) | §6.1, §8.5 |
| NFR8 | **Security (role-key separation):** the audit key and the seizure-authority quorum are held by different parties, because their combination equals unilateral clawback power; each role key is itself threshold-held or hardware-guarded, and audit-key compromise (a total visibility breach, never a spend capability) triggers rotation | 1 | Monument + MNF (key allocation); custodian (key custody) | [MNF + OZ + Shielded Tech Call 2026-07-13](https://docs.google.com/document/d/1gP--f6iFbhXOaYMZRcN0AI8RPomc-0lDh8F_IxgWNsg) (compromised-auditor-key risk) | §7 |
| NFR9 | **Security (secret hygiene, proving boundary):** note nonces and randomness seeds are spend-critical secrets: high-entropy, fresh per invocation, never reused. All proving runs inside the custody boundary, because whoever runs the prover sees every witness; a hosted prover would see everything the chain hides | 1 | Custodian + Monument (operate); OZ (documents the requirements) | [Bitgo <> MNF <> OZ 2026-04-28](https://docs.google.com/document/d/17ncCRGaEqLCxZRLjlFUj4T73mCUTOQUiBE6-0bbiisg) (proof server inside the custodian boundary) | §6.4, §7 |
| NFR10 | **Governance:** the disclosure and compliance surface is fixed at deployment: who may read what (FR6, FR9–FR10) and which compliance operations exist (FR14–FR16) cannot be added or changed after deploy, because the ledger layout is immutable; only circuit implementations can be upgraded | 1 | Monument + MNF (decide); OZ (enforce) | [MNF + OZ + Shielded Tech Call 2026-07-13](https://docs.google.com/document/d/1gP--f6iFbhXOaYMZRcN0AI8RPomc-0lDh8F_IxgWNsg) | §6.6, §8.5 |
| NFR11 | **Cryptography:** the confidentiality guarantees are classical-hardness guarantees: hiding rests on discrete-log/DDH on the Jubjub curve (the ElGamal supply cell, the ECDH-derived audit and delivery masks) and on the hash functions' preimage and collision resistance (commitments, nullifiers). The scheme is not post-quantum: a future quantum adversary could retrospectively open recorded ciphertexts; keys and authorization could be rotated to post-quantum schemes, but confidentiality of already-recorded data cannot be restored. Stated as an accepted, industry-standard risk, not a defect | 1 | Monument + MNF (accept the risk); OZ (documents it) | OZ engineering baseline (this document); same position as the ConfidentialFungibleToken design precedent | §7 |
| NFR12 | **Dependencies:** the design's integrity and confidentiality rest on layers OZ does not own: the Compact compiler and its standard-library primitives (the hash functions, the Jubjub curve operations, the coming ECDSA/Keccak verifiers, and the compiler's `disclose()` analysis), the proof system's soundness and zero-knowledge, and the ledger's transcript semantics. The agreed audit baseline: the platform is assumed to behave as documented, and OZ audits cover only the logic built on top (our own `crypto/` modules, ElGamal, ECDH mask, and note delivery, sit inside that OZ scope). Assurance of the platform itself, including the ledger-9 / toolchain-0.33 release candidates this design currently targets, is an MNF / platform-team responsibility. A soundness bug below our layer means counterfeiting and a zero-knowledge or `disclose()` bug means disclosure, regardless of anything in this document | 1 | MNF + platform teams (platform assurance); OZ (audits its own layer, documents the assumption) | [MNF x OZ 2026-06-04](https://docs.google.com/document/d/1WC_9IR9rSlDTWAEmI5sjFc66OvBsT1zlvtD37Z8pT5Q) (audit baseline: platform behaves as documented; audit only the logic on top) | §8.5, §11 |
| NFR13 | **Concurrency:** concurrent operations must fail safe, never corrupt state: a transaction that loses a race is rejected before fees and retried. Customer payments scale in parallel; privileged operations serialize on the signature nonce (about one per block). The concurrency patterns were reviewed with MNF engineering, but the operational tempo this implies has never been discussed with MNF or the custodian; expectations and the improvement levers need explicit alignment (§12-Q8) | 1 | OZ | [MNF + OZ + Shielded Tech Call 2026-08-03](https://docs.google.com/document/d/1KEYgmB0YgFiQNzz-0JSKKZr9D4E_3uPpXpxHP4sRmmM) | §9, §12-Q8 |
| NFR14 | **Proving performance:** proofs generate client-side inside the custody boundary; no customer-side proving exists in phase one. The per-operation latency budget is TBD: the composed circuits are not yet fully benchmarked, the real ECDSA + Keccak verification cost is the single largest unknown (§8.1), and a jump to k=18–19 circuit sizes would materially slow proving. Benchmarking before the audit-scope freeze is a required milestone (§11). End-to-end operation latency additionally includes block inclusion and indexer finality, also unbenchmarked on the target stack | 1 | OZ (benchmarks); MNF (platform measurement program) | [MNF roadmap](https://docs.google.com/spreadsheets/d/1lO_jXRheWImyydgkM9cIP6GRJWFWOa_tsNJr8r5Q2_I) (measurement-program row) | §8.1, §8.3, §11 |
| NFR15 | **Deployability:** the composed contract must fit the node's deployment and per-block budget; a deploy canary on the release-candidate stack is mandatory before the audit scope freezes | 1 | OZ (budget bound: MNF) | [MNF <> OZ - Steering 2026-07-27](https://docs.google.com/document/d/1zs1hXIAVIVk2k40l9q-tStqnkdxa1wh8G0ZilL3ehyg) | §8.2 |
| NFR16 | **Scalability:** the design scales in customers and operations: the commitment tree holds 2^32 (about 4.3 billion) leaves with no deletion, not a practical ceiling here; the growth that needs managing is the root-history map, audit trail, and delivery list, which grow without protocol pruning. Production operations require growth monitoring and an announced-window `resetHistory` policy (each reset invalidates in-flight transactions) | 1 | OZ (design); custodian (monitoring) | OZ engineering baseline (this document, §8.4) | §8.4, §9 |
| NFR17 | **Observability:** every ledger artifact an operator needs (commitments, nullifiers, audit trail, delivery list, supply cells, counters) is exported from the contract and documented for indexer consumption. Compact's `emit` form supports only standard-library event types today (custom application events are a static error), so append-only lists are the substitute the backend subscribes to | 1 | OZ (exports + documentation); custodian (consumes) | OZ engineering baseline (this document, §3) | §3, §6.4 |
| NFR18 | **Durability:** a note is spendable only with its opening (value, nonce), and nothing on-chain stores openings in the clear, so the custodian MUST keep a durable store of openings and keys. The audit channel is the recovery backstop: every opening is re-derivable from the on-chain audit trail with the audit key, so catastrophic custodian data loss is recoverable with regulator cooperation | 1 | Custodian (primary store); audit-key holder (backstop) | OZ engineering baseline (this document, §5.5, §8.4) | §5.5, §8.4 |
| NFR19 | **Reproducibility:** deployed verifier keys MUST be reproducible from the audited source at a pinned toolchain, and every CMA upgrade ships with artifact hashes matching a reviewed build, so the deployer can always prove that what is on-chain is what was audited | 1 | OZ (pinned builds, artifact hashes); CMA key holder (verifies before applying) | OZ engineering baseline (this document) | §11; complements NFR4 |
| NFR20 | **Verification:** every invariant this document states is covered by executable tests (unit suites against the simulator and live-stack runs against a real node) before the audit begins; the family test suites are tracked in [#742](https://github.com/OpenZeppelin/compact-contracts/issues/742) | 1 | OZ | [#742](https://github.com/OpenZeppelin/compact-contracts/issues/742); OZ engineering baseline | §10, §11 |
| NFR21 | **Audit-readiness:** components pass an independent security audit, performed by OZ's audit team (organizationally separate from the library engineers), before holding value, and circuit size/complexity is not expanded while an audit is in flight | 1 | OZ audit team (scheduling with MNF) | [MNF + OZ + Shielded Tech Call 2026-08-03](https://docs.google.com/document/d/1KEYgmB0YgFiQNzz-0JSKKZr9D4E_3uPpXpxHP4sRmmM) | §11 |
| NFR22 | **Scope:** phase one is bank-managed mint and redeem only; no end-user wallets, no customer-initiated transfers, no decentralized finance (DeFi) | 1 | MNF + Monument | [Bitgo <> MNF <> OZ 2026-05-19](https://docs.google.com/document/d/1E4Vkc21ykf_DxM6t2_w8lBjqcJ6qxfDroZKG6yazJb8), [MNF x OZ 2026-06-04](https://docs.google.com/document/d/1WC_9IR9rSlDTWAEmI5sjFc66OvBsT1zlvtD37Z8pT5Q) | §6.5 |
| NFR23 | **Platform:** the contract does not depend on MNF's `discloseTo` primitive: designated-party disclosure is already covered by the contract logic (audit channel, review extension, supply key; §5.5). MNF's roadmap nonetheless gates the phase-one launch on `discloseTo` landing as a platform milestone; that gate is MNF-owned and external to this contract | 1 | MNF | [MNF roadmap](https://docs.google.com/spreadsheets/d/1lO_jXRheWImyydgkM9cIP6GRJWFWOa_tsNJr8r5Q2_I), Q4 2026 row | §5.5 |
| NFR24 | **Communication:** regulator-facing framing is "selective disclosure", not "privacy" (adopted after BitGo risk/compliance/legal approval; OCC engagement next) | 1 | all parties | [Bitgo <> MNF <> OZ 2026-08-18](https://docs.google.com/document/d/1pqsNKJH_b5eezxBa9bESYApB_oSrIeEMvsFHg1y6xDU) | §7 |
| NFR25 | **Interoperability:** when MNF's RWA standard interface (MPS-0023, roadmap Q4 2026) is ratified, the token aligns with it so wallets, custodians, and compliance tooling integrate once; alignment is a phase-two obligation tracked against the standard's timeline | 2 | OZ + MNF (the standard) | [MNF roadmap](https://docs.google.com/spreadsheets/d/1lO_jXRheWImyydgkM9cIP6GRJWFWOa_tsNJr8r5Q2_I) (RWA standard interface MPS-0023 row) | phase-two design |
| NFR26 | **Timeline:** year-end deadline for the integrated product; OZ development and audit targeted complete by mid-November so third parties can integrate inside 2026 | 1 | OZ (delivery); MNF (launch) | [MNF roadmap](https://docs.google.com/spreadsheets/d/1lO_jXRheWImyydgkM9cIP6GRJWFWOa_tsNJr8r5Q2_I) ("Monument Bank Phase 1 LIVE", Q4 2026); mid-November is the OZ delivery target (§11) | §11 |

Rows FR12 (omnibus vs. smart account) and FR11 (public vs. attested supply) have open sub-questions tracked in §12. NFR1–NFR2 were ratified on the 2026-08-18 Bitgo <> MNF <> OZ call, which also confirmed BitGo internal approval of the design.

## 3. System overview and interconnection

The system has four trust domains: **Monument** (the bank and its backend), the **custodian** (Balance: key management and signing), the **Midnight chain** (the deployed contract, nodes, indexer), and the **auditor/regulator** (holds the audit decryption key, no spend power).

```mermaid
flowchart LR
  APP[Banking app] --> MON[Monument backend]
  MON --> CUS[Custodian: Balance<br/>warm 2-of-3 signing keys<br/>offline admin keys]
  CUS --> PROVE[Proof server<br/>inside the custody boundary]
  PROVE --> NODE[Midnight node]
  NODE --> CONTRACT[(Monument token contract<br/>one address)]
  CONTRACT --> IDX[Indexer]
  IDX -. commitments, nullifiers,<br/>trails, supply state .-> MON
  CONTRACT -. audit records .-> AUD[Auditor / regulator<br/>audit key]
```

**How the elements interconnect.** Reading the contract from the outside in:

- **The multisig gate** (`EcdsaSignerManager`, §6.1) holds the signer commitments and threshold. It authorizes; it moves no value.
- **The gated entry points** (§6.2) are the only exported state-changing circuits. Each verifies M-of-N signatures over a message hash that binds the operation, its parameters, the contract address, and a monotonic nonce, and only then calls the token machinery.
- **The note core** (§5.2) owns the commitment tree and nullifier set: existence, ownership, conservation, single-spend. It is deliberately role-free; all policy lives in the gates above it.
- **The emission chokepoint** (§5.5) is one small circuit every output note passes through: the audit extension derives the note's nonce (auditor completeness), the delivery extension publishes the ciphertext the owner's wallet will find, the supply extension absorbs the delta. Compliance is structural because there is exactly one path to note creation.
- **The compliance extensions** (freeze, allowlist, review; §5.6) hang off the same spend and emission paths.
- **The public ledger artifacts** (commitments, nullifiers, audit trail, delivery list, supply cells, counters) are what the indexer reads and the custodian's backend reconciles against. Compact's `emit` form (toolchain 0.32.104 onward) covers only the standard-library event types, not custom application events, so append-only ledger lists are the event substitute for these feeds today.
- **The audit key** decrypts everything, spends nothing (§7).

```mermaid
flowchart TD
  GATE[EcdsaSignerManager<br/>signer commitments + threshold] --> OPS[Gated entry points<br/>mint · burn · freeze · seize · rotate]
  OPS --> EMIT[emitOutput chokepoint]
  EMIT --> AUDIT[Audit extension<br/>derives every output nonce]
  EMIT --> DELIV[Delivery extension<br/>on-chain note ciphertexts]
  EMIT --> SUPPLY[Supply extension<br/>attested]
  OPS --> CORE[Note core<br/>commitment tree + nullifiers]
  CORE --> LEDGER[Public ledger artifacts]
  AUDIT --> LEDGER
  DELIV --> LEDGER
  SUPPLY --> LEDGER
```

**The composition rule.** Every element above is a Compact *module* compiled into **one contract at one address**. This is a composition choice, not a platform limitation (see the status note below), and the module mechanism is what makes it sound: modules are private unless composed; the preset imports each under a prefix and exports only its own gated circuits, so internal building blocks (`Core__mint`, the ungated freeze write, and so on) are not public entry points. This is the same mechanism-vs-policy split the rest of the library uses; what is new here is which policy sits on top (§6).

**Cross-contract calls: status, and why phase one does not use them.** Cross-contract calls are live on Stagenet (toolchain 0.33 / ledger-9 release candidates; ledger 9 has not reached mainnet). Two of their rules decide this design:

- **Callees must be witness-free under the current toolchain, and the call boundary discloses.** Today's compiler disqualifies witness-calling circuits from contract types, a restriction the toolchain itself marks "not yet supported", so it may relax. What will not relax is the boundary: the callee’s address is revealed on-chain, and call arguments must be marked disclosed; the caller cannot stop the callee from publishing them. The note token's circuits run on witnesses (the input note, the spend secret, Merkle paths, randomness seeds), and those are exactly the values that must never cross a public boundary, so they cannot be callees under either the temporary rule or the permanent one. A confidential token composes inside one contract; at most it acts as a call *root*, never a callee.
- **The re-entrancy ban is a toolchain guard, not a consensus rule.** The client runtime rejects `A → B → A` shapes; the chain itself does not, and the language reference calls cyclic call graphs undefined. Call graphs are therefore designed acyclic, and non-re-entrancy is treated as a client-stack property.

What calls do unlock is multi-contract architecture *around* the token: per-user account contracts and public-argument compositions. That is a phase-two conversation (§6.7, §12-Q1); nothing in phase one depends on it, which also keeps the Monument deadline decoupled from cross-contract availability on mainnet.

## 4. Why a note model

Four requirements drive the elimination: hidden amounts including issuance (FR9's dataset is for the *auditor*, not the public), segregated per-customer claims with the chain as the ledger (FR12), freeze and seize (FR14–FR16), and honest supply (FR11). Each alternative fails at least one:

| Approach | What it is | Why not (for this use case) |
| --- | --- | --- |
| Account-based confidential token (the library's ConfidentialFungibleToken) | encrypted balances per account, updated homomorphically | **the account graph is public**: who-pays-whom, registrations, and mint/burn events stay visible even with amounts hidden. Hot accounts also serialize (one credit per block) |
| Native shielded (Zswap) coins + custody wrappers | protocol-level shielded UTXOs issued by a contract | **every mint and burn amount is public** (protocol supply deltas), and a coin in a wallet is a bearer instrument: freeze/seize are structurally impossible after issuance without key escrow |
| Ring signatures / stealth addresses on an account model | hide the sender behind decoys | **circuit-constraint blowup**; evaluated and rejected 2026-07-13; the note model is both cheaper and more private |
| Omnibus balance + internal bank ledger | one on-chain pot, per-customer accounting off-chain | **rejected 2026-06-30**: Monument requires the chain itself to be the ledger |
| Per-user contract instances (the earlier custodian architecture) | one multisig treasury contract deployed per customer | **no factory pattern in Compact**: deploying and upgrading 100k+ contracts by hand; contract addresses leak the customer count. Minting into a per-user contract in one transaction (the old error-186 failure) is now unblocked at the ledger level (§6.7), but a per-user shape cannot be rescued by wrapping this token either: called circuits must be witness-free, and the note token’s are not (§3). Phase one also cannot depend on cross-contract mainnet timing |
| **Notes in one contract** | commitments + nullifiers inside a single contract | **Chosen.** The only shape that hides amounts, sender, and recipient at once *and* leaves the issuer a contract-mediated handle on every claim |

Sender privacy is the forcing constraint: hiding which account a debit touches requires an unindexed commitment set with in-circuit membership proofs and nullifiers, and that *is* the note model. This is also why the Midnight Foundation confirmed the note design as the direction for Monument (2026-08-17): it is the design whose promises match the system they are integrating.

**Prior art, honestly stated.** The skeleton is Zcash's (commitments, nullifiers, Merkle membership), rebuilt inside a contract, with three deliberate deviations: the nullifier omits the owner secret (enabling escrow-free seizure, §5.6), every output carries an audit record that cannot be omitted or faked (§5.5), and the pool is one contract's state rather than a protocol shielded pool.

## 5. The token: building blocks consumed

The token half of the composition is the ConfidentialNoteFungibleToken family ([#722](https://github.com/OpenZeppelin/compact-contracts/issues/722)). This section states only what the Monument deployment consumes and the properties the multisig design relies on; the family's own specification carries the full circuit-by-circuit detail.

### 5.1 The note algebra

A note is `Note { value: Uint<128>, nonce: Field }` owned by `pk = Hf(sk)`. On the ledger it exists only as the commitment `cm = H("OZ:note:commit", value, nonce, pk)` in a `HistoricMerkleTree`. Spending publishes `nf = H("OZ:note:null", nonce)` and proves tree membership in zero knowledge without revealing which leaf. All derivations are domain-separated; the pure circuits (`derivePk`, `commitOf`, `nullifierOf`) are exported so backends and auditors compute identities exactly as the circuits do.

**The nullifier preimage is the nonce alone, with no owner secret.** This is the family's load-bearing deviation from Zcash: anyone who knows a nonce derives the same nullifier. It is what makes seizure escrow-free (§5.6) and it makes every nonce a spend-critical secret end to end. In the phase-one custodial topology, all nonces live inside the Monument/custodian boundary, which contains this risk but concentrates it (§7).

### 5.2 The core (PR [#743](https://github.com/OpenZeppelin/compact-contracts/pull/743), open)

The core owns the commitment tree and nullifier set and nothing else: no balances, no accounts, no supply, **no roles**. It provides self-gated `transfer`/`burn` for standalone use and ungated `_mint` / `_transfer` / `_burn` / `_consumeNote` building blocks for composition. Conservation (`input = output + change`) is asserted inside the proof. Ownership is bound in the commitment, not the nullifier, which is exactly the hook seizure uses.

### 5.3 Transfers (family capability; not exposed in phase one)

A transfer consumes one input note and creates a recipient note plus a change note: publicly, one nullifier and two commitments, nothing else. The capability exists and is costed (§8.1); phase one deliberately does not export it (§6.5). When phase two adds customer-to-customer movement, it is an additive composition change, not a redesign (FR17).

### 5.4 Supply (accounting)

The core writes no supply; supply is a per-deployment policy choice:

| Variant | Public sees | Fit |
| --- | --- | --- |
| none | nothing; auditor reconstructs from the audit trail | insufficient for FR11 |
| confidential, designated readers | a ciphertext; the total is readable only by the supply-key holders (e.g. regulator, external auditor) | hides per-deposit amounts and the program size; reviewers verify continuously; no public proof until one is requested |
| confidential + public attestation | a proof-backed total at a chosen cadence (homomorphic ElGamal running total; attestation proves the decryption) | hides per-deposit amounts; publishes the program size at each attestation |
| fully public counters ([#740](https://github.com/OpenZeppelin/compact-contracts/issues/740)) | every mint/burn delta, live | simplest queries; **leaks each deposit/redemption amount with its timestamp** |

FR6 requires an authoritative, verifiable total on-chain; FR7–FR8 (gross minted and burned) are served by the custodian's own records and the audit trail rather than by public state; FR11 requires the total to be non-inflatable. Every variant except "none" satisfies FR11. The two confidential rows are the same deployed code: the attestation circuit ships either way, and cadence is an operational choice, not a code choice. This specification recommends **confidential with designated readers, attesting publicly on demand**: the regulator verifies continuously (supply key and audit trail), the public can be handed a proof-backed total whenever one is needed, and the bank's day-to-day program size stays off the public record. Public counters contradict the reason the note model was chosen (hidden issuance) and remain only a fallback if the regulator requires live public totals (§12-Q2). **Mechanism note (FR9).** The designated-reader property needs no extra module: it is the supply extension plus key custody. Reviewers read the encrypted accumulator with the supply key (exact verification via the audit trail for the regulator; a bounded discrete-log decode, cheap at bank magnitudes, for a key-only reviewer), and `attestSupply` turns the same cell into a public proof on demand. One consequence to weigh in §12-Q2: attestation requires the supply secret, so every read-capable key holder can also publish; if publication control should stay separate, the key goes to the external auditor and the regulator verifies via the audit trail instead. Note also what the extension does not contain: a single net accumulator, so gross minted and burned totals (FR7–FR8) are not on-chain even for the supply-key holder; separately attested gross accumulators are the optional extension named in §12-Q2. The review extension (§5.5) plays no role here either: it scopes per-transaction disclosure to designated parties, not totals.

Accounting per customer is off-chain by construction: the custodian's backend tracks notes per `ownerId` from the delivery/audit data it already holds (§6.4).

### 5.5 Audit: completeness by construction

For every output note, the audit extension runs an ECDH against the audit key, **derives the note's nonce from the shared secret**, and publishes an encrypted audit record of `(value, owner)`. Because the nonce comes out of the audit ECDH and the commitment binds the same fields inside one proof, an output the auditor cannot open cannot exist. The auditor recovers amounts, recipients, and, via published nullifiers matched against earlier records, senders: exactly the FR9 dataset, with no honest-participation assumption. The audit key decrypts; it can never spend.

The **review extension** adds scoped, per-designee disclosure alongside the global audit channel (records encrypted to an approved reviewer key, e.g. a custodian’s financial intelligence unit (FIU)). Its final shape is pending FIU feedback (§12-Q3). Relation to the platform's `discloseTo` roadmap item (NFR23): the contract-level channels above deliver day-one auditor completeness without waiting for platform features; `discloseTo` adds platform-level scoped viewing keys that the same records can ride when it lands. The two are complementary, and this contract does not block on `discloseTo` for its own audit channel.

### 5.6 Compliance: freeze, seize, allowlist

- **Seize (escrow-free).** The authority consumes the target note using the audit-trail data as witness and re-mints the full value to a recovery key, audited and delivered like any output. Owner-spend and seizure derive the *same* nullifier, so they are mutually exclusive: first to land wins, and the authority never holds customer spend keys. A public seizure counter provides accountability (how many, never against whom).
- **Freeze.** A frozen-nullifier set checked at the owner-spend chokepoint: freezing a note blocks its owner-spend while leaving seizure available. The operational sequence is freeze → finality → seize.
- **Know-your-customer (KYC) allowlist.** Spend-time Merkle-membership proof (a hidden spender cannot do a `Set` lookup without disclosing a stable pseudonym). Phase one has no customer-initiated spends, so the allowlist gates onboarding administratively; it becomes load-bearing in phase two.

**Wind-down (FR13), and why it is mostly key governance.** Three layers, none of them a new token mechanism: the audit trail is a complete on-chain creditor ledger (the regulator can reconstruct every position from chain data even if the bank records are lost); an administrator inheriting the escrow keystore and multisig shares continues redemption unchanged; and if the keystore is lost, seize doubles as the recovery path: the authority quorum, armed with audit-trail witnesses, moves every claim to administrator-held recovery notes (one note per transaction; batch recovery would need the same multi-input consumption as note consolidation, [#737](https://github.com/OpenZeppelin/compact-contracts/issues/737)). The binding decision is key governance: the authority quorum and audit key must survive the bank failure, which argues for an independent or regulator-designated share in the 2-of-3 set (§12-Q6). A customer-initiated exit (issuer heartbeat + time-gated recovery spend, via the existing block-time kernel reads) would be a small new extension: meaningful only once customers hold keys (FR18), and it must ship at genesis if ever wanted (NFR10).

## 6. The multisig integration (the new design)

This section is the part of the system that existed nowhere before this document: how the ECDSA multisig controls the note token.

### 6.1 Authorization: threshold ECDSA replaces the role secrets

The family's draft preset gates its roles by **hash-preimage proof**: the caller proves knowledge of a secret whose hash matches a stored role key. That is a single shared secret: no threshold, no rotation of individual signers, and nothing an institutional HSM can produce. The custodian requirement (FR1–FR3, NFR5, NFR6) is signatures from independently held ECDSA keys.

**The mechanism already exists in the `multisig/` package.** `EcdsaSignerManager` stores signers as commitments `H(pk, instanceSalt, domain)` in an M-of-N registry and verifies a vector of `(pubkey, signature)` pairs against a message hash, folding the valid count against the threshold. The Monument preset replaces each role gate with a call into this verifier:

- **Message binding.** Each operation verifies signatures over `msgHash = H(opDomainTag, contractAddress, paramsHash, opNonce)`: the operation selector, this contract instance, every consequential parameter, and a monotonic per-contract nonce. A signature for one operation, parameter set, instance, or point in the sequence cannot authorize any other; the nonce blocks replay. This is the pattern already implemented in `ShieldedMultiSigV3` and it carries over unchanged.
- **Signature form.** Low-s signatures only (FR3), matching the Ethereum-ecosystem HSM convention the custodians use.
- **Hash function.** The message hash MUST be `keccak256` in production to match HSM signing formats; the current code uses `persistentHash` as a stand-in until the Keccak primitive is available.
- **The stub boundary.** ECDSA verification is stubbed today (`stubVerifySignature` returns true; issue [#475](https://github.com/OpenZeppelin/compact-contracts/issues/475)). The stub MUST hard-fail outside test builds so a stubbed contract can never reach a production network. Real `ecdsaVerify` was validated end-to-end on Stagenet with multisig flows (2026-08-03) on the release-candidate (RC) toolchain (PR [#713](https://github.com/OpenZeppelin/compact-contracts/pull/713)); general availability (GA) of the primitives is a Midnight Foundation deliverable (§8.5).
- **A known defect to fix before composition.** The verifier's duplicate-signer detection compares adjacent entries only, which is correct for 2 signatures but not for 3+ (issue [#629](https://github.com/OpenZeppelin/compact-contracts/issues/629)). Phase one submits exactly 2 signatures, but the fix lands before audit regardless.

### 6.2 The gated operation set

Working name for the deployable composition: **`MultisigConfidentialNoteFungibleToken`** (final name is a review question). Its exported circuit surface, and who authorizes what:

| Operation | Gate | Notes |
| --- | --- | --- |
| `mint(ownerId, encPk, value, sigs)` | 2-of-3 ECDSA (warm set) | creates a note for a customer; amount hidden; audited + delivered |
| `burn(value, sigs)` | 2-of-3 ECDSA **and** the note owner's spend proof | redemption; the bank proves the customer's note with the escrowed key, the multisig co-authorizes (FR5: customers cannot burn unilaterally, and the bank cannot burn without the note either) |
| `freeze(nf, sigs)` / `unfreeze(nf, sigs)` | 2-of-3 ECDSA | immediate; works while other activity is in flight |
| `seize(targetOwnerId, recoveryId, recoveryEncPk, sigs)` | 2-of-3 ECDSA | escrow-free clawback per §5.6; scope question §12-Q4 |
| `authorizeAccount(ownerId, sigs)` | 2-of-3 ECDSA | onboarding into the allowlist |
| `rotateSigner(...)` / `changeThreshold(...)` | 2-of-3 ECDSA (offline/admin set) | signer-set maintenance |
| `attestSupply(total)` | supply-key proof | publishes the proof-backed total (confidential+attested variant) |
| read circuits | none | supply cells, counters, signer-set queries |

Two-party control falls out of the structure: minting needs the multisig but creates value only as an audited note; burning needs the multisig *and* a valid note spend; seizure needs the multisig *and* the audit trail. No single key, and no single trust domain, can move value alone.

### 6.3 Direct signatures, not on-chain proposals (phase one)

The `multisig/` package offers two authorization flows: **direct threshold signatures** (each call carries the co-signatures, V3 style) and the **`ProposalManager`** (propose on-chain, approve, execute; recently extended with expiry deadlines in PR [#780](https://github.com/OpenZeppelin/compact-contracts/pull/780)). Phase one uses **direct signatures**:

- The custodian's operational model is "sign this message hash with the warm keys" (FR4–FR8, FR14–FR15, NFR6): machine-driven, single-transaction, no human quorum workflow on-chain.
- The proposal flow adds ledger state, extra circuits (contract size, §8.2), and extra pinned reads (concurrency, §9) for a coordination problem phase one does not have.
- The proposal manager remains the right tool for slower, human-quorum governance actions and can be composed in phase two without disturbing the phase-one surface.

### 6.4 Key topology and the custodian API

Mapping the custodian's required operations (FR4–FR8, FR14–FR15) and key model (NFR6) onto the contract:

| Custodian endpoint | Contract surface | Signing keys |
| --- | --- | --- |
| mint | `mint(...)` | warm 2-of-3 set |
| burn | `burn(...)` | warm 2-of-3 set + escrowed owner key (witness) |
| freeze / unfreeze | `freeze(...)` / `unfreeze(...)` | warm 2-of-3 set |
| total supply | encrypted on-chain accumulator, read with the supply key; publicly attested value when/if published (§12-Q2) | supply key (reads) |
| total minted / total burned | custodian's own transaction records (closed loop), verifiable against the audit trail; separately attested gross accumulators are an optional extension (§12-Q2) | none |

- **Warm operational set (2-of-3).** Available 24/7 for mint/burn/freeze tempo. Signer keys live in the custodian's HSM infrastructure; the contract stores only salted commitments to them, so the on-chain state does not even reveal the operating public keys.
- **Offline admin keys.** Signer-set rotation and threshold changes are gated to the admin quorum. The contract-upgrade authority (Midnight's contract maintenance authority; circuits are upgradable, the ledger layout is not) belongs with the same offline keys (FR2).
- **Audit key.** Held by the auditor/regulator arrangement Monument designates; separated from the seizure authority as a matter of duty separation (§7).
- **Witness discipline.** Customer spend secrets and note openings are witnesses: they exist only inside the Monument/custodian boundary, and the proof server MUST run inside that boundary. A hosted or third-party prover would see everything the chain hides.

The custodian's transaction discovery is a closed loop (their own words, 2026-07-29): they originate every transaction, hold the relevant keys, and reconcile against the indexer's view of commitments, nullifiers, and trails. Nothing in this design requires them to read other parties' data, and nothing lets them.

### 6.5 Phase-one circuit surface: deliberately narrow

Phase one exposes **no transfer**. The custodian operation set (FR4–FR8, FR14–FR15) includes no transfer, and phase-one doctrine is bank-managed mint/redeem only (NFR22). Consequences, in order of importance:

1. **Contract size.** The transfer circuit is the family's largest (k=18, ~136k rows, two full emission pipelines). Excluding it from the deployed contract removes the single biggest contributor to the block-budget risk (§8.2).
2. **Concurrency.** No customer-initiated spends means the allowlist admin-vs-spend contention and same-note races are phase-two concerns (§9).
3. **Scope honesty.** "Customers move tokens" is exactly the phase-two boundary MNF drew; building it now would be unrequested scope.

Segregation is unaffected: every customer's claims are distinct notes under their own `ownerId`, on-chain, satisfying FR12 without customer-facing circuits.

### 6.6 Operation flows

Deposit → mint:

```mermaid
sequenceDiagram
  participant App as Banking app
  participant Mon as Monument backend
  participant Cus as Custodian (warm keys)
  participant CT as Contract
  participant Aud as Auditor

  App->>Mon: customer deposits GBP
  Mon->>Mon: build mint params (ownerId, encPk, value), read nonce
  Mon->>Cus: request 2-of-3 signatures over msgHash
  Cus-->>Mon: signatures
  Mon->>Mon: prove mint circuit (proof server in-boundary)
  Mon->>CT: submit mint tx
  Note over CT: verify sigs, nonce++<br/>audit record → nonce → commitment<br/>delivery ciphertext, supply delta
  CT-->>Aud: audit record (decryptable)
  CT-->>Mon: indexer: commitment + delivery confirmed
```

Withdrawal → burn (freeze/seize intervene on the same spend path):

```mermaid
sequenceDiagram
  participant App as Banking app
  participant Mon as Monument backend
  participant Cus as Custodian (warm keys)
  participant CT as Contract

  App->>Mon: customer requests withdrawal
  Mon->>Mon: select note (escrowed key + opening + Merkle path)
  Mon->>Cus: request 2-of-3 signatures over burn msgHash
  Cus-->>Mon: signatures
  Mon->>Mon: prove burn circuit
  Mon->>CT: submit burn tx
  Note over CT: verify sigs + owner spend proof<br/>nullifier published, change note re-minted<br/>supply delta absorbed
  Note over CT: freeze marks the nullifier first if compliance intervenes<br/>seize consumes the same nullifier via the authority path
  Mon->>App: GBP released off-chain
```

Both flows change nothing after deployment: the policy (who signs, what is audited, what the public sees) is fixed at deployment time (NFR10). Signer *keys* rotate under the admin quorum; the policy shape does not.

### 6.7 Relation to the earlier custodian architecture

The BitGo-era design ("Midnight Onboarding — Architecture & Design Decisions") put each customer in their own V2 multisig treasury contract, with a shared V3 mint authority, on native Zswap coins. Its **requirements survive** in this specification: 2-of-3 ECDSA (FR1), HSM-held platform keys, multisig custody at every step (NFR5), indexer-driven reconciliation. Its **architecture is superseded**, though not for the reason assumed at the time. Minting into a per-user contract failed because the client stack could not construct a transaction satisfying the ledger's coin-claim rule, so the chain rejected the unclaimed output (error 186). The ledger itself permitted contract-to-contract coin forwarding all along: the coin-claim rule (every contract-owned coin claimed by exactly one contract in the same transaction segment) is unchanged from ledger 8 to 9.1. The remaining client gap, a callee's shielded-coin state, was closed in the compact runtime after the current Stagenet pin. So the V3-mint-into-V2 flow is becoming buildable. It stays the wrong shape for this use case on the other grounds: per-user deployment has no factory and no upgrade story (the language cannot create contract instances), native coins make every mint and burn amount public, and contract addresses leak the customer count. In the note model, "mint to the customer" is an internal note creation inside the one contract (no hop, no second contract, no public amount), and NFR5 holds because value never exists outside the multisig-governed contract at all.

## 7. Privacy and disclosure, stated precisely

| Observer | Sees | Does not see |
| --- | --- | --- |
| Public / any indexer | that commitments, nullifiers, encrypted records, and supply-cell updates appeared; operation shape and timing; seizure count; attested totals at their cadence | amounts, balances, customer identities, who-paid-whom |
| Custodian (closed loop) | everything about transactions it originated; the full reconciliation view of its own notes | nothing about any other party's data |
| Monument | everything (it runs onboarding, holds escrowed keys, sees all openings) | nothing |
| Auditor / regulator (audit key) | every output's `(owner, value, nonce)`, hence every balance and the full flow graph (FR9, FR10) | it cannot spend, freeze, or seize |
| Seizure authority | nothing extra by itself | it acts only when armed with audit-trail data for a specific target |

Named honestly, the residual leaks and concentrations:

- **Shape and timing are public.** A mint (one commitment) is distinguishable from a burn/seize (nullifier + one commitment) and a transfer (nullifier + two commitments); counts and timestamps are visible. Amounts and parties are not.
- **The audit key is all-seeing by design.** FR10 records that Monument accepts this. Compromise of the audit key is total *visibility* compromise (never spend capability); audit-key + authority-key collusion equals unilateral clawback, so the two MUST be held under separated duties, and both SHOULD themselves be threshold-held.
- **Phase one concentrates custody.** Monument's boundary holds every customer key and every nonce (spend-critical secrets). That is the deliberate phase-one topology (NFR22); the note model's self-custody capability is what phase two graduates into, without changing the token.
- **Issuance-time linkage.** Off-chain knowledge that "customer X deposited at time T" combines with public timing. On-chain data alone reveals nothing; the mitigation for stronger threat models is batching (§9).

## 8. Feasibility and constraints

The commissioned question: is this possible, yes or no, and what does it depend on. First the numbers, then the verdict.

### 8.1 Circuit costs (compiler `@circuitInfo`)

| Circuit | k | rows | in phase-one deploy set? |
| --- | --- | --- | --- |
| core `_consumeNote` | 14 | 12,248 | yes (inside burn/seize) |
| core `_mint` | 14 | 10,964 | yes (inside mint) |
| audit `_emitAuditedOutput` | 15 | 31,599 | yes (inside every output) |
| delivery `_deliver` | 15 | 23,198 | yes |
| supply `_addMinted` / `_addBurned` | 13 | ~7k | yes |
| preset `mint` (audited + delivered + supply) | 17 | 69,322 | yes, + ECDSA verification |
| preset `burn` | 17 | 82,803 | yes, + ECDSA verification |
| preset `seize` | 17 | 75,043 | pending §12-Q4, + ECDSA verification |
| preset `transfer` | 18 | 135,775 | **no** (§6.5) |
| `attestSupply` | 13 | 4,720 | yes |

**The unmeasured term is ECDSA.** Real `ecdsaVerify` + `keccak256` costs on top of each gated circuit are unknown until the primitives are measured on the release-candidate toolchain; this is the single largest cost unknown, and measuring it is an explicit early milestone (§11). The dominant cost everywhere else is the SHA-class `persistentHash`; a platform Poseidon-class hasher would cut roughly 5× across the stack with no source changes (an issue has been open with the compiler team since March 2026, and a formal problem statement was agreed to be raised). That is a cost lever, not a feasibility condition.

### 8.2 Contract size and the block budget

The hard constraint is the node's per-transaction block byte budget. Observed data points: the block-size limit dropped from 5 MB to 1 MB (2026-07-27); block-weight "1010" errors appeared at four-plus k=16 circuits under ledger v8; and ledger 9.1 RC3 moved deploys to **verifier-key-only**, after which the multisig V2/V3 contracts deployed with all circuits including a k=17 (2026-07-28). From the ledger source at tag `ledger-9.1.0.0-rc.3`: the transaction byte cap is 1 MiB, but block admission is a multi-dimensional limit whose size dimension is roughly 200 KB of estimated transaction size per block, so the block dimension binds first; verifier keys resolve on-chain per (contract address, entry point), a 9.1 deploy carries v3 keys only, and deploy-time entry-point metadata passes a 50 KB size check. The phase-one surface was scoped with this in mind: no transfer (the k=18 outlier), one contract, roughly six-to-eight gated circuits.

Mitigations, in order: verifier-key-only deploys (already on the RC stack), the trimmed surface (§6.5), incremental deployment if needed, and getter-circuit removal. Two obligations follow. First, a **deploy canary**: the composed contract MUST be deployed against the RC stack before the audit scope freezes, because the budget is empirical. Second, MNF SHOULD publish the documented upper bound (requested 2026-07-27, still open).

### 8.3 Proving and throughput

Proving runs client-side inside the custody boundary; platform estimates are seconds-scale per proof and MNF's own roadmap flags real measurements as outstanding. Phase-one tempo is bank-driven mint/redeem, where seconds-per-operation proving and one-privileged-operation-per-block serialization (§9) are compatible with launch-scale volume; the ceiling and its levers are stated in §9 rather than hidden.

### 8.4 Long-lived state

The commitment tree is fixed-depth with 2^32 leaves (about 4.3 billion, no deletion): not a practical ceiling for this use case. The growth that does need managing is elsewhere: the root-history map, audit trail, and delivery list grow without protocol pruning, so a production operations plan needs growth monitoring and an announced-window `resetHistory` policy (each reset invalidates in-flight transactions). Lost note openings are unrecoverable by rescanning (nothing is on chain but hashes); in this topology that reduces to custodian backup discipline, and it is listed as such in §10's operational obligations.

### 8.5 Verdict

**Yes, conditionally.** An ECDSA-multisig-controlled, note-based confidential token is buildable now as one contract, and nothing in the design waits on cross-contract calls (live on Stagenet, deliberately unused here; §3), factories, or platform privacy features. The conditions, all external and all named:

1. **ECDSA + Keccak primitives reach general availability** on a deployable network (validated on Stagenet on the RC toolchain 2026-08-03; GA is an MNF/platform deliverable). Until then the signature gate is a stub and the contract MUST NOT hold value.
2. **The composed contract passes the deploy canary** under the current block budget (expected to pass given verifier-key-only deploys and the trimmed surface; asserted empirically, not assumed).
3. **The supply-variant and seize-scope decisions land** (§12-Q2, Q4) before the audit scope freezes, because ledger layout is fixed at deployment (NFR10).

Not conditions: a Poseidon-class hasher (cost, not feasibility) and `discloseTo` (the contract's own audit channel is self-contained; the platform gate NFR23 is MNF's to manage).

## 9. Concurrency

The family's conflict analysis carries over; what matters for this composition:

- **Privileged operations serialize on the signature nonce by design.** Replay protection requires each signed operation to bind the current nonce, which pins it: two concurrent multisig operations conflict and one retries. Effective tempo is one privileged operation per block (~seconds). At launch-scale deposit volume this is adequate; the levers, if volume outgrows it, are batch outputs (N deposits in one mint proof, tracked as a family extension) and partitioned nonce lanes per operation class.
- **Supply updates serialize** on the encrypted-supply cell. The family already has the fix designed and implemented in draft (a commuting delta inbox whose attestation proves the inbox empty; [#729](https://github.com/OpenZeppelin/compact-contracts/issues/729), [#736](https://github.com/OpenZeppelin/compact-contracts/issues/736)); adopting it is a composition choice if mint/burn tempo demands it.
- **A losing racer pays nothing on-chain** (guaranteed-segment failure rejects before fees); the cost is rebuild-reprove-resubmit inside the custody backend.
- **Freeze/seize ordering** is operational: freeze wins only if it lands first, so the authority sequence is freeze → finality → seize (§6.6).
- **Phase-two note**: customer-initiated transfers commute with each other and with mint/burn (append-only tree, per-key nullifier writes), so opening the transfer surface later scales payments without touching the phase-one gates. Allowlist administration vs. in-flight customer spends becomes the contention to manage then.

## 10. Status: done vs. pending

| Component | Status | Where |
| --- | --- | --- |
| Note core (tree, nullifiers, conservation, `OZ:note:*` tags) | implemented, unit-tested, **in review** | PR [#743](https://github.com/OpenZeppelin/compact-contracts/pull/743) (fixes [#723](https://github.com/OpenZeppelin/compact-contracts/issues/723)) |
| Crypto primitives: ElGamal, EcdhMask | merged | `crypto/` |
| NoteDelivery primitive | implemented, tested (draft branch) | [#735](https://github.com/OpenZeppelin/compact-contracts/issues/735) |
| Audit / Delivery / Supply / ConcurrentSupply extensions | implemented in draft, compile-verified; to re-land as reviewed PRs | [#726](https://github.com/OpenZeppelin/compact-contracts/issues/726), [#727](https://github.com/OpenZeppelin/compact-contracts/issues/727), [#728](https://github.com/OpenZeppelin/compact-contracts/issues/728), [#729](https://github.com/OpenZeppelin/compact-contracts/issues/729) |
| Freeze / Allowlist / Review extensions | implemented in draft; Review shape pending FIU feedback | [#730](https://github.com/OpenZeppelin/compact-contracts/issues/730), [#731](https://github.com/OpenZeppelin/compact-contracts/issues/731), [#732](https://github.com/OpenZeppelin/compact-contracts/issues/732) |
| Family test suites for the invariants | not yet | [#742](https://github.com/OpenZeppelin/compact-contracts/issues/742) |
| Multisig signer registry + proposal manager | merged on `main` | `multisig/` |
| `EcdsaSignerManager` (commitment registry + fold verify) | implemented on a branch; duplicate-detection fix needed for 3+ | [#629](https://github.com/OpenZeppelin/compact-contracts/issues/629) |
| ECDSA/Keccak integration on the RC toolchain | in progress (draft), validated on Stagenet | PR [#713](https://github.com/OpenZeppelin/compact-contracts/pull/713), [#475](https://github.com/OpenZeppelin/compact-contracts/issues/475) |
| Stub hard-fail outside test builds | open requirement | [#475](https://github.com/OpenZeppelin/compact-contracts/issues/475) |
| **The Monument preset (this document's §6)** | **designed here; not built; no tracking issue yet** | none yet |
| Deploy canary on the RC stack | not run | §8.2 |
| Security audit of the composition | not started | §11 |

Operational obligations that are *not* contract work but are load-bearing: custodian backup of note openings and nonces (§8.4), proof-server placement inside the custody boundary (§6.4), and the audit/authority duty separation (§7).

## 11. Plan and timeline realism

Working backwards from NFR26: third parties need the audited contract early enough to run their own integration inside 2026, and the custodian expects extension-complete alphas around late September. That leaves, from this week, roughly **five to six development weeks before an audit-scope freeze**, then the audit and the integration window. The precedent for pace: the family's core, nine extensions, and presets already exist in draft; this plan is mostly landing, composing, and hardening, not inventing.

| Window | Work | Exit criterion |
| --- | --- | --- |
| Week of Aug 18 | This specification agreed with MNF; §12 decisions collected; preset tracking issue filed | signed-off baseline |
| Weeks of Aug 24 – Sep 07 | Re-land family extensions as reviewed PRs with the invariant test suites ([#742](https://github.com/OpenZeppelin/compact-contracts/issues/742)); fix [#629](https://github.com/OpenZeppelin/compact-contracts/issues/629); ECDSA cost measurement on the RC toolchain | extensions merged; ECDSA cost known |
| Weeks of Sep 07 – 21 | Build the Monument preset (§6.2), simulator, tests; **deploy canary** on the RC stack; live contention check on mint/burn | composed contract deploys; invariants green |
| Late Sep | Scope freeze; audit begins (baseline per prior agreement: platform primitives are assumed documented-correct; audit covers our logic on top) | audit start |
| Oct–Nov | Audit + remediation; custodian integration against preview/Stagenet in parallel (collaboration agreed 2026-07-29) | audited artifact |
| Dec | Third-party integration window; MNF gate items (`discloseTo`) land per their roadmap | Monument phase one live (MNF milestone) |

**Ownership boundaries, stated so they cannot creep.** OpenZeppelin delivers standards and smart contracts: the family modules, the Monument preset, simulators, tests, and this documentation. Backends, wallets, unspent-transaction-output (UTXO) stores, key ceremonies, proving infrastructure, and production deployment belong to Monument/Balance; ECDSA-primitive GA, the block-budget bound, `discloseTo`, and audit scheduling belong to the Midnight Foundation. One known gap to surface with MNF: the custodian expects a final, ready-to-deploy contract, and today no party owns that last-mile productization (§12-Q5).

**The honest risk list**: ECDSA GA slipping (the schedule's long pole: everything value-bearing is behind it), the deploy canary failing (fallbacks: incremental deployment, further surface trimming), audit findings in the novel seams (the audit-derived-nonce channel and the multisig binding are the two places to expect attention), and decision latency on §12 (each open question that slips past the scope freeze becomes a phase-two item by default, because ledger layout cannot change post-deployment).

## 12. Open questions

| # | Question | For | Default if unanswered |
| --- | --- | --- | --- |
| Q1 | Omnibus vs. smart accounts: is the note model's "segregated claims in one contract" accepted as satisfying FR12? The known wrinkle: the 2026-06-04 discussion cited European anti-money-laundering rules as wanting individual wallet addresses per user; the note model provides individual cryptographic identities and claims, not individual addresses, and regulatory acceptance of that reading needs confirming. Smart-account-per-user is no longer call-blocked (cross-contract calls run on Stagenet) but stays gated on: no factory (contract instances cannot be created from the language), the witness-free-callee rule (§3), which blocks any per-user wrapper from calling into this token; the absence of contract private state, so a per-user contract cannot custody its customer’s secrets; callee shielded-coin support only in compact-runtime releases newer than the Stagenet pin; and ledger-9 mainnet timing; phase two at the earliest. | MNF + Monument | notes-in-one-contract (this spec) |
| Q2 | Supply disclosure: (a) who holds the supply key, meaning which reviewers may read the total continuously; (b) public attestation cadence, scheduled (publishes the program size each time) or on-demand only; (c) are separately attested gross totalMinted/totalBurned accumulators required on-chain, or do the custodian's records plus the audit trail suffice (FR10–FR11)? Live public counters stay a regulator-mandated fallback only | MNF + Monument regulator view | regulator + external auditor hold the supply key; attestation on demand; no on-chain gross counters |
| Q3 | Review-extension shape: what exactly must the custodian FIU see, per record? | Balance/FIU | global audit channel only in phase one |
| Q4 | Compliance operations phasing: freeze (FR14), unfreeze (FR15), and seize (FR16) ship in the phase-one deployment regardless, because capabilities cannot be added after deployment (NFR10; ledger layout fixed at deploy time). Which of them, if any, is exercised during phase one? | MNF + Monument | deployed at genesis behind the 2-of-3 gate; operational use deferred to phase two |
| Q5 | Who owns final productization and deployment of the contract the custodian expects to receive ready-to-run? | MNF | unassigned; must be raised |
| Q6 | Wind-down mechanics (FR13): off-chain redemption commitment vs. an on-chain recovery path | Monument | off-chain redemption; on-chain: audit-trail creditor list + seize-as-recovery under a bank-failure-surviving quorum (§5.6); trustless customer exit deferred to phase two |
| Q7 | ECDSA/Keccak GA date and the documented block-budget bound | MNF | plan assumes GA before scope freeze |
| Q8 | Operational tempo: what mint/burn/freeze throughput does phase one actually require? Privileged operations serialize on the signature nonce (about one per block). If the required tempo is higher, the levers are the concurrent-supply delta inbox ([#729](https://github.com/OpenZeppelin/compact-contracts/issues/729)), batch outputs ([#739](https://github.com/OpenZeppelin/compact-contracts/issues/739)), and partitioned nonce lanes; each is a build decision needed before the scope freeze | MNF + Monument + custodian | current tempo assumed sufficient for bank-driven phase one |
| Q9 | Data-protection classification: nothing customer-identifying is stored on-chain (pseudonymous keys and ciphertexts only), but whether the encrypted audit records and pseudonymous claims count as personal data under UK data-protection law, and what retention and erasure posture that implies for an immutable chain, is a legal determination for Monument | Monument (legal) | assumed acceptable: no plaintext personal data on-chain |

## 13. Common questions (FAQ)

**Can the public see a customer's balance or deposit history?** No. The ledger shows commitments, nullifiers, and ciphertexts. Balances, amounts, and identities appear nowhere on-chain, at any time, including at mint and burn.

**Can Monument or the custodian inflate the supply?** Not silently. Every mint updates the encrypted supply accumulator inside the same proof that creates the note, so the total the designated reviewers read, and any attestation published from it, is proof-backed. A wrong total cannot be published without failing the proof, and the regulator can independently reconstruct the supply from the audit trail.

**What if the audit key is compromised?** Every balance and flow becomes visible to the holder. Visibility, not theft: the audit key cannot spend, freeze, or seize. Combined compromise of audit *and* authority keys equals clawback power, which is why the two are separated duties and each should itself be threshold-held.

**What if a warm signing key is compromised?** Nothing moves on one key: the threshold is 2-of-3, every signature binds a specific operation and nonce, and the admin quorum rotates the signer set. On-chain, signers are salted commitments, so the key set is not even enumerable from state.

**Can a customer be paid by someone other than the bank?** Not in phase one: there are no customer wallets and no transfer surface (NFR22). The family supports customer-to-customer transfers; exposing them is the phase-two composition change.

**Why not the account-based confidential token the library already has?** It hides amounts but keeps the account graph public, and hot accounts serialize on credits. The requirement here includes sender/recipient privacy on a chain-as-ledger (FR12); only the note model delivers that (§4).

**Is this Zcash?** Same commitment/nullifier skeleton, three deliberate differences: nullifiers omit the owner secret (escrow-free seizure), audit records are structurally unavoidable (auditor completeness), and the pool is a single contract's state under an institutional multisig.

**Is the current code deployable?** No. Signature verification is stubbed (always-true) until the platform ECDSA primitive is generally available, and the stub must hard-fail outside tests. Nothing value-bearing deploys before that flips (§8.5).

## 14. References

- ConfidentialNoteFungibleToken family: umbrella [#722](https://github.com/OpenZeppelin/compact-contracts/issues/722) and sub-issues [#723](https://github.com/OpenZeppelin/compact-contracts/issues/723)–[#742](https://github.com/OpenZeppelin/compact-contracts/issues/742); core PR [#743](https://github.com/OpenZeppelin/compact-contracts/pull/743); design draft `confidential-note-token.md` (family branch); exploration draft PR [#679](https://github.com/OpenZeppelin/compact-contracts/pull/679) (closed, superseded by the per-sub-issue PRs).
- Multisig package: `contracts/src/multisig/` on `main`; `EcdsaSignerManager` branch; ECDSA integration PR [#713](https://github.com/OpenZeppelin/compact-contracts/pull/713); issues [#475](https://github.com/OpenZeppelin/compact-contracts/issues/475), [#629](https://github.com/OpenZeppelin/compact-contracts/issues/629), [#619](https://github.com/OpenZeppelin/compact-contracts/issues/619); proposal expiry PR [#780](https://github.com/OpenZeppelin/compact-contracts/pull/780).
- Custodian-era architecture: "Midnight Onboarding — Architecture & Design Decisions" ([Google Doc](https://docs.google.com/document/d/1IOdmTvO5teU-SE1i-HTCMJnn9M5dXaCCHj9176FrYmA)): requirements inherited, architecture superseded (§6.7).
- Midnight Foundation roadmap: "SHARED w/ OZ MN Roadmap 2026-2027" ([sheet](https://docs.google.com/spreadsheets/d/1lO_jXRheWImyydgkM9cIP6GRJWFWOa_tsNJr8r5Q2_I)): Monument Phase 1 (Q4 2026, gated on `discloseTo`), tokenized-deposit contract framework, shielded contract tokens, and the Midnight Problem Statement MPS-0006 custody design.
- Cross-contract calls: CoIP-2 (`LFDT-Minokawa/compact`, `coips/coip-0002.md`) and the toolchain 0.33 release notes; "Cross-contract calls on Midnight — how they work" ([Google Doc](https://docs.google.com/document/d/1oJlQ3izG7GqZ9gOOZSpFNjf20oGKsx8YPldtxKkYQ-Q), draft); ledger semantics inspected at tag `ledger-9.1.0.0-rc.3` (`ledger/src/verify.rs`, `ledger/src/structure.rs`, `ledger/src/semantics.rs`, `ledger/tests/composable.rs`).
- Meeting record for §2 provenance (labels are the Gemini note titles): Bitgo <> MNF <> OZ (2026-04-21 … 2026-08-18), MNF x OZ (2026-06-04 … 2026-07-02), MNF <> OZ - Steering (2026-06-22 agenda, 2026-07-20, 2026-07-27, 2026-08-03, 2026-08-10), MNF + OZ + Shielded Tech Call (2026-07-13, 2026-07-27, 2026-08-03, 2026-08-10), Balance - Openzeppelin (2026-07-29).
- Prior art: Zerocash (Ben-Sasson et al., IEEE S&P 2014); Zcash protocol specification §3.2, §3.8–3.9 (notes, commitment trees, nullifiers); Native Shielded Token standard (Midnight Improvement Proposal MIP-0011) and its custody-extension draft for the seize/privacy exclusivity analysis.
