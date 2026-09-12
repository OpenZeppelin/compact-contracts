import {
  sampleSigningKey,
  signatureVerifyingKey,
} from '@midnight-ntwrk/compact-runtime';
import {
  ContractMaintenanceAuthority,
  ReplaceAuthority,
} from '@midnight-ntwrk/ledger-v8';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  readCmaCounter,
  submitRawMaintenanceUpdate,
} from '../../_harness/cma.js';
import {
  deployTestTokenV1,
  type TestTokenV1Kit,
} from '../../fixtures/testTokenV1.js';

/**
 * The CMA counter is replay protection: it is part of the signed payload, so a
 * signature captured at counter C must not apply once the chain has moved on.
 * The setup lands one real update to advance the chain, then submits an update
 * signed against the now-stale counter.
 */
describe.runIf(isLiveBackend())('TestToken — stale-counter update', () => {
  let v1: TestTokenV1Kit;
  let staleCounter: bigint;

  beforeAll(async () => {
    v1 = await deployTestTokenV1();
    staleCounter = await readCmaCounter(v1.providers, v1.contractAddress);
    await v1.deployed.circuitMaintenanceTx._mint.removeVerifierKey();

    const fresh = await readCmaCounter(v1.providers, v1.contractAddress);
    if (fresh !== staleCounter + 1n) {
      throw new Error(
        `staleCounter setup: expected the counter to advance from ${staleCounter} to ${staleCounter + 1n}, got ${fresh}`,
      );
    }
  });

  afterAll(async () => {
    await v1?.teardown();
  });

  it('rejects an update built against a counter the chain has moved past', async () => {
    // The payload is incidental — a fresh authority is structurally valid and
    // does not depend on slot occupancy. The counter is what is under test.
    const newAuth = new ContractMaintenanceAuthority(
      [signatureVerifyingKey(sampleSigningKey())],
      1,
    );

    await expect(
      submitRawMaintenanceUpdate(
        v1.providers,
        v1.contractAddress,
        [new ReplaceAuthority(newAuth)],
        staleCounter,
      ),
    ).rejects.toThrow(/SubmissionError|Transaction submission error/);

    const counterAfter = await readCmaCounter(v1.providers, v1.contractAddress);
    expect(counterAfter).toBe(staleCounter + 1n);
  });
});
