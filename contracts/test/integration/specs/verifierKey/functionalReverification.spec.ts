import type {
  ContractAddress,
  Either,
  ZswapCoinPublicKey,
} from '../../../../artifacts/TestToken/contract/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rotateCircuitVK } from '../../_harness/cma.js';
import { deployTestToken, type TestTokenKit } from '../../fixtures/testToken.js';

/**
 * Spec: post-rotation, every rotated circuit still verifies functionally.
 *
 * Each `it`:
 *   1. Rotates one circuit's VK (remove + reinsert the same VK).
 *   2. Calls that circuit and asserts the expected on-chain effect.
 *
 * If the rotation broke verification, the call would fail at the prove or
 * verify step. Pure-state-survival is covered separately; this spec proves
 * the *prove → verify → apply* loop is intact for each rotated circuit.
 */

const MINTER_ROLE = new Uint8Array(32);
'MINTER'.split('').forEach((c, i) => {
  MINTER_ROLE[i] = c.charCodeAt(0);
});

describe('TestToken — functional re-verification after VK rotation', () => {
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

  it("should mint successfully and increment the recipient's balance after rotating the `_mint` VK", async () => {
    const before =
      (await kit.readLedger()).FungibleToken__balances.member(alice)
        ? (await kit.readLedger()).FungibleToken__balances.lookup(alice)
        : 0n;

    await rotateCircuitVK(kit.providers, kit.deployed, '_mint');
    await kit.deployed.callTx._mint(alice, 75n);

    const after = (await kit.readLedger()).FungibleToken__balances.lookup(
      alice,
    );
    expect(after).toBe(before + 75n);
  });

  it('should pause the contract after rotating the `pause` VK', async () => {
    if ((await kit.readLedger()).Pausable__isPaused) {
      await kit.deployed.callTx.unpause();
    }
    await rotateCircuitVK(kit.providers, kit.deployed, 'pause');
    await kit.deployed.callTx.pause();
    expect((await kit.readLedger()).Pausable__isPaused).toBe(true);
  });

  it('should let ADMIN grant MINTER to ALICE after rotating the `grantRole` VK', async () => {
    const admin = await kit.as('ADMIN');
    await rotateCircuitVK(kit.providers, kit.deployed, 'grantRole');
    await admin.callTx.grantRole(MINTER_ROLE, alice);

    const ledger = await kit.readLedger();
    const aliceHas =
      ledger.AccessControl__operatorRoles.member(MINTER_ROLE) &&
      ledger.AccessControl__operatorRoles.lookup(MINTER_ROLE).member(alice) &&
      ledger.AccessControl__operatorRoles
        .lookup(MINTER_ROLE)
        .lookup(alice);
    expect(aliceHas).toBe(true);
  });

  it('should transfer ALICE → BOB and update both balances after rotating the `transfer` VK', async () => {
    // Make sure ALICE has enough to transfer.
    const aliceBalanceStart = (await kit.readLedger()).FungibleToken__balances
      .lookup(alice);
    if (aliceBalanceStart < 50n) {
      await kit.deployed.callTx._mint(alice, 50n - aliceBalanceStart);
    }

    // unpause if needed — transfer should succeed in normal state.
    if ((await kit.readLedger()).Pausable__isPaused) {
      await kit.deployed.callTx.unpause();
    }

    const ledgerBefore = await kit.readLedger();
    const aliceBefore = ledgerBefore.FungibleToken__balances.lookup(alice);
    const bobBefore = ledgerBefore.FungibleToken__balances.member(bob)
      ? ledgerBefore.FungibleToken__balances.lookup(bob)
      : 0n;

    await rotateCircuitVK(kit.providers, kit.deployed, 'transfer');

    const alice = await kit.as('ALICE');
    await alice.callTx.transfer(bob, 25n);

    const ledgerAfter = await kit.readLedger();
    expect(ledgerAfter.FungibleToken__balances.lookup(alice)).toBe(
      aliceBefore - 25n,
    );
    expect(ledgerAfter.FungibleToken__balances.lookup(bob)).toBe(
      bobBefore + 25n,
    );
  });
});
