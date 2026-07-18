import {
  CompactTypeBytes,
  CompactTypeVector,
  ecMulGenerator,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConfidentialFungibleTokenPublicSupplySimulator } from './simulators/ConfidentialFungibleTokenPublicSupplySimulator.js';

// ---------------------------------------------------------------------------
// ConfidentialFungibleTokenPublicSupply
//
// Exercises the supply layer (mint / burn / burnFrom / totalSupply) that sits
// over the supply-free base, via its own mock/simulator
// (MockConfidentialFungibleTokenPublicSupply). These specs assert the supply-specific
// behavior (public totalSupply accounting, overflow/underflow, mint credits
// pending, burnFrom consuming an escrow); the base value surface is covered
// separately in ConfidentialFungibleToken.test.ts against the supply-free base.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildAccountIdHash = (sk: Uint8Array): Uint8Array => {
  const rt_type = new CompactTypeVector(1, new CompactTypeBytes(32));
  return persistentHash(rt_type, [sk]);
};

/**
 * @description The identity element on Jubjub, produced by ecMulGenerator(0).
 * Used as both c1 and c2 of Enc(0).
 */
const identityPoint = () => ecMulGenerator(0n);

const createTestKey = (label: string): Uint8Array => {
  const key = new Uint8Array(32);
  const encoded = new TextEncoder().encode(label);
  key.set(encoded.slice(0, 32));
  return key;
};

const makeUser = (label: string) => {
  const secretKey = createTestKey(`${label}_SK`);
  const encryptionKey = createTestKey(`${label}_EK`);
  const accountId = buildAccountIdHash(secretKey);
  return { secretKey, encryptionKey, accountId };
};

// Users
const ALICE = makeUser('ALICE');
const BOB = makeUser('BOB');

// Token metadata
const NAME = 'ConfidentialToken';
const SYMBOL = 'CT';
const DECIMALS = 6n;

let cft: ConfidentialFungibleTokenPublicSupplySimulator;

