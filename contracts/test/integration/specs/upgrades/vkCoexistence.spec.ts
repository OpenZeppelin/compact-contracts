import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deployTestTokenV1,
  type TestTokenV1Kit,
} from '../../fixtures/testTokenV1.js';

/**
 * Two verifier keys cannot share a circuit slot. The SDK checks the slot, not
 * the key, and refuses before building the tx — so an upgrade is a sequenced
 * remove-then-insert, never a side-by-side install followed by a cleanup.
 */
describe.runIf(isLiveBackend())('TestToken — VK coexistence', () => {
  let v1: TestTokenV1Kit;

  beforeAll(async () => {
    v1 = await deployTestTokenV1();
  });

  afterAll(async () => {
    await v1?.teardown();
  });

  it('rejects inserting into a slot that already holds a key', async () => {
    // Re-inserting the deploy-time key is enough: the guard reads the slot.
    const currentMintVk =
      await v1.providers.zkConfigProvider.getVerifierKey('_mint');

    await expect(
      v1.deployed.circuitMaintenanceTx._mint.insertVerifierKey(currentMintVk),
    ).rejects.toThrow(/Circuit '_mint' is already defined/);
  });
});
