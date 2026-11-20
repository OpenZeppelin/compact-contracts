import { beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN,
  ALICE,
  actAs,
  BOB,
  deploy,
  findRoleHolders,
  type RoleHolderLedger,
  type SharedCallerShieldedRolesSimulator,
} from '../fixtures/sharedCallerShieldedRoles.js';

/**
 * ShieldedAccessControl stores an account commitment, so a role holder's
 * account can be public. `SharedCallerShieldedRoles` composes FungibleToken
 * and ShieldedAccessControl under one caller, and every circuit that proves a
 * role passes the caller's secret blinding. No 32-byte value in public state
 * lets the observer recompute a holder.
 *
 * Every observer assertion reads `getPublicState()` alone. The claim is about
 * public state: a transaction that proves a role and writes the caller's own
 * account links the two, so the role holder never mints to herself.
 */

/** Candidate blindings from public state: zero, both salts, the role id and every balance key. */
const publicValues = (
  ledger: RoleHolderLedger & {
    _callerSalt: Uint8Array;
  },
): Uint8Array[] => [
  new Uint8Array(32),
  ledger._callerSalt,
  ledger.ShieldedAccessControl__instanceSalt,
  ledger.MINTER_ROLE,
  ...[...ledger.FungibleToken__balances]
    .filter(([account]) => account.is_left)
    .map(([account]) => account.left),
];

describe('ShieldedAccessControl role holder privacy', () => {
  let sim: SharedCallerShieldedRolesSimulator;

  // ADMIN funds ALICE, then ALICE uses the role to mint to BOB. The cases
  // only read, so one deployment serves both.
  beforeAll(async () => {
    sim = await deploy();
    const minterRole = (await sim.getPublicState()).MINTER_ROLE;
    await sim.grantRole(minterRole, ADMIN.accountCommitment);
    await sim.grantRole(minterRole, ALICE.accountCommitment);
    await sim.mint(ALICE.account, 100n);
    await actAs(sim, ALICE);
    await sim.mint(BOB.account, 40n);
  });

  it('should not let an observer recompute the role holder from public state', async () => {
    const ledger = await sim.getPublicState();
    expect(ledger.FungibleToken__balances.member(ALICE.account)).toBe(true);
    expect(ledger.FungibleToken__balances.lookup(BOB.account)).toBe(40n);

    expect(findRoleHolders(ledger, publicValues(ledger))).toStrictEqual([]);
  });

  it("should find the holder from public state only when handed the holder's own blinding", async () => {
    const ledger = await sim.getPublicState();

    expect(findRoleHolders(ledger, [BOB.blinding])).toStrictEqual([]);
    expect(findRoleHolders(ledger, [ALICE.blinding])).toStrictEqual([
      ALICE.accountId,
    ]);
  });
});
