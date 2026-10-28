# Architecture

The design decisions behind OpenZeppelin Contracts for Compact and the reasoning that holds them
together. This document answers **why** the library is shaped the way it is. For **how** to write
code that fits (naming, ordering, idioms), see [`GUIDELINES.md`](GUIDELINES.md).

## Overview

Midnight contract authors compose this library's Compact modules into their own contracts. It ships
as `@openzeppelin/compact-contracts`. Stable releases are cut from audit branches and published
under the npm `latest` tag; `main` is the alpha line under `beta` ([`RELEASING.md`](RELEASING.md)).
Audit boundaries are the exact commits and scopes in [`audits/README.md`](audits/README.md). An
audit of a release does not cover later changes on `main`. Module headers are the reference; the
[docs](https://docs.openzeppelin.com/contracts-compact) cover some modules. The design preserves:

1. **Composable building blocks.** Modules and presets are imported; `examples/` holds deployables.
2. **No trusted witnesses.** Authorization and integrity hold in-circuit for any witness value.
3. **Explicit disclosure.** Shielded modules list what they reveal; public state is flagged as such.

## Repository layout

The library lives in the [`contracts/`](contracts/) package, whose [README](contracts/README.md)
covers each domain's internal layout and the mocks warning. Dependencies are the `import` lines.

| Path | Responsibility and dependencies |
| --- | --- |
| `contracts/src/access` | Ownership and role-based access control, transparent and shielded. Imports `utils`. |
| `contracts/src/crypto` | ElGamal and ECDH over Jubjub, secp256k1 ECDSA, EIP-712. No ledger state and no witnesses, so an importer inherits no witness interface it does not need. Imports nothing outside `crypto`. |
| `contracts/src/math` | Wrapping arithmetic on `Uint<N>` at any width: pure circuits, no ledger state, no witnesses. Imports nothing. |
| `contracts/src/multisig` | Signer registry, threshold approvals, proposals, treasuries, forwarders, presets. Imports `utils` and `crypto/Ecdsa`; the presets add `crypto/Eip712` and `utils/EvmAbi`. `presets/NativeShieldedTokenIssuer` is the only multisig file that imports `token`. |
| `contracts/src/security` | Initialization, pausing, allowlists and blocklists. Imports only the standard library. |
| `contracts/src/token` | Transparent, confidential and native shielded tokens, extensions, a preset. Imports `utils`. `ConfidentialFungibleToken` imports `crypto/ElGamal` and `crypto/EcdhMask`; `extensions/ConfidentialNoteFungibleTokenDelivery` imports `crypto/Ecdh`, `crypto/EcdhMask` and `math/UintN`; `presets/ZOwnableNativeShieldedToken` imports `access/ZOwnablePK`. |
| `contracts/src/utils` | Shared helpers and EVM ABI word encoding. Imports only the standard library. |
| `contracts/src/archive` | Legacy code, excluded from the build and the tests. |
| `contracts/test-utils` | Live harness, test fixtures and the concurrency replay harness. |
| `contracts/test/integration` | Contracts composed from several modules, for cross-module behaviour. |

The published package holds only the `.compact` sources, `package.json` and the README, without
`archive/` or `Mock*` contracts (the `build` script in
[`contracts/package.json`](contracts/package.json)). Consumers compile it with the compiler pinned
in [`README.md`](README.md).

## Core design principles

### Modular composition by delegation

A contract calls the exported circuits of the modules it imports and re-exposes them through its
own wrappers. Nothing is inherited, and naming and layering stay with the consumer
([extensibility](https://docs.openzeppelin.com/contracts-compact/extensibility)).

### One initialization flag per module

A module that needs an init guard owns its flag. Two modules in one directory that import
`Initializable` share one slot ([compact#270](https://github.com/LFDT-Minokawa/compact/issues/270)),
so `Initializable` stays for a single top-layer import.

### Mechanism, not policy

Building blocks such as `_mint`, `_burn`, `_send`, `_deposit` and `_allow` carry no authorization.
The consumer gates them with an access module; re-exporting one ungated makes it permissionless. A
failed assert rejects the whole transaction before any state moves, so a wrapper's guard after the
module call still blocks the operation.

### Contract recipients wait for the cross-contract migration

The modules have not migrated to contract-to-contract calls yet, so value sent to a contract would
be stranded. Until then the transparent tokens, `AccessControl` and `Ownable` reject contract
addresses but keep `_unsafe` variants; native shielded tokens mint to coin public keys or to self.

### Domain separation and instance salts

Most shielded modules tag each stored commitment and nullifier with module and purpose, as
same-shape hashes otherwise share a domain, and write a fresh `sealed` salt per deployment that
stops cross-deployment links.

### Opt-in supply tracking

The native shielded and confidential token bases track no supply, because a ledger total publishes
every amount that changes it. `*PublicSupply` extensions add one where auditability matters more.

## Privacy and witness model

**Identity.** The modules read no sender address: a caller proves identity in-circuit from secrets
its witnesses supply. Transparent modules expose a pseudonymous account id the consumer treats as
public, the `msg.sender` analogue. `ShieldedAccessControl`, `ZOwnablePK` and
`ConfidentialNoteFungibleToken` commit to a salted, per-instance identity instead;
`ConfidentialFungibleToken` keeps the transparent account id, and the native shielded tokens hold
no identity at all, only coins.

**Witnesses are untrusted.** Each witness value is bound in-circuit to public state or used so a
hostile value cannot break the module's claim; `ownPublicKey()` is a witness too. Keys and
randomness are the exception: no circuit can check that a seed is fresh or a key secret, so
confidentiality rests on the wallet supplying both. The repository's witnesses are unpublished
test doubles; consumers write and audit their own.

**Disclosure is explicit.** Shielded module headers list what a transaction publishes, what state
is public and what stays private. `disclose()` only permits a flow; the ledger write or effect
publishes it. A stateless module is still observable: a coin commitment links a receive to its spend.

## State and storage model

Ledger fields are public. `sealed` fields are written once, at construction: salts, domains,
metadata. Wallet-held secrets, notes and plaintext balances enter through witnesses. Wrappers
re-export inner ledger fields by name, so consumer ledger keys stay plain.

Generic widths (a threshold, a tree depth) are fixed at import and are part of the wire format.
Commitment trees and nullifier sets are never pruned, so capacity is permanent.

There is no ledger migration: a layout change ships as a fresh deployment ("fresh deploys only"
in [`CHANGELOG.md`](CHANGELOG.md)).

## Asset handling

**Ledger-accounted tokens** keep balances in state: plain in `FungibleToken`, `MultiToken` and
`NonFungibleToken`, as ElGamal ciphertexts in `ConfidentialFungibleToken`, and as committed notes
in `ConfidentialNoteFungibleToken`.

**Native Zswap coins** come from the `NativeShieldedToken` family. A coin's colour derives from the
token domain and the contract's address, so only that contract mints it. Mint and burn widths
differ because the protocol primitives impose it. `_burn` spends a coin paid into the transaction,
`_burnFromSelf` one the contract holds. A held coin moves through Zswap, beyond the contract's view.

**Treasuries** hold value for a multisig and move it only through ungated building blocks.

## Upgrade and versioning

There is no upgrade module. The Contract Maintenance Authority (CMA) can rotate a circuit's
verifier key but cannot migrate ledger state. Recipient types are final from day one, so contract
recipients need only a key rotation (see `FungibleToken`). Upgrades add operations; they never
change how state is derived or laid out. Wire formats (domain tags, preimage layouts, widths) are
frozen; a change orphans old state.

## Testing architecture

The suite mirrors the module map: each domain's `test/` holds mocks that expose internals,
simulators and test witnesses, and presets keep their specs beside them. The same specs run dry on
the simulator and, except the witness-only ones, live on a local Midnight stack. Integration specs
compose modules into one contract to pin init-state isolation, supply conservation and privacy.
The live harness and the CI scripts have their own dry tests.

Beyond behaviour, specs pin invariants, properties, concurrency, compatibility and privacy.
Compatibility specs pin digests, ledger slots and the circuit surface; a failure there is a
decision, not a test to fix.

Test commands are in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Constraints and non-goals

- **Contract-to-contract calls are not used yet.** The modules still reject contract recipients
  and role grantees. `ConfidentialFungibleToken` is EOA-only anyway: contracts hold no private key.
- **No `Uint<256>`, dynamic arrays, events or introspection.** `MultiToken` has no batch operations,
  and neither `FungibleToken` nor `MultiToken` claims ERC-20 or ERC-1155 compatibility.
- **Compiler and backend issues.** The shared init flags above, the newer backend's blockers in
  [Known issues](CHANGELOG.md#known-issues), and the per-transaction block byte budget
  ([midnight-node#1202](https://github.com/midnightntwrk/midnight-node/issues/1202)) that a full
  `ConfidentialFungibleToken` exceeds.
- **Circuit size is a cost.** Rows drive proving time
  ([ZK Circuits 101](https://docs.openzeppelin.com/contracts-compact/zk-circuits-101)) and SHA-256
  dominates the confidential tokens' rows.
- **Fixed capacities.** Trees never shrink; some calls land at most once per block (see headers).
- **Out-of-band coin data.** Native coins a contract mints or sends have no on-chain ciphertext;
  dropping the returned coin info strands value.
- **Runtime subgroup guarantee.** The Jubjub modules trust the runtime to keep points in the
  prime-order subgroup; `contracts/src/crypto/test/CurveRuntimeInvariants.test.ts` pins that.
- **Not provided.** Production witnesses and seed generation (wallet duties); auditor keys, freeze
  and seize for `ConfidentialFungibleToken`; multisig signer rotation; multi-owner `ZOwnablePK`;
  `archive/ShieldedToken` (archived, not for use).
