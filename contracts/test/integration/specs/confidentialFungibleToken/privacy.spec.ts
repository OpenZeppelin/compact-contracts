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
// Privacy properties of the composed token, asserted from the observer's
// side: everything checked here reads only what the public ledger exposes.
//
// What must stay hidden: balance, pending, and escrow amounts (ElGamal
// ciphertexts), the approve cap, and every transfer amount. What is disclosed
// by design: the totalSupply cell, so each mint/burn amount leaks through its
// delta ("public supply"), and the counterparty graph (account ids and memo
// growth) on every credit. The witness-binding cases assert that a hostile
// wallet cannot fake the hidden values it is asked to prove.
// ---------------------------------------------------------------------------

let cft: ConfidentialFungibleTokenPublicSupplySimulator;

describe('ConfidentialFungibleTokenPublicSupply privacy', () => {
  beforeEach(async () => {
    cft = await deployCft();
  });

  it('should store balances, pending, and escrows only as ciphertexts', async () => {
    await registerAs(cft, ALICE);
    await registerAs(cft, BOB);
    await fundAs(cft, ALICE, 100n);
    await cft.approve(BOB.accountId, 40n);

    const ledger = await cft.getPublicState();

    // Balance and pending cells are ElGamal point pairs, not integers.
    const balance = ledger.Token__balances.lookup(ALICE.accountId);
    const pending = ledger.Token__pending.lookup(ALICE.accountId);
    for (const ct of [balance, pending]) {
      expect(typeof ct.c1.x).toBe('bigint');
      expect(typeof ct.c2.x).toBe('bigint');
    }

    // The escrow entry carries two ciphertext copies and an encrypted owner
    // memo; the approved cap (40) appears nowhere in clear. The two copies
    // encrypt the same amount under different keys, so they must not be equal.
    const entry = ledger.Token__escrow.lookup(ALICE.accountId).lookup(
      BOB.accountId,
    );
    expect(typeof entry.spenderCt.c1.x).toBe('bigint');
    expect(typeof entry.ownerCt.c1.x).toBe('bigint');
    expect(entry.spenderCt).not.toEqual(entry.ownerCt);
  });

  it('should produce unlinkable ciphertexts for equal amounts', async () => {
    await registerAs(cft, ALICE);
    await registerAs(cft, BOB);

    // Same amount, same block of state, two recipients: the credit randomness
    // is bound to the recipient account, so the resulting pending ciphertexts
    // (and memos) must differ even for identical values.
    await actAs(cft, ALICE);
    await cft.mint(ALICE.accountId, 50n);
    await cft.mint(BOB.accountId, 50n);

    const alicePending = await cft.pendingOf(ALICE.accountId);
    const bobPending = await cft.pendingOf(BOB.accountId);
    expect(alicePending).not.toEqual(bobPending);

    const ledger = await cft.getPublicState();
    const aliceMemo = [...ledger.Token__memos.lookup(ALICE.accountId)][0];
    const bobMemo = [...ledger.Token__memos.lookup(BOB.accountId)][0];
    expect(aliceMemo).not.toEqual(bobMemo);
  });

  it('should hide transfer amounts while revealing the counterparty graph', async () => {
    await registerAs(cft, ALICE);
    await registerAs(cft, BOB);
    await fundAs(cft, ALICE, 100n);

    const before = await cft.getPublicState();
    const bobMemosBefore = before.Token__memos.member(BOB.accountId)
      ? before.Token__memos.lookup(BOB.accountId).length()
      : 0n;

    await cft.transfer(BOB.accountId, 30n);

    // No amount leaks: the only public integer, totalSupply, is untouched by
    // a conserving transfer.
    expect(await cft.totalSupply()).toBe(100n);

    // The graph metadata IS visible: an observer sees Bob received a credit
    // (his memo list grew), just not how much.
    const after = await cft.getPublicState();
    expect(after.Token__memos.lookup(BOB.accountId).length()).toBe(
      bobMemosBefore + 1n,
    );
  });

  it('should disclose mint and burn amounts through the supply delta (by design)', async () => {
    await registerAs(cft, ALICE);

    // The "public" in public supply: each mint/burn amount is recoverable
    // from the totalSupply delta. This is the deliberate disclosure of this
    // composition; a confidential-supply extension would remove it.
    await cft.mint(ALICE.accountId, 75n);
    expect(await cft.totalSupply()).toBe(75n);

    await cft.sweep();
    await cft.privateState.cachePlaintext(
      await cft.balanceOf(ALICE.accountId),
      75n,
    );
    await cft.burn(25n);
    expect(await cft.totalSupply()).toBe(50n);
  });

  it('should reject a wallet whose encryption key does not match the registered pk', async () => {
    await registerAs(cft, ALICE);
    await fundAs(cft, ALICE, 100n);

    // A hostile wallet swaps in a different EK: the decryption-consistency
    // check re-derives the public key and refuses to prove against it.
    const wrongEk = new Uint8Array(32).fill(7);
    await cft.privateState.injectEncryptionKey(wrongEk);

    await expect(cft.burn(10n)).rejects.toThrow('ElGamal: ek/pk mismatch');
  });

  it('should reject a hostile plaintext claim on the escrow path', async () => {
    await registerAs(cft, ALICE);
    await registerAs(cft, BOB);
    await fundAs(cft, ALICE, 100n);
    await cft.approve(BOB.accountId, 40n);

    // Bob claims his escrow copy holds 100 when it encrypts 40: the witness
    // binding rejects the overstated allowance.
    await actAs(cft, BOB);
    const escrow = await cft.allowance(ALICE.accountId, BOB.accountId);
    await cft.privateState.cachePlaintext(escrow.spenderCt, 100n);

    await expect(
      cft.transferFrom(ALICE.accountId, BOB.accountId, 60n),
    ).rejects.toThrow('ElGamal: plaintext mismatch');
  });
});
