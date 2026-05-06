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
 * V1 deploys cleanly. Each describe rotates EXACTLY the circuit(s) under
 * test (remove + insert, or insert-only for new circuits) so the on-chain
 * change is visible at the call site. Stories covered:
 *
 *   1. **Mint cap** — `_mint` rotates to V2's VK; over-cap mints reject,
 *      under-cap mints succeed.
 *   2. **Admin-gated pause** — `pause`/`unpause` rotate to V2's VKs; non-admin
 *      callers can no longer pause; admin still can.
 *   3. **`transferOwnership` post-C2C semantics** — `transferOwnership`
 *      rotates to V2's VK (drops the ContractAddress guard); contract
 *      destinations now succeed where V1 would have rejected.
 *   4. **Decommissioning the unsafe circuit** — `_unsafeTransferOwnership`'s
 *      VK is removed with no replacement. Calls reject; V2's typed surface
 *      doesn't carry the symbol either.
 *   5. **New operation name** — V2 introduces `mintBatch`. Its V2 VK is
 *      inserted (no remove, since the slot was empty on V1).
 *
 * `bindAsV2` returns a permissive V2-typed handle that does NOT validate
 * every V2 circuit's VK against on-chain (see the helper's docstring).
 * Each describe is responsible for rotating only the circuits it calls
 * via `v2.callTx.X` — anything else stays on V1's VK and is unaffected.
 */

describe('TestToken upgrade — `_mint` rotation enforces V2 per-tx cap', () => {
  let v1: TestTokenV1Kit;

  beforeAll(async () => {
    v1 = await deployTestTokenV1();
    // Rotate `_mint` from V1's VK to V2's VK — V2 adds a per-tx cap of 1 000 000.
    const v2MintVk = await v2VerifierKey('_mint');
    await v1.deployed.circuitMaintenanceTx._mint.removeVerifierKey();
    await v1.deployed.circuitMaintenanceTx._mint.insertVerifierKey(v2MintVk);
  });

  afterAll(async () => {
    await v1?.teardown();
  });

  it('should mint successfully when the amount is at or below V2 cap', async () => {
    const v2 = await bindAsV2(v1, 'GENESIS');
    const alice = await v1.signers.eitherFor('ALICE');
    await v2.callTx._mint(alice, 1000n);
    const balance = (await v1.readLedger()).FungibleToken__balances.lookup(alice);
    expect(balance).toBeGreaterThanOrEqual(1000n);
  });

  it('should reject mints over V2 cap (V1 would have allowed them)', async () => {
    const v2 = await bindAsV2(v1, 'GENESIS');
    const bob = await v1.signers.eitherFor('BOB');
    // 2 000 000 is over V2's 1 000 000 cap; the assert inside V2's _mint trips.
    await expect(v2.callTx._mint(bob, 2_000_000n)).rejects.toThrow(
      'TestTokenV2: _mint amount over per-tx cap',
    );
  });
});

describe('TestToken upgrade — `pause` rotation gates pause on admin role', () => {
  let v1: TestTokenV1Kit;

  beforeAll(async () => {
    v1 = await deployTestTokenV1();
    // Rotate `pause` and `unpause` to V2's VKs — V2 adds an admin-role gate.
    const v2PauseVk = await v2VerifierKey('pause');
    const v2UnpauseVk = await v2VerifierKey('unpause');
    await v1.deployed.circuitMaintenanceTx.pause.removeVerifierKey();
    await v1.deployed.circuitMaintenanceTx.pause.insertVerifierKey(v2PauseVk);
    await v1.deployed.circuitMaintenanceTx.unpause.removeVerifierKey();
    await v1.deployed.circuitMaintenanceTx.unpause.insertVerifierKey(v2UnpauseVk);
  });

  afterAll(async () => {
    await v1?.teardown();
  });

  it('should let ADMIN pause after the V2 rotation', async () => {
    const adminV2 = await bindAsV2(v1, 'ADMIN');
    await adminV2.callTx.pause();
    expect((await v1.readLedger()).Pausable__isPaused).toBe(true);
    await adminV2.callTx.unpause();
    expect((await v1.readLedger()).Pausable__isPaused).toBe(false);
  });

  it('should reject BOB attempting to pause (BOB lacks admin role)', async () => {
    const bobV2 = await bindAsV2(v1, 'BOB');
    await expect(bobV2.callTx.pause()).rejects.toThrow(
      'AccessControl: unauthorized account',
    );
  });
});

