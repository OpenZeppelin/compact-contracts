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
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  readAuthoritySnapshot,
  readCmaCounter,
  requireContractState,
  submitRawMaintenanceUpdate,
} from '../../_harness/cma.js';
import {
  deployTestTokenV1,
  type TestTokenV1Kit,
} from '../../fixtures/testTokenV1.js';

/**
 * How the chain treats a `MaintenanceUpdate` carrying several `SingleUpdate`s,
 * which the SDK's one-update-per-tx surface cannot build.
 *
 * Two rules fall out, and they differ:
 *
 *   - Two `ReplaceAuthority`s in one bundle are refused at submission, so the
 *     tx never reaches a block.
 *   - Two inserts on the same operation produce a tx the chain accepts, whose
 *     bundle then reverts as a unit: the status is `FailFallible` and the slot
 *     is left as it was. Reverting is per bundle, not per `SingleUpdate`.
 */
const OPERATION_VERSION = 'v3';

describe.runIf(isLiveBackend())(
  'TestToken — one bundle of [remove, insert] for `_mint`',
  () => {
    let v1: TestTokenV1Kit;

    beforeAll(async () => {
      v1 = await deployTestTokenV1();
    });

    afterAll(async () => {
      await v1?.teardown();
    });

    it('accepts the bundle and advances the counter once per update', async () => {
      const before = await readCmaCounter(v1.providers, v1.contractAddress);
      const mintVk =
        await v1.providers.zkConfigProvider.getVerifierKey('_mint');
      const versionedVk = new ContractOperationVersionedVerifierKey(
        OPERATION_VERSION,
        mintVk,
      );

      // The slot holds the deploy-time key. Remove through the SDK, then
      // re-insert through the raw path — the helper takes no remove update.
      await v1.deployed.circuitMaintenanceTx._mint.removeVerifierKey();
      await submitRawMaintenanceUpdate(v1.providers, v1.contractAddress, [
        new VerifierKeyInsert('_mint', versionedVk),
      ]);

      const after = await readCmaCounter(v1.providers, v1.contractAddress);
      expect(after).toBe(before + 2n);
    });
  },
);

describe.runIf(isLiveBackend())(
  'TestToken — two `ReplaceAuthority` in one bundle',
  () => {
    let v1: TestTokenV1Kit;

    beforeAll(async () => {
      v1 = await deployTestTokenV1();
    });

    afterAll(async () => {
      await v1?.teardown();
    });

    it('is refused at submission', async () => {
      const before = await readAuthoritySnapshot(
        v1.providers,
        v1.contractAddress,
      );
      const authFor = (key: ReturnType<typeof sampleSigningKey>) =>
        new ContractMaintenanceAuthority([signatureVerifyingKey(key)], 1);

      await expect(
        submitRawMaintenanceUpdate(v1.providers, v1.contractAddress, [
          new ReplaceAuthority(authFor(sampleSigningKey())),
          new ReplaceAuthority(authFor(sampleSigningKey())),
        ]),
      ).rejects.toThrow(/SubmissionError|Transaction submission error/);

      const after = await readAuthoritySnapshot(
        v1.providers,
        v1.contractAddress,
      );
      expect(after).toStrictEqual(before);
    });
  },
);

describe.runIf(isLiveBackend())(
  'TestToken — two `VerifierKeyInsert` on the same operation',
  () => {
    let v1: TestTokenV1Kit;

    beforeAll(async () => {
      v1 = await deployTestTokenV1();
      // Empty the slot first, so this is a two-insert case rather than the
      // insert-on-occupied one `vkCoexistence` already covers.
      await v1.deployed.circuitMaintenanceTx._mint.removeVerifierKey();
    });

    afterAll(async () => {
      await v1?.teardown();
    });

    it('finalizes the tx but reverts the bundle, leaving the slot empty', async () => {
      const mintVk =
        await v1.providers.zkConfigProvider.getVerifierKey('_mint');
      const versionedVk = new ContractOperationVersionedVerifierKey(
        OPERATION_VERSION,
        mintVk,
      );

      const result = await submitRawMaintenanceUpdate(
        v1.providers,
        v1.contractAddress,
        [
          new VerifierKeyInsert('_mint', versionedVk),
          new VerifierKeyInsert('_mint', versionedVk),
        ],
      );
      expect(result.status).toBe('FailFallible');

      const stateAfter = await requireContractState(
        v1.providers,
        v1.contractAddress,
      );
      expect(stateAfter.operation('_mint')).toBeUndefined();
    });
  },
);
