import { sampleSigningKey } from '@midnight-ntwrk/compact-runtime';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freeze, readCmaCounter } from '../../_harness/cma.js';
import type { PausableHarness } from '../../_harness/harnesses/PausableHarness.js';
import {
  compiledPausable,
  deployPausable,
  PausablePrivateState,
  PausablePrivateStateId,
} from '../../fixtures/pausable.js';

/**
 * Spec: Pausable — once the CMA is rotated to an un-retained key, every
 * subsequent maintenance update fails verification on-chain.
 *
 * This is the "freeze" use case from Part 4.1 of the research report
 * (`ReplaceAuthority(∅)`). Since midnight-js-contracts 4.x models the CMA as a
 * single `SigningKey` rather than a full multi-sig committee, our `freeze()`
 * helper achieves the same effect by rotating to a freshly-sampled key whose
 * bytes are never captured. The DeployedContract still holds the previous
 * signer, so further updates the SDK signs are rejected.
 */
describe('Pausable — freezing the CMA rejects further maintenance', () => {
  let pausable: PausableHarness;
  let counterBeforeFreeze: bigint;

  beforeAll(async () => {
    pausable = await deployPausable();
  });

  afterAll(async () => {
    await pausable?.teardown();
  });

  it('a pre-freeze maintenance update succeeds (sanity)', async () => {
    const before = await readCmaCounter(
      pausable.providers,
      pausable.contractAddress,
    );
    const vk = await pausable.providers.zkConfigProvider.getVerifierKey('pause');
    await pausable.circuitMaintenanceTx.pause.removeVerifierKey();
    await pausable.circuitMaintenanceTx.pause.insertVerifierKey(vk);
    const after = await readCmaCounter(
      pausable.providers,
      pausable.contractAddress,
    );
    expect(after).toBe(before + 2n);
    counterBeforeFreeze = after;
  });

  it('freeze() succeeds and advances the CMA counter by 1', async () => {
    await freeze(pausable.deployed);
    const afterFreeze = await readCmaCounter(
      pausable.providers,
      pausable.contractAddress,
    );
    expect(afterFreeze).toBe(counterBeforeFreeze + 1n);
  });

  it('a maintenance update signed by a wrong key is rejected (proves freeze effect)', async () => {
    // After `freeze()`, the on-chain authority is a key whose bytes we never
    // retained. The SDK's `replaceAuthority` silently stores the new key on
    // `pausable.deployed` locally, so that handle would still succeed. To
    // actually prove "nobody can update anymore" we need a DeployedContract
    // whose local signer is *not* the on-chain authority. Re-find the contract
    // binding a freshly-sampled wrong key, then attempt a maintenance update.
    const wrongKey = sampleSigningKey();
    const reFound = await findDeployedContract(pausable.providers, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      compiledContract: compiledPausable as any,
      contractAddress: pausable.contractAddress,
      privateStateId: PausablePrivateStateId,
      initialPrivateState: PausablePrivateState,
      signingKey: wrongKey,
    });
    await expect(
      reFound.circuitMaintenanceTx.pause.removeVerifierKey(),
    ).rejects.toThrow();
  });
});
