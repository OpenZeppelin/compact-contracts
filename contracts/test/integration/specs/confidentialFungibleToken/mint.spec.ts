import { beforeEach, describe, expect, it } from 'vitest';
import {
  ALICE,
  actAs,
  BOB,
  type ConfidentialFungibleTokenPublicSupplySimulator,
  deployCft,
  identityPoint,
  registerAs,
} from '../../fixtures/confidentialFungibleTokenPublicSupply.js';

// ---------------------------------------------------------------------------
// mint: the composed supply operation pairing `Supply__addSupply` with the
// token module's `_mint`. Asserts the pairing (supply delta matches the
// credit), the credit landing in the recipient's pending pool, the memo push,
// and the extension's overflow guard.
//
// Note: mint is intended to be called from privileged contract contexts (e.g.
// gated by an Ownable or AccessControl companion module). The integration
// contract exposes it ungated, so the specs call it directly and treat the
// active identity as both "the minter" and "the account being minted to".
// ---------------------------------------------------------------------------

let cft: ConfidentialFungibleTokenPublicSupplySimulator;

describe('ConfidentialFungibleTokenPublicSupply mint', () => {
  beforeEach(async () => {
    cft = await deployCft();
  });

  it('should credit the recipient and increase totalSupply', async () => {
    await registerAs(cft, ALICE);

    await cft.mint(ALICE.accountId, 100n);
    expect(await cft.totalSupply()).toBe(100n);

    // The mint credits Alice's pending (incoming) pool, not spendable.
    const pending = await cft.pendingOf(ALICE.accountId);
    const identity = identityPoint();
    expect(pending.c1).not.toEqual(identity);
    expect(pending.c2).not.toEqual(identity);
  });

  it('should accumulate across multiple mints', async () => {
    await registerAs(cft, ALICE);

    await cft.mint(ALICE.accountId, 100n);
    await cft.mint(ALICE.accountId, 50n);

    expect(await cft.totalSupply()).toBe(150n);

    // Both mints land in pending; mint's credit never decrypts, so no caching
    // is needed between them. Sweep the accumulated pending into spendable,
    // then cache the swept balance so the burn's plaintext witness matches.
    await cft.sweep();
    const aliceBalance = await cft.balanceOf(ALICE.accountId);
    await cft.privateState.cachePlaintext(aliceBalance, 150n);

    // Verify Alice can spend her accumulated balance.
    await cft.burn(150n);
    expect(await cft.totalSupply()).toBe(0n);
  });

  it('should mint to a different account than the caller', async () => {
    // Register Alice and Bob; Alice mints to Bob.
    await registerAs(cft, ALICE);
    await registerAs(cft, BOB);
    await actAs(cft, ALICE);

    await cft.mint(BOB.accountId, 100n);

    expect(await cft.totalSupply()).toBe(100n);

    // The mint credits Bob's pending (incoming) pool, not spendable.
    const bobPending = await cft.pendingOf(BOB.accountId);
    const identity = identityPoint();
    expect(bobPending.c1).not.toEqual(identity);
    expect(bobPending.c2).not.toEqual(identity);
  });

  it('should push a memo to the recipient on mint', async () => {
    await registerAs(cft, ALICE);

    await cft.mint(ALICE.accountId, 100n);

    const ledger = await cft.getPublicState();
    const aliceMemos = ledger.Token__memos.lookup(ALICE.accountId);
    // Expect exactly one memo entry after one mint.
    expect(aliceMemos.length()).toBe(1n);
  });

  it('should fail to mint to an unregistered account', async () => {
    await actAs(cft, ALICE);
    // Alice does not register.

    await expect(cft.mint(ALICE.accountId, 100n)).rejects.toThrow();
  });

  it('should treat a zero-value mint as a no-op (no semantic restriction)', async () => {
    // The composition does not prohibit value=0; mint(account, 0) credits 0
    // and increments totalSupply by 0 (both no-ops). Documented explicitly.
    await registerAs(cft, ALICE);

    await cft.mint(ALICE.accountId, 0n);
    expect(await cft.totalSupply()).toBe(0n);
  });

  it('should reject a mint that overflows totalSupply', async () => {
    await registerAs(cft, ALICE);

    const MAX_UINT128 = (1n << 128n) - 1n;
    await cft.mint(ALICE.accountId, MAX_UINT128);
    await expect(cft.mint(ALICE.accountId, 1n)).rejects.toThrow(
      'ConfidentialFungibleToken: overflow',
    );
  });
});
