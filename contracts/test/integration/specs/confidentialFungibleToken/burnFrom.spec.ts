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
// burnFrom: the composed supply operation pairing the token module's
// `_burnFrom` (escrow consumption with no recipient credit) with
// `Supply__subSupply`. Asserts the escrow lifecycle across partial burns, the
// exhaustion and no-escrow failures, and the supply accounting on each step.
// ---------------------------------------------------------------------------

let cft: ConfidentialFungibleTokenPublicSupplySimulator;

describe('ConfidentialFungibleTokenPublicSupply burnFrom', () => {
  beforeEach(async () => {
    cft = await deployCft();
  });

  it('should consume the caller’s escrow and lower totalSupply', async () => {
    // Alice mints 100, sweeps, and approves Bob for 40. Bob then burns 25 of
    // that escrow: totalSupply drops 100 -> 75 while Alice's main balance is
    // untouched (only the escrowed amount is consumed).
    await registerAs(cft, ALICE);
    await registerAs(cft, BOB);
    await fundAs(cft, ALICE, 100n);
    await cft.approve(BOB.accountId, 40n);
    expect(await cft.totalSupply()).toBe(100n);

    // Bob decrypts his escrow copy (40) and burns 25 of it.
    await actAs(cft, BOB);
    const escrow = await cft.allowance(ALICE.accountId, BOB.accountId);
    await cft.privateState.cachePlaintext(escrow.spenderCt, 40n);

    await cft.burnFrom(ALICE.accountId, 25n);
    expect(await cft.totalSupply()).toBe(75n);
  });

  it('should burn the escrow down to zero and then reject further burns', async () => {
    await registerAs(cft, ALICE);
    await registerAs(cft, BOB);
    await fundAs(cft, ALICE, 100n);
    await cft.approve(BOB.accountId, 40n);

    // Bob burns the escrow in two steps: 25, then the remaining 15. Each spend
    // re-randomizes the escrow ciphertext, so the new spender copy is cached
    // with the known remaining before the next burn.
    await actAs(cft, BOB);
    let escrow = await cft.allowance(ALICE.accountId, BOB.accountId);
    await cft.privateState.cachePlaintext(escrow.spenderCt, 40n);
    await cft.burnFrom(ALICE.accountId, 25n);

    escrow = await cft.allowance(ALICE.accountId, BOB.accountId);
    await cft.privateState.cachePlaintext(escrow.spenderCt, 15n);
    await cft.burnFrom(ALICE.accountId, 15n);
    expect(await cft.totalSupply()).toBe(60n);

    // The escrow slot still exists but encrypts 0; a further burn of 1 fails
    // the allowance bound.
    escrow = await cft.allowance(ALICE.accountId, BOB.accountId);
    await cft.privateState.cachePlaintext(escrow.spenderCt, 0n);
    await expect(cft.burnFrom(ALICE.accountId, 1n)).rejects.toThrow(
      'ConfidentialFungibleToken: insufficient allowance',
    );
    expect(await cft.totalSupply()).toBe(60n);
  });

  it('should fail when no escrow exists for the caller', async () => {
    await registerAs(cft, ALICE);
    await registerAs(cft, BOB);
    await fundAs(cft, ALICE, 100n);
    // Alice approves nothing.

    await actAs(cft, BOB);
    await expect(cft.burnFrom(ALICE.accountId, 1n)).rejects.toThrow(
      'ConfidentialFungibleToken: no escrow',
    );
  });
});
