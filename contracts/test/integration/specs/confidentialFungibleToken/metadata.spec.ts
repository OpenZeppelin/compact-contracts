import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ALICE,
  actAs,
  type ConfidentialFungibleTokenPublicSupplySimulator,
  deployCft,
  TOKEN_DECIMALS,
  TOKEN_NAME,
  TOKEN_SYMBOL,
} from '../../fixtures/confidentialFungibleTokenPublicSupply.js';

// ---------------------------------------------------------------------------
// Composition wiring smoke tests: the constructor initializes the token module,
// its metadata lands on the composed ledger, and registration round-trips
// through the composed contract. Depth on each circuit lives in the unit suite
// (src/token/test/ConfidentialFungibleToken.test.ts); these specs only assert
// the composed contract wires the module correctly.
//
// Metadata is read off the ledger: the base exposes no name/symbol/decimals
// getter circuits (dropped to keep the deploy within the block byte budget).
// ---------------------------------------------------------------------------

let cft: ConfidentialFungibleTokenPublicSupplySimulator;

describe.skipIf(isLiveBackend())(
  'ConfidentialFungibleTokenPublicSupply metadata and registration',
  () => {
    beforeEach(async () => {
      cft = await deployCft();
    });

    it('should expose the constructor metadata', async () => {
      const state = await cft.getPublicState();
      expect(state.Token__name).toBe(TOKEN_NAME);
      expect(state.Token__symbol).toBe(TOKEN_SYMBOL);
      expect(state.Token__decimals).toBe(TOKEN_DECIMALS);
    });

    it('should start with a zero total supply', async () => {
      expect(await cft.totalSupply()).toBe(0n);
    });

    it('should register an account and report it as registered', async () => {
      await actAs(cft, ALICE);
      expect(await cft.isRegistered(ALICE.accountId)).toBe(false);

      const registeredId = await cft.register();

      expect(registeredId).toEqual(ALICE.accountId);
      expect(await cft.isRegistered(ALICE.accountId)).toBe(true);
    });

    it('should derive the accountId from the secret key', async () => {
      expect(await cft.computeAccountId(ALICE.secretKey)).toEqual(
        ALICE.accountId,
      );
    });
  },
);