describe('TestToken upgrade — `transferOwnership` rotation lifts the ContractAddress guard (post-C2C)', () => {
  let testTokenV1: TestTokenV1Kit;

  beforeAll(async () => {
    testTokenV1 = await deployTestTokenV1();
    // Rotate `transferOwnership` from V1's VK (rejects ContractAddress) to
    // V2's VK (delegates to Ownable._unsafeTransferOwnership — no
    // ContractAddress guard, simulating post-C2C semantics).
    const v2TransferOwnershipVk = await v2VerifierKey('transferOwnership');
    await testTokenV1.deployed.circuitMaintenanceTx.transferOwnership.removeVerifierKey();
    await testTokenV1.deployed.circuitMaintenanceTx.transferOwnership.insertVerifierKey(
      v2TransferOwnershipVk,
    );
  });

  afterAll(async () => {
    await testTokenV1?.teardown();
  });

  it('should still let the owner transfer to an EOA after rotation', async () => {
    // Genesis (the deployer) is the initial owner. After rotation, the V2
    // body still owner-checks and zero-checks — EOA transfers must work.
    const v2 = await bindAsV2(testTokenV1, 'GENESIS');
    const alice = await testTokenV1.signers.eitherFor('ALICE');
    await v2.callTx.transferOwnership(alice);
    expect((await testTokenV1.readLedger()).Ownable__owner.left.bytes).toEqual(
      alice.left.bytes,
    );
  });

  it('should accept a ContractAddress destination after rotation (V1 would have rejected)', async () => {
    // Re-deploy so the owner is the deployer again (previous test moved it).
    const v1 = await deployTestTokenV1();
    try {
      const v2Vk = await v2VerifierKey('transferOwnership');
      await v1.deployed.circuitMaintenanceTx.transferOwnership.removeVerifierKey();
      await v1.deployed.circuitMaintenanceTx.transferOwnership.insertVerifierKey(v2Vk);

      const v2 = await bindAsV2(v1, 'GENESIS');
      const contractDest = v1.signers.contractAddressEither('upgrade-test-contract');

      // V1 would have asserted "Ownable: unsafe ownership transfer" here.
      await v2.callTx.transferOwnership(contractDest);

      const ownerNow = (await v1.readLedger()).Ownable__owner;
      expect(ownerNow.is_left).toBe(false);
      expect(ownerNow.right.bytes).toEqual(contractDest.right.bytes);
    } finally {
      await v1.teardown();
    }
  });
});

