import { isLiveBackend } from '@openzeppelin/compact-simulator';
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
// The documented concurrency limitation (see the ConfidentialFungibleToken
// module header): two credits to the SAME recipient in the same block
// conflict. A credit is a read-modify-write of the recipient's pending
// ciphertext and memo list, so its public transcript depends on the
// recipient's pre-state; two transactions proven against the same pre-state
// both claim the same read, and whichever lands second is invalid.
//
// The simulator executes sequentially, so these specs prove the CAUSE rather
// than replay the race: with all witness randomness pinned, they show a
// credit's output depends on the recipient's prior state (same inputs +
// different pre-state => different transcript), that a credit leaves other
// recipients' cells untouched, that sweep writes the same contested pending
// cell, and that every composed supply op rewrites one public totalSupply
// cell, so supply ops serialize regardless of recipient.
// ---------------------------------------------------------------------------

const FIXED_SEED = new Uint8Array(32).fill(7);

let cft: ConfidentialFungibleTokenPublicSupplySimulator;

describe.skipIf(isLiveBackend())(
  'ConfidentialFungibleTokenPublicSupply same-block concurrency limitation',
  () => {
    beforeEach(async () => {
      cft = await deployCft();
    });

    it('should make a credit’s public write depend on the recipient’s pre-state', async () => {
      // Baseline determinism on a second, identical deployment: same identity,
      // same pinned seed, same pre-state => byte-identical first credit. This
      // pins down that any difference observed below comes from state, not
      // randomness.
      const other = await deployCft();
      for (const sim of [cft, other]) {
        await registerAs(sim, ALICE);
        await sim.privateState.setRandomnessSeed(FIXED_SEED);
        await sim.mint(ALICE.accountId, 50n);
      }
      const firstCredit = await cft.pendingOf(ALICE.accountId);
      expect(await other.pendingOf(ALICE.accountId)).toEqual(firstCredit);

      const ledgerAfterFirst = await cft.getPublicState();
      const firstMemo = [
        ...ledgerAfterFirst.Token__memos.lookup(ALICE.accountId),
      ][0];
      const otherLedger = await other.getPublicState();
      const otherMemo = [
        ...otherLedger.Token__memos.lookup(ALICE.accountId),
      ][0];
      expect(otherMemo).toEqual(firstMemo);

      // Replay the exact same operation (same caller, amount, and seed) on top
      // of the changed pre-state: the transcript differs, because the credit
      // read the recipient's pending ciphertext and memo count. On chain, two
      // such transactions built against ONE pre-state would both claim the
      // first transcript, and the second to land would be rejected.
      await cft.mint(ALICE.accountId, 50n);
      const secondCredit = await cft.pendingOf(ALICE.accountId);
      expect(secondCredit).not.toEqual(firstCredit);

      const ledgerAfterSecond = await cft.getPublicState();
      const memos = [...ledgerAfterSecond.Token__memos.lookup(ALICE.accountId)];
      expect(memos).toHaveLength(2);
      expect(memos[0]).not.toEqual(memos[1]);
    });

    it('should leave another recipient’s cells untouched by a credit', async () => {
      await registerAs(cft, ALICE);
      await registerAs(cft, BOB);
      await actAs(cft, ALICE);
      await cft.privateState.setRandomnessSeed(FIXED_SEED);

      await cft.mint(ALICE.accountId, 50n);
      const alicePending = await cft.pendingOf(ALICE.accountId);
      const aliceLedger = await cft.getPublicState();
      const aliceMemos = aliceLedger.Token__memos.lookup(
        ALICE.accountId,
      ).length();

      // Bob's credit reads and writes only Bob's pending and memo cells;
      // Alice's are untouched. The composed mint still rewrites the shared
      // totalSupply cell, so the two mints serialize there (next case).
      await cft.mint(BOB.accountId, 50n);
      expect(await cft.pendingOf(ALICE.accountId)).toEqual(alicePending);
      const afterLedger = await cft.getPublicState();
      expect(afterLedger.Token__memos.lookup(ALICE.accountId).length()).toBe(
        aliceMemos,
      );
    });

    it('should serialize supply ops on the shared totalSupply cell', async () => {
      const other = await deployCft();
      for (const sim of [cft, other]) {
        await registerAs(sim, ALICE);
        await registerAs(sim, BOB);
        await sim.privateState.setRandomnessSeed(FIXED_SEED);
      }
      await cft.mint(ALICE.accountId, 50n);

      // The same credit to Bob against two supply pre-states writes the same
      // recipient cells but a different totalSupply value, so mint, burn, and
      // burnFrom all pin that one cell and serialize with each other regardless
      // of recipient.
      await cft.mint(BOB.accountId, 50n);
      await other.mint(BOB.accountId, 50n);

      expect((await cft.getPublicState()).Supply__totalSupply).toBe(100n);
      expect((await other.getPublicState()).Supply__totalSupply).toBe(50n);
      expect(await cft.pendingOf(BOB.accountId)).toEqual(
        await other.pendingOf(BOB.accountId),
      );
    });

    it('should contest the same pending cell between sweep and an incoming credit', async () => {
      await registerAs(cft, ALICE);
      await cft.privateState.setRandomnessSeed(FIXED_SEED);
      await cft.mint(ALICE.accountId, 50n);

      const pendingBeforeSweep = await cft.pendingOf(ALICE.accountId);
      const identity = identityPoint();
      expect(pendingBeforeSweep.c1).not.toEqual(identity);

      // Sweep rewrites the SAME pending cell a credit writes (resetting it to
      // the deterministic Enc(0)), so a sweep and an incoming credit to the
      // same account are also same-block rivals: a credit proven against the
      // pre-sweep pending would be invalidated by the sweep landing first (and
      // vice versa).
      await cft.sweep();
      const pendingAfterSweep = await cft.pendingOf(ALICE.accountId);
      expect(pendingAfterSweep.c1).toEqual(identity);
      expect(pendingAfterSweep.c2).toEqual(identity);
    });
  },
);
