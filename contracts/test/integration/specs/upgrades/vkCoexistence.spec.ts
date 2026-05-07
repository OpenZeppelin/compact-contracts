import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deployTestTokenV1,
  type TestTokenV1Kit,
} from '../../fixtures/testTokenV1.js';

/**
 * Spec: can two verifier keys coexist on the same circuit slot at the same
 * time?
 *
 * **Answer (SDK level):** no. The SDK enforces a one-VK-per-slot invariant
 * client-side. `submitInsertVerifierKeyTx` does a pre-flight check before
 * even building the maintenance tx (`assertUndefined(contractState.operation
 * (circuitId), …)` at `midnight-js-contracts`), so a
 * second insert against an occupied slot rejects in-process — never reaches
 * the chain.
 *
 * What this proves: the public API treats VK upgrades as a strictly
 * sequenced *remove → insert*, not a *insert-side-by-side → remove-old*
 * pattern. From a spec writer's perspective, "rotation" is the only legal
 * upgrade move.
 */
describe('TestToken — VK coexistence is rejected by the SDK', () => {
  let v1: TestTokenV1Kit;

  beforeAll(async () => {
    v1 = await deployTestTokenV1();
  });

  afterAll(async () => {
    await v1?.teardown();
  });

  it("should reject insertVerifierKey when '_mint' already has an active VK", async () => {
    // Fresh deploy: `_mint`'s slot already holds the VK installed during
    // contract deployment. We don't even need a *different* VK to test the
    // guard — re-fetching the same VK and trying to insert it again is
    // enough; the guard inspects the SLOT, not the VK content.
    const currentMintVk = await v1.providers.zkConfigProvider.getVerifierKey('_mint');

    await expect(
      v1.deployed.circuitMaintenanceTx._mint.insertVerifierKey(currentMintVk),
    ).rejects.toThrow(/Circuit '_mint' is already defined/);
  });
});
