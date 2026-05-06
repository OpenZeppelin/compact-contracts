import {
  sampleSigningKey,
  signatureVerifyingKey,
  type SigningKey,
} from '@midnight-ntwrk/compact-runtime';
import {
  ContractMaintenanceAuthority,
  ContractOperationVersionedVerifierKey,
  ReplaceAuthority,
  VerifierKeyInsert,
} from '@midnight-ntwrk/ledger-v8';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  readAuthority,
  readCmaCounter,
  submitRawMaintenanceUpdate,
} from '../../_harness/cma.js';
import {
  deployTestTokenV1,
  type TestTokenV1Kit,
} from '../../fixtures/testTokenV1.js';

/**
 * Spec: probing chain behaviour with multi-`SingleUpdate` `MaintenanceUpdate`s.
 *
 * The SDK's public `circuitMaintenanceTx` / `contractMaintenanceTx`
 * interfaces produce one `SingleUpdate` per tx. To answer Q2 and the chain
 * half of Q4 (see [README](../../README.md#notes--open-questions)) we drop
 * down to `submitRawMaintenanceUpdate` from
 * [`_harness/cma.ts`](../../_harness/cma.ts), which builds a raw
 * `MaintenanceUpdate` carrying *N* `SingleUpdate`s, signs it with the
 * deployer's key, and submits it directly.
 *
 * Three describes, with outcomes pinned from a live local run:
 *
 *   1. **Sanity** — single-bundle `[insert]` for `_mint` after an SDK-side
 *      remove. Verifies the helper end-to-end. Counter advances by 2.
 *
 *   2. **Q2** — two `ReplaceAuthority`s in one bundle.
 *      **Observed:** chain rejects the tx outright with substrate
 *      `1010: Invalid Transaction: Custom error: 117`. `submitTx` returns
 *      a wrapped `SubmissionError` rejection (no `FinalizedTxData`).
 *
 *   3. **Q4 (chain-level)** — two `VerifierKeyInsert`s targeting the same
 *      operation in one bundle.
 *      **Observed:** chain accepts the *transaction* (no submission error)
 *      but the `MaintenanceUpdate` bundle is applied **atomically** —
 *      either all its `SingleUpdate`s land, or none do. With two inserts
 *      on the same op, the second fails the runtime invariant and the
 *      whole bundle reverts. The tx finalises with `status: 'FailFallible'`
 *      and the targeted op stays undefined on chain. Operationally:
 *      neither insert sticks.
 *
 *      (The `segmentStatusMap` in the finalised data shows two
 *      `SegmentSuccess` entries and one `SegmentFail` — the successes are
 *      guaranteed-phase / signature segments; the fail is the bundle's
 *      fallible segment. Reverting is at the bundle granularity, not per
 *      `SingleUpdate`.)
 */
describe('TestToken — sanity: single bundle with [remove, insert] for `_mint`', () => {
  let v1: TestTokenV1Kit;

  beforeAll(async () => {
    v1 = await deployTestTokenV1();
  });

  afterAll(async () => {
    await v1?.teardown();
  });

  it('should accept the bundle and bump the CMA counter', async () => {
    const before = await readCmaCounter(v1.providers, v1.contractAddress);
    const mintVk = await v1.providers.zkConfigProvider.getVerifierKey('_mint');
    const versionedVk = new ContractOperationVersionedVerifierKey('v3', mintVk);

    // The slot starts occupied (deploy-time VK). Remove first, then re-insert
    // the same VK — net behaviour unchanged, but the bundle exercises the
    // multi-`SingleUpdate` path.
    //
    // NOTE: VerifierKeyRemove takes (operation, version). We don't have a
    // direct `removeVerifierKey` SingleUpdate constructor exposed in the
    // current cma.ts surface — fall back to the SDK's per-tx remove first,
    // then submit the [insert] alone via the raw helper. That still proves
    // the raw path works without needing a remove SingleUpdate today.
    await v1.deployed.circuitMaintenanceTx._mint.removeVerifierKey();
    await submitRawMaintenanceUpdate(v1.providers, v1.contractAddress, [
      new VerifierKeyInsert('_mint', versionedVk),
    ]);

    const after = await readCmaCounter(v1.providers, v1.contractAddress);
    // SDK remove (1) + raw insert (1) = +2 total.
    expect(after).toBe(before + 2n);
  });
});

