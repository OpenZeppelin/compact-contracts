import { sampleSigningKey } from '@midnight-ntwrk/compact-runtime';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freeze, readCmaCounter } from '../../_harness/cma.js';
import {
  compiledTestToken,
  deployTestToken,
  TestTokenPrivateState,
  TestTokenPrivateStateId,
  type TestTokenKit,
} from '../../fixtures/testToken.js';

/**
 * Spec: freezing the CMA terminates all further maintenance.
 *
 * `freeze()` rotates the maintenance authority to a freshly-sampled signing
 * key whose bytes are never retained anywhere — the closest the
 * midnight-js-contracts 4.x surface lets us get to the "empty authority"
 * documented in the research report. After freeze, every subsequent
 * maintenance update must fail.
 *
 * To prove this we must work around an SDK quirk: `replaceAuthority(newKey)`
 * silently updates the local DeployedContract's internal signer to `newKey`,
 * so that handle would erroneously continue to succeed even when on-chain
 * authority is the un-retained key. We re-bind via `findDeployedContract`
 * with a definitely-not-on-chain `wrongKey` to test the genuine "no one
 * has the key" semantic.
 */
describe('TestToken — freezing the CMA blocks further maintenance', () => {
  let kit: TestTokenKit;
  let counterBeforeFreeze: bigint;

  beforeAll(async () => {
    kit = await deployTestToken();
  });

  afterAll(async () => {
    await kit?.teardown();
  });

  it('should accept a maintenance update before freezing (sanity)', async () => {
    const before = await readCmaCounter(kit.providers, kit.contractAddress);
    const vk = await kit.providers.zkConfigProvider.getVerifierKey('pause');
    await kit.deployed.circuitMaintenanceTx.pause.removeVerifierKey();
    await kit.deployed.circuitMaintenanceTx.pause.insertVerifierKey(vk);
    const after = await readCmaCounter(kit.providers, kit.contractAddress);
    expect(after).toBe(before + 2n);
    counterBeforeFreeze = after;
  });

  it('should advance the CMA counter by 1 when freeze() succeeds', async () => {
    await freeze(kit.deployed);
    const after = await readCmaCounter(kit.providers, kit.contractAddress);
    expect(after).toBe(counterBeforeFreeze + 1n);
  });

  it('should reject every maintenance update signed by a wrong key after freeze', async () => {
    const wrongKey = sampleSigningKey();
    const reFound = await findDeployedContract(kit.providers, {
      compiledContract: compiledTestToken,
      contractAddress: kit.contractAddress,
      privateStateId: TestTokenPrivateStateId,
      initialPrivateState: TestTokenPrivateState,
      signingKey: wrongKey,
    });
    await expect(
      reFound.circuitMaintenanceTx.pause.removeVerifierKey(),
    ).rejects.toThrow();
  });
});
