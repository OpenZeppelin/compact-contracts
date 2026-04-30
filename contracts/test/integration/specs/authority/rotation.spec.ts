import { sampleSigningKey } from '@midnight-ntwrk/compact-runtime';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readCmaCounter, rotateAuthority } from '../../_harness/cma.js';
import {
  compiledTestToken,
  deployTestToken,
  TestTokenPrivateState,
  TestTokenPrivateStateId,
  type TestTokenKit,
} from '../../fixtures/testToken.js';

/**
 * Spec: `replaceAuthority` rotates the on-chain CMA cleanly.
 *
 * Three claims:
 *
 *   1. Replacing the maintenance authority with a fresh signing key succeeds
 *      and bumps the CMA replay-protection counter by exactly 1.
 *   2. A `DeployedContract` re-bound to the *old* signing key (via
 *      `findDeployedContract({ signingKey: oldKey })`) is rejected when it
 *      attempts a subsequent maintenance update. This proves the old key no
 *      longer authorises updates after rotation.
 *   3. The same contract handle (whose internal signer was updated by the
 *      midnight-js SDK during `replaceAuthority`) can perform a further
 *      maintenance update — proving the new key works.
 */
describe('TestToken — CMA rotation via replaceAuthority', () => {
  let kit: TestTokenKit;
  let originalKey: ReturnType<typeof sampleSigningKey>;
  let counterBeforeRotation: bigint;

  beforeAll(async () => {
    kit = await deployTestToken();
    originalKey = kit.deployed.deployTxData.private.signingKey;
    counterBeforeRotation = await readCmaCounter(
      kit.providers,
      kit.contractAddress,
    );
  });

  afterAll(async () => {
    await kit?.teardown();
  });

  // Note on ordering:
  // The midnight-js-contracts SDK caches the contract's signing key in a
  // per-contract-address local store. `replaceAuthority(newKey)` updates
  // that store; `findDeployedContract({ signingKey: <X> })` *overwrites* it.
  // The "rejected by old key" test deliberately pollutes the store, so it
  // MUST run last — otherwise `kit.deployed`'s subsequent maintenance txs
  // would sign with the wrong key and fail with InvalidCommitteeSignature.

  it('should install a new signing key and advance the CMA counter by 1 when calling replaceAuthority', async () => {
    const newKey = sampleSigningKey();
    await rotateAuthority(kit.deployed, newKey);
    const counterAfter = await readCmaCounter(
      kit.providers,
      kit.contractAddress,
    );
    expect(counterAfter).toBe(counterBeforeRotation + 1n);
  });

  it('should authorise further maintenance updates with the rotated key', async () => {
    const before = await readCmaCounter(kit.providers, kit.contractAddress);
    // kit.deployed still holds the post-rotation key the SDK installed.
    const evenNewerKey = sampleSigningKey();
    await rotateAuthority(kit.deployed, evenNewerKey);
    const after = await readCmaCounter(kit.providers, kit.contractAddress);
    expect(after).toBe(before + 1n);
  });

  it('should reject a maintenance tx signed by the old (pre-rotation) key', async () => {
    // Re-find with the captured ORIGINAL key — that handle's local signer
    // no longer matches the on-chain CMA, so the chain rejects. Side effect:
    // this overwrites the per-address local key store, which is why this
    // test runs last.
    const reFound = await findDeployedContract(kit.providers, {
      compiledContract: compiledTestToken,
      contractAddress: kit.contractAddress,
      privateStateId: TestTokenPrivateStateId,
      initialPrivateState: TestTokenPrivateState,
      signingKey: originalKey,
    });
    await expect(
      reFound.circuitMaintenanceTx.pause.removeVerifierKey(),
    ).rejects.toThrow();
  });
});