describe('TestToken — Q2: two `ReplaceAuthority` in one bundle', () => {
  let v1: TestTokenV1Kit;

  beforeAll(async () => {
    v1 = await deployTestTokenV1();
  });

  afterAll(async () => {
    await v1?.teardown();
  });

  it('should be rejected by the chain at submission (Custom error: 117)', async () => {
    const keyB: SigningKey = sampleSigningKey();
    const keyC: SigningKey = sampleSigningKey();
    const authB = new ContractMaintenanceAuthority(
      [signatureVerifyingKey(keyB)],
      1,
    );
    const authC = new ContractMaintenanceAuthority(
      [signatureVerifyingKey(keyC)],
      1,
    );

    // Pinned from observation: the chain rejects two-`ReplaceAuthority`
    // bundles at submission time (substrate `1010: Invalid Transaction:
    // Custom error: 117`). `submitTx` surfaces this as a wrapped
    // `SubmissionError` rejection — different from the FailFallible
    // segment-level handling we see in the Q4 case below.
    await expect(
      submitRawMaintenanceUpdate(v1.providers, v1.contractAddress, [
        new ReplaceAuthority(authB),
        new ReplaceAuthority(authC),
      ]),
    ).rejects.toThrow(/SubmissionError|Transaction submission error/);

    // The on-chain authority should be unchanged from deploy. Sanity-check.
    const auth = await readAuthority(v1.providers, v1.contractAddress);
    expect(auth.committee.length).toBe(1);
  });
});

describe('TestToken — Q4 (chain-level): two `VerifierKeyInsert` on the same op', () => {
  let v1: TestTokenV1Kit;

  beforeAll(async () => {
    v1 = await deployTestTokenV1();
    // Empty the `_mint` slot first via the SDK's standard remove path so
    // the bundle below exercises a clean two-insert case (not insert-on-
    // occupied, which is what `vkCoexistence.spec.ts` already covers).
    await v1.deployed.circuitMaintenanceTx._mint.removeVerifierKey();
  });

  afterAll(async () => {
    await v1?.teardown();
  });

  it('should accept the tx but revert the bundle atomically (FailFallible, _mint stays undefined)', async () => {
    const mintVk = await v1.providers.zkConfigProvider.getVerifierKey('_mint');
    const versionedVk = new ContractOperationVersionedVerifierKey('v3', mintVk);

    // Both inserts target the same operation `_mint` in the same bundle.
    // Pinned from observation: the tx finalises (no submission error), but
    // the `MaintenanceUpdate` bundle is applied atomically — the second
    // insert violates the one-VK-per-slot invariant, the whole bundle
    // reverts, and `_mint` stays undefined. Status reflects the failure.
    const result = await submitRawMaintenanceUpdate(
      v1.providers,
      v1.contractAddress,
      [
        new VerifierKeyInsert('_mint', versionedVk),
        new VerifierKeyInsert('_mint', versionedVk),
      ],
    );

    // The tx didn't entirely succeed — the fallible segment carrying the
    // bundle failed, even though the guaranteed-phase segments succeeded.
    expect(result.status).toBe('FailFallible');

    // Bundle reverted atomically: neither insert took effect. The `_mint`
    // slot was emptied in `beforeAll` and stays empty after the bundle.
    const stateAfter = await v1.providers.publicDataProvider.queryContractState(
      v1.contractAddress,
    );
    expect(stateAfter?.operation('_mint')).toBeUndefined();
  });
});
