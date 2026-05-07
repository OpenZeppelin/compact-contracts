# Integration tests

End-to-end specs that drive the OpenZeppelin Compact modules against a real local Midnight stack (proof-server + indexer + node). For how to run them, see the root [README](../../../README.md#integration-tests).

## Structure

- **`specs/`** — what runs in CI. Grouped by surface under test (`accessControl/`, `cma/`, `upgrades/`, plus a top-level `smoke.spec.ts`).
- **`fixtures/`** — per-contract deploy + handle factories. `testTokenV1.ts` returns a kit (deployer wallet, signer pool, ledger reader); `testTokenV2.ts` exposes `bindAsV2(kit, alias)` for the upgrade specs.
- **`_harness/`** — cross-cutting helpers: CMA wrappers (`cma.ts`), provider builders, network config, the shared `WalletPool` (singleton across the suite).
- **`_mocks/`** — test-only `.compact` contracts (the `TestToken` composite, V1 and V2).

Three pre-funded signer aliases (`ADMIN`, `ALICE`, `BOB`) come from the dev-preset Midnight node; the deployer alias is `GENESIS` and lives on `kit.wallet`.

## Notes / open questions

Working record of what we've learned about Compact's CMA / VK upgrade pathway from running these tests. Update when a new spec resolves an open question.

| # | Question | Status | Where |
|---|---|---|---|
| Q1 | `VerifierKeyInsert` for a brand-new operation name? | ✅ | `versionUpgrade.spec.ts` (mintBatch describe) — chain accepts. |
| Q2 | Two `ReplaceAuthority` in one bundle? | ✅ | Chain rejects the tx at submission (substrate `1010: Invalid Transaction: Custom error: 117`). Pinned in `multiUpdate.spec.ts`. |
| Q3 | CMA state queryable via indexer without a tx? | ✅ | `_harness/cma.ts` readers (`readAuthority`, `readCmaCounter`) used by every CMA spec. |
| Q4 | Multiple VK versions live on the same slot? | ✅ | Two layers: the SDK rejects client-side (`vkCoexistence.spec.ts`), and at the chain level a hand-built bundle with two `VerifierKeyInsert`s on the same op finalises `status: 'FailFallible'` and reverts the whole `MaintenanceUpdate` atomically — neither insert persists. Pinned in `multiUpdate.spec.ts`. |
| Q5 | Events emitted on `MaintenanceUpdate`? | ⏳ | Not probed. |
| Q6 | Stale-counter `MaintenanceUpdate` rejected? | ✅ | Yes. Replay protection works as documented — chain rejects at submission. Pinned in `staleCounter.spec.ts`. |
| Q7 | `ReplaceAuthority` mixed with other `SingleUpdate` kinds in one bundle? | ✅ | Chain rejects in both orderings (`Custom error: 117`). Together with Q2, suggests the rule "any bundle containing a `ReplaceAuthority` must contain *only* that one SU." Pinned in `mixedBundle.spec.ts`. |
| Q8 | Cross-contract signature replay (sign for A, address to B)? | ✅ | Chain rejects — `dataToSign` is address-bound. Pinned in `crossContractReplay.spec.ts`. |
| Q9 | Empty-committee `ReplaceAuthority(committee=[], threshold=1)` accepted by chain? | ✅ | No. Chain rejects at submission (`Custom error: 117`). The "abandoned-key" workaround in `freeze.spec.ts` is therefore the only viable freeze pattern. Pinned in `emptyCommitteeFreeze.spec.ts`. |
| Q10 | VK-only multi-update bundles on **different** ops (Insert+Insert, Remove+Remove, Insert+Remove)? | (pending run) | Tested in `multiVkBundle.spec.ts`. Pinning policy: assertions assume entire success (chain accepts the realistic upgrade path). Update this row after first green run. |

Status: ✅ Answered · ◐ Partial · ⏳ Open
