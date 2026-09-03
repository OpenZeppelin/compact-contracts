import {
  ContractOperationVersion,
  ContractOperationVersionedVerifierKey,
  VerifierKeyInsert,
  VerifierKeyRemove,
} from '@midnight-ntwrk/ledger-v8';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  requireContractState,
  submitRawMaintenanceUpdate,
} from '../../_harness/cma.js';
import {
  deployTestTokenV1,
  type TestTokenV1Kit,
} from '../../fixtures/testTokenV1.js';

/**
 * Verifier-key bundles that touch *different* operations — the shape a real
 * multi-circuit version bump takes.
 *
 * The neighbouring specs pin what the chain refuses: bundles with more than
 * one `ReplaceAuthority`, bundles mixing `ReplaceAuthority` with another kind,
 * and two inserts on one operation. These three are the remainder, and they
 * all apply in full.
 */
const OPERATION_VERSION = 'v3';

const versionedKey = async (kit: TestTokenV1Kit, circuit: '_mint' | 'pause') =>
  new ContractOperationVersionedVerifierKey(
    OPERATION_VERSION,
    await kit.providers.zkConfigProvider.getVerifierKey(circuit),
  );

describe.runIf(isLiveBackend())(
  'TestToken — VK bundles across different operations',
  () => {
    describe('two inserts into empty slots', () => {
      let v1: TestTokenV1Kit;

      beforeAll(async () => {
        v1 = await deployTestTokenV1();
        await v1.deployed.circuitMaintenanceTx._mint.removeVerifierKey();
        await v1.deployed.circuitMaintenanceTx.pause.removeVerifierKey();
      });

      afterAll(async () => {
        await v1?.teardown();
      });

      it('applies both, occupying each slot', async () => {
        const result = await submitRawMaintenanceUpdate(
          v1.providers,
          v1.contractAddress,
          [
            new VerifierKeyInsert('_mint', await versionedKey(v1, '_mint')),
            new VerifierKeyInsert('pause', await versionedKey(v1, 'pause')),
          ],
        );
        expect(result.status).toBe('SucceedEntirely');

        const stateAfter = await requireContractState(
          v1.providers,
          v1.contractAddress,
        );
        expect(stateAfter.operation('_mint')).toBeDefined();
        expect(stateAfter.operation('pause')).toBeDefined();
      });
    });

    describe('two removes from occupied slots', () => {
      let v1: TestTokenV1Kit;

      beforeAll(async () => {
        // A fresh deploy leaves both slots holding their original keys.
        v1 = await deployTestTokenV1();
      });

      afterAll(async () => {
        await v1?.teardown();
      });

      it('applies both, emptying each slot', async () => {
        const version = new ContractOperationVersion(OPERATION_VERSION);
        const result = await submitRawMaintenanceUpdate(
          v1.providers,
          v1.contractAddress,
          [
            new VerifierKeyRemove('_mint', version),
            new VerifierKeyRemove('pause', version),
          ],
        );
        expect(result.status).toBe('SucceedEntirely');

        const stateAfter = await requireContractState(
          v1.providers,
          v1.contractAddress,
        );
        expect(stateAfter.operation('_mint')).toBeUndefined();
        expect(stateAfter.operation('pause')).toBeUndefined();
      });
    });

    describe('an insert and a remove', () => {
      let v1: TestTokenV1Kit;

      beforeAll(async () => {
        v1 = await deployTestTokenV1();
        // `_mint` empty for the insert to land in; `pause` left occupied for
        // the remove to take.
        await v1.deployed.circuitMaintenanceTx._mint.removeVerifierKey();
      });

      afterAll(async () => {
        await v1?.teardown();
      });

      it('applies both, so mixing update kinds is allowed', async () => {
        const result = await submitRawMaintenanceUpdate(
          v1.providers,
          v1.contractAddress,
          [
            new VerifierKeyInsert('_mint', await versionedKey(v1, '_mint')),
            new VerifierKeyRemove(
              'pause',
              new ContractOperationVersion(OPERATION_VERSION),
            ),
          ],
        );
        expect(result.status).toBe('SucceedEntirely');

        const stateAfter = await requireContractState(
          v1.providers,
          v1.contractAddress,
        );
        expect(stateAfter.operation('_mint')).toBeDefined();
        expect(stateAfter.operation('pause')).toBeUndefined();
      });
    });
  },
);
