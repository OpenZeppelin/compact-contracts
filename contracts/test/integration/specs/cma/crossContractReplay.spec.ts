import {
  sampleSigningKey,
  signatureVerifyingKey,
  signData,
} from '@midnight-ntwrk/compact-runtime';
import {
  ContractMaintenanceAuthority,
  Intent,
  MaintenanceUpdate,
  ReplaceAuthority,
  Transaction,
} from '@midnight-ntwrk/ledger-v8';
import { submitTx } from '@midnight-ntwrk/midnight-js-contracts';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { asContractAddress } from '@midnight-ntwrk/midnight-js-types';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  maintenanceTtl,
  readAuthoritySnapshot,
  readCmaCounter,
} from '../../_harness/cma.js';
import {
  deployTestTokenV1,
  type TestTokenV1Kit,
} from '../../fixtures/testTokenV1.js';

/**
 * A maintenance signature is bound to the contract it names. Without that,
 * capturing one signature from any contract would compromise every other
 * contract whose counter happened to line up.
 *
 * The update is built and signed inline rather than through
 * `submitRawMaintenanceUpdate`: that helper looks the key up by the address it
 * is given, so it would fetch B's key and prove nothing.
 */
describe.runIf(isLiveBackend())(
  "TestToken — one contract's signature on another's update",
  () => {
    let contractA: TestTokenV1Kit;
    let contractB: TestTokenV1Kit;

    beforeAll(async () => {
      contractA = await deployTestTokenV1();
      contractB = await deployTestTokenV1();
    });

    afterAll(async () => {
      await contractA?.teardown();
      await contractB?.teardown();
    });

    it('is rejected when addressed to B and signed with A’s key', async () => {
      const signingKeyA =
        await contractA.providers.privateStateProvider.getSigningKey(
          contractA.contractAddress,
        );
      if (!signingKeyA) {
        throw new Error(
          `crossContractReplay setup: no signing key for ${contractA.contractAddress}`,
        );
      }

      const authorityB = await readAuthoritySnapshot(
        contractB.providers,
        contractB.contractAddress,
      );
      // Match B's counter, or a stale-counter rejection would mask the one
      // under test.
      const counterB = await readCmaCounter(
        contractB.providers,
        contractB.contractAddress,
      );
      const decoyAuth = new ContractMaintenanceAuthority(
        [signatureVerifyingKey(sampleSigningKey())],
        1,
      );

      const update = new MaintenanceUpdate(
        asContractAddress(contractB.contractAddress),
        [new ReplaceAuthority(decoyAuth)],
        counterB,
      );
      const signed = update.addSignature(
        0n,
        signData(signingKeyA, update.dataToSign),
      );
      const unprovenTx = Transaction.fromParts(
        getNetworkId(),
        undefined,
        undefined,
        Intent.new(maintenanceTtl()).addMaintenanceUpdate(signed),
      );

      await expect(
        submitTx(contractB.providers as Parameters<typeof submitTx>[0], {
          unprovenTx,
        }),
      ).rejects.toThrow(/SubmissionError|Transaction submission error/);

      const authorityAfter = await readAuthoritySnapshot(
        contractB.providers,
        contractB.contractAddress,
      );
      expect(authorityAfter).toStrictEqual(authorityB);
    });
  },
);
