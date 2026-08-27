import {
  ContractMaintenanceAuthority,
  ReplaceAuthority,
} from '@midnight-ntwrk/ledger-v8';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
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
 * An empty committee is described as the canonical frozen authority, but the
 * chain refuses it: a CMA must keep at least one committee key. That makes the
 * discard-the-key freeze in `freeze.spec.ts` the only way to reach the state,
 * not merely the most convenient one.
 *
 * The SDK's `replaceAuthority` takes a single signing key and cannot express
 * an empty committee at all, so this goes through the raw ledger path.
 */
describe.runIf(isLiveBackend())('TestToken — empty-committee CMA', () => {
  let v1: TestTokenV1Kit;

  beforeAll(async () => {
    v1 = await deployTestTokenV1();
  });

  afterAll(async () => {
    await v1?.teardown();
  });

  it('is refused at submission', async () => {
    await expect(
      submitRawMaintenanceUpdate(v1.providers, v1.contractAddress, [
        new ReplaceAuthority(new ContractMaintenanceAuthority([], 1)),
      ]),
    ).rejects.toThrow(/SubmissionError|Transaction submission error/);

    const authAfter = await readAuthority(v1.providers, v1.contractAddress);
    expect(authAfter.committee.length).toBe(1);
  });
});
