import { sampleSigningKey } from '@midnight-ntwrk/compact-runtime';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freeze, readCmaCounter } from '../../_harness/cma.js';
import {
  compiledTestTokenV1,
  deployTestTokenV1,
  privateStateFor,
  privateStateIdFor,
  type TestTokenV1Contract,
  type TestTokenV1Kit,
} from '../../fixtures/testTokenV1.js';

/**
 * Freezing terminates all further maintenance.
 *
 * `freeze()` rotates to a key nobody retains. The deploying handle cannot show
 * that: `replaceAuthority` silently installs the new key in it, so it would
 * keep succeeding. The last test re-binds with a key that is definitely not
 * on chain, which is the state every caller is in after a freeze.
 */
describe.runIf(isLiveBackend())('TestToken — freezing the CMA', () => {
  let v1: TestTokenV1Kit;
  // Sentinel: a failure in the first test would otherwise resurface here as
  // a BigInt TypeError, hiding the real cause.
  let counterBeforeFreeze = 0n;

  beforeAll(async () => {
    v1 = await deployTestTokenV1();
  });

  afterAll(async () => {
    await v1?.teardown();
  });

  it('accepts a maintenance update before freezing', async () => {
    const before = await readCmaCounter(v1.providers, v1.contractAddress);
    const vk = await v1.providers.zkConfigProvider.getVerifierKey('pause');
    await v1.deployed.circuitMaintenanceTx.pause.removeVerifierKey();
    await v1.deployed.circuitMaintenanceTx.pause.insertVerifierKey(vk);
    counterBeforeFreeze = await readCmaCounter(
      v1.providers,
      v1.contractAddress,
    );
    expect(counterBeforeFreeze).toBe(before + 2n);
  });

  it('advances the counter by 1 when freeze succeeds', async () => {
    await freeze(v1.deployed);
    const after = await readCmaCounter(v1.providers, v1.contractAddress);
    expect(after).toBe(counterBeforeFreeze + 1n);
  });

  it('rejects every maintenance update signed by a wrong key after freeze', async () => {
    const reFound = await findDeployedContract<TestTokenV1Contract>(
      v1.providers,
      {
        compiledContract: compiledTestTokenV1,
        contractAddress: v1.contractAddress,
        privateStateId: privateStateIdFor('deployer'),
        initialPrivateState: privateStateFor('deployer'),
        signingKey: sampleSigningKey(),
      },
    );
    // The chain rejects the unauthorized signature, and the SDK surfaces that
    // as Effect's `SubmissionError` rather than the typed maintenance error.
    await expect(
      reFound.circuitMaintenanceTx.pause.removeVerifierKey(),
    ).rejects.toThrow(/SubmissionError|Transaction submission error/);
  });
});
