import { sampleSigningKey } from '@midnight-ntwrk/compact-runtime';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readCmaCounter, rotateAuthority } from '../../_harness/cma.js';
import {
  compiledTestTokenV1,
  deployTestTokenV1,
  type TestTokenV1Contract,
  type TestTokenV1Kit,
} from '../../fixtures/testTokenV1.js';

/**
 * `replaceAuthority` rotates the on-chain maintenance authority: the counter
 * advances, the new key authorizes further updates, and the old key does not.
 *
 * Ordering matters. The SDK caches one signing key per contract address, and
 * `findDeployedContract({ signingKey })` overwrites it — so the old-key test
 * runs last, after the tests that need the handle's own key intact.
 */
describe.runIf(isLiveBackend())('TestToken — CMA rotation', () => {
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

  it('installs a new signing key and advances the counter by 1', async () => {
    await rotateAuthority(v1.deployed, sampleSigningKey());
    const counterAfter = await readCmaCounter(v1.providers, v1.contractAddress);
    expect(counterAfter).toBe(counterBeforeRotation + 1n);
  });

  it('authorizes further maintenance updates with the rotated key', async () => {
    const before = await readCmaCounter(v1.providers, v1.contractAddress);
    await rotateAuthority(v1.deployed, sampleSigningKey());
    const after = await readCmaCounter(v1.providers, v1.contractAddress);
    expect(after).toBe(before + 1n);
  });

  it('rejects a maintenance tx signed by the pre-rotation key', async () => {
    const reFound = await findDeployedContract<TestTokenV1Contract>(
      v1.providers,
      {
        compiledContract: compiledTestTokenV1,
        contractAddress: v1.contractAddress,
        signingKey: originalKey,
      },
    );
    const before = await readCmaCounter(v1.providers, v1.contractAddress);
    await expect(
      reFound.contractMaintenanceTx.replaceAuthority(sampleSigningKey()),
    ).rejects.toThrow();
    const after = await readCmaCounter(v1.providers, v1.contractAddress);
    expect(after).toBe(before);
  });
});
