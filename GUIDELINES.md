# Guidelines

The single source of truth for coding conventions in this repository. It serves humans and AI
agents alike: contributors follow it by hand, and every review tool reads it instead of
restating the rules.

> Scope: **how** we write Compact and the TypeScript around it in this repo: naming, layout,
> idioms, testing, documentation. For **why** the library is shaped the way it is (design
> decisions, module layout, constraints), see [`ARCHITECTURE.md`](ARCHITECTURE.md). How changes
> land (commits, PR titles, review, the coverage gate) is in
> [`CONTRIBUTING.md`](CONTRIBUTING.md); how to run the suites is in [`TESTING.md`](TESTING.md).

These conventions target the Compact language version every module's `pragma` declares,
compiled with the compiler version pinned in [`README.md`](README.md#usage), and TypeScript for
the tests, witnesses, simulators and scripts. Where this file is silent, follow the surrounding file; for TypeScript,
Biome's recommended rules apply through the repository's [`biome.json`](biome.json).

## Naming

Compact:

- A module is `PascalCase` and its file carries the same name: `module FungibleToken` lives in
  `FungibleToken.compact`. A generic module names its parameter in the header:
  `@module Signer<T>`, `@module ConfidentialNoteFungibleToken<#depth>`.
- Ledger fields are `_camelCase`, always underscore-prefixed, including `export sealed ledger`
  fields: `_balances`, `_isInitialized`, `_instanceSalt`.
- Circuits are `camelCase`. A building block the consuming contract is expected to gate carries a
  leading underscore: `_mint`, `_burn`, `_grantRole`, `_send`. A variant that skips a safety
  guard is `_unsafe<Name>`: `_unsafeTransfer`, `_unsafeMint`. A guard that only asserts is
  `assert<Condition>`: `assertInitialized`, `assertNotPaused`, `assertOnlyRole`. A boolean query
  is `is<Condition>` or `has<Thing>`: `isPaused`, `hasRole`.
- Compact has no module-level constants, so a constant is an `UPPER_SNAKE_CASE` pure circuit:
  `DEFAULT_ADMIN_ROLE()`, `UINT128_MAX()`, `MINT_TYPEHASH()`.
- Witnesses are `wit_<Module><Thing>`: `wit_FungibleTokenSK`, `wit_ConfidentialNotePath`,
  `wit_RandomnessSeed`. The module name in the witness name keeps two modules' witnesses apart in
  a composed contract.
- Structs, enums and `new type` aliases are `PascalCase`. A struct that exists only to be hashed
  is `<Thing>Preimage`: `CommitPreimage`, `NullifierPreimage`.
- Domain tags are `"<Module>:<purpose>"`, padded to 32 bytes, named after the module that defines
  them and never after an application: `pad(32, "ElGamal:secretToScalar")`,
  `"ShieldedAccessControl:nullifier"`.
- Assertion messages are `"<Module>: <lowercase reason>"` with no trailing period. The prefix is
  the module that declares the `assert`; a shared core may use the family name its wrappers
  present (`NativeShieldedTokenCore` asserts as `NativeShieldedToken:`).
- A test mock is `Mock<Module>.compact`, a variant `Mock<Module><Variant>.compact`
  (`MockSecp256k1EcdsaMultisig2To3`, `MockConfidentialNoteFungibleTokenInit`). A deployable
  example is `<Preset>Example.compact`.

TypeScript:

- Simulators are `<Module>[<Variant>]Simulator.ts` exporting a class of the same name. Witness
  modules are `<Module>Witnesses.ts` exporting `I<Module>Witnesses`, `<Module>PrivateState` (a
  type and a same-named object with `generate()` and the `with<Field>` constructors) and the
  `<Module>Witnesses()` factory.
- Test files are `<Module>.test.ts` next to what they cover. A flavored suite adds its flavor
  before the extension: `.privacy.test.ts`, `.property.test.ts`, `.invariant.test.ts`,
  `.concurrency.test.ts`, `.compatibility.test.ts`; when a module splits its behavior suite out,
  it is `.unit.test.ts`. Integration specs are `camelCase.spec.ts` under
  `contracts/test/integration/specs/`.
- Shared helpers in `contracts/test-utils/` are `camelCase.ts` for function modules
  (`address.ts`, `rejection.ts`) and `PascalCase.ts` for a file that exports one class
  (`WalletPool.ts`, `DryReplayHarness.ts`).
- Test fixtures and constants are `UPPER_SNAKE_CASE` (`OWNER`, `AMOUNT`, `INSTANCE_SALT`);
  helper functions are `camelCase`.

## Layout and section ordering

A library module (`contracts/src/<category>/<Module>.compact`), top to bottom:

1. `// SPDX-License-Identifier: MIT`
2. `// OpenZeppelin Compact Contracts v<version> (<category>/<Module>.compact)`, the version
   being the one in [`contracts/package.json`](contracts/package.json).
3. The `pragma language_version` line, identical to the one in every other module.
4. The module header docblock (`@module`, `@description`, then the notices; see
   [Documentation](#documentation)).
5. `module <Name> {` with everything below indented two spaces.
6. `import CompactStandardLibrary;`, then the module imports, then any unprefixed ledger
   re-exports (see [Imports](#imports)).
7. Types: `enum`, `new type`, `struct`, exported before internal.
8. Ledger state, the `_isInitialized` flag first when the module has one.
9. Witness declarations.
10. `initialize` (if applicable).
11. The remaining circuits.

Section dividers (`// ─── State ───` or `// ------- Types -------`) are optional; a file that
uses them uses one style throughout and labels every section.

A test mock (`test/mocks/Mock<Module>.compact`): SPDX line, the four-line
`// WARNING: FOR TESTING PURPOSES ONLY.` banner, pragma, `import CompactStandardLibrary;`, the
module import, `export { ... }` of the standard-library types its signatures use, the
constructor, then one wrapper per circuit in the module's own order. An example contract
(`examples/<Preset>Example.compact`) follows the same shape with a `@title` header docblock in
place of the banner.

Formatting. The Compact toolchain ships a formatter (`compact format`, wrapping
`format-compact`, 100-column target, `--check` for CI), but this repository does not run it:
the sources predate it and no script or check invokes it. Until it is adopted repo-wide in one
PR, `.compact` files are formatted by hand to match the surrounding file, and a contributor does
not run the formatter on a file in an unrelated change, since it rewrites the whole file.

- Two-space indentation, no tabs, no trailing whitespace.
- Wrap doc comments and prose at about 100 columns. Code lines have no hard limit, but a
  signature that does not fit puts one parameter per line, indented one level, with the closing
  `): <Type> {` back at the declaration's indent. Older files align parameters under the opening
  parenthesis; leave them as they are.

A TypeScript test file: imports (sorted by Biome), a header docblock when the suite needs one
(what it pins and whether it runs live), helpers, fixtures and constants, the simulator
variable, then `describe` blocks. A simulator file: the artifact imports, the `type <Module>Args`
tuple, the `createSimulator` base, the exported class with `static async create` first and then
one method per circuit in the module's order.

## Imports

Compact:

- `import CompactStandardLibrary;` is always first and always present, in modules, mocks and
  examples alike.
- A module is imported by relative path with a prefix: `import "../utils/Utils" prefix Utils_;`.
  The prefix is the module name plus an underscore. A thin wrapper may shorten it to a role
  (`Core_`, `Treasury_`) when the header says what it wraps.
- A generic module is instantiated at the import: `import "./Signer"<Bytes<32>> prefix Signer_;`,
  `import "../ConfidentialNoteFungibleToken"<32> prefix Core_;`. The arguments are part of the
  deployed wire format ([`ARCHITECTURE.md`](ARCHITECTURE.md#state-and-storage-model)).
- A wrapper that surfaces an inner module's ledger does it with a second, unprefixed import plus
  a re-export, so consumer ledger keys stay plain:

  ```compact
  import "./NativeShieldedTokenPublicSupplyCore" prefix Core_;
  import { _totalMinted, _totalBurned } from "./NativeShieldedTokenPublicSupplyCore";
  export { _totalMinted, _totalBurned };
  ```

  Rename on collision (`_isInitialized as _ownableIsInitialized`). A consumer imports the
  wrapper or the inner module, never both: a doubled import relies on the compiler's shared-state
  deduplication ([compact#270](https://github.com/LFDT-Minokawa/compact/issues/270)).
- A `Mock*` or example contract re-exports the standard-library types its circuit signatures
  expose (`export { ContractAddress, Either, Maybe };`) so the generated TypeScript names them.

TypeScript:

- Node built-ins use the `node:` prefix (`import { getRandomValues } from 'node:crypto';`).
- Relative imports carry the `.js` extension; shared test helpers come through the
  `#test-utils/*` alias (`import { expectRejection } from '#test-utils/assertions/rejection.js';`).
- Compiled artifacts are imported from `contracts/artifacts/<Mock>/contract/index.js`, aliasing
  `Contract` to the mock's name (`Contract as MockFungibleToken`).
- Type-only imports use `import type` or inline `type`. Biome sorts imports and rejects unused
  ones; no barrel files and no `export *`.

## Types

- A struct, enum or `new type` that appears in an exported circuit's signature is exported. One
  that only shapes a hash preimage stays internal.
- A hash preimage is a struct, never an ad hoc byte concatenation: `persistentHash` over
  `CommitPreimage { domain, value, nonce, pk }` is the format the compatibility suite pins and
  the format a wallet reimplements. A new preimage puts its domain tag first; an existing layout
  does not move ([`ARCHITECTURE.md`](ARCHITECTURE.md#upgrade-and-versioning)).
- Amounts are `Uint<128>`; `Uint<256>` does not exist on this backend. A narrower width is used
  only where a protocol primitive imposes it (`mintShieldedToken` takes `Uint<64>`) and the doc
  comment says so. A monotonic count is a `Counter`; a bounded one takes the width its range
  needs (`Uint<8>` for a signer threshold).
- A recipient that may be a user or a contract is `Either<Bytes<32>, ContractAddress>` (account
  id) or `Either<ZswapCoinPublicKey, ContractAddress>` (coin key), and is canonicalized before it
  reaches a map or an equality check (see [Idioms](#idioms-and-patterns)). The zero value of the
  active branch is the burn or unset sentinel; `Utils_zeroAccount()` / `Utils_isTargetZero`
  name it.
- A scalar parameter is `JubjubScalar`, not `Field`. A `Field as JubjubScalar` cast at a call
  site reduces modulo the subgroup order and silently accepts what the typed parameter rejects.
- Metadata strings are `Opaque<"string">`; optional values are `Maybe<T>`; a tree depth or
  signer count that shapes the ledger is a module generic (`<#depth>`, `<#t>`), fixed at import.
- Ledger declarations: `export ledger` for state the consumer reads (every field is public on
  chain whether exported or not), `export sealed ledger` for a value written once at
  construction, `MerkleTree` where a stored value must not appear in the transcript and `Set`
  where it may. Pruning does not exist: a tree or set is permanent capacity.

## Functions and errors

Visibility:

- `export circuit` is the consumer-facing surface. `export pure circuit` is for a circuit that
  touches no ledger, witness or kernel; the compiler enforces purity, and consumers and tests
  call pure circuits off-chain through the artifact's `pureCircuits`. An unexported `circuit` is
  an internal helper.
- An `_` circuit carries no authorization (`ARCHITECTURE.md`, "Mechanism, not policy"). The
  consumer gates it. The module header states that in a sentence; the circuit's own docblock
  does not repeat it.
- A guarded circuit and its `_unsafe` variant come in pairs: the guarded one asserts, then
  delegates. The `_unsafe` docblock carries `@warning` naming what the skipped guard protected.

Validation and errors:

- In a module with an init flag, every impure exported circuit other than `initialize` and
  `isInitialized` begins with `assertInitialized()`.
- Failure is `assert(condition, "<Module>: <reason>");`. There are no error values. The message
  names the condition, the same condition reuses the same message across circuits, and the text
  is stable: tests assert on the whole string and a change is a changelog entry. The
  `Requirements:` block of the docblock lists one bullet per assert.
- Validate before the first write, and reserve before you commit: check `member` on a nullifier
  or nonce set and `insert` it before the state it protects moves. A failed assert rejects the
  whole transaction, so this is for readability and for the transcript, not for safety.
- Witness values are untrusted inputs. Each one is bound in-circuit to public state or used so a
  hostile value cannot break the module's claim; keys and randomness, which no circuit can check,
  are documented as wallet duties ([`ARCHITECTURE.md`](ARCHITECTURE.md#privacy-and-witness-model)).
- `disclose()` wraps the exact value that reaches a ledger write or a public comparison, at the
  point it does, not the input it was derived from. It is a permission marker, not the
  disclosure itself: the module header's privacy notice is where what the transaction reveals is
  written down.

## Idioms and patterns

Each pattern below is one the library standardizes on, with the shape to avoid first.

**Canonicalize an `Either` before it keys a map or feeds a comparison.** A crafted value with
data in both branches would otherwise miss a lookup that only inspects the active branch.

```compact
// Avoid
_balances.insert(disclose(to), disclose(value));

// Use
const canonTo = Utils_canonicalize<Bytes<32>, ContractAddress>(to);
_balances.insert(disclose(canonTo), disclose(value));
```

**A missing map entry is zero.** Check `member` before `lookup` and return the default rather
than letting the lookup fail.

```compact
// Avoid
return _balances.lookup(disclose(account));

// Use
if (!_balances.member(disclose(account))) {
  return 0;
}
return _balances.lookup(disclose(account));
```

**Each module owns its initialization flag.** Importing `Initializable` from two modules in one
directory collapses their flags into one slot (compact#270), so a module declares
`export ledger _isInitialized: Boolean;` and its own `assertInitialized` pair.

```compact
// Avoid
import "../security/Initializable" prefix Initializable_;

// Use
export ledger _isInitialized: Boolean;
circuit assertInitialized(): [] {
  assert(_isInitialized, "FungibleToken: contract not initialized");
}
```

**Guard, then delegate.** The public circuit holds the policy check and calls the building block
that holds the mechanism, so a consumer who wants a different policy wraps the block instead.

```compact
export circuit transfer(to: Either<Bytes<32>, ContractAddress>, value: Uint<128>): Boolean {
  assertInitialized();
  assert(to.is_left, "FungibleToken: unsafe transfer");
  return _unsafeTransfer(to, value);
}
```

**Tag a derivation unless it is meant to be global.** Two `persistentHash` calls over the same
arity and element type share a domain, so a value derived from a secret that must stay private,
or must not link across modules or deployments, carries a fixed module-named tag, placed first in
a new preimage so no caller-supplied slot can reproduce it. The one untagged derivation is the
public account id, `Utils_computeAccountId`, which is `persistentHash([secretKey])` by design: the
transparent modules share one identity per key. A module that wants a per-deployment identity
instead (`ShieldedAccessControl`, `ZOwnablePK`, `ConfidentialNoteFungibleToken`) salts and tags
its own, and never derives a private value from the untagged form.

```compact
// Avoid: a private key derivation that collides with the public account id
degradeToTransient(persistentHash<Vector<1, Bytes<32>>>([secret])) as JubjubScalar;

// Use
degradeToTransient(
  persistentHash<Vector<2, Bytes<32>>>([pad(32, "ElGamal:secretToScalar"), secret])
) as JubjubScalar;
```

**Constants are pure circuits, for now.** Compact has no module-level `const`, so a shared value
is an `UPPER_SNAKE_CASE` pure circuit, documented like any other. This is a workaround until the
language provides constants; when it does, these circuits become `const` declarations with the
same names.

```compact
export pure circuit UINT128_MAX(): Uint<128> {
  return 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;
}
```

**Compute, do not mutate.** Locals are immutable and the only loop is `for (const x of ...)`
over a vector or a `0..n` range, with its bound fixed at compile time. Branch with a ternary or
an early `return`, and accumulate with the standard library's `fold` or `map` rather than an
accumulator variable.

Patterns the library does not use, and why:

- **Per-call anti-replay nullifiers or sequence checks.** The ledger rejects a replayed intent
  (`ReplayProtectionViolation`); a nullifier in a contract is for a spendable thing (a note, a
  role), not for a transaction.
- **A contract recipient other than `kernel.self()` for a shielded coin.** The node rejects it
  and the dry simulator does not, so the modules assert it away up front
  ([`ARCHITECTURE.md`](ARCHITECTURE.md#asset-handling)).
- **A default or off-curve point inside a not-taken branch.** The prover constrains both branches,
  so an unprovable value behind a guard still fails the proof.
- **`TODO` comments.** Open an issue and reference it from the docblock if the gap is user-facing.
- **A `Mock*` contract, test witness or simulator reaching production.** They expose internals
  and bypass guards by design; the published package excludes them.

## Testing

Tests are written not only to verify the correctness of the target code but to be
comprehensively reviewed by other programmers. For code that secures value, the quality of the
tests matters as much as the code itself, and they are held to the same standards of clarity.
Every addition or change to the code comes with relevant and comprehensive tests. Unit tests
are mandatory for every new feature; whether a change also needs an integration test is
decided in review. When unsure, open the PR and ask. The coverage gate itself is set in
[`CONTRIBUTING.md`](CONTRIBUTING.md#code-quality-standards).

Layout:

- A module's specs live in its `test/` directory next to it, with the mock that exposes it under
  `test/mocks/`, the simulator under `test/simulators/` and the test witnesses under
  `test/witnesses/` ([`contracts/README.md`](contracts/README.md)). A preset keeps the same
  shape under `presets/test/`; an example under `examples/test/`.
- Every mock compiles through its category's `compile:<category>` script, and every spec drives
  the mock through a simulator built with `createSimulator` from `@openzeppelin/compact-simulator`,
  one method per circuit. A spec reaches the generated artifact directly only for
  `pureCircuits`, for the transcript (`proofData`) a privacy suite inspects, or for a
  constructor-only check that no simulator method can express.
- The unit spec covers behavior. A claim the header makes beyond behavior gets its own flavor
  file: `.privacy` (what the transcript and the ledger publish, with a negative control),
  `.property` (`fast-check` over generated inputs), `.invariant` (what holds across operation
  sequences), `.concurrency` (which pairs of calls conflict, through
  `test-utils/concurrency`), `.compatibility` (absolute digests, ledger slots and the circuit
  surface; a failure there is a decision, not a test to fix).
- A witness module with logic of its own (private-state constructors, validation, derivation)
  has a `test/witnesses/<Module>Witnesses.test.ts`; one that only hands back private state does
  not. These specs are dry-only.
- An integration spec composes several production modules into one contract under
  `test/integration/_mocks/`, with its simulator under `test/integration/fixtures/`, and pins what
  no single-module spec can: init-state isolation, supply conservation across modules, privacy of
  the composed transcript.

What every exported circuit has:

- The happy path, asserting on the resulting state through the simulator's ledger reader, not
  only on the return value.
- One test per `assert` in the circuit, named for the condition, asserting the full message:
  `await expect(token.transfer(ZERO, AMOUNT)).rejects.toThrow('FungibleToken: invalid receiver');`.
- The "not initialized" rejection, where the module has the guard (an `it.each` table over the
  guarded circuits keeps it to one test).
- The boundaries its types admit: zero, the width's maximum, the default or zero sentinel, both
  branches of an `Either`, the non-canonical value where canonicalization applies.
- For a circuit that reads a witness, the wrong-witness case: a hostile or stale value is
  rejected, or provably cannot affect the claim.

Idioms:

- `describe` per circuit (or per state, "when not initialized"); `it` names the behavior in the
  present tense: `'returns 0 when there is no supply'`. The older `'should ...'` form is accepted
  in files that already use it; do not mix the two in one file.
- `it.each` / `describe.each` for the same assertion over recipient kinds or circuit lists.
- A rejection raised by a witness, not by an in-circuit `assert`, is asserted with
  `expectRejection` from `#test-utils/assertions/rejection.js`: on the live backend the cause is
  wrapped twice and `rejects.toThrow` cannot see it.
- The same spec files run dry and live. A block that cannot run live (it mutates private state
  mid-test, constructs a simulator without deploying, or is pure compiler semantics) is
  `describe.skipIf(isLiveBackend())` with a comment stating why; a block that only means
  something live is `describe.runIf(isLiveBackend())`.
- No `it.only` is ever committed. `it.skip` carries a comment with the reason.
- Flaky tests are not acceptable: the live runner's flake check reports a pass on retry loudly,
  and the fix is in the test or the harness, not a retry loop in the spec.
- Property-based tests (`fast-check`) back math-heavy and encoding code: the curve modules,
  `EvmAbi`, supply accounting. A claim over a small finite input space is tested exhaustively
  instead, the way the concurrency suites enumerate every ordered pair of circuits.

The dry simulator is blind to the node's checks on coins, recipients and proof satisfiability.
A change that touches coins, identity or deployment is also run live before review, as
[`CONTRIBUTING.md`](CONTRIBUTING.md#tests) requires; the mechanics are in
[`TESTING.md`](TESTING.md).

## Linting and formatting

Biome is the formatter and linter for every TypeScript, JavaScript and JSON file, configured in
[`biome.json`](biome.json). `.compact` files are excluded from Biome and are not yet run through
the Compact formatter either; they follow [Layout](#layout-and-section-ordering). The commands
are in [`CONTRIBUTING.md`](CONTRIBUTING.md#a-typical-workflow).

Non-negotiable settings:

- Single quotes, semicolons, two-space indentation, sorted imports (`organizeImports`).
- `noUnusedVariables` and `noUnusedImports` are errors.
- `noBarrelFile` and `noReExportAll` are errors: import from the file that defines a thing.
- `noConsole` is an error except `console.log`; `useErrorMessage` requires every thrown `Error`
  to carry a message.
- `noNonNullAssertion` and `noExplicitAny` are off: a `!` or an `any` is a review question, not
  a lint failure.

The only acceptable suppression is a `// biome-ignore lint/<group>/<rule>: <reason>` on the line
above, and the reason says why the rule does not apply there, not that it is noisy. The one
expected occurrence is in every simulator's `create`:
``// biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this` ``.

`yarn types` type-checks only the witness modules and `scripts/`. Simulators and specs are not
type-checked by any script or CI step: vitest strips their types without checking them, so a
type error there passes unless it also fails at runtime. Check them in the editor before
opening a PR.

## Documentation

Every circuit (exported or not), every ledger field, every witness declaration and every
struct carries a `/** ... */` docblock. Docblocks are consumer-facing and describe what the code
does now: behavior, effects on the ledger, operational duties, deliberate asymmetries and
hazards invisible in a diff. No design rationale over alternatives, no history, no mention of
tests or mocks; that prose belongs in the PR, an issue or `ARCHITECTURE.md`.

Module header:

- `@module <Name>` (with its generic, `@module Signer<T>`) then `@description`, a paragraph on
  what the module is and how a contract composes it, with a `compact` code example where the
  composition is not obvious.
- `@notice` for an integrator-facing rule or caution (`MUST be called from the constructor`,
  constructor-time restrictions, out-of-band coin data). `@dev` for an implementation note a
  reviewer needs (derivations, notation, trust assumptions). `@warning` for a hazard that can
  lose value or keys.
- A module that touches secrets, coins or commitments has a privacy section stating what is
  public per transaction, what is public as state and what stays private, and a security section
  stating the wallet's duties (fresh seeds, secret keys) and what the ungated `_` circuits permit.
  Newer modules title them `@notice Privacy:` and `@notice Security:`. Anything in
  `export ledger` is a disclosure; say so, and say whether it is a new fact or already derivable
  from transaction history.
- Hashing is written as `H(...)` over named fixed-width operands, or as the preimage struct.
  Vocabulary: exported circuit signature, contract interface or ledger layout, never "ABI"
  (except in `EvmAbi` and `Eip712`).

Ledger fields: `@description`, plus `@type` lines on a map describing its key and value.

Circuits, with a blank `*` line between groups and typically in this order:

1. `@description`: one to three sentences on behavior and effect, never a restatement of the
   signature.
2. `@constraints k=<k>, rows=<rows>` on exported circuits, measured from a full compile of a
   mock that exercises them (not `SKIP_ZK`). An untagged annotation is the default ZKIR v2
   backend; a circuit compiled with `--feature-zkir-v3` appends `(zkir-v3)`. A change to an
   annotated circuit's body re-measures the annotation in the same PR. Exact row counts appear
   nowhere else.
3. `@notice` / `@dev` / `@warning` as above.
4. `Requirements:` followed by a blank `*` line and one bullet per `assert`.
5. `@param {Type} name - Description.` for every parameter.
6. `@return {Type} - Description.`; a mutator writes `@return {[]} - Empty tuple.`. `@returns`
   appears in older files and is left alone.

Witnesses: `@witness <name>`, `@description` of what the wallet must return and the trust the
module places in it, `@returns {Type} name - Description.`.

TypeScript docblocks (simulators, witnesses, harness) use `@description`, `@param name` with
a description and `@returns`; test files use a header docblock when the suite's
scope or backend gating needs explaining and `//` comments to say what a non-obvious assertion
pins. Every `Mock*.compact` starts with the `WARNING: FOR TESTING PURPOSES ONLY.` banner and
every `*Witnesses.ts` with the `TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.` banner, verbatim.

Prose rules for all of the above and for every Markdown file: US spelling, no em dashes (use a
colon, a comma or parentheses), and no row counts or values expected to change (address prefixes,
version numbers) in running text.

The online documentation at
[OpenZeppelin/docs](https://github.com/OpenZeppelin/docs) mirrors the module headers of the
modules it covers, with usage examples; the API pages copy the docblocks and infer nothing. It
is synchronized at release time rather than per PR.

## Changelog

[`CONTRIBUTING.md`](CONTRIBUTING.md#commit-and-pr-conventions) says when an entry is required.
Its format:

- One line per entry under `## Unreleased`, consumer-facing, ending with the PR number in
  parentheses: `(#1150)`. Sub-bullets list the signature or message changes a consumer must act
  on.
- Sections are added only when an entry needs them, in [Keep a
  Changelog](https://keepachangelog.com/) order: `### Added`, `### Changed`, `### Deprecated`,
  `### Removed`, `### Fixed`, `### Security`. A behavior change goes under `### Changed`, never
  `### Added`.
- A change is breaking, relative to the last release tag, when one of two audiences must act:
  1. An importing contract no longer compiles unchanged, or its client's generated types change:
     a changed exported circuit signature, a removed or renamed export, a renamed exported
     ledger key, a changed generic parameter
  2. A deployed instance cannot adopt the change by verifier-key rotation: any ledger layout
     change, any wire-format change (domain tags, preimage layouts, widths), any change to a
     struct that is signed or hashed

  Everything else, a new assert or a tightened check included, is `Changed` or `Fixed`, since
  an existing deployment takes it in place. Breaking entries go under their own
  `### Changed (breaking)` header.
- An entry in the second class says `fresh deploys only`.
- A fix to a change that has not shipped gets no entry; the `Unreleased` entry it corrects is
  amended if its text is no longer accurate.
