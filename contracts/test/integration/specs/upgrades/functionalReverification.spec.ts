import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rotateCircuitVK } from '../../_harness/cma.js';
import { eitherFor } from '../../_harness/identity.js';
import {
  deployTestTokenV1,
  type TestTokenV1Kit,
} from '../../fixtures/testTokenV1.js';

/**
 * A rotated circuit still proves and verifies. `stateSurvival` shows the ledger
 * is untouched; this calls each rotated circuit afterwards, so a rotation that
 * broke the prove-verify-apply loop fails at the call rather than silently.
 */
const MINTER_ROLE = new Uint8Array(32);
MINTER_ROLE.set(new TextEncoder().encode('MINTER'));

const ALICE = eitherFor('ALICE');
const BOB = eitherFor('BOB');

describe.runIf(isLiveBackend())('TestToken — calls after VK rotation', () => {
  let v1: TestTokenV1Kit;

  const balanceOf = async (account: typeof ALICE) => {
    const balances = (await v1.readLedger()).FungibleToken__balances;
    return balances.member(account) ? balances.lookup(account) : 0n;
  };

  beforeAll(async () => {
    v1 = await deployTestTokenV1();
  });

  afterAll(async () => {
    await v1?.teardown();
  });

  it('mints after the `_mint` VK rotates', async () => {
    const before = await balanceOf(ALICE);

    await rotateCircuitVK(v1.providers, v1.deployed, '_mint');
    await v1.deployed.callTx._mint(ALICE, 75n);

    expect(await balanceOf(ALICE)).toBe(before + 75n);
  });

  it('pauses after the `pause` VK rotates', async () => {
    if ((await v1.readLedger()).Pausable__isPaused) {
      await v1.deployed.callTx.unpause();
    }
    await rotateCircuitVK(v1.providers, v1.deployed, 'pause');
    await v1.deployed.callTx.pause();
    expect((await v1.readLedger()).Pausable__isPaused).toBe(true);
  });

  it('grants a role after the `grantRole` VK rotates', async () => {
    const admin = await v1.as('ADMIN');
    await rotateCircuitVK(v1.providers, v1.deployed, 'grantRole');
    await admin.callTx.grantRole(MINTER_ROLE, ALICE);

    const roles = (await v1.readLedger()).AccessControl__operatorRoles;
    expect(roles.lookup(MINTER_ROLE).lookup(ALICE)).toBe(true);
  });

  it('transfers after the `transfer` VK rotates', async () => {
    const aliceStart = await balanceOf(ALICE);
    if (aliceStart < 50n) {
      await v1.deployed.callTx._mint(ALICE, 50n - aliceStart);
    }
    if ((await v1.readLedger()).Pausable__isPaused) {
      await v1.deployed.callTx.unpause();
    }

    const aliceBefore = await balanceOf(ALICE);
    const bobBefore = await balanceOf(BOB);

    await rotateCircuitVK(v1.providers, v1.deployed, 'transfer');

    const alice = await v1.as('ALICE');
    await alice.callTx.transfer(BOB, 25n);

    expect(await balanceOf(ALICE)).toBe(aliceBefore - 25n);
    expect(await balanceOf(BOB)).toBe(bobBefore + 25n);
  });
});
