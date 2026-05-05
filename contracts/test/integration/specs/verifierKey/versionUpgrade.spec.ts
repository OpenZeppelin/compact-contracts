import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deployTestTokenV1,
  type TestTokenV1Kit,
} from '../../fixtures/testTokenV1.js';
import {
  bindAsV2,
  v2VerifierKey,
} from '../../fixtures/testTokenV2.js';

/**
 * Spec: real-world version upgrade via VK rotation.
 *
 * V1 deploys cleanly. The spec then rotates one or more circuits' verifier
 * keys to V2's, which changes on-chain behaviour for those circuits. Three
 * stories are covered:
 *
 *   1. **Mint cap** — `_mint` rotates to V2's VK; over-cap mints reject,
 *      under-cap mints succeed.
 *   2. **Admin-gated pause** — `pause`/`unpause` rotate to V2's VKs; non-admin
 *      callers can no longer pause; admin still can.
 *   3. **New operation name** — V2 introduces `mintBatch`, a circuit that
 *      doesn't exist in V1's VK table. `insertVerifierKey('mintBatch', v2VK)`
 *      tests whether Compact's CMA permits adding a brand-new operation
 *      (open question per the upgradability research). The spec asserts the
 *      observable outcome regardless of which way it goes.
 */

describe('TestToken upgrade — `_mint` rotation enforces V2 per-tx cap', () => {
  let testTokenV1: TestTokenV1Kit;

  beforeAll(async () => {
    testTokenV1 = await deployTestTokenV1();
    // Rotate `_mint` from V1's VK to V2's VK — V2 adds a per-tx cap of 1 000 000.
    const v2MintVk = await v2VerifierKey('_mint');
    await testTokenV1.deployed.circuitMaintenanceTx._mint.removeVerifierKey();
    await testTokenV1.deployed.circuitMaintenanceTx._mint.insertVerifierKey(v2MintVk);
  });

  afterAll(async () => {
    await testTokenV1?.teardown();
  });

  it('should mint successfully when the amount is at or below V2 cap', async () => {
    const v2 = await bindAsV2(testTokenV1, 'GENESIS');
    const alice = await testTokenV1.aliasFor('ALICE');
    await v2.callTx._mint(alice, 1000n);
    const balance = (await testTokenV1.readLedger()).FungibleToken__balances.lookup(alice);
    expect(balance).toBeGreaterThanOrEqual(1000n);
  });

  it('should reject mints over V2 cap (V1 would have allowed them)', async () => {
    const v2 = await bindAsV2(testTokenV1, 'GENESIS');
    const bob = await testTokenV1.aliasFor('BOB');
    // 2 000 000 is over V2's 1 000 000 cap; the assert inside V2's _mint trips.
    await expect(v2.callTx._mint(bob, 2_000_000n)).rejects.toThrow(
      'TestTokenV2: _mint amount over per-tx cap',
    );
  });
});

describe('TestToken upgrade — `pause` rotation gates pause on admin role', () => {
  let testTokenV1: TestTokenV1Kit;

  beforeAll(async () => {
    testTokenV1 = await deployTestTokenV1();
    const v2PauseVk = await v2VerifierKey('pause');
    const v2UnpauseVk = await v2VerifierKey('unpause');
    await testTokenV1.deployed.circuitMaintenanceTx.pause.removeVerifierKey();
    await testTokenV1.deployed.circuitMaintenanceTx.pause.insertVerifierKey(v2PauseVk);
    await testTokenV1.deployed.circuitMaintenanceTx.unpause.removeVerifierKey();
    await testTokenV1.deployed.circuitMaintenanceTx.unpause.insertVerifierKey(v2UnpauseVk);
  });

  afterAll(async () => {
    await testTokenV1?.teardown();
  });

  it('should let ADMIN pause after the V2 rotation', async () => {
    const adminV2 = await bindAsV2(testTokenV1, 'ADMIN');
    await adminV2.callTx.pause();
    expect((await testTokenV1.readLedger()).Pausable__isPaused).toBe(true);
    await adminV2.callTx.unpause();
    expect((await testTokenV1.readLedger()).Pausable__isPaused).toBe(false);
  });

  it('should reject BOB attempting to pause (BOB lacks admin role)', async () => {
    const bobV2 = await bindAsV2(testTokenV1, 'BOB');
    await expect(bobV2.callTx.pause()).rejects.toThrow(
      'AccessControl: unauthorized account',
    );
  });
});

describe('TestToken upgrade — inserting V2 `mintBatch` (a brand-new circuit)', () => {
  let testTokenV1: TestTokenV1Kit;

  beforeAll(async () => {
    testTokenV1 = await deployTestTokenV1();
    // Trick: `testTokenV1.deployed.circuitMaintenanceTx` is keyed by V1's circuit
    // names — `mintBatch` isn't there. But the *same on-chain contract*
    // re-bound with V2's `CompiledContract` (via `bindAsV2`) gives us a
    // handle whose `circuitMaintenanceTx.mintBatch` does exist. The
    // resulting maintenance tx carries a `VerifierKeyInsert` for the
    // operation NAME `mintBatch` — which V1's deployed VK table has never
    // seen. The chain then either accepts (Compact permits adding new
    // operation names via CMA) or rejects (it doesn't). Either outcome
    // resolves the open question.
    const v2Handle = await bindAsV2(testTokenV1, 'GENESIS');
    const v2MintBatchVk = await v2VerifierKey('mintBatch');
    await v2Handle.circuitMaintenanceTx.mintBatch.insertVerifierKey(
      v2MintBatchVk,
    );
  });

  afterAll(async () => {
    await testTokenV1?.teardown();
  });

  it("should accept `mintBatch` calls and triple the recipient's balance", async () => {
    const v2 = await bindAsV2(testTokenV1, 'GENESIS');
    const alice = await testTokenV1.aliasFor('ALICE');
    const before = (await testTokenV1.readLedger()).FungibleToken__balances.member(
      alice,
    )
      ? (await testTokenV1.readLedger()).FungibleToken__balances.lookup(alice)
      : 0n;

    await v2.callTx.mintBatch(alice, 1000n);

    const after = (await testTokenV1.readLedger()).FungibleToken__balances.lookup(alice);
    // V2's mintBatch is an unrolled 3-mint, so the balance bumps by `3 × value`.
    expect(after).toBe(before + 3000n);
  });

  it('should still let `_mint` run as the original V1 circuit (siblings unaffected)', async () => {
    const v2 = await bindAsV2(testTokenV1, 'GENESIS');
    const bob = await testTokenV1.aliasFor('BOB');
    // `_mint`'s VK was never rotated in this describe block, so it still
    // proves against V1's keys. We use the V2 handle for type access only —
    // the `_mint` SLOT on chain still holds V1's VK.
    const before = (await testTokenV1.readLedger()).FungibleToken__balances.member(bob)
      ? (await testTokenV1.readLedger()).FungibleToken__balances.lookup(bob)
      : 0n;
    await v2.callTx._mint(bob, 50n);
    const after = (await testTokenV1.readLedger()).FungibleToken__balances.lookup(bob);
    expect(after).toBe(before + 50n);
  });
});
