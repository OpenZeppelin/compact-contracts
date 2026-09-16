import {
  sampleSigningKey,
  signatureVerifyingKey,
} from '@midnight-ntwrk/compact-runtime';
import {
  ContractMaintenanceAuthority,
  ContractOperationVersionedVerifierKey,
  ReplaceAuthority,
  type SingleUpdate,
  VerifierKeyInsert,
} from '@midnight-ntwrk/ledger-v8';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readAuthoritySnapshot,
  requireContractState,
  submitRawMaintenanceUpdate,
} from '../../_harness/cma.js';
import {
  deployTestTokenV1,
  type TestTokenV1Kit,
} from '../../fixtures/testTokenV1.js';

/**
 * A `ReplaceAuthority` cannot share a bundle with another kind of update: the
 * chain refuses the tx at submission, in either order. Together with the
 * two-`ReplaceAuthority` case in `multiUpdate`, that makes the rule structural
 * rather than about ordering or content.
 *
 * Note this is a different rule from the atomic revert two same-operation
 * inserts get — those produce a tx the chain accepts.
 */
const OPERATION_VERSION = 'v3';

/** Deploy, then empty `_mint` so the bundle's insert has a free slot. */
async function deployWithEmptyMintSlot(): Promise<TestTokenV1Kit> {
  const v1 = await deployTestTokenV1();
  await v1.deployed.circuitMaintenanceTx._mint.removeVerifierKey();
  return v1;
}

describe.runIf(isLiveBackend())(
  'TestToken — bundling ReplaceAuthority with another update kind',
  () => {
    let v1: TestTokenV1Kit | undefined;

    afterEach(async () => {
      await v1?.teardown();
      v1 = undefined;
    });

    it.each([
      { order: 'ReplaceAuthority first', authorityFirst: true },
      { order: 'ReplaceAuthority last', authorityFirst: false },
    ])('is refused at submission with $order', async ({ authorityFirst }) => {
      v1 = await deployWithEmptyMintSlot();
      const authorityBefore = await readAuthoritySnapshot(
        v1.providers,
        v1.contractAddress,
      );

      const newAuth = new ContractMaintenanceAuthority(
        [signatureVerifyingKey(sampleSigningKey())],
        1,
      );
      const mintVk =
        await v1.providers.zkConfigProvider.getVerifierKey('_mint');
      const insert = new VerifierKeyInsert(
        '_mint',
        new ContractOperationVersionedVerifierKey(OPERATION_VERSION, mintVk),
      );
      const updates: SingleUpdate[] = authorityFirst
        ? [new ReplaceAuthority(newAuth), insert]
        : [insert, new ReplaceAuthority(newAuth)];

      await expect(
        submitRawMaintenanceUpdate(v1.providers, v1.contractAddress, updates),
      ).rejects.toThrow(/SubmissionError|Transaction submission error/);

      // Neither update took: the authority is the deploy-time one and the
      // slot is still empty.
      const authorityAfter = await readAuthoritySnapshot(
        v1.providers,
        v1.contractAddress,
      );
      expect(authorityAfter).toStrictEqual(authorityBefore);
      const stateAfter = await requireContractState(
        v1.providers,
        v1.contractAddress,
      );
      expect(stateAfter.operation('_mint')).toBeUndefined();
    });
  },
);
