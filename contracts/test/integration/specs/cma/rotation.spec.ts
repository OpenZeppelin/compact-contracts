import { sampleSigningKey } from '@midnight-ntwrk/compact-runtime';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readCmaCounter, rotateAuthority } from '../../_harness/cma.js';
import {
  compiledTestTokenV1,
  deployTestTokenV1,
  TestTokenV1PrivateState,
  TestTokenV1PrivateStateId,
  type TestTokenV1Kit,
} from '../../fixtures/testTokenV1.js';

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
  let v1: TestTokenV1Kit;
  let originalKey: ReturnType<typeof sampleSigningKey>;
  let counterBeforeRotation: bigint;

  beforeAll(async () => {
    v1 = await deployTestTokenV1();
    originalKey = v1.deployed.deployTxData.private.signingKey;
    counterBeforeRotation = await readCmaCounter(
      v1.providers,
      v1.contractAddress,
    );
  });

  afterAll(async () => {
    await v1?.teardown();
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
    await rotateAuthority(v1.deployed, newKey);
    const counterAfter = await readCmaCounter(
      v1.providers,
      v1.contractAddress,
    );
    expect(counterAfter).toBe(counterBeforeRotation + 1n);
  });

  it('should authorise further maintenance updates with the rotated key', async () => {
    const before = await readCmaCounter(v1.providers, v1.contractAddress);
    // kit.deployed still holds the post-rotation key the SDK installed.
    const evenNewerKey = sampleSigningKey();
    await rotateAuthority(v1.deployed, evenNewerKey);
    const after = await readCmaCounter(v1.providers, v1.contractAddress);
    expect(after).toBe(before + 1n);
  });

  it('should reject a maintenance tx signed by the old (pre-rotation) key', async () => {
    // Re-find with the captured ORIGINAL key — that handle's local signer
    // no longer matches the on-chain CMA, so the chain rejects. Side effect:
    // this overwrites the per-address local key store, which is why this
    // test runs last.
    const reFound = await findDeployedContract(v1.providers, {
      compiledContract: compiledTestTokenV1,
      contractAddress: v1.contractAddress,
      privateStateId: TestTokenV1PrivateStateId,
      initialPrivateState: TestTokenV1PrivateState,
      signingKey: originalKey,
    });
    // The chain rejects the maintenance tx because the old key no longer
    // authorises (substrate "Custom error: 135"). The SDK currently surfaces
    // this as Effect's `(FiberFailure) SubmissionError: Transaction submission
    // error`, NOT as the typed `RemoveVerifierKeyTxFailedError` — neither
    // the outer wrapper nor any `.cause` link carries that class. Match on
    // the message instead.
    await expect(
      reFound.circuitMaintenanceTx.pause.removeVerifierKey(),
    ).rejects.toThrow(/SubmissionError|Transaction submission error/);
  });
});
