import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  actAs,
  CHARLIE,
  type ComposedEscrowBypassSimulator,
  deployBypass,
  registerAs,
} from '../../fixtures/composedEscrowBypass.js';
import {
  ALICE,
  BOB,
} from '../../fixtures/confidentialFungibleTokenPublicSupply.js';

// ---------------------------------------------------------------------------
// escrowBypass: a composing contract writes the token module's exported
// `_escrow` map directly, so an escrow can exist for a party that never
// registered. `_spendEscrow` must stop on its own registration guards rather
// than on a raw missing-key read of `_encryptionKeys`; without those guards
// every rejection below surfaces as `expected a cell, received null`. The
// owner cases spend 0 so that, unguarded, they clear the allowance bound and
// reach the owner-key read instead of stopping at `insufficient allowance`.
// ---------------------------------------------------------------------------

let cft: ComposedEscrowBypassSimulator;

describe.skipIf(isLiveBackend())(
  'ConfidentialFungibleToken escrow planted by a composing contract',
  () => {
    beforeEach(async () => {
      cft = await deployBypass();
    });

    it('should reject transferFrom when the spender never registered', async () => {
      await registerAs(cft, ALICE);
      await registerAs(cft, CHARLIE);
      await cft.plantEscrow(ALICE.accountId, BOB.accountId);

      await actAs(cft, BOB);
      await expect(
        cft.transferFrom(ALICE.accountId, CHARLIE.accountId, 1n),
      ).rejects.toThrow('ConfidentialFungibleToken: spender not registered');
    });

    it('should reject _burnFrom when the spender never registered', async () => {
      await registerAs(cft, ALICE);
      await cft.plantEscrow(ALICE.accountId, BOB.accountId);

      await actAs(cft, BOB);
      await expect(cft._burnFrom(ALICE.accountId, 1n)).rejects.toThrow(
        'ConfidentialFungibleToken: spender not registered',
      );
    });

    it('should reject a spend when the owner never registered', async () => {
      await registerAs(cft, BOB);
      await registerAs(cft, CHARLIE);
      await cft.plantEscrow(ALICE.accountId, BOB.accountId);

      await actAs(cft, BOB);
      await expect(
        cft.transferFrom(ALICE.accountId, CHARLIE.accountId, 0n),
      ).rejects.toThrow('ConfidentialFungibleToken: owner not registered');
    });

    it('should reject _burnFrom when the owner never registered', async () => {
      await registerAs(cft, BOB);
      await cft.plantEscrow(ALICE.accountId, BOB.accountId);

      await actAs(cft, BOB);
      await expect(cft._burnFrom(ALICE.accountId, 0n)).rejects.toThrow(
        'ConfidentialFungibleToken: owner not registered',
      );
    });

    it('should let a planted escrow between registered parties reach the allowance check', async () => {
      // Negative control: with both keys present the guards pass, and the
      // planted entry (an encryption of zero, which the witness reads as 0
      // with no cache entry) fails on the amount instead.
      await registerAs(cft, ALICE);
      await registerAs(cft, BOB);
      await registerAs(cft, CHARLIE);
      await cft.plantEscrow(ALICE.accountId, BOB.accountId);

      await actAs(cft, BOB);
      await expect(
        cft.transferFrom(ALICE.accountId, CHARLIE.accountId, 1n),
      ).rejects.toThrow('ConfidentialFungibleToken: insufficient allowance');
    });
  },
);
