import {
  ContractOperationVersion,
  ContractOperationVersionedVerifierKey,
  VerifierKeyInsert,
  VerifierKeyRemove,
} from '@midnight-ntwrk/ledger-v8';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { submitRawMaintenanceUpdate } from '../../_harness/cma.js';
import {
  deployTestTokenV1,
  type TestTokenV1Kit,
} from '../../fixtures/testTokenV1.js';

/**
 * Spec: bundle-shape matrix for non-`ReplaceAuthority` `MaintenanceUpdate`s.
 *
 * What we know going in (from earlier specs):
 *   - Multi-`ReplaceAuthority` in one bundle: rejected at submission ([`multiUpdate.spec.ts`](./multiUpdate.spec.ts) Q2).
 *   - Multi-`VerifierKeyInsert` on the **same** op: tx finalises but the
 *     bundle reverts atomically with `status: 'FailFallible'`
 *     ([`multiUpdate.spec.ts`](./multiUpdate.spec.ts) Q4 chain-level).
 *   - `ReplaceAuthority` mixed with another `SingleUpdate` kind: rejected
 *     in either order ([`mixedBundle.spec.ts`](./mixedBundle.spec.ts) Q7).
 *
 * What this spec fills in: the three bundle shapes that remain — VK-only
 * bundles on **different** operations. These are the realistic happy path
 * for a multi-circuit version bump (e.g., simultaneously rotating `_mint`
 * and `pause` VKs in one tx). The suite has implicitly assumed they work
 * but never directly confirmed it.
 *
 * Three describes, each its own fresh deploy (the bundles mutate state
 * and we want each test in a known-clean starting state):
 *
 *   1. **Multi-insert on different ops** — `[Insert(_mint), Insert(pause)]`
 *      against empty slots. Expect entire success.
 *   2. **Multi-remove on different ops** — `[Remove(_mint), Remove(pause)]`
 *      against occupied slots. Expect entire success.
 *   3. **Mixed `Insert` + `Remove` on different ops** — `[Insert(_mint),
 *      Remove(pause)]`. Q7 only forbade mixing with `ReplaceAuthority`;
 *      mixing VK kinds should be allowed. Expect entire success.
 *
 * If any describe fails, we pin to the observed behaviour and update the
 * [README notes table](../../README.md#notes--open-questions). Until then,
 * Q10 (this whole probe) is the spec's contribution.
 */
describe('TestToken — multi-VK bundles on different ops', () => {
  describe('multi-insert on different empty slots', () => {
    let v1: TestTokenV1Kit;

    beforeAll(async () => {
      v1 = await deployTestTokenV1();
      // Empty both target slots so the inserts land cleanly.
      await v1.deployed.circuitMaintenanceTx._mint.removeVerifierKey();
      await v1.deployed.circuitMaintenanceTx.pause.removeVerifierKey();
    });

    afterAll(async () => {
      await v1?.teardown();
    });

    it('should accept the bundle entirely; both slots become occupied', async () => {
      const mintVk = await v1.providers.zkConfigProvider.getVerifierKey('_mint');
      const pauseVk = await v1.providers.zkConfigProvider.getVerifierKey('pause');
      const versionedMintVk = new ContractOperationVersionedVerifierKey('v3', mintVk);
      const versionedPauseVk = new ContractOperationVersionedVerifierKey('v3', pauseVk);

      const result = await submitRawMaintenanceUpdate(
        v1.providers,
        v1.contractAddress,
        [
          new VerifierKeyInsert('_mint', versionedMintVk),
          new VerifierKeyInsert('pause', versionedPauseVk),
        ],
      );
      expect(result.status).toBe('SucceedEntirely');

      const stateAfter = await v1.providers.publicDataProvider.queryContractState(
        v1.contractAddress,
      );
      expect(stateAfter?.operation('_mint')).toBeDefined();
      expect(stateAfter?.operation('pause')).toBeDefined();
    });
  });

  describe('multi-remove on different occupied slots', () => {
    let v1: TestTokenV1Kit;

    beforeAll(async () => {
      // Fresh deploy: both slots are occupied with their original VKs.
      v1 = await deployTestTokenV1();
    });

    afterAll(async () => {
      await v1?.teardown();
    });

    it('should accept the bundle entirely; both slots become empty', async () => {
      const v3 = new ContractOperationVersion('v3');
      const result = await submitRawMaintenanceUpdate(
        v1.providers,
        v1.contractAddress,
        [
          new VerifierKeyRemove('_mint', v3),
          new VerifierKeyRemove('pause', v3),
        ],
      );
      expect(result.status).toBe('SucceedEntirely');

      const stateAfter = await v1.providers.publicDataProvider.queryContractState(
        v1.contractAddress,
      );
      expect(stateAfter?.operation('_mint')).toBeUndefined();
      expect(stateAfter?.operation('pause')).toBeUndefined();
    });
  });

  describe('mixed Insert + Remove on different ops', () => {
    let v1: TestTokenV1Kit;

    beforeAll(async () => {
      v1 = await deployTestTokenV1();
      // Empty `_mint` so the bundle's Insert can land; leave `pause`
      // occupied so the bundle's Remove has something to remove.
      await v1.deployed.circuitMaintenanceTx._mint.removeVerifierKey();
    });

    afterAll(async () => {
      await v1?.teardown();
    });

    it('should accept the bundle entirely; `_mint` becomes occupied, `pause` becomes empty', async () => {
      const mintVk = await v1.providers.zkConfigProvider.getVerifierKey('_mint');
      const versionedMintVk = new ContractOperationVersionedVerifierKey('v3', mintVk);
      const v3 = new ContractOperationVersion('v3');

      const result = await submitRawMaintenanceUpdate(
        v1.providers,
        v1.contractAddress,
        [
          new VerifierKeyInsert('_mint', versionedMintVk),
          new VerifierKeyRemove('pause', v3),
        ],
      );
      expect(result.status).toBe('SucceedEntirely');

      const stateAfter = await v1.providers.publicDataProvider.queryContractState(
        v1.contractAddress,
      );
      expect(stateAfter?.operation('_mint')).toBeDefined();
      expect(stateAfter?.operation('pause')).toBeUndefined();
    });
  });
});
