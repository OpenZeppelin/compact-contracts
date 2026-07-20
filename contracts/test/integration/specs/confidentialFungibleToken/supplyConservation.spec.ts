import { beforeEach, describe, expect, it } from 'vitest';
import {
  ALICE,
  actAs,
  BOB,
  type ConfidentialFungibleTokenPublicSupplySimulator,
  deployCft,
  fundAs,
  registerAs,
} from '../../fixtures/confidentialFungibleTokenPublicSupply.js';

// ---------------------------------------------------------------------------
// The composition invariant: `sum(balances) == totalSupply`.
//
// Only the paired supply operations (mint / burn / burnFrom) may change
// totalSupply; every conserving operation of the token module (transfer,
// _move, approve, transferFrom, sweep) must leave it untouched. The unit
// suites cannot see this pairing (the module and the extension are tested in
// isolation there); asserting it is exactly what this composed contract
// exists for.
// ---------------------------------------------------------------------------

let cft: ConfidentialFungibleTokenPublicSupplySimulator;

describe('ConfidentialFungibleTokenPublicSupply supply conservation', () => {
  beforeEach(async () => {
    cft = await deployCft();
  });

  it('should reflect cumulative mints and burns', async () => {
    await registerAs(cft, ALICE);

    await cft.mint(ALICE.accountId, 1000n);
    expect(await cft.totalSupply()).toBe(1000n);

    await cft.sweep();
    let aliceBalance = await cft.balanceOf(ALICE.accountId);
    await cft.privateState.cachePlaintext(aliceBalance, 1000n);

    await cft.burn(300n);
    expect(await cft.totalSupply()).toBe(700n);

    await cft.mint(ALICE.accountId, 200n);
    expect(await cft.totalSupply()).toBe(900n);

    // The new mint added 200 to pending; sweep folds it into the 700
    // spendable, giving 900 spendable.
    await cft.sweep();
    aliceBalance = await cft.balanceOf(ALICE.accountId);
    await cft.privateState.cachePlaintext(aliceBalance, 900n);

    await cft.burn(900n);
    expect(await cft.totalSupply()).toBe(0n);
  });

  it('should keep totalSupply unchanged across transfer', async () => {
    await registerAs(cft, ALICE);
    await registerAs(cft, BOB);
    await fundAs(cft, ALICE, 100n);

    await cft.transfer(BOB.accountId, 30n);

    expect(await cft.totalSupply()).toBe(100n);
  });

  it('should keep totalSupply unchanged across approve and transferFrom', async () => {
    await registerAs(cft, ALICE);
    await registerAs(cft, BOB);
    await fundAs(cft, ALICE, 100n);

    await cft.approve(BOB.accountId, 40n);
    expect(await cft.totalSupply()).toBe(100n);

    // Bob draws 25 of the escrow to himself: still conserving.
    await actAs(cft, BOB);
    const escrow = await cft.allowance(ALICE.accountId, BOB.accountId);
    await cft.privateState.cachePlaintext(escrow.spenderCt, 40n);
    await cft.transferFrom(ALICE.accountId, BOB.accountId, 25n);
    expect(await cft.totalSupply()).toBe(100n);

    // Only the paired burn moves the total.
    await cft.sweep();
    const bobBalance = await cft.balanceOf(BOB.accountId);
    await cft.privateState.cachePlaintext(bobBalance, 25n);
    await cft.burn(25n);
    expect(await cft.totalSupply()).toBe(75n);
  });

  it('should keep totalSupply unchanged across _move and sweep', async () => {
    await registerAs(cft, ALICE);
    await fundAs(cft, ALICE, 100n);

    // A self-move is conserving: it debits spendable and credits the caller's
    // own pending (net zero), recovered with sweep.
    await cft._move(ALICE.accountId, 40n);
    expect(await cft.totalSupply()).toBe(100n);

    await cft.sweep();
    expect(await cft.totalSupply()).toBe(100n);
  });

  it('should conserve supply through a multi-user mint/transfer/burn flow', async () => {
    await registerAs(cft, ALICE);
    await registerAs(cft, BOB);

    // Mint 100 to Alice; transfer 30 to Bob (conserving).
    await fundAs(cft, ALICE, 100n);
    await cft.transfer(BOB.accountId, 30n);
    expect(await cft.totalSupply()).toBe(100n);

    // Bob sweeps his incoming 30 (conserving) and burns 10.
    await actAs(cft, BOB);
    await cft.sweep();
    const bobBalance = await cft.balanceOf(BOB.accountId);
    await cft.privateState.cachePlaintext(bobBalance, 30n);
    expect(await cft.totalSupply()).toBe(100n);

    await cft.burn(10n);
    expect(await cft.totalSupply()).toBe(90n);

    // Alice burns her remaining 70: the total drops to exactly Bob's
    // remaining 20.
    await actAs(cft, ALICE);
    const aliceBalance = await cft.balanceOf(ALICE.accountId);
    await cft.privateState.cachePlaintext(aliceBalance, 70n);
    await cft.burn(70n);
    expect(await cft.totalSupply()).toBe(20n);
  });
});
