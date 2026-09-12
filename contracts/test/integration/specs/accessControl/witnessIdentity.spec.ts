import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ADMIN_ROLE, eitherFor } from '../../_harness/identity.js';
import {
  deployTestTokenV1,
  type TestTokenV1Kit,
} from '../../fixtures/testTokenV1.js';

/**
 * Role checks follow the secret key a caller injects through its witness, not
 * the wallet that submits the tx — every alias here pays from the same wallet.
 * The upgrade specs rely on that to vary the caller, so it is pinned once here
 * rather than assumed.
 *
 * Assertions read the ledger instead of calling `hasRole`, which would be a
 * full transaction for a value already on chain.
 */
const MINTER_ROLE = new Uint8Array(32);
MINTER_ROLE.set(new TextEncoder().encode('MINTER'));

const ALICE = eitherFor('ALICE');

describe.runIf(isLiveBackend())(
  'AccessControl — witness-derived caller identity',
  () => {
    let v1: TestTokenV1Kit;

    const hasRole = async (roleId: Uint8Array, account: typeof ALICE) => {
      const roles = (await v1.readLedger()).AccessControl__operatorRoles;
      return (
        roles.member(roleId) &&
        roles.lookup(roleId).member(account) &&
        roles.lookup(roleId).lookup(account)
      );
    };

    beforeAll(async () => {
      v1 = await deployTestTokenV1();
    });

    afterAll(async () => {
      await v1?.teardown();
    });

    it('grants the admin role to ADMIN during deploy', async () => {
      expect(await hasRole(DEFAULT_ADMIN_ROLE, eitherFor('ADMIN'))).toBe(true);
    });

    it('lets ADMIN grant and revoke a role', async () => {
      const admin = await v1.as('ADMIN');

      await admin.callTx.grantRole(MINTER_ROLE, ALICE);
      expect(await hasRole(MINTER_ROLE, ALICE)).toBe(true);

      await admin.callTx.revokeRole(MINTER_ROLE, ALICE);
      expect(await hasRole(MINTER_ROLE, ALICE)).toBe(false);
    });

    it('rejects a caller whose witness key holds no admin role', async () => {
      const bob = await v1.as('BOB');
      await expect(bob.callTx.grantRole(MINTER_ROLE, ALICE)).rejects.toThrow(
        'AccessControl: unauthorized account',
      );
    });
  },
);