describe('TestToken upgrade — `_unsafeTransferOwnership` is decommissioned', () => {
  let v1: TestTokenV1Kit;

  beforeAll(async () => {
    v1 = await deployTestTokenV1();
    // The unsafe escape hatch was deleted in V2 — there is no V2 VK to
    // rotate to. The realistic upgrade is `removeVerifierKey()` with no
    // replacement, leaving the slot dead.
    await v1.deployed.circuitMaintenanceTx._unsafeTransferOwnership.removeVerifierKey();
  });

  afterAll(async () => {
    await v1?.teardown();
  });

  it('should reject `_unsafeTransferOwnership` calls via the V1 handle once its VK is removed', async () => {
    // V1's bound CompiledContract still exposes `_unsafeTransferOwnership`,
    // but after `removeVerifierKey()` the on-chain `ContractState` no longer
    // lists the operation. The SDK aborts CLIENT-SIDE before submission with
    // `Error("Operation '_unsafeTransferOwnership' is undefined for contract
    // state ...")` — a plain Error wrapped by `scoped()`. The typed
    // `CallTxFailedError` never gets thrown because the call doesn't reach
    // the chain. Asserting on the operation name in the message is the
    // honest contract: caller learns "this circuit is gone."
    const alice = await v1.signers.eitherFor('ALICE');
    await expect(
      v1.deployed.callTx._unsafeTransferOwnership(alice),
    ).rejects.toThrow(/Operation '_unsafeTransferOwnership' is undefined/);
  });

  it('should not even surface `_unsafeTransferOwnership` on the V2 handle (circuit dropped from V2)', async () => {
    // V2's CompiledContract was built without a `_unsafeTransferOwnership`
    // wrapper, so the bound handle's `callTx` has no such property.
    // Calling the missing member is a synchronous TypeError — it never
    // reaches the chain. Two assertions: the property is `undefined` and
    // attempting to invoke it throws TypeError.
    const v2 = await bindAsV2(v1, 'GENESIS');
    const callTx = v2.callTx as Record<string, unknown>;
    expect(callTx._unsafeTransferOwnership).toBeUndefined();
    const alice = await v1.signers.eitherFor('ALICE');
    expect(() =>
      (callTx as { _unsafeTransferOwnership: (a: unknown) => unknown })
        ._unsafeTransferOwnership(alice),
    ).toThrow(TypeError);
  });
});

describe('TestToken upgrade — inserting V2 `mintBatch` (a brand-new circuit)', () => {
  let v1: TestTokenV1Kit;

  beforeAll(async () => {
    v1 = await deployTestTokenV1();
    // Trick: `testTokenV1.deployed.circuitMaintenanceTx` is keyed by V1's circuit
    // names — `mintBatch` isn't there. But the *same on-chain contract*
    // re-bound with V2's `CompiledContract` (via `bindAsV2`) gives us a
    // handle whose `circuitMaintenanceTx.mintBatch` does exist. The
    // resulting maintenance tx carries a `VerifierKeyInsert` for the
    // operation NAME `mintBatch` — which V1's deployed VK table has never
    // seen. The chain then either accepts (Compact permits adding new
    // operation names via CMA) or rejects (it doesn't). Either outcome
    // resolves the open question.
    const v2Handle = await bindAsV2(v1, 'GENESIS');
    const v2MintBatchVk = await v2VerifierKey('mintBatch');
    await v2Handle.circuitMaintenanceTx.mintBatch.insertVerifierKey(
      v2MintBatchVk,
    );
  });

  afterAll(async () => {
    await v1?.teardown();
  });

  it("should accept `mintBatch` calls and triple the recipient's balance", async () => {
    const v2 = await bindAsV2(v1, 'GENESIS');
    const alice = await v1.signers.eitherFor('ALICE');
    const before = (await v1.readLedger()).FungibleToken__balances.member(
      alice,
    )
      ? (await v1.readLedger()).FungibleToken__balances.lookup(alice)
      : 0n;

    await v2.callTx.mintBatch(alice, 1000n);

    const after = (await v1.readLedger()).FungibleToken__balances.lookup(alice);
    // V2's mintBatch is an unrolled 3-mint, so the balance bumps by `3 × value`.
    expect(after).toBe(before + 3000n);
  });

  it('should leave `_mint` undisturbed (siblings unaffected by the mintBatch insert)', async () => {
    // `_mint`'s on-chain VK was never touched in this describe — only
    // `mintBatch` was inserted. V1's prover key (still loaded by `v1.deployed`)
    // produces a proof that matches V1's `_mint` VK on chain, so the call
    // succeeds. NOTE: we deliberately use V1's handle, not V2's: V2's
    // `_mint` body differs (adds a cap), so V2's prover key would generate
    // a proof that does NOT match V1's on-chain VK.
    const bob = await v1.signers.eitherFor('BOB');
    const before = (await v1.readLedger()).FungibleToken__balances.member(bob)
      ? (await v1.readLedger()).FungibleToken__balances.lookup(bob)
      : 0n;
    await v1.deployed.callTx._mint(bob, 50n);
    const after = (await v1.readLedger()).FungibleToken__balances.lookup(bob);
    expect(after).toBe(before + 50n);
  });
});
