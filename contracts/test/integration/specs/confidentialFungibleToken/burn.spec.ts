import { beforeEach, describe, expect, it } from 'vitest';
import {
  ALICE,
  actAs,
  type ConfidentialFungibleTokenPublicSupplySimulator,
  deployCft,
  fundAs,
  registerAs,
} from '../../fixtures/confidentialFungibleTokenPublicSupply.js';

// ---------------------------------------------------------------------------
// burn: the composed supply operation pairing the token module's `_burn`
// (debit of the caller's own balance) with `Supply__subSupply`. Asserts the
// pairing, the balance guards, the hostile-witness rejection, and that a burn
// (a debit) pushes no memo.
// ---------------------------------------------------------------------------

let cft: ConfidentialFungibleTokenPublicSupplySimulator;

describe('ConfidentialFungibleTokenPublicSupply burn', () => {
  beforeEach(async () => {
    cft = await deployCft();
  });

  it('should debit the caller and decrease totalSupply', async () => {
    await registerAs(cft, ALICE);
    await fundAs(cft, ALICE, 100n);

    await cft.burn(40n);

    expect(await cft.totalSupply()).toBe(60n);
  });

  it('should allow burning the entire balance', async () => {
    await registerAs(cft, ALICE);
    await fundAs(cft, ALICE, 100n);

    await cft.burn(100n);

    expect(await cft.totalSupply()).toBe(0n);

    // The balance now encrypts 0, but it is NOT the identity ciphertext:
    // subEncrypted re-randomizes, so Enc(0) here has non-trivial c1/c2.
    // Verify the balance is treated as 0 by showing a further burn of 1
    // fails for insufficient balance.
    const aliceBalance = await cft.balanceOf(ALICE.accountId);
    await cft.privateState.cachePlaintext(aliceBalance, 0n);
    await expect(cft.burn(1n)).rejects.toThrow(
      'ConfidentialFungibleToken: insufficient balance',
    );
  });

  it('should fail to burn more than the balance', async () => {
    await registerAs(cft, ALICE);
    await fundAs(cft, ALICE, 100n);

    // The balance guard fires before the supply decrement, so the failure is
    // 'insufficient balance'; the extension's supply-underflow assert is
    // unreachable through the composed surface (supply >= any single balance).
    await expect(cft.burn(101n)).rejects.toThrow(
      'ConfidentialFungibleToken: insufficient balance',
    );
  });

  it('should fail to burn from an unregistered account', async () => {
    await actAs(cft, ALICE);
    // Alice does not register.

    await expect(cft.burn(50n)).rejects.toThrow();
  });

  it('should fail with a hostile plaintext witness', async () => {
    await registerAs(cft, ALICE);
    await actAs(cft, ALICE);
    await cft.mint(ALICE.accountId, 100n);
    await cft.sweep();
    const aliceBalance = await cft.balanceOf(ALICE.accountId);

    // Cache the WRONG plaintext: claim Alice has 1000 when she has 100.
    // ElGamal_assertDecryptsTo (via the debit) should reject this.
    await cft.privateState.cachePlaintext(aliceBalance, 1000n);

    await expect(cft.burn(50n)).rejects.toThrow('ElGamal: plaintext mismatch');
  });

  it('should push no memo on burn (debits are memo-less)', async () => {
    await registerAs(cft, ALICE);
    await fundAs(cft, ALICE, 100n);

    const before = await cft.getPublicState();
    const memosBefore = before.Token__memos.lookup(ALICE.accountId).length();

    await cft.burn(40n);

    const after = await cft.getPublicState();
    const memosAfter = after.Token__memos.lookup(ALICE.accountId).length();
    expect(memosAfter).toBe(memosBefore);
  });
});
