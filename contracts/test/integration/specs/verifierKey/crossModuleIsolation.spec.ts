import type {
  ContractAddress,
  Either,
  ZswapCoinPublicKey,
} from '../../../../artifacts/TestToken/contract/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rotateCircuitVK } from '../../_harness/cma.js';
import { deployTestToken, type TestTokenKit } from '../../fixtures/testToken.js';

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
  let kit: TestTokenKit;
  let alice: Either<ZswapCoinPublicKey, ContractAddress>;
  let bob: Either<ZswapCoinPublicKey, ContractAddress>;

  beforeAll(async () => {
    kit = await deployTestToken();
    alice = await kit.aliasFor('ALICE');
    bob = await kit.aliasFor('BOB');
  });

  afterAll(async () => {
    await kit?.teardown();
  });

  it("should preserve BOB's balance when rotating the AccessControl `grantRole` VK after a FungibleToken mint", async () => {
    await kit.deployed.callTx._mint(bob, 50n);
    const before = (await kit.readLedger()).FungibleToken__balances.lookup(
      bob,
    );

    await rotateCircuitVK(kit.providers, kit.deployed, 'grantRole');

    const after = (await kit.readLedger()).FungibleToken__balances.lookup(
      bob,
    );
    expect(after).toBe(before);
  });

  it("should preserve ALICE's MINTER role when rotating the FungibleToken `_mint` VK after the role grant", async () => {
    const admin = await kit.as('ADMIN');
    await admin.callTx.grantRole(MINTER_ROLE, alice);

    await rotateCircuitVK(kit.providers, kit.deployed, '_mint');

    const ledger = await kit.readLedger();
    const aliceHas =
      ledger.AccessControl__operatorRoles.member(MINTER_ROLE) &&
      ledger.AccessControl__operatorRoles.lookup(MINTER_ROLE).member(alice) &&
      ledger.AccessControl__operatorRoles
        .lookup(MINTER_ROLE)
        .lookup(alice);
    expect(aliceHas).toBe(true);
  });

  it('should keep the contract paused when rotating the FungibleToken `_mint` VK after a pause', async () => {
    if (!(await kit.readLedger()).Pausable__isPaused) {
      await kit.deployed.callTx.pause();
    }
    await rotateCircuitVK(kit.providers, kit.deployed, '_mint');
    expect((await kit.readLedger()).Pausable__isPaused).toBe(true);
  });

  it('should keep Initializable.isInitialized = true when rotating the Pausable `pause` VK', async () => {
    expect((await kit.readLedger()).Initializable__isInitialized).toBe(true);
    await rotateCircuitVK(kit.providers, kit.deployed, 'pause');
    expect((await kit.readLedger()).Initializable__isInitialized).toBe(true);
  });
});
