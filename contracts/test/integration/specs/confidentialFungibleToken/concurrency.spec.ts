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
// credit's output is a deterministic function of the recipient's prior state
// (same inputs + different pre-state => different transcript), that credits
// to distinct recipients touch disjoint state (no conflict), and that sweep
// writes the same contested cell.
// ---------------------------------------------------------------------------

const FIXED_SEED = new Uint8Array(32).fill(7);

let cft: ConfidentialFungibleTokenPublicSupplySimulator;

describe('ConfidentialFungibleTokenPublicSupply same-block concurrency limitation', () => {
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
    const otherMemo = [...otherLedger.Token__memos.lookup(ALICE.accountId)][0];
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

  it('should keep credits to distinct recipients on disjoint state', async () => {
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

    // Bob's credit reads and writes only Bob's cells: Alice's pending
    // ciphertext and memo list are untouched, so the two credits could land
    // in the same block without conflict.
    await cft.mint(BOB.accountId, 50n);
    expect(await cft.pendingOf(ALICE.accountId)).toEqual(alicePending);
    const afterLedger = await cft.getPublicState();
    expect(afterLedger.Token__memos.lookup(ALICE.accountId).length()).toBe(
      aliceMemos,
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
});
