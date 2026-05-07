import type {
  ContractAddress,
  Either,
  ZswapCoinPublicKey,
} from '../../../../artifacts/TestTokenV1/contract/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rotateCircuitVK } from '../../_harness/cma.js';
import { deployTestTokenV1, type TestTokenV1Kit } from '../../fixtures/testTokenV1.js';

/**
 * Spec: rotating module A's circuit VK does not disturb module B's state.
 *
 * The unique-value claim of a composite mock — VK rotation in any one
 * module's circuits leaves every other module's ledger state intact.
 * Each `it` follows the pattern:
 *   1. Set state in module B.
 *   2. Rotate a VK in module A (different module).
 *   3. Read state of module B; assert preserved.
 */

const MINTER_ROLE = new Uint8Array(32);
'MINTER'.split('').forEach((c, i) => {
  MINTER_ROLE[i] = c.charCodeAt(0);
});

describe('TestToken — cross-module isolation under VK rotation', () => {
  let v1: TestTokenV1Kit;
  let alice: Either<ZswapCoinPublicKey, ContractAddress>;
  let bob: Either<ZswapCoinPublicKey, ContractAddress>;

  beforeAll(async () => {
    v1 = await deployTestTokenV1();
    alice = await v1.signers.eitherFor('ALICE');
    bob = await v1.signers.eitherFor('BOB');
  });

  afterAll(async () => {
    await v1?.teardown();
  });

  it("should preserve BOB's balance when rotating the AccessControl `grantRole` VK after a FungibleToken mint", async () => {
    await v1.deployed.callTx._mint(bob, 50n);
    const before = (await v1.readLedger()).FungibleToken__balances.lookup(
      bob,
    );

    await rotateCircuitVK(v1.providers, v1.deployed, 'grantRole');

    const after = (await v1.readLedger()).FungibleToken__balances.lookup(
      bob,
    );
    expect(after).toBe(before);
  });

  it("should preserve ALICE's MINTER role when rotating the FungibleToken `_mint` VK after the role grant", async () => {
    const admin = await v1.as('ADMIN');
    await admin.callTx.grantRole(MINTER_ROLE, alice);

    await rotateCircuitVK(v1.providers, v1.deployed, '_mint');

    const ledger = await v1.readLedger();
    const aliceHas =
      ledger.AccessControl__operatorRoles.member(MINTER_ROLE) &&
      ledger.AccessControl__operatorRoles.lookup(MINTER_ROLE).member(alice) &&
      ledger.AccessControl__operatorRoles
        .lookup(MINTER_ROLE)
        .lookup(alice);
    expect(aliceHas).toBe(true);
  });

  it('should keep the contract paused when rotating the FungibleToken `_mint` VK after a pause', async () => {
    if (!(await v1.readLedger()).Pausable__isPaused) {
      await v1.deployed.callTx.pause();
    }
    await rotateCircuitVK(v1.providers, v1.deployed, '_mint');
    expect((await v1.readLedger()).Pausable__isPaused).toBe(true);
  });

  it('should keep Initializable.isInitialized = true when rotating the Pausable `pause` VK', async () => {
    expect((await v1.readLedger()).Initializable__isInitialized).toBe(true);
    await rotateCircuitVK(v1.providers, v1.deployed, 'pause');
    expect((await v1.readLedger()).Initializable__isInitialized).toBe(true);
  });
});