describe('ConfidentialFungibleTokenPublicSupply', () => {
  beforeEach(async () => {
    cft = await ConfidentialFungibleTokenPublicSupplySimulator.create(
      NAME,
      SYMBOL,
      DECIMALS,
    );
  });

  describe('mint and burn', () => {
    // Note: mint and burn are supply-layer operations, intended to be called
    // from privileged contract contexts (e.g. gated by an Ownable or
    // AccessControl companion module). In these unit tests we don't model that
    // gating; we call them directly and treat the active identity as both "the
    // minter" and "the account being minted to." This keeps the cache updates
    // straightforward, since the test identity is the one whose plaintext-cache
    // the witness reads.

    describe('mint', () => {
      it('should credit the recipient and increase totalSupply', async () => {
        await cft.privateState.switchIdentity(
          ALICE.secretKey,
          ALICE.encryptionKey,
        );
        await cft.register();

        await cft.mint(ALICE.accountId, 100n);
        expect(await cft.totalSupply()).toBe(100n);

        // The mint credits Alice's pending (incoming) pool, not spendable.
        const pending = await cft.pendingOf(ALICE.accountId);
        const identity = identityPoint();
        expect(pending.c1).not.toEqual(identity);
        expect(pending.c2).not.toEqual(identity);
      });

      it('should accumulate across multiple mints', async () => {
        await cft.privateState.switchIdentity(
          ALICE.secretKey,
          ALICE.encryptionKey,
        );
        await cft.register();

        await cft.mint(ALICE.accountId, 100n);
        await cft.mint(ALICE.accountId, 50n);

        expect(await cft.totalSupply()).toBe(150n);

        // Both mints land in pending; mint's _credit never decrypts, so no
        // caching is needed between them. Sweep the accumulated pending into
        // spendable, then cache the swept balance so the burn's plaintext
        // witness matches.
        await cft.sweep();
        const aliceBalance = await cft.balanceOf(ALICE.accountId);
        await cft.privateState.cachePlaintext(aliceBalance, 150n);

        // Verify Alice can spend her accumulated balance.
        await cft.burn(150n);
        expect(await cft.totalSupply()).toBe(0n);
      });

      it('should mint to a different account than the caller', async () => {
        // Register Alice and Bob; Alice mints to Bob.
        await cft.privateState.switchIdentity(
          ALICE.secretKey,
          ALICE.encryptionKey,
        );
        await cft.register();

        await cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
        await cft.register();

        // Switch back to Alice and mint to Bob.
        await cft.privateState.switchIdentity(
          ALICE.secretKey,
          ALICE.encryptionKey,
        );
        await cft.mint(BOB.accountId, 100n);

        expect(await cft.totalSupply()).toBe(100n);

        // The mint credits Bob's pending (incoming) pool, not spendable.
        const bobPending = await cft.pendingOf(BOB.accountId);
        const identity = identityPoint();
        expect(bobPending.c1).not.toEqual(identity);
        expect(bobPending.c2).not.toEqual(identity);
      });

      it('should push a memo to the recipient on mint', async () => {
        await cft.privateState.switchIdentity(
          ALICE.secretKey,
          ALICE.encryptionKey,
        );
        await cft.register();

        await cft.mint(ALICE.accountId, 100n);

        const ledger = await cft.getPublicState();
        const aliceMemos = ledger.Token__memos.lookup(ALICE.accountId);
        // Expect exactly one memo entry after one mint.
        expect(aliceMemos.length()).toBe(1n);
      });

      it('should fail to mint to an unregistered account', async () => {
        await cft.privateState.switchIdentity(
          ALICE.secretKey,
          ALICE.encryptionKey,
        );
        // Alice does not register.

        await expect(cft.mint(ALICE.accountId, 100n)).rejects.toThrow();
      });

      it('should treat a zero-value mint as a no-op (no semantic restriction)', async () => {
        // The layer does not prohibit value=0; mint(account, 0) credits 0 and
        // increments totalSupply by 0 (both no-ops). Documented explicitly.
        await cft.privateState.switchIdentity(
          ALICE.secretKey,
          ALICE.encryptionKey,
        );
        await cft.register();

        await cft.mint(ALICE.accountId, 0n);
        expect(await cft.totalSupply()).toBe(0n);
      });
    });

    describe('burn', () => {
      it('should debit the caller and decrease totalSupply', async () => {
        await cft.privateState.switchIdentity(
          ALICE.secretKey,
          ALICE.encryptionKey,
        );
        await cft.register();

        await cft.mint(ALICE.accountId, 100n);
        await cft.sweep();
        const aliceBalance = await cft.balanceOf(ALICE.accountId);
        await cft.privateState.cachePlaintext(aliceBalance, 100n);

        await cft.burn(40n);

        expect(await cft.totalSupply()).toBe(60n);
      });

      it('should allow burning the entire balance', async () => {
        await cft.privateState.switchIdentity(
          ALICE.secretKey,
          ALICE.encryptionKey,
        );
        await cft.register();

        await cft.mint(ALICE.accountId, 100n);
        await cft.sweep();
        let aliceBalance = await cft.balanceOf(ALICE.accountId);
        await cft.privateState.cachePlaintext(aliceBalance, 100n);

        await cft.burn(100n);

        expect(await cft.totalSupply()).toBe(0n);

        // The balance now encrypts 0, but it is NOT the identity ciphertext:
        // subEncrypted re-randomizes, so Enc(0) here has non-trivial c1/c2.
        // Verify the balance is treated as 0 by showing a further burn of 1
        // fails for insufficient balance.
        aliceBalance = await cft.balanceOf(ALICE.accountId);
        await cft.privateState.cachePlaintext(aliceBalance, 0n);
        await expect(cft.burn(1n)).rejects.toThrow(
          'ConfidentialFungibleToken: insufficient balance',
        );
      });

      it('should fail to burn more than the balance', async () => {
        await cft.privateState.switchIdentity(
          ALICE.secretKey,
          ALICE.encryptionKey,
        );
        await cft.register();

        await cft.mint(ALICE.accountId, 100n);
        await cft.sweep();
        const aliceBalance = await cft.balanceOf(ALICE.accountId);
        await cft.privateState.cachePlaintext(aliceBalance, 100n);

        await expect(cft.burn(101n)).rejects.toThrow(
          'ConfidentialFungibleToken: insufficient balance',
        );
      });

      it('should fail to burn from an unregistered account', async () => {
        await cft.privateState.switchIdentity(
          ALICE.secretKey,
          ALICE.encryptionKey,
        );
        // Alice does not register.

        await expect(cft.burn(50n)).rejects.toThrow();
      });

      it('should fail with a hostile plaintext witness', async () => {
        await cft.privateState.switchIdentity(
          ALICE.secretKey,
          ALICE.encryptionKey,
        );
        await cft.register();

        await cft.mint(ALICE.accountId, 100n);
        await cft.sweep();
        const aliceBalance = await cft.balanceOf(ALICE.accountId);

        // Cache the WRONG plaintext: claim Alice has 1000 when she has 100.
        // ElGamal_assertDecryptsTo (via _debit) should reject this.
        await cft.privateState.cachePlaintext(aliceBalance, 1000n);

        await expect(cft.burn(50n)).rejects.toThrow(
          'ElGamal: plaintext mismatch',
        );
      });
    });

    describe('totalSupply tracking across operations', () => {
      it('should reflect cumulative mints and burns', async () => {
        await cft.privateState.switchIdentity(
          ALICE.secretKey,
          ALICE.encryptionKey,
        );
        await cft.register();

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
    });
  });

  describe('supply overflow', () => {
    it('still rejects a mint that overflows totalSupply', async () => {
      await cft.privateState.switchIdentity(
        ALICE.secretKey,
        ALICE.encryptionKey,
      );
      await cft.register();

      const MAX_UINT128 = (1n << 128n) - 1n;
      await cft.mint(ALICE.accountId, MAX_UINT128);
      await expect(cft.mint(ALICE.accountId, 1n)).rejects.toThrow(
        'ConfidentialFungibleToken: overflow',
      );
    });
  });

  describe('burnFrom', () => {
    it('consumes the caller’s escrow and lowers totalSupply', async () => {
      // Alice mints 100, sweeps, and approves Bob for 40. Bob then burns 25 of
      // that escrow: totalSupply drops 100 -> 75 while Alice's main balance is
      // untouched (only the escrowed amount is consumed).
      for (const u of [ALICE, BOB]) {
        await cft.privateState.switchIdentity(u.secretKey, u.encryptionKey);
        await cft.register();
      }
      await cft.privateState.switchIdentity(
        ALICE.secretKey,
        ALICE.encryptionKey,
      );
      await cft.mint(ALICE.accountId, 100n);
      await cft.sweep();
      await cft.privateState.cachePlaintext(
        await cft.balanceOf(ALICE.accountId),
        100n,
      );
      await cft.approve(BOB.accountId, 40n);
      expect(await cft.totalSupply()).toBe(100n);

      // Bob decrypts his escrow copy (40) and burns 25 of it.
      await cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
      const escrow = await cft.allowance(ALICE.accountId, BOB.accountId);
      await cft.privateState.cachePlaintext(escrow.spenderCt, 40n);

      await cft.burnFrom(ALICE.accountId, 25n);
      expect(await cft.totalSupply()).toBe(75n);
    });
  });
});
