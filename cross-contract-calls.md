# Cross-Contract Calls on Midnight

> **Status:** living draft (2026-07-24), destination Notion. A general-purpose reference and discussion doc for cross-contract calls: the opening sections describe the feature as it exists today, and *Open questions* collects the design questions worth working through. Add new questions there rather than forking new docs.
>
> **Verification.** Every mechanics claim is tagged with a clickable marker like [\[1\]](#ref-1) that jumps to *References*, which deep-links to the exact lines on GitHub at the pinned commits: [`LFDT-Minokawa/compact`](https://github.com/LFDT-Minokawa/compact) @ `c06961e` and [`midnightntwrk/midnight-ledger`](https://github.com/midnightntwrk/midnight-ledger) @ `e1edad2`. Code marked *(verbatim)* is copied from examples the toolchain's own e2e suite compiles; code marked *(sketch)* is ours and not yet compiled. The *Prior art: zk stacks* comparison was verified against each platform's official documentation on 2026-07-23 (refs [\[62\]](#ref-62)–[\[65\]](#ref-65)).

# Summary

A **cross-contract call (C2C)** is one deployed contract's circuit invoking a circuit on another deployed contract, inside a single transaction. The feature is merged in the Compact toolchain under [CoIP-0002 "Contract Types, Values, and Calls"](https://github.com/LFDT-Minokawa/compact/blob/main/coips/coip-0002.md), introduced at toolchain 0.32.105 (language 0.24.102), and ships in the current RC matrix: compactc [0.33.0-rc.2](https://github.com/LFDT-Minokawa/compact/releases/tag/compactc-v0.33.0-rc.2), runtime 0.18.0-rc.1, ledger 9.1.0.0-rc.3 (JS package numbering; the Rust `midnight-ledger` repo is at 8.2.0-rc.1), node [2.0.0-rc.4](https://github.com/midnightntwrk/midnight-node/releases/tag/node-2.0.0-rc.4), midnight-js 5.0.0-beta.4.

Be precise about what shipped: this is **stage one of multi-contract systems**. Interfaces are compile-time types, a DApp binds one implementation per contract type, callees must have no private state, and the call graph must form a forest. Dynamic implementation discovery is explicitly deferred to a future CoIP [\[1\]](#ref-1). What is dynamic today is the **instance**: a circuit can receive a contract reference as a parameter and call whatever deployment the transaction supplies.

That dynamism is where the main design question lands: whether a DApp should be able to **restrict the callable contracts to a vetted set** rather than dispatch to arbitrary addresses. Q1 (in *Open questions*) works through what exists today, how EVM and other zk stacks handle the same question, and the trade-offs involved.

Primary design overview from the Midnight team: [Cross-contract calls on Midnight — how they work](https://docs.google.com/document/d/1oJlQ3izG7GqZ9gOOZSpFNjf20oGKsx8YPldtxKkYQ-Q/edit?usp=sharing) ([announcement thread](https://openzeppelin.slack.com/archives/C0A94G0PS64/p1784042986745349)).

# Concepts, from the sources

The terms this doc relies on, defined by the primary sources rather than restated. Quoted text is verbatim. (C2C, CCC, and "cross-contract call" name the same thing: the Midnight team's docs write CCC, this doc writes C2C.)

- **Cross-contract call (C2C / CCC).** "A cross-contract call (CCC) is one deployed contract's circuit calling a circuit on **another** deployed contract, inside a single transaction. The result is a **call tree**: the root circuit and every callee it invokes, proven and applied atomically." — Midnight team design doc [\[67\]](#ref-67). In language terms: "Cross-contract calls: `reference.circuit(args...)` invokes a circuit named in the reference's type." — Compact changelog [\[1\]](#ref-1).
- **Contract type.** "Compact programs can specify a collection of circuit signatures (that is, their names, parameter types, and return types) to describe other contracts on which they depend." — CoIP-0002 [\[66\]](#ref-66). "A contract type is a regular program-defined Compact type, just like a structure type or enumeration type." — language reference [\[2\]](#ref-2).
- **Contract reference (contract value).** "A reference is introduced from application code by passing a deployed contract's address where a value of the contract type is expected." — Compact changelog [\[1\]](#ref-1). And the inverse does not exist in-language: "No mechanism is provided within the Compact language to *create* values with contract types." — language reference [\[11\]](#ref-11).
- **`contract implements C;`.** "A contract implements a contract type whenever it exports a matching circuit for each one the contract type declares — but when the assertion is present the compiler verifies it and rejects the contract at compile time if any required circuit is missing or has a non-matching signature." — Compact changelog [\[1\]](#ref-1).
- **Static vs dynamic C2C.** "Dynamic C2C" is **not a term defined in Midnight documentation**; it is the team's working name (Slack, July 2026) for calls whose callee is chosen at runtime — in today's language, exactly the contract-typed circuit parameter (see *Holding a callee reference*). The clearest published definition of the distinction is Leo's: "Static calls require the callee program to be known at compile time … Dynamic calls allow the callee to be determined at runtime." [\[62\]](#ref-62). The sourced anchor for Midnight's future work in this direction: "Later proposals will address dynamic discovery of contract implementation code and management of private state across contracts." — CoIP-0002 [\[66\]](#ref-66).
- **Call tree / call forest.** "The result is a **call tree**: the root circuit and every callee it invokes" [\[67\]](#ref-67); the ledger requires a transaction's call graph to be "a forest (no cycles, no multiple parents)" — ledger source comment [\[68\]](#ref-68).
- **Communication commitment.** "A communication commitment, which commits to the inputs and outputs of the circuit being called." — ledger spec [\[42\]](#ref-42).
- **Entry point.** The name under which a callee circuit's verifier key is stored and looked up on-chain; the ledger resolves a call via the callee's `operations` map keyed by entry-point name — ledger spec [\[39\]](#ref-39), [\[47\]](#ref-47).
- **Maintenance authority / maintenance update.** The per-contract committee-plus-threshold that authorizes replacing the contract's verifier keys (`VerifierKeyRemove` / `VerifierKeyInsert`) or the authority itself — ledger source [\[52\]](#ref-52), [\[54\]](#ref-54).
- **Guaranteed / fallible sections.** "First the guaranteed transcript is applied, then the fallible transcript, with any failure during the fallible transcript application reverting to the state after the guaranteed transcript was applied." — ledger spec [\[44\]](#ref-44).
- **`expectedVk` (implementation binding).** The compiler-emitted SHA-256 fingerprint of a callee circuit's verifier key, compared by the runtime against the deployed key on every call — Compact changelog [\[26\]](#ref-26).

# How cross-contract calls work

## The callee interface is a type

A caller declares the circuits it will call with a `contract` block. This is a compile-time type, not a deployment [\[2\]](#ref-2), [\[3\]](#ref-3); the interface block itself [\[7\]](#ref-7):

```compact
// examples/composable/direct/Main.compact (verbatim)
contract Calculator {
    circuit get_square(x: Field): Field;
    circuit get_cube(x: Field): Field;
}
```

Contract typing is **structural, not nominal** [\[4\]](#ref-4): any contract exporting matching circuits satisfies the type. The type system therefore cannot express *identity*; anything identity-shaped (vetting, allowlists) must key on the address or the verifier key (see Q1). A callee can opt into a static conformance check with `contract implements Calculator;` [\[5\]](#ref-5).

Since Issue 201, most interface-conformance checking moved from compile time to **runtime guards** (see *Runtime guards*). The compiler still rejects a call to a circuit the interface never declared: `"contract C has no circuit declaration named f"` [\[6\]](#ref-6).

## Holding a callee reference

A contract-typed value is a reference to a specific deployed instance. There are two ways to hold one, and they have different trust shapes.

**As a ledger field** [\[8\]](#ref-8), fixed at deploy time:

```compact
// examples/composable/direct/Main-constructor.compact (verbatim)
ledger calc: Calculator;

constructor (c: Calculator) {
    calc = disclose(c);
}
```

**As a circuit parameter** [\[9\]](#ref-9), chosen per call. This is the dynamic-dispatch form:

```compact
// examples/composable/direct/Main-circuit-parameter.compact (verbatim)
circuit calculate_square(calc: Calculator, i: Field): Field {
    return calc.get_square(disclose(i));
}
```

Contract types are ordinary types, so references also live in ledger collections: `Map<Field, C>`, `List<C>`, `MerkleTree<2, C>` all work [\[13\]](#ref-13). This enables the vetted-registry idiom in Q1.

Two hard limits shape what architectures are possible:

- **References cannot be created from addresses in-language.** `Calculator(address)` is rejected with `"invalid context for reference to contract type name Calculator"` [\[10\]](#ref-10). References enter a contract only from application code, via constructor or circuit arguments, or from a witness return [\[11\]](#ref-11).
- **Constructors cannot make cross-contract calls.** A dedicated compiler pass rejects them: `"constructor cannot call external contracts"` [\[12\]](#ref-12). Storing a reference in the constructor is fine; calling through it is not.

## Disclosure

The reference itself must always be disclosed, **"because a cross-contract call reveals the address of the called contract"** [\[14\]](#ref-14). A ledger-held reference was disclosed when stored; a parameter-held reference needs `disclose()` on the path to each call. Call *arguments* additionally need disclosure unless the callee circuit is declared `pure` in the interface, because an impure callee might publish them.

Omitting it is a compile error (wording verified end-to-end [\[15\]](#ref-15)):

```text
potential witness-value disclosure must be declared but is not:
  witness value potentially disclosed: the value of parameter calc of exported circuit calculate_square ...
  nature of the disclosure: contract call contract reference might disclose the witness value
```

## A contract's own address

`kernel.self()` returns the executing contract's `ContractAddress` [\[16\]](#ref-16), used when a contract must name itself, for example as the sender in token operations it drives [\[17\]](#ref-17):

```compact
// doc/compact-reference.mdx:3352-3356 (verbatim)
import CompactStandardLibrary;
circuit f(): ContractAddress {
  return kernel.self();
}
```

`ContractAddress` is `struct ContractAddress { bytes: Bytes<32>; }` [\[18\]](#ref-18). At runtime a contract value flattens to its 32-byte address, but the struct and the contract-typed value are **not interchangeable in-language** (see *Holding a callee reference*).

## Return values

A callee's return value flows back into the caller like any local value; the static type is the declared return type [\[19\]](#ref-19). Callees can even return contract references the caller reuses [\[20\]](#ref-20):

```compact
// test-center/composable/Basic/Outer.compact (verbatim, abridged)
contract Inner {
  circuit add(value: Field): Field;
}
export ledger inner: Inner;
constructor(i: Inner) { inner = disclose(i); }

export circuit add(value: Field): Field {
  return inner.add(disclose(value));
}
export circuit setInner(i: Inner): Inner {
  const lastInner = inner;
  inner = disclose(i);
  return lastInner;
}
```

## What a callee may be

- **Witness-free on the called path.** The compiler eliminates circuits that call witnesses from cross-contract consideration [\[21\]](#ref-21), and the runtime enforces it: a callee that invokes a witness throws ``Cross-contract callee '<addr>' invoked witness '<name>'`` [\[22\]](#ref-22). In effect, **called contracts must have no private state** on the paths you call.
- **No shielded (Zswap) coin operations inside a callee** [\[23\]](#ref-23), [\[55\]](#ref-55) — the main limit on moving token value through a call tree; see *Shielded coins and callees* below.
- **No generics across the boundary**: circuit declarations in contract types cannot be generic [\[24\]](#ref-24).
- Contract-typed *values* may still pass through witnesses as parameters or returns [\[25\]](#ref-25).

## Shielded coins and callees

The shielded-token stdlib circuits — `mintShieldedToken`, `receiveShielded`, `sendShielded`, `sendImmediateShielded`, `mergeCoin` [\[56\]](#ref-56) — all call the runtime primitives `createZswapInput`, `createZswapOutput`, or `ownPublicKey`. Each asserts a **Zswap local state** and throws `CompactError: "Zswap local state is undefined for contract '<addr>'"` when it is absent [\[55\]](#ref-55). The current runtime wires a Zswap local state into the **root** call only; a cross-contract callee runs in a sub-context that has none. So any shielded mint/send/receive/merge **inside a callee throws** — shielded value cannot move below the root of a call tree.

Two clarifications from the code:

- **Reads are fine.** `hasCoinCommitment` only reads the per-call query context, not the Zswap local state, so it does not throw in a callee.
- **Unshielded tokens use a different path.** `mintUnshieldedToken` / `sendUnshielded` / `receiveUnshielded` go through `kernel.*` effects, not Zswap local state [\[57\]](#ref-57), so they are not gated by this guard. (Whether they compose end-to-end through a tree is untested here; they are simply not blocked by the shielded-coin assertion.)

This reads as a **client-runtime limitation, not a ledger rule**: the ledger's per-call effects already carry a contract's shielded nullifiers, receives, spends, and mints [\[58\]](#ref-58), so the structure anticipates contract calls that touch shielded coins. Treat "no shielded ops in a callee" as a stage-one gap to confirm on the roadmap, not a proven permanent bar.

## Runtime guards

Every cross-contract call passes four dynamic guards in the Compact runtime [\[26\]](#ref-26):

| Guard | What it checks | On violation |
| --- | --- | --- |
| Re-entrancy | callee not already on the client call stack [\[27\]](#ref-27) | `Contract re-entrancy detected: '<addr>' is already executing on the call stack; re-entrant cross-contract calls are not yet supported` |
| Implementation binding | SHA-256 of the deployed verifier key matches the compiler-emitted `expectedVk` fingerprint | `ContractInterfaceMismatchError` |
| Purity | the callee's real purity (its own `pureCircuits` map) matches the `pure` annotation in the caller's interface — checked both directions [\[59\]](#ref-59) | `Expected pure circuit '<id>' for callee '<addr>' to be defined` (interface said `pure`, callee is not) or `… to be undefined` (interface omitted `pure`, callee is pure) |
| Witness | the callee does not *invoke* a witness on the called path — declaring witnesses is fine, invoking one is trapped [\[60\]](#ref-60) | `Cross-contract callee '<addr>' invoked witness '<name>'; calls to witnesses in non-root contracts are not yet supported` |

Sequential calls to the same callee are fine [\[28\]](#ref-28); A→B→A and self-recursion are rejected [\[29\]](#ref-29), [\[30\]](#ref-30). Note the implementation-binding guard: **code-identity checking by verifier key already exists in the pipeline.** Q1 builds on this.

**Purity, in detail.** The caller's `contract` interface annotates each circuit `pure` or not; the deployed callee's generated bindings expose the set of circuits its own compiler proved pure (`pureCircuits`). The guard cross-checks the two and rejects a mismatch **either way** — a `pure` interface over an impure implementation, or a non-`pure` interface over a pure one [\[59\]](#ref-59). This matters because purity drives disclosure: arguments to a `pure` callee need no `disclose()` (see *Disclosure*), so a wrong `pure` annotation would let a caller under-model a call's state effects. The message text comes from the generic `assertDefined` / `assertUndefined` helpers [\[61\]](#ref-61).

**Witness, in detail.** Witnesses (private-state functions) exist only for the root contract. A callee is constructed with a proxy that supplies a stub for every witness name, so its generated `Contract` constructor still validates and witness-free circuits run unchanged — but the stub *throws the moment a called circuit actually invokes a witness* [\[60\]](#ref-60). The rule is therefore about invocation, not declaration: a callee may *declare* witnesses; it just cannot *call* one on a cross-contract path, which is the same as saying its called paths touch no private state.

## The ledger execution model: a declarative call forest

On the EVM, calls happen **on-chain**: contract A runs, hits a call, the chain executes B, control returns to A. There is a live call stack. Midnight works differently: **all execution and proving happens off-chain, before submission.** What the ledger receives is a *list of already-proven calls*, where each call *declares* which sub-calls it requires [\[34\]](#ref-34). The ledger never runs anything across contracts — it only checks that the declarations and the calls **match up**, one-to-one, in the same segment [\[35\]](#ref-35):

```
What the transaction contains:          The linked ("declared") view:

  Call 1: Router.swap                     Router.swap
          declares: "I need call 2"          └─► Pair.swap
  Call 2: Pair.swap                                └─► Token.transfer
          declares: "I need call 3"
  Call 3: Token.transfer
          declares: nothing
```

**The matched-up graph must be a *forest*: one or more separate trees.** Concretely, two rules — no cycles, and every call has at most one parent:

```
ALLOWED — a forest (two trees):        A            D
                                       ├─► B        └─► E
                                       └─► C

REJECTED — a cycle (re-entrancy):      A ─► B ─► A          ✗ NonForest

REJECTED — one call, two parents:      A ─► (X) ◄─ C        ✗ NonForest
                                       (the SAME call claimed by two callers)

ALLOWED — same contract, two calls:    A ─► Helper (call 1)  ✓ two separate
                                       C ─► Helper (call 2)    calls, one
                                                               parent each
```

Cycles are rejected at transaction construction with `NonForest` [\[36\]](#ref-36), and so is a call claimed by more than one caller [\[37\]](#ref-37). At verification a caller's position must be strictly smaller than its callee's, so a cycle cannot even be written down [\[38\]](#ref-38). Note the last example: each call is its own node (keyed by its communication commitment), so two contracts each making *their own* call to the same helper is fine — only *sharing one call* is not, and ordinary code never produces that.

Remaining ledger facts:

- **Verifier keys resolve by (contract address, entry-point name)** from the callee's on-chain operations map [\[39\]](#ref-39), [\[40\]](#ref-40). The vk-hash binding of *Runtime guards* is a client-side guard, not a ledger rule.
- **The callee learns its caller.** `CallContext.caller` is a user key hash or a contract address [\[41\]](#ref-41), so callee-side "who may call me" policies are app-expressible today.
- **No call-depth limit** — depth is bounded by budgets and transaction size, not a cap.
- **The "link" between caller and callee is the communication commitment**: a value committing to the sub-call's inputs and outputs, so the caller's declaration and the callee's actual execution are cryptographically tied together [\[42\]](#ref-42), [\[43\]](#ref-43).

## Atomicity: guaranteed and fallible

Transactions split into a **guaranteed** section (segment 0, runs before fees) and **fallible** segments. A failure in a fallible segment reverts to the state after the guaranteed section applied; fees are charged regardless [\[44\]](#ref-44). Causality is a theorem of the system: if A calls B, "A succeeding must imply B succeeding", both must be in the same intent, and the sectioning is consistent across the tree [\[45\]](#ref-45). The net effect is that a call tree applies all-or-nothing within its section. Design callees to fail loudly; a failed callee aborts its whole tree.

## Missing-key lookups abort

`Map.lookup` on an absent key yields `Null`, and the next cell operation aborts with `"expected a cell, received null"` [\[46\]](#ref-46). This bites hardest in C2C, where a callee routinely receives keys it has never seen (a pool paying a brand-new recipient). Default first:

```compact
// pattern from the design doc
circuit balance_or_zero(owner: ContractAddress): Uint<64> {
  return balances.member(disclose(owner))
    ? balances.lookup(disclose(owner))
    : 0 as Uint<64>;
}
```

## Artifacts and proving

Each contract compiles to a bundle: generated bindings (`contract/index.js`), per-circuit proving and verifier keys, ZKIR, and `contract-info.json` [\[31\]](#ref-31). The client runtime models the **whole call tree** [\[32\]](#ref-32), so every contract that can appear in a tree must be compiled and present locally when proving. Call sites hard-code the callee implementation at `../T/contract/index.js`, which "effectively limits any DApp to a single implementation of each contract type" [\[33\]](#ref-33).

# Privacy model (stated precisely)

What a cross-contract call reveals, from the ledger structures themselves:

| | |
| --- | --- |
| **Hidden** | circuit arguments and return values (behind the communication commitment [\[42\]](#ref-42)); contract private state (callees have none on called paths) |
| **Public** | callee contract address and entry-point name (`ContractCall` fields [\[47\]](#ref-47)); the declared call graph (sequence, callee address, entry-point hash per claim [\[34\]](#ref-34)); transcripts of public-state effects; caller identity, exposed to the callee [\[41\]](#ref-41) |

Two consequences worth stating plainly:

- **The choice of callee is an observable behavior channel.** When the callee is user-influenced, an observer learns which venue, token module, or counterparty a user routed through, even while amounts stay hidden. The language documents this: the reference must be disclosed "because a cross-contract call reveals the address of the called contract" (see *Disclosure*).
- **Shielded outputs to contracts name the contract in cleartext.** `ZswapOutput.contract: Option<ContractAddress>` is a public field, and contract-destined outputs carry no ciphertext: `assert!(self.contract.is_none() || self.ciphertext.is_none())` [\[48\]](#ref-48). The same holds for contract-owned spends [\[49\]](#ref-49). This was confirmed independently on preprod during the forwarder review (finding CRIT-1): a shielded send to a contract publishes the contract address, while a coin-public-key recipient stays hidden.

This is the axis an EVM comparison cannot supply: on a transparent chain, callee restriction is purely a safety feature. On Midnight it is also a **privacy bound**, currently the only one available for dispatch (see Q1).

# Constraints at a glance

| Constraint | Layer | Source |
| --- | --- | --- |
| Call graph must be an acyclic, single-parent forest | ledger (structural) | [\[50\]](#ref-50) |
| No re-entrancy ("not yet supported") | client runtime guard | [\[27\]](#ref-27) |
| Callee must be witness-free on called path (no private state) | compiler + runtime guard | [\[21\]](#ref-21) |
| No shielded (Zswap) coin ops in a callee | client runtime | [\[55\]](#ref-55) |
| Constructors cannot make C2C calls | compiler | [\[12\]](#ref-12) |
| No reference creation from an address in-language | compiler | [\[10\]](#ref-10) |
| No generics across the call boundary | compiler | [\[24\]](#ref-24) |
| One implementation per contract type per DApp | tooling | [\[33\]](#ref-33) |
| Every callee's artifacts present locally at prove time | tooling | [\[32\]](#ref-32) |
| Callee address + entry point public per call | ledger | [\[47\]](#ref-47) |

# Open questions

This is the living part of the doc. Each question gets a subsection: the question, what exists today, relevant prior art, and a recommended direction. Add new questions here rather than forking new docs.

## Q1 — Restricting callable contracts to a vetted set

**The question:** should a DApp be able to restrict the callable contracts to a specific known set that it has vetted, rather than dispatch to arbitrary addresses? This is the central design question around dynamic C2C.

**The answer is yes — as an opt-in primitive, not a gate.** Almost every DApp wants *some* bound on dispatch once the failure modes are on the table, but several important use cases need genuine openness: the callee is chosen by a user or a vote at runtime, so no developer can write the allowlist in advance (a smart-account wallet calling whatever dApp its user picks next; a DAO executor performing whatever call the members voted for — there, the vote *is* the vetting). The productive discussion is about granularity, mutability, defaults, and the privacy dimension.

### What exists today

**Compact is already restrictive by default — the opposite of the EVM.** The language has no way to turn a raw address into something callable (see *Holding a callee reference*): a contract can only call a `contract`-typed reference that application code handed to it. EVM's "call any address" is simply not expressible. Within that rule, a caller contract can take exactly three shapes today:

**A — Fixed callees (closed).** Every reference is set once, in the constructor, and no circuit accepts a contract-typed parameter. The set of contracts this contract can ever call is frozen at deploy time; nothing a user sends can extend it. A vetted set for free — no allowlist code needed.

```compact
// (sketch) closed: can only ever call the token wired in at deploy
ledger tokenA: Token;
constructor(a: Token) { tokenA = disclose(a); }
export circuit pay(to: ContractAddress, amount: Uint<64>): [] {
  tokenA.transfer(disclose(to), disclose(amount));
}
```

**B — Caller's choice (open).** A circuit accepts a contract-typed parameter, so whoever builds the transaction picks the callee. This is the *only* door to open dispatch in today's language — and therefore the only place the vetting question bites. (A stored reference can also be *reassigned* later, but only through such a parameter — the same door.)

```compact
// (sketch) open: the transaction picks ANY deployed contract matching Token
export circuit pay(token: Token, to: ContractAddress, amount: Uint<64>): [] {
  disclose(token).transfer(disclose(to), disclose(amount));
}
```

**C — Guest list (open, but bounded).** The circuit takes a small id and looks the callee up in an admin-controlled ledger Map. A missing key aborts the whole call tree (see *Missing-key lookups abort*), so users can only pick from the approved entries — unvetted callees are unrepresentable:

```compact
// (sketch — untested) vetted-registry idiom in current syntax
contract Token {
  circuit transfer(to: ContractAddress, amount: Uint<64>): [];
}

export ledger vettedTokens: Map<Uint<8>, Token>;   // populated at deploy / by admin circuit

export circuit pay(tokenId: Uint<8>, to: ContractAddress, amount: Uint<64>): [] {
  // aborts the whole call tree if tokenId is not vetted
  const token = vettedTokens.lookup(disclose(tokenId));
  token.transfer(disclose(to), disclose(amount));
}
```

All three shapes are expressible **today**. So the question for the platform is not "make restriction possible" — it is whether to bless shape C as a first-class primitive, so teams stop re-implementing it (and its admin/mutation path) inconsistently, and what its default posture and granularity should be.

### Prior art: EVM

The EVM imposes nothing: `call` accepts any address, and all restriction is app-level convention. The exploit record for protocols that forward user-controlled `(target, calldata)` is the strongest argument for a first-class primitive: Multichain/AnySwap router (2022), Dexible (2023), Socket/Bungee (2024), Li.Fi (2024). Same root cause each time, and the post-mortem fix each time was a target allowlist. The ecosystem also built the pattern proactively where stakes were high: Safe modules/guards, Uniswap v4 hook-address permission bits, ERC-3643 identity registries, timelock-managed target sets, and `EXTCODEHASH` code-identity checks. Solidity converged on exactly what dynamic C2C is proposing, but only after losses.

### Prior art: zk stacks

Verified against each platform's official docs on 2026-07-23; sources per row. In the *Restriction* column: **always-on** = the platform enforces it on every (dynamic) call; **DIY** = no platform primitive, apps hand-roll their own checks.

| Platform | Dynamic C2C | Restriction | Callee visibility | Source |
| --- | --- | --- | --- | --- |
| Aleo / Leo | **Yes** — since Leo 4.0 (2026): `Interface@(target)::method` dynamic dispatch (itself an opt-in construct; static calls remain the default) | **Yes, always-on** — every dynamic call must satisfy a declared interface (compiler-enforced); identity vetting (which specific programs) is DIY | Public | [\[62\]](#ref-62) |
| Mina / o1js | **Partial** — callee chosen at proving time (a runtime argument), not on-chain dispatch; calls proven client-side and committed as account updates | **No — DIY only**; the platform only checks the proof against the verification key stored on the callee's account | Public | [\[63\]](#ref-63) |
| Starknet / Cairo | **Yes** — `call_contract` syscall (by address), `library_call` (by class hash) | **No — DIY only** ("any previously declared class") | Public (transparent chain) | [\[64\]](#ref-64) |
| Aztec (Noir / Aztec.nr) | **Yes** — private calls proven client-side under a recursive private kernel; public calls are enqueued and executed by the AVM | **No — DIY only** for vetting (which contracts *may* be called is the app's own code); kernel circuits do verify every call is *genuine* — correct function, valid proofs — but that is correctness, not trust | **"The addresses of all private calls are hidden from observers"** (doc verbatim); enqueued *public* calls are visible | [\[65\]](#ref-65) |
| Compact / Midnight today | **Yes** — via a contract-typed parameter (itself an opt-in shape; ledger-held references stay closed) | **No — DIY only** (registry idiom); the vk-binding guard is a toolchain integrity check, not a policy option | Public (see *Privacy model*) | [\[47\]](#ref-47) |

Two lessons from the neighbors:

- **On safety, Aleo just made the same transition Compact is making.** Static-only until Leo 4.0 added dynamic dispatch; their answer was to keep static calls the default and make dynamic calls **opt-in and interface-constrained** (the compiler checks the runtime target implements a declared interface). That is the same shape as Compact's contract-typed parameters — an interface bound, not identity vetting — so the vetting question is still open there too. Starknet's address-vs-class-hash split is the closest existing analogue for *what* a vetted set should key on (see *Vetting granularity* above).
- **On privacy, Aztec is the structurally different answer.** Instead of restricting the callee set, it hides the callee at the proof-system level: a private call's target never reaches the public ledger (though any public calls it enqueues are visible). If Midnight ever adopts this, the allowlist loses its privacy job and keeps only its safety job (see *The privacy dimension*).

### Why open dispatch matters

Open dynamic dispatch buys **permissionless composability**: calling contracts that did not exist at deploy time, with no gatekeeper approving integrations. The canonical users:

- **Smart accounts** — exist to call whatever dApp the user picks next; unenumerable by definition.
- **Aggregators / routers** — the best route crosses venues launched after the router deployed.
- **Factory protocols and marketplaces** — must call pairs/collections created continuously by third parties.
- **Plugin systems and governance executors** — third-party modules over time; a DAO's `execute(target, args)` is open by design.

### Three tiers of dispatch

Most "open" demands are not *fully* open. A restriction primitive should express all three tiers; most real use cases land in tier 2 or 3 voluntarily:

| Tier | Meaning | Who needs it |
| --- | --- | --- |
| 1 — Fully open | any deployed contract | smart accounts, governance executors |
| 2 — Code-vetted, instance-open | any instance of an audited implementation (**verifier-key predicate**) | factory pairs, standard-interface marketplaces |
| 3 — Registry-vetted | governed, mutable set of specific instances | routers, plugin systems |

### Vetting granularity: address vs verifier key

A vetted set has to name *what* it trusts. Two options:

- **By address** — "allow the contract at address X." Trusts a specific deployment.
- **By verifier key** — "allow any contract running this exact audited code." The verifier key is the fingerprint of a circuit's code, and the client runtime already checks it on every call (`expectedVk`, see *Runtime guards*) — so this is a policy layer over existing machinery, not new cryptography. Starknet class hashes and EVM `EXTCODEHASH` are the precedents.

The trap: **an address does not pin the code.** `ContractAddress` commits only to the contract's *initial* state [\[51\]](#ref-51), and a **maintenance update** can replace the verifier keys at that same address later (`VerifierKeyRemove` / `VerifierKeyInsert`, authorized by a committee threshold) [\[52\]](#ref-52), [\[53\]](#ref-53). The two options then fail differently:

- Vet **by address**, and a later code swap silently keeps passing your check — you are now calling code nobody audited.
- Vet **by code**, and a swap makes your check fail loudly (safer), but a *legitimate* upgrade of the callee also breaks your DApp until you re-vet.

Either way, you must also look at **who can change the callee's code** — its maintenance authority. A contract deployed with the default authority (empty committee, threshold 1, unsatisfiable) can never be updated, so it is effectively immutable and even address-vetting is sound there [\[54\]](#ref-54). A contract with a real committee can rotate its code at any time. **Sound vetting = code identity + a check on the callee's maintenance authority.**

(The reverse direction — a callee restricting who may call *it* — is already expressible today via `CallContext.caller`, see *The ledger execution model*. The open gap is only the caller-side restriction of callees.)

### The privacy dimension

Every cross-contract call **publishes which contract was called**: the callee address and entry-point name are public transaction fields (see *Privacy model*). Arguments and amounts stay hidden; the *choice of callee* does not. On a privacy chain, that choice tells a story by itself — which venue, token, or counterparty a user interacted with is exactly the kind of metadata the chain exists to hide.

This gives the allowlist two jobs:

- On a transparent chain (EVM), restricting callees is purely a **safety** feature — everything is public anyway.
- On Midnight it is **also a privacy bound**: if a contract can only call k vetted targets, an observer learns "one of these k" instead of an arbitrary, revealing address. Today it is the *only* available bound on the callee leak.

There is a deeper long-term fix: **hide the callee itself**, as Aztec does at the proof-system level. Whether that is even compatible with Midnight's declarative call-forest model — where call claims name the callee address — is an open architecture question, and the answer decides what an allowlist is *for*: the permanent design, or a mitigation until callee hiding exists. Worth resolving directly with the platform team.

### Recommended direction

1. **Open by default.** Dynamic C2C ships open (tier 1 stays plain dispatch); restriction is something a DApp opts into, not a gate the platform imposes.
2. **But ship the restriction primitive first-class** (platform or stdlib), covering tiers 2 and 3: **verifier-key predicates** ("any instance of this audited code") and **registry predicates** (specific instances). Ship it **together with** the dynamic-discovery CoIP, not after — EVM's lesson is not that allowlists are needed, but that safety arrived only after the losses.
3. **Pair vk-vetting with a maintenance-authority check**, or a key rotation can silently invalidate it.
4. **Audited mutation patterns** (immutable / role-gated / timelocked) rather than a bare setter.
5. **Tooling nudge instead of a language gate:** a suppressible compiler/linter warning when a circuit takes a contract-typed parameter with no policy attached — openness stays cheap, unrestricted dispatch stays greppable for auditors.
6. Resolve whether callee hiding is on any roadmap (it reframes the privacy argument); and once the API stabilizes, a vetted-registry / `AllowedCallees` module in `compact-contracts` is a natural library candidate.

### Open sub-questions

- Is the restriction envisioned per call site, per contract, or per deployment? Address-based, vk-based, or both?
- How should a vetted set be mutated, and what default posture should the platform want (immutable / role-gated / timelocked)?
- Is hiding the callee of a private call compatible with the call-forest model, and is it on any roadmap?
- The client guard says re-entrancy is "not yet supported" while the ledger's forest rule is structural. Which layer is authoritative for the roadmap?
- Does the single-parent (no-diamond) rule stay? What composition patterns is it expected to forbid?

## Backlog: further open questions

Smaller or newer questions (Q2–Q6), to be promoted to full subsections as they develop. Dated on entry.

- **Q2 — Callee upgrades vs vetting (2026-07-23).** Maintenance updates can swap verifier keys under a fixed address. Should a vetting primitive pin the maintenance-authority state too? What happens to deployed callers when a vetted callee rotates keys?
- **Q3 — Callees with private state (2026-07-23, expanded 2026-07-24).** Called paths must be witness-free and cannot do Zswap ops (see *What a callee may be*). Is lifting this planned? It currently rules out C2C into any contract whose API touches its own private state. Concrete case (2026-07-24): the confidential note token (`ConfidentialNoteFungibleToken`, [compact-contracts PR #679](https://github.com/OpenZeppelin/compact-contracts/pull/679)) is *categorically* uncallable — every value-moving circuit invokes witnesses (spend secret, input note, Merkle path, randomness seeds, or role secrets), and the design has no witness-free getters at all (its "events" are ledger lists read off-chain). So no router, DEX, or custody contract can drive a note-model confidential token through C2C under stage-one rules; the entire confidential-token class sits behind this question, not just individual circuits.
- **Q4 — Artifact distribution (2026-07-23).** Every provable callee needs its compiled bundle locally, and a DApp binds one implementation per contract type (see *Artifacts and proving*). Does dynamic dispatch need a callee-bundle discovery/distribution story (the deferred "future CoIP")?
- **Q5 — State reads (2026-07-23).** A→B getter calls work but are full circuit calls. Is a cheaper read-only cross-contract state access planned?
- **Q6 — Fee asymmetry (2026-07-23).** Fallible-section failures still pay fees [\[44\]](#ref-44). Does a failed callee deep in a tree create griefing economics for the caller?

# Worked example: can we build Uniswap V2?

A DEX is a good stress test because a single swap exercises multi-level calls, shared token contracts, value movement, and cross-contract reads all at once. This section walks a V2-style design through the constraints described above. **Verdict up front:** the call shape is legal and a basic swap over a fixed set of public-balance tokens is buildable today; a faithful, permissionless V2 is not yet.

## The V2 architecture, mapped to Midnight

| V2 component | Its role | Midnight mapping |
| --- | --- | --- |
| Router | Stateless multi-hop helper; slippage, deadline, path routing | Caller contract holding `Pair` references |
| Pair (per token pair) | Reserves, swap math, LP token | Callee with **public-ledger** reserves |
| Token ×2 | The two underlying ERC-20s | Callee tokens with **public-ledger** balances |
| Factory | Deploys pairs; deterministic (`CREATE2`) address | App-code deploy + a ledger registry — **no on-chain address derivation** (see *Holding a callee reference*) |

## The call tree for one swap

```
Router.swapExactIn (root)
  ├─► TokenIn.transfer(user → Pair)        move input into the pair first
  └─► Pair.swap
        ├─► TokenOut.transfer(Pair → user) pay the output
        ├─► TokenIn.balanceOf(Pair)        read reserves to verify the k invariant
        └─► TokenOut.balanceOf(Pair)
```

Every edge flows away from the root; no callee reaches back. Valid forest. Note the inversion: the input token is moved into the `Pair` *before* the `Pair` pays out, so the chain runs one direction only and never re-enters (see *Runtime guards*). Multi-hop is two sibling subtrees under the Router (`Router → Pair1`, `Router → Pair2`), also a forest.

## What works, what breaks

| V2 feature | Midnight | Blocking constraint | Related question |
| --- | --- | --- | --- |
| `Router → Pair → Token` chain | ✅ works | forest, no depth limit | — |
| Multi-hop (sibling pair calls) | ✅ works | sibling subtrees, still a forest | — |
| Public-balance underlying tokens | ✅ works | callee is witness-free | — |
| Reserve reads (`balanceOf` for the k-check) | ⚠️ works, but costed | getter is a full circuit call, not a storage peek; a missing key aborts | Q5 (state reads) |
| Confidential-token pairs (our CFT or note token) | ❌ | callee must have no private state | Q3 (private state) |
| Flash swaps (`uniswapV2Call` callback) | ❌ | re-entrancy ban — the callback re-enters the caller | Q1 (re-entrancy) |
| `pairFor` / `CREATE2` address derivation | ❌ redesign | no reference-from-address in-contract | Q1 (references) |
| Generic pairs over heterogeneous token *code* | ❌ | one implementation per contract type | Q4 (artifacts) |
| Arbitrary user-supplied tokens | ❌ | every callee's artifacts must be compiled locally to prove | Q4 (artifacts) |

(LP-token minting is a further callee/module the `Pair` would drive; it does not change the picture.)

## Verdict

- **Buildable today:** a swap DEX with a fixed, known set of public-balance tokens, in exactly the `Router → Pair → Token` shape.
- **Not yet:** a permissionless, generic V2 — arbitrary third-party tokens, on-chain pair derivation, flash swaps, or confidential assets.
- **Why it is a useful discussion case:** one concrete design touches open questions Q1, Q3, Q4 and Q5 at once — reference creation and the re-entrancy layer (Q1), private-state callees (Q3), artifact distribution (Q4), and cheaper state reads (Q5). It gives a tangible design to react to rather than an abstract list.

# Technical links

- CoIP-0002: [Contract Types, Values, and Calls](https://github.com/LFDT-Minokawa/compact/blob/main/coips/coip-0002.md)
- Midnight team design doc: [Cross-contract calls on Midnight — how they work](https://docs.google.com/document/d/1oJlQ3izG7GqZ9gOOZSpFNjf20oGKsx8YPldtxKkYQ-Q/edit?usp=sharing)
- Announcement + RC matrix: [Slack thread](https://openzeppelin.slack.com/archives/C0A94G0PS64/p1784042986745349)
- Local verified clones: `../compact-main` @ `c06961e`, `../midnight-ledger-main` @ `e1edad2`

# References

Pinned commits: Compact [`c06961e`](https://github.com/LFDT-Minokawa/compact/tree/c06961eb661942f7689c6509d0913326f264e848) · Ledger [`e1edad2`](https://github.com/midnightntwrk/midnight-ledger/tree/e1edad2d7019e1520d173f3e22e9991903225cef). Each link deep-links to the cited lines at that commit.

1. <a id="ref-1"></a>[`compact CHANGELOG.md:307-330`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/CHANGELOG.md#L307-L330) — C2C is stage one; dynamic discovery deferred to a future CoIP.
2. <a id="ref-2"></a>[`doc/compact-reference.mdx:669-712`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/doc/compact-reference.mdx#L669-L712) — contract type declarations ("Contract types").
3. <a id="ref-3"></a>[`doc/compact-grammar.mdx:271-286`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/doc/compact-grammar.mdx#L271-L286) — grammar: external-contract declaration.
4. <a id="ref-4"></a>[`doc/compact-reference.mdx:764-766`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/doc/compact-reference.mdx#L764-L766) — contract typing is structural, not nominal.
5. <a id="ref-5"></a>[`doc/compact-reference.mdx:774-784`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/doc/compact-reference.mdx#L774-L784) — `contract implements C;` assertion.
6. <a id="ref-6"></a>[`compiler/analysis-passes/infer-types.ss:829`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/compiler/analysis-passes/infer-types.ss#L829) — error: "no circuit declaration named".
7. <a id="ref-7"></a>[`examples/composable/direct/Main.compact:16-29`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/examples/composable/direct/Main.compact#L16-L29) — verbatim: `Calculator` interface + call.
8. <a id="ref-8"></a>[`examples/composable/direct/Main-constructor.compact:21-24`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/examples/composable/direct/Main-constructor.compact#L21-L24) — verbatim: ledger-field reference set in constructor.
9. <a id="ref-9"></a>[`examples/composable/direct/Main-circuit-parameter.compact:21-23`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/examples/composable/direct/Main-circuit-parameter.compact#L21-L23) — verbatim: parameter-held reference.
10. <a id="ref-10"></a>[`compiler/analysis-passes/expand-modules-and-types.ss:613`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/compiler/analysis-passes/expand-modules-and-types.ss#L613) — error: "invalid context for reference to contract type name".
11. <a id="ref-11"></a>[`doc/compact-reference.mdx:793-803`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/doc/compact-reference.mdx#L793-L803) — references enter only from application code / witness returns.
12. <a id="ref-12"></a>[`compiler/analysis-passes/reject-constructor-cc-calls.ss:19`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/compiler/analysis-passes/reject-constructor-cc-calls.ss#L19) — constructors cannot make cross-contract calls.
13. <a id="ref-13"></a>[`test-center/composable/Storage/Outer.compact`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/test-center/composable/Storage/Outer.compact) — contract references in `Map` / `List` / `MerkleTree`.
14. <a id="ref-14"></a>[`doc/compact-reference.mdx:3558-3565`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/doc/compact-reference.mdx#L3558-L3565) — disclosure of the reference; args unless callee is `pure`.
15. <a id="ref-15"></a>[`tests-e2e/src/tests/compiler/compiler.composable.direct.e2e.test.ts:265-269`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/tests-e2e/src/tests/compiler/compiler.composable.direct.e2e.test.ts#L265-L269) — verbatim disclosure-error text.
16. <a id="ref-16"></a>[`doc/ledger-adt.mdx:140-143`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/doc/ledger-adt.mdx#L140-L143) — `kernel.self(): ContractAddress`.
17. <a id="ref-17"></a>[`doc/compact-reference.mdx:3352-3356`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/doc/compact-reference.mdx#L3352-L3356) — verbatim: `kernel.self()` example.
18. <a id="ref-18"></a>[`compiler/standard-library.compact:94`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/compiler/standard-library.compact#L94) — `struct ContractAddress { bytes: Bytes<32>; }`.
19. <a id="ref-19"></a>[`doc/compact-reference.mdx:3106-3107`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/doc/compact-reference.mdx#L3106-L3107) — call's static type = declared return type.
20. <a id="ref-20"></a>[`test-center/composable/Basic/Outer.compact:16-34`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/test-center/composable/Basic/Outer.compact#L16-L34) — verbatim: `Inner` interface, `add` / `setInner`.
21. <a id="ref-21"></a>[`doc/compact-reference.mdx:3109-3118`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/doc/compact-reference.mdx#L3109-L3118) — witness-calling circuits excluded from cross-contract calls.
22. <a id="ref-22"></a>[`compact CHANGELOG.md:379-380`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/CHANGELOG.md#L379-L380) — runtime: a callee invoking a witness throws.
23. <a id="ref-23"></a>[`compact CHANGELOG.md:389-394`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/CHANGELOG.md#L389-L394) — no Zswap operations inside a callee.
24. <a id="ref-24"></a>[`doc/compact-reference.mdx:3093-3094`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/doc/compact-reference.mdx#L3093-L3094) — no generics across the call boundary.
25. <a id="ref-25"></a>[`test-center/composable/Witness/Outer.compact`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/test-center/composable/Witness/Outer.compact) — contract values passing through witnesses.
26. <a id="ref-26"></a>[`compact CHANGELOG.md:367-381`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/CHANGELOG.md#L367-L381) — the four dynamic runtime guards.
27. <a id="ref-27"></a>[`runtime/src/contract.ts:404-420`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/runtime/src/contract.ts#L404-L420) — re-entrancy guard + error text.
28. <a id="ref-28"></a>[`test-center/ts/composable/basic.ts:59`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/test-center/ts/composable/basic.ts#L59) — sequential calls to the same callee compose.
29. <a id="ref-29"></a>[`test-center/ts/composable/mutual-recursion.ts:202-218`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/test-center/ts/composable/mutual-recursion.ts#L202-L218) — A→B→A rejected.
30. <a id="ref-30"></a>[`test-center/ts/composable/self-recursion.ts:50`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/test-center/ts/composable/self-recursion.ts#L50) — self-recursion rejected.
31. <a id="ref-31"></a>[`doc/compact-reference.mdx:3585-3616`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/doc/compact-reference.mdx#L3585-L3616) — per-contract artifact bundle.
32. <a id="ref-32"></a>[`compact CHANGELOG.md:343-366`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/CHANGELOG.md#L343-L366) — `CircuitContext` models the whole call tree.
33. <a id="ref-33"></a>[`doc/compact-reference.mdx:3120-3133`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/doc/compact-reference.mdx#L3120-L3133) — one implementation per contract type per DApp.
34. <a id="ref-34"></a>[`ledger spec/contracts.md:170`](https://github.com/midnightntwrk/midnight-ledger/blob/e1edad2d7019e1520d173f3e22e9991903225cef/spec/contracts.md#L170) — `claimed_contract_calls` tuple.
35. <a id="ref-35"></a>[`ledger spec/intents-transactions.md:159-161`](https://github.com/midnightntwrk/midnight-ledger/blob/e1edad2d7019e1520d173f3e22e9991903225cef/spec/intents-transactions.md#L159-L161) — bidirectional call/claim matching per segment.
36. <a id="ref-36"></a>[`ledger/src/construct.rs:1046-1061`](https://github.com/midnightntwrk/midnight-ledger/blob/e1edad2d7019e1520d173f3e22e9991903225cef/ledger/src/construct.rs#L1046-L1061) — cycle detection → `NonForest`.
37. <a id="ref-37"></a>[`ledger/src/construct.rs:1069-1070`](https://github.com/midnightntwrk/midnight-ledger/blob/e1edad2d7019e1520d173f3e22e9991903225cef/ledger/src/construct.rs#L1069-L1070) — single-parent check → `NonForest`.
38. <a id="ref-38"></a>[`ledger/src/verify.rs:936-945`](https://github.com/midnightntwrk/midnight-ledger/blob/e1edad2d7019e1520d173f3e22e9991903225cef/ledger/src/verify.rs#L936-L945) — caller position strictly less than callee position.
39. <a id="ref-39"></a>[`ledger spec/contracts.md:301`](https://github.com/midnightntwrk/midnight-ledger/blob/e1edad2d7019e1520d173f3e22e9991903225cef/spec/contracts.md#L301) — verifier-key lookup by address + entry point.
40. <a id="ref-40"></a>[`onchain-state/src/state.rs:728-733`](https://github.com/midnightntwrk/midnight-ledger/blob/e1edad2d7019e1520d173f3e22e9991903225cef/onchain-state/src/state.rs#L728-L733) — `operations` map keyed by entry-point name.
41. <a id="ref-41"></a>[`ledger spec/contracts.md:178-211`](https://github.com/midnightntwrk/midnight-ledger/blob/e1edad2d7019e1520d173f3e22e9991903225cef/spec/contracts.md#L178-L211) — `CallContext.caller` / `PublicAddress` (178-182, 197, 205-211).
42. <a id="ref-42"></a>[`ledger spec/contracts.md:90-91`](https://github.com/midnightntwrk/midnight-ledger/blob/e1edad2d7019e1520d173f3e22e9991903225cef/spec/contracts.md#L90-L91) — communication commitment commits to inputs/outputs.
43. <a id="ref-43"></a>[`doc/ledger-adt.mdx:65-71`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/doc/ledger-adt.mdx#L65-L71) — `kernel.claimContractCall`.
44. <a id="ref-44"></a>[`ledger spec/contracts.md:105-114`](https://github.com/midnightntwrk/midnight-ledger/blob/e1edad2d7019e1520d173f3e22e9991903225cef/spec/contracts.md#L105-L114) — guaranteed/fallible sections; fees charged regardless.
45. <a id="ref-45"></a>[`ledger spec/properties.md:139-146`](https://github.com/midnightntwrk/midnight-ledger/blob/e1edad2d7019e1520d173f3e22e9991903225cef/spec/properties.md#L139-L146) — Theorem 4 (Causality).
46. <a id="ref-46"></a>[`onchain-vm/src/error.rs:68-81`](https://github.com/midnightntwrk/midnight-ledger/blob/e1edad2d7019e1520d173f3e22e9991903225cef/onchain-vm/src/error.rs#L68-L81) — "expected a cell, received null".
47. <a id="ref-47"></a>[`ledger spec/contracts.md:95-102`](https://github.com/midnightntwrk/midnight-ledger/blob/e1edad2d7019e1520d173f3e22e9991903225cef/spec/contracts.md#L95-L102) — `ContractCall` fields: `address`, `entry_point` public.
48. <a id="ref-48"></a>[`ledger spec/zswap.md:87-93`](https://github.com/midnightntwrk/midnight-ledger/blob/e1edad2d7019e1520d173f3e22e9991903225cef/spec/zswap.md#L87-L93) — `ZswapOutput.contract` public; no ciphertext for contracts (assert at 185-186).
49. <a id="ref-49"></a>[`ledger spec/zswap.md:82`](https://github.com/midnightntwrk/midnight-ledger/blob/e1edad2d7019e1520d173f3e22e9991903225cef/spec/zswap.md#L82) — `ZswapInput.contract` (contract-owned spends).
50. <a id="ref-50"></a>[`ledger/src/construct.rs:1046-1077`](https://github.com/midnightntwrk/midnight-ledger/blob/e1edad2d7019e1520d173f3e22e9991903225cef/ledger/src/construct.rs#L1046-L1077) — full forest-partition logic (cycles + single-parent).
51. <a id="ref-51"></a>[`ledger spec/contracts.md:58`](https://github.com/midnightntwrk/midnight-ledger/blob/e1edad2d7019e1520d173f3e22e9991903225cef/spec/contracts.md#L58) — `ContractAddress = Hash<ContractDeploy>` (initial state only).
52. <a id="ref-52"></a>[`ledger/src/structure.rs:2687-2722`](https://github.com/midnightntwrk/midnight-ledger/blob/e1edad2d7019e1520d173f3e22e9991903225cef/ledger/src/structure.rs#L2687-L2722) — `SingleUpdate` / `MaintenanceUpdate` (VK replace).
53. <a id="ref-53"></a>[`ledger/src/verify.rs:1738-1788`](https://github.com/midnightntwrk/midnight-ledger/blob/e1edad2d7019e1520d173f3e22e9991903225cef/ledger/src/verify.rs#L1738-L1788) — maintenance-update authorization (committee threshold).
54. <a id="ref-54"></a>[`onchain-state/src/state.rs:708-713`](https://github.com/midnightntwrk/midnight-ledger/blob/e1edad2d7019e1520d173f3e22e9991903225cef/onchain-state/src/state.rs#L708-L713) — default maintenance authority is unsatisfiable (immutable).
55. <a id="ref-55"></a>[`runtime/src/zswap.ts:202-204`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/runtime/src/zswap.ts#L202-L204) — `assertHasCurrentZswapLocalState`; throws `"Zswap local state is undefined for contract '…'"`.
56. <a id="ref-56"></a>[`compiler/standard-library.compact:125-227`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/compiler/standard-library.compact#L125-L227) — shielded circuits (`mintShieldedToken`, `receiveShielded`, `sendShielded`, `sendImmediateShielded`, `mergeCoin`) call `createZswapInput` / `createZswapOutput`.
57. <a id="ref-57"></a>[`compiler/standard-library.compact:299-325`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/compiler/standard-library.compact#L299-L325) — unshielded ops (`mintUnshieldedToken` / `sendUnshielded` / `receiveUnshielded`) use `kernel.*` effects, not Zswap local state.
58. <a id="ref-58"></a>[`ledger spec/contracts.md:147-169`](https://github.com/midnightntwrk/midnight-ledger/blob/e1edad2d7019e1520d173f3e22e9991903225cef/spec/contracts.md#L147-L169) — per-call effects carry a contract's shielded nullifiers, receives, spends, and mints.
59. <a id="ref-59"></a>[`runtime/src/contract.ts:388-401`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/runtime/src/contract.ts#L388-L401) — `assertPurityMatches`: interface `pure` annotation vs the callee's `pureCircuits`, both directions.
60. <a id="ref-60"></a>[`runtime/src/contract.ts:427-449`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/runtime/src/contract.ts#L427-L449) — `forbiddenCalleeWitnesses`: witness stubs + the "invoked witness" throw.
61. <a id="ref-61"></a>[`runtime/src/error.ts:63-93`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/runtime/src/error.ts#L63-L93) — `assertDefined` / `assertUndefined`: "Expected … to be defined / undefined".
62. <a id="ref-62"></a>[Leo docs: Interfaces](https://docs.leo-lang.org/language/programs_in_practice/interfaces) — "Dynamic calls allow the callee to be determined at runtime. The caller still knows *what* it can call — expressed as an interface — but not *which* program it is calling." Shipped in Leo 4.0 ([announcement](https://provable.com/blog/interfaces-and-dynamic-dispatch-in-leo); [network-level audit](https://reports.zksecurity.xyz/reports/aleo-dynamic-dispatch/)).
63. <a id="ref-63"></a>[o1js docs: smart contracts](https://docs.o1labs.org/o1js/zkapps/smart-contracts) — off-chain execution, composing zkApp calls; [permissions](https://docs.o1labs.org/o1js/zkapps/permissions): "Every smart contract has a verification key stored on-chain."
64. <a id="ref-64"></a>[Cairo Book: system calls](https://book.cairo-lang.org/appendix-08-system-calls.html) — `call_contract_syscall(address, selector, calldata)`; `library_call_syscall(class_hash, …)`: "Calls the requested function in any previously declared class."
65. <a id="ref-65"></a>[Aztec docs: transactions](https://docs.aztec.network/developers/docs/foundational-topics/transactions) — "The addresses of all private calls are hidden from observers. The only information leaked … : 1. The number of private state updates triggered 2. The set of public calls generated." Public execution now runs in the AVM ([circuits/public_execution](https://docs.aztec.network/developers/nightly/docs/foundational-topics/advanced/circuits/public_execution)).
66. <a id="ref-66"></a>[`coips/coip-0002.md:38-47`](https://github.com/LFDT-Minokawa/compact/blob/c06961eb661942f7689c6509d0913326f264e848/coips/coip-0002.md#L38-L47) — CoIP-0002 abstract: the three new features (contract types, contract references, cross-contract calls); "Later proposals will address dynamic discovery of contract implementation code and management of private state across contracts."
67. <a id="ref-67"></a>[Midnight team design doc: Cross-contract calls on Midnight — how they work](https://docs.google.com/document/d/1oJlQ3izG7GqZ9gOOZSpFNjf20oGKsx8YPldtxKkYQ-Q/edit?usp=sharing) — CCC definition and call-tree framing.
68. <a id="ref-68"></a>[`ledger/src/construct.rs:1011-1012`](https://github.com/midnightntwrk/midnight-ledger/blob/e1edad2d7019e1520d173f3e22e9991903225cef/ledger/src/construct.rs#L1011-L1012) — "Generate a call graph between `calls`. Assert that this is a forest (no cycles, no multiple parents)."

