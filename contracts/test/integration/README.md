# Integration tests

Specs that compose **multiple production modules into a single top-level
contract** and drive it through the simulator — the surface unit tests (one
module per mock) can't cover. Run with the current toolchain (compact 0.29.0).

```sh
yarn test:integration
```

That compiles the integration contracts and runs `vitest --config
vitest.integration.config.ts`.

## Structure

- **`specs/`** — what runs. One file per scenario, named `*.spec.ts`.
- **`fixtures/`** — per-contract simulator factories (`@openzeppelin/compact-simulator`).
- **`_mocks/`** — test-only top-level `.compact` contracts that do the composing.

## `initStateIsolation` (issue #556 / compiler#270)

Proves both the bug and the fix for shared-vs-per-module initialization state:

- **`SharedInitCollision`** — two modules in the same directory that both import
  the shared, stateful `Initializable`. The compiler deduplicates the transitive
  `_isInitialized` into one ledger slot, so initializing one module initializes
  the other. The spec's "the bug" block asserts that collision.
- **`ComposedTokens`** — the production `FungibleToken` + `NonFungibleToken`
  (same directory), each now owning its `_isInitialized` flag. The "the fix"
  block asserts the two initializations are independent.

If the compiler ever isolates transitive ledger state (compiler#270 resolved),
the "the bug" block must be inverted or removed.
