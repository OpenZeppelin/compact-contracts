import {
  sampleSigningKey,
  signatureVerifyingKey,
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
  submitRawMaintenanceUpdate,
} from '../../_harness/cma.js';
import {
  deployTestTokenV1,
  type TestTokenV1Kit,
} from '../../fixtures/testTokenV1.js';

/**
 * Spec: when a `MaintenanceUpdate` bundle contains a `ReplaceAuthority`
 * *plus* another `SingleUpdate` (here: a `VerifierKeyInsert`), what does
 * the chain do?
 *
 * **Pinned outcome (observed):** chain rejects the tx outright at
 * submission with substrate `1010: Invalid Transaction: Custom error: 117`,
 * surfaced by the SDK as `(FiberFailure) SubmissionError`. Same error
 * class as the two-`ReplaceAuthority` bundle in [`multiUpdate.spec.ts`](./multiUpdate.spec.ts);
 * the two findings together suggest the chain enforces a structural rule:
 *
 *   - A `MaintenanceUpdate` carrying any `ReplaceAuthority` cannot also
 *     carry other `SingleUpdate` kinds in the same bundle.
 *   - (Multi-`VerifierKeyInsert` bundles are accepted as txs but revert
 *     atomically per the Q4 finding — that's a different rule.)
 *
 * Both orderings — `[ReplaceAuthority, …]` and `[…, ReplaceAuthority]` —
 * reject identically, so the SU sequence doesn't shape the outcome. The
 * spec deliberately tests both orderings to lock in that the rule is
 * "no `ReplaceAuthority` mixed with other kinds, regardless of order."
 *
 * See Q7 in the [README notes table](../../README.md#notes--open-questions).
 */
describe('TestToken — mixed bundle: [ReplaceAuthority, VerifierKeyInsert]', () => {
  let v1: TestTokenV1Kit;
  let newKey: ReturnType<typeof sampleSigningKey>;

  beforeAll(async () => {
    v1 = await deployTestTokenV1();
    // Empty `_mint` so the bundle's VerifierKeyInsert lands cleanly (no
    // collision with the deploy-time VK in the slot).
    await v1.deployed.circuitMaintenanceTx._mint.removeVerifierKey();
    newKey = sampleSigningKey();
  });

  afterAll(async () => {
    await v1?.teardown();
  });

  it('should reject the bundle at submission (Custom error: 117) — chain disallows mixing ReplaceAuthority with other SingleUpdate kinds', async () => {
    const newAuth = new ContractMaintenanceAuthority(
      [signatureVerifyingKey(newKey)],
      1,
    );
    const mintVk = await v1.providers.zkConfigProvider.getVerifierKey('_mint');
    const versionedVk = new ContractOperationVersionedVerifierKey('v3', mintVk);

    await expect(
      submitRawMaintenanceUpdate(v1.providers, v1.contractAddress, [
        new ReplaceAuthority(newAuth),
        new VerifierKeyInsert('_mint', versionedVk),
      ]),
    ).rejects.toThrow(/SubmissionError|Transaction submission error/);

    // Sanity: nothing applied. `_mint` is still empty (we removed it in
    // beforeAll), the authority is unchanged from deploy.
    const authAfter = await readAuthority(v1.providers, v1.contractAddress);
    expect(authAfter.committee.length).toBe(1);
    const stateAfter = await v1.providers.publicDataProvider.queryContractState(
      v1.contractAddress,
    );
    expect(stateAfter?.operation('_mint')).toBeUndefined();
  });
});

describe('TestToken — mixed bundle: [VerifierKeyInsert, ReplaceAuthority]', () => {
  let v1: TestTokenV1Kit;
  let newKey: ReturnType<typeof sampleSigningKey>;

  beforeAll(async () => {
    v1 = await deployTestTokenV1();
    await v1.deployed.circuitMaintenanceTx._mint.removeVerifierKey();
    newKey = sampleSigningKey();
  });

  afterAll(async () => {
    await v1?.teardown();
  });

  it('should reject in this ordering too — the SU sequence does not change the verdict', async () => {
    const newAuth = new ContractMaintenanceAuthority(
      [signatureVerifyingKey(newKey)],
      1,
    );
    const mintVk = await v1.providers.zkConfigProvider.getVerifierKey('_mint');
    const versionedVk = new ContractOperationVersionedVerifierKey('v3', mintVk);

    await expect(
      submitRawMaintenanceUpdate(v1.providers, v1.contractAddress, [
        new VerifierKeyInsert('_mint', versionedVk),
        new ReplaceAuthority(newAuth),
      ]),
    ).rejects.toThrow(/SubmissionError|Transaction submission error/);

    const authAfter = await readAuthority(v1.providers, v1.contractAddress);
    expect(authAfter.committee.length).toBe(1);
    const stateAfter = await v1.providers.publicDataProvider.queryContractState(
      v1.contractAddress,
    );
    expect(stateAfter?.operation('_mint')).toBeUndefined();
  });
});
