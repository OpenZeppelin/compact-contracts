import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rotateCircuitVK } from '../../_harness/cma.js';
import { eitherFor } from '../../_harness/identity.js';
import {
  deployTestTokenV1,
  type TestTokenV1Kit,
} from '../../fixtures/testTokenV1.js';

/**
 * Rotating one module's circuit leaves the other modules' state alone — the
 * property only a composed contract can show. Each test writes state in one
 * module, rotates a key in another, and reads the first back.
 */
const MINTER_ROLE = new Uint8Array(32);
MINTER_ROLE.set(new TextEncoder().encode('MINTER'));

const ALICE = eitherFor('ALICE');
const BOB = eitherFor('BOB');

describe.runIf(isLiveBackend())(
  'TestToken — cross-module isolation under VK rotation',
  () => {
    let v1: TestTokenV1Kit;

    beforeAll(async () => {
      v1 = await deployTestTokenV1();
    });

    afterAll(async () => {
      await v1?.teardown();
    });

    it("keeps BOB's balance when the AccessControl `grantRole` VK rotates", async () => {
      await v1.deployed.callTx._mint(BOB, 50n);
      const before = (await v1.readLedger()).FungibleToken__balances.lookup(
        BOB,
      );

      await rotateCircuitVK(v1.providers, v1.deployed, 'grantRole');

      const after = (await v1.readLedger()).FungibleToken__balances.lookup(BOB);
      expect(after).toBe(before);
    });

    it("keeps ALICE's MINTER role when the FungibleToken `_mint` VK rotates", async () => {
      const admin = await v1.as('ADMIN');
      await admin.callTx.grantRole(MINTER_ROLE, ALICE);

      await rotateCircuitVK(v1.providers, v1.deployed, '_mint');

      const roles = (await v1.readLedger()).AccessControl__operatorRoles;
      expect(roles.lookup(MINTER_ROLE).lookup(ALICE)).toBe(true);
    });

    it('keeps the contract paused when the FungibleToken `_mint` VK rotates', async () => {
      if (!(await v1.readLedger()).Pausable__isPaused) {
        await v1.deployed.callTx.pause();
      }
      await rotateCircuitVK(v1.providers, v1.deployed, '_mint');
      expect((await v1.readLedger()).Pausable__isPaused).toBe(true);
    });

    it('keeps the Initializable flag set when the Pausable `pause` VK rotates', async () => {
      expect((await v1.readLedger()).Initializable__isInitialized).toBe(true);
      await rotateCircuitVK(v1.providers, v1.deployed, 'pause');
      expect((await v1.readLedger()).Initializable__isInitialized).toBe(true);
    });
  },
);
