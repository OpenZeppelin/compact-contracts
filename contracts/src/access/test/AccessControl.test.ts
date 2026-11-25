import {
  CompactTypeBytes,
  CompactTypeVector,
  convertBigintToBytes,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/fixtures/address.js';
import {
  AccessControlCallerSimulator,
  type Caller,
} from './simulators/AccessControlCallerSimulator.js';
import { AccessControlSimulator } from './simulators/AccessControlSimulator.js';

// Helpers
const buildAccountIdHash = (sk: Uint8Array): Uint8Array => {
  const rt_type = new CompactTypeVector(3, new CompactTypeBytes(32));
  const domain = createTestSK('AuthPrfAddr:account');
  const salt = createTestSK('MockAccessControl');
  return persistentHash(rt_type, [domain, salt, sk]);
};

const zeroBytes = utils.zeroUint8Array();

const eitherCommitment = (commitment: Uint8Array) => {
  return {
    is_left: true,
    left: commitment,
    right: { bytes: zeroBytes },
  };
};

const eitherContract = (address: string) => {
  return {
    is_left: false,
    left: zeroBytes,
    right: utils.encodeToAddress(address),
  };
};

const createTestSK = (label: string): Uint8Array => {
  const sk = new Uint8Array(32);
  const encoded = new TextEncoder().encode(label);
  sk.set(encoded.slice(0, 32));
  return sk;
};

const makeUser = (label: string) => {
  const secretKey = createTestSK(label);
  const accountId = buildAccountIdHash(secretKey);
  const either = eitherCommitment(accountId);
  return { secretKey, accountId, either };
};

// Users
const ADMIN = makeUser('ADMIN');
const CUSTOM_ADMIN = makeUser('CUSTOM_ADMIN');
const OP1 = makeUser('OP1');
const OP2 = makeUser('OP2');
const OP3 = makeUser('OP3');
const UNAUTHORIZED = makeUser('UNAUTHORIZED');

// Contract addresses
const OP1_CONTRACT = eitherContract('CONTRACT_ADDRESS');

// Roles
const DEFAULT_ADMIN_ROLE = utils.zeroUint8Array();
const OPERATOR_ROLE_1 = convertBigintToBytes(32, 1n, '');
const OPERATOR_ROLE_2 = convertBigintToBytes(32, 2n, '');
const OPERATOR_ROLE_3 = convertBigintToBytes(32, 3n, '');
const CUSTOM_ADMIN_ROLE = convertBigintToBytes(32, 4n, '');
const UNINITIALIZED_ROLE = convertBigintToBytes(32, 5n, '');

// Lists
const operatorRolesList = [OPERATOR_ROLE_1, OPERATOR_ROLE_2];
const commitmentOperators = [OP1.either, OP2.either, OP3.either];
const allOperators = [...commitmentOperators, OP1_CONTRACT];

// Zero accounts
const zeroKeyAccounts = [
  ['zero account', eitherCommitment(zeroBytes)],
  [
    'non-canonical zero account',
    {
      is_left: true,
      left: zeroBytes,
      right: { bytes: new Uint8Array(32).fill(0xff) },
    },
  ],
] as const;
const zeroAccounts = [
  ...zeroKeyAccounts,
  [
    'contract-arm zero account',
    { is_left: false, left: zeroBytes, right: { bytes: zeroBytes } },
  ],
] as const;

let accessControl: AccessControlSimulator;

const operatorTypes = [
  ['contract', OP1_CONTRACT],
  ['commitment', OP1.either],
] as const;

describe('AccessControl', () => {
  beforeEach(async () => {
    accessControl = await AccessControlSimulator.create();
  });

  describe('hasRole', () => {
    beforeEach(async () => {
      await accessControl._grantRole(OPERATOR_ROLE_1, OP1.either);
    });

    it('should return true when operator has a role', async () => {
      expect(await accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(
        true,
      );
    });

    it('should return false when unauthorized', async () => {
      expect(
        await accessControl.hasRole(OPERATOR_ROLE_1, UNAUTHORIZED.either),
      ).toBe(false);
    });

    it('should return false when role does not exist', async () => {
      expect(await accessControl.hasRole(UNINITIALIZED_ROLE, OP1.either)).toBe(
        false,
      );
    });

    it('should return true when queried with dirty Either (canonicalization)', async () => {
      const dirtyEither = {
        is_left: true,
        left: OP1.accountId,
        right: { bytes: new Uint8Array(32).fill(0xff) },
      };
      expect(await accessControl.hasRole(OPERATOR_ROLE_1, dirtyEither)).toBe(
        true,
      );
    });

    it('should return false when dirty Either has wrong accountId', async () => {
      const dirtyEither = {
        is_left: true,
        left: UNAUTHORIZED.accountId,
        right: { bytes: new Uint8Array(32).fill(0xff) },
      };
      expect(await accessControl.hasRole(OPERATOR_ROLE_1, dirtyEither)).toBe(
        false,
      );
    });

    it('should match hasRole with dirty left side on contract address', async () => {
      await accessControl._unsafeGrantRole(OPERATOR_ROLE_1, OP1_CONTRACT);

      const dirtyContract = {
        is_left: false,
        left: new Uint8Array(32).fill(0xff),
        right: OP1_CONTRACT.right,
      };
      expect(await accessControl.hasRole(OPERATOR_ROLE_1, dirtyContract)).toBe(
        true,
      );
    });
  });

  describe('assertOnlyRole', () => {
    beforeEach(async () => {
      await accessControl._grantRole(OPERATOR_ROLE_1, OP1.either);
    });

    it('should allow operator with role to call', async () => {
      // Set secret key for OP1
      await accessControl.privateState.injectSecretKey(OP1.secretKey);

      await accessControl.assertOnlyRole(OPERATOR_ROLE_1);
    });

    it('should fail if caller is unauthorized', async () => {
      // Set bad secret key
      await accessControl.privateState.injectSecretKey(UNAUTHORIZED.secretKey);

      await expect(
        accessControl.assertOnlyRole(OPERATOR_ROLE_1),
      ).rejects.toThrow('AccessControl: unauthorized account');
    });

    it('should fail when contract address matches accountId bytes but is right variant', async () => {
      // Grant role to a contract address whose bytes match ADMIN's accountId
      const contractWithSameBytes = {
        is_left: false,
        left: zeroBytes,
        right: { bytes: ADMIN.accountId },
      };

      await accessControl._unsafeGrantRole(
        OPERATOR_ROLE_1,
        contractWithSameBytes,
      );
      expect(
        await accessControl.hasRole(OPERATOR_ROLE_1, contractWithSameBytes),
      ).toBe(true);

      // ADMIN's witness produces left(H(sk)) which has the same bytes
      // but is a different Either variant than the granted role
      await accessControl.privateState.injectSecretKey(ADMIN.secretKey);
      await expect(
        accessControl.assertOnlyRole(OPERATOR_ROLE_1),
      ).rejects.toThrow('AccessControl: unauthorized account');
    });
  });

  describe('_checkRole', () => {
    beforeEach(async () => {
      await accessControl._grantRole(OPERATOR_ROLE_1, OP1.either);
      await accessControl._unsafeGrantRole(OPERATOR_ROLE_1, OP1_CONTRACT);
    });

    it('should not fail if user has role', async () => {
      expect(await accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(
        true,
      );

      await accessControl._checkRole(OPERATOR_ROLE_1, OP1.either);
    });

    it('should not fail if contract has role', async () => {
      expect(await accessControl.hasRole(OPERATOR_ROLE_1, OP1_CONTRACT)).toBe(
        true,
      );

      await accessControl._checkRole(OPERATOR_ROLE_1, OP1_CONTRACT);
    });

    it('should fail if operator is unauthorized', async () => {
      await expect(
        accessControl._checkRole(OPERATOR_ROLE_1, UNAUTHORIZED.either),
      ).rejects.toThrow('AccessControl: unauthorized account');
    });
  });

  describe('DEFAULT_ADMIN_ROLE', () => {
    it('should return zero bytes', async () => {
      expect(await accessControl.DEFAULT_ADMIN_ROLE()).toEqual(
        DEFAULT_ADMIN_ROLE,
      );
    });
  });

  describe('getRoleAdmin', () => {
    it('should return default admin role if admin role not set', async () => {
      expect(await accessControl.getRoleAdmin(OPERATOR_ROLE_1)).toEqual(
        DEFAULT_ADMIN_ROLE,
      );
    });

    it('should return custom admin role if set', async () => {
      await accessControl._setRoleAdmin(OPERATOR_ROLE_1, CUSTOM_ADMIN_ROLE);
      expect(await accessControl.getRoleAdmin(OPERATOR_ROLE_1)).toEqual(
        CUSTOM_ADMIN_ROLE,
      );
    });
  });

  describe('grantRole', () => {
    beforeEach(async () => {
      await accessControl._grantRole(DEFAULT_ADMIN_ROLE, ADMIN.either);
    });

    it('admin should grant role', async () => {
      // Set admin SK
      await accessControl.privateState.injectSecretKey(ADMIN.secretKey);

      await accessControl.grantRole(OPERATOR_ROLE_1, OP1.either);
      expect(await accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(
        true,
      );
    });

    it('admin should grant multiple roles', async () => {
      // Set admin SK
      await accessControl.privateState.injectSecretKey(ADMIN.secretKey);

      for (let i = 0; i < operatorRolesList.length; i++) {
        for (let j = 0; j < commitmentOperators.length; j++) {
          await accessControl.grantRole(
            operatorRolesList[i],
            commitmentOperators[j],
          );
          expect(
            await accessControl.hasRole(
              operatorRolesList[i],
              commitmentOperators[j],
            ),
          ).toBe(true);
        }
      }
    });

    it('should fail if unauthorized grants role', async () => {
      // Set unauthorized SK
      await accessControl.privateState.injectSecretKey(UNAUTHORIZED.secretKey);

      await expect(
        accessControl.grantRole(OPERATOR_ROLE_1, OP1.either),
      ).rejects.toThrow('AccessControl: unauthorized account');
    });

    it('should fail if operator grants role', async () => {
      // Set admin SK
      await accessControl.privateState.injectSecretKey(ADMIN.secretKey);
      await accessControl.grantRole(OPERATOR_ROLE_1, OP1.either);

      // Set OP1 SK
      await accessControl.privateState.injectSecretKey(OP1.secretKey);

      await expect(
        accessControl.grantRole(OPERATOR_ROLE_1, OP2.either),
      ).rejects.toThrow('AccessControl: unauthorized account');
    });

    it('should fail if admin grants role to ContractAddress', async () => {
      // Set admin SK
      await accessControl.privateState.injectSecretKey(ADMIN.secretKey);

      await expect(
        accessControl.grantRole(OPERATOR_ROLE_1, OP1_CONTRACT),
      ).rejects.toThrow('AccessControl: unsafe role approval');
    });

    it('admin should not be able to grant after self-revocation', async () => {
      // Set admin SK
      await accessControl.privateState.injectSecretKey(ADMIN.secretKey);

      await accessControl.revokeRole(DEFAULT_ADMIN_ROLE, ADMIN.either);

      await expect(
        accessControl.grantRole(OPERATOR_ROLE_1, OP1.either),
      ).rejects.toThrow('AccessControl: unauthorized account');
    });

    it('admin should not be able to grant after renouncing role', async () => {
      // Set admin SK
      await accessControl.privateState.injectSecretKey(ADMIN.secretKey);

      await accessControl.renounceRole(DEFAULT_ADMIN_ROLE, ADMIN.either);

      await expect(
        accessControl.grantRole(OPERATOR_ROLE_1, OP1.either),
      ).rejects.toThrow('AccessControl: unauthorized account');
    });

    it('admin authority should not be transitive across role hierarchies', async () => {
      await accessControl._setRoleAdmin(OPERATOR_ROLE_2, OPERATOR_ROLE_1);
      await accessControl._grantRole(OPERATOR_ROLE_1, OP1.either);

      await accessControl.privateState.injectSecretKey(ADMIN.secretKey);

      // ADMIN holds DEFAULT_ADMIN_ROLE but not OPERATOR_ROLE_1
      await expect(
        accessControl.grantRole(OPERATOR_ROLE_2, OP2.either),
      ).rejects.toThrow('AccessControl: unauthorized account');

      // OP1 holds OPERATOR_ROLE_1 which is admin of OPERATOR_ROLE_2
      await accessControl.privateState.injectSecretKey(OP1.secretKey);
      await accessControl.grantRole(OPERATOR_ROLE_2, OP2.either);
    });

    it('admin should re-grant a role after revoking it', async () => {
      await accessControl.privateState.injectSecretKey(ADMIN.secretKey);

      await accessControl.grantRole(OPERATOR_ROLE_1, OP1.either);
      expect(await accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(
        true,
      );

      await accessControl.revokeRole(OPERATOR_ROLE_1, OP1.either);
      expect(await accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(
        false,
      );

      await accessControl.grantRole(OPERATOR_ROLE_1, OP1.either);
      expect(await accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(
        true,
      );
    });

    it('should be idempotent when granting an already-held role', async () => {
      await accessControl.privateState.injectSecretKey(ADMIN.secretKey);

      await accessControl.grantRole(OPERATOR_ROLE_1, OP1.either);
      expect(await accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(
        true,
      );

      // Second grant should not throw or corrupt state
      await accessControl.grantRole(OPERATOR_ROLE_1, OP1.either);
      expect(await accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(
        true,
      );

      // Revoke should still work normally after double-grant
      await accessControl.revokeRole(OPERATOR_ROLE_1, OP1.either);
      expect(await accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(
        false,
      );
    });

    it.each(zeroKeyAccounts)(
      'should fail if admin grants role to the %s',
      async (_, account) => {
        await accessControl.privateState.injectSecretKey(ADMIN.secretKey);

        await expect(
          accessControl.grantRole(OPERATOR_ROLE_1, account),
        ).rejects.toThrow('AccessControl: invalid account');
        expect(await accessControl.hasRole(OPERATOR_ROLE_1, account)).toBe(
          false,
        );
      },
    );
  });

  describe('revokeRole', () => {
    beforeEach(async () => {
      await accessControl._grantRole(DEFAULT_ADMIN_ROLE, ADMIN.either);
      await accessControl._grantRole(OPERATOR_ROLE_1, OP1.either);
      await accessControl._unsafeGrantRole(OPERATOR_ROLE_1, OP1_CONTRACT);
    });

    describe.each(operatorTypes)(
      'when the operator is a %s',
      (_operatorType, _operator) => {
        it('admin should revoke role', async () => {
          // Set admin SK
          await accessControl.privateState.injectSecretKey(ADMIN.secretKey);

          await accessControl.revokeRole(OPERATOR_ROLE_1, _operator);
          expect(await accessControl.hasRole(OPERATOR_ROLE_1, _operator)).toBe(
            false,
          );
        });
      },
    );

    it('should fail if unauthorized revokes role', async () => {
      await accessControl.privateState.injectSecretKey(UNAUTHORIZED.secretKey);

      await expect(
        accessControl.revokeRole(OPERATOR_ROLE_1, OP1.either),
      ).rejects.toThrow('AccessControl: unauthorized account');
    });

    it('should fail if operator revokes role', async () => {
      await accessControl.privateState.injectSecretKey(OP1.secretKey);

      await expect(
        accessControl.revokeRole(OPERATOR_ROLE_1, OP2.either),
      ).rejects.toThrow('AccessControl: unauthorized account');
    });

    it('admin should revoke multiple roles', async () => {
      await accessControl.privateState.injectSecretKey(ADMIN.secretKey);

      for (let i = 0; i < operatorRolesList.length; i++) {
        for (let j = 0; j < allOperators.length; j++) {
          await accessControl._unsafeGrantRole(
            operatorRolesList[i],
            allOperators[j],
          );
          await accessControl.revokeRole(operatorRolesList[i], allOperators[j]);
          expect(
            await accessControl.hasRole(operatorRolesList[i], allOperators[j]),
          ).toBe(false);
        }
      }
    });

    it('should not corrupt state when revoking a never-granted role', async () => {
      await accessControl.privateState.injectSecretKey(ADMIN.secretKey);

      // Revoke a role that was never granted to OP2
      await accessControl.revokeRole(OPERATOR_ROLE_2, OP2.either);
      expect(await accessControl.hasRole(OPERATOR_ROLE_2, OP2.either)).toBe(
        false,
      );

      // Subsequent grant should still work
      await accessControl.grantRole(OPERATOR_ROLE_2, OP2.either);
      expect(await accessControl.hasRole(OPERATOR_ROLE_2, OP2.either)).toBe(
        true,
      );
    });
  });

  describe('renounceRole', () => {
    beforeEach(async () => {
      await accessControl._grantRole(OPERATOR_ROLE_1, OP1.either);
    });

    it('should allow operator to renounce own role', async () => {
      await accessControl.privateState.injectSecretKey(OP1.secretKey);

      await accessControl.renounceRole(OPERATOR_ROLE_1, OP1.either);
      expect(await accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(
        false,
      );
    });

    // Should be refactored with c2c
    it('should fail when renouncing as a ContractAddress', async () => {
      await accessControl._unsafeGrantRole(OPERATOR_ROLE_1, OP1_CONTRACT);

      await accessControl.privateState.injectSecretKey(ADMIN.secretKey);

      await expect(
        accessControl.renounceRole(OPERATOR_ROLE_1, OP1_CONTRACT),
      ).rejects.toThrow('AccessControl: bad confirmation');
    });

    it('should fail when unauthorized renounces role', async () => {
      await accessControl.privateState.injectSecretKey(UNAUTHORIZED.secretKey);

      await expect(
        accessControl.renounceRole(OPERATOR_ROLE_1, OP1.either),
      ).rejects.toThrow('AccessControl: bad confirmation');
    });

    it('should not fail when renouncing a role not held', async () => {
      await accessControl.privateState.injectSecretKey(OP1.secretKey);
      // Confirm role not already held
      expect(await accessControl.hasRole(OPERATOR_ROLE_3, OP1.either)).toBe(
        false,
      );

      await accessControl.renounceRole(OPERATOR_ROLE_3, OP1.either);
      expect(await accessControl.hasRole(OPERATOR_ROLE_3, OP1.either)).toBe(
        false,
      );
    });
  });

  describe('_setRoleAdmin', () => {
    beforeEach(async () => {
      await accessControl._setRoleAdmin(OPERATOR_ROLE_1, CUSTOM_ADMIN_ROLE);
    });

    it('should set role admin', async () => {
      expect(await accessControl.getRoleAdmin(OPERATOR_ROLE_1)).toEqual(
        CUSTOM_ADMIN_ROLE,
      );
    });

    it('should set multiple role admins', async () => {
      await accessControl._setRoleAdmin(OPERATOR_ROLE_2, CUSTOM_ADMIN_ROLE);
      await accessControl._setRoleAdmin(OPERATOR_ROLE_3, CUSTOM_ADMIN_ROLE);

      expect(await accessControl.getRoleAdmin(OPERATOR_ROLE_1)).toEqual(
        CUSTOM_ADMIN_ROLE,
      );
      expect(await accessControl.getRoleAdmin(OPERATOR_ROLE_2)).toEqual(
        CUSTOM_ADMIN_ROLE,
      );
      expect(await accessControl.getRoleAdmin(OPERATOR_ROLE_3)).toEqual(
        CUSTOM_ADMIN_ROLE,
      );
    });

    it('should authorize new admin to grant / revoke roles', async () => {
      await accessControl._grantRole(CUSTOM_ADMIN_ROLE, CUSTOM_ADMIN.either);
      await accessControl._setRoleAdmin(OPERATOR_ROLE_1, CUSTOM_ADMIN_ROLE);

      // Set custom admin SK
      await accessControl.privateState.injectSecretKey(CUSTOM_ADMIN.secretKey);

      // Grant role and check it's been granted
      await accessControl.grantRole(OPERATOR_ROLE_1, OP1.either);
      expect(await accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(
        true,
      );

      // Revoke role and check it's been revoked
      await accessControl.revokeRole(OPERATOR_ROLE_1, OP1.either);
      expect(await accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(
        false,
      );
    });

    it('should disallow previous admin from granting / revoking roles', async () => {
      await accessControl._grantRole(DEFAULT_ADMIN_ROLE, ADMIN.either);
      await accessControl._grantRole(CUSTOM_ADMIN_ROLE, CUSTOM_ADMIN.either);
      await accessControl._setRoleAdmin(OPERATOR_ROLE_1, CUSTOM_ADMIN_ROLE);

      // Set init admin
      await accessControl.privateState.injectSecretKey(ADMIN.secretKey);

      await expect(
        accessControl.grantRole(OPERATOR_ROLE_1, OP1.either),
      ).rejects.toThrow('AccessControl: unauthorized account');

      await expect(
        accessControl.revokeRole(OPERATOR_ROLE_1, OP1.either),
      ).rejects.toThrow('AccessControl: unauthorized account');
    });

    it('should allow overwriting admin role and transfer authority', async () => {
      const NEW_ADMIN_ROLE = convertBigintToBytes(32, 99n, '');
      const NEW_ADMIN = makeUser('NEW_ADMIN');

      await accessControl._grantRole(CUSTOM_ADMIN_ROLE, CUSTOM_ADMIN.either);
      await accessControl._grantRole(NEW_ADMIN_ROLE, NEW_ADMIN.either);
      await accessControl._setRoleAdmin(OPERATOR_ROLE_1, CUSTOM_ADMIN_ROLE);

      // CUSTOM_ADMIN can grant
      await accessControl.privateState.injectSecretKey(CUSTOM_ADMIN.secretKey);
      await accessControl.grantRole(OPERATOR_ROLE_1, OP1.either);

      // Overwrite admin role
      await accessControl._setRoleAdmin(OPERATOR_ROLE_1, NEW_ADMIN_ROLE);

      // CUSTOM_ADMIN should lose authority
      await expect(
        accessControl.grantRole(OPERATOR_ROLE_1, OP2.either),
      ).rejects.toThrow('AccessControl: unauthorized account');

      // NEW_ADMIN should gain authority
      await accessControl.privateState.injectSecretKey(NEW_ADMIN.secretKey);
      await accessControl.grantRole(OPERATOR_ROLE_1, OP2.either);
    });
  });

  describe('_grantRole', () => {
    it('should grant role', async () => {
      expect(await accessControl._grantRole(OPERATOR_ROLE_1, OP1.either)).toBe(
        true,
      );
      expect(await accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(
        true,
      );
    });

    it('should return false if hasRole already', async () => {
      expect(await accessControl._grantRole(OPERATOR_ROLE_1, OP1.either)).toBe(
        true,
      );
      expect(await accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(
        true,
      );

      expect(await accessControl._grantRole(OPERATOR_ROLE_1, OP1.either)).toBe(
        false,
      );
      expect(await accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(
        true,
      );
    });

    // Should be refactored with c2c
    it('should fail to grant role to a ContractAddress', async () => {
      await expect(
        accessControl._grantRole(OPERATOR_ROLE_1, OP1_CONTRACT),
      ).rejects.toThrow('AccessControl: unsafe role approval');
    });

    it('should grant multiple roles', async () => {
      for (let i = 0; i < operatorRolesList.length; i++) {
        for (let j = 0; j < commitmentOperators.length; j++) {
          await accessControl._grantRole(
            operatorRolesList[i],
            commitmentOperators[j],
          );
          expect(
            await accessControl.hasRole(
              operatorRolesList[i],
              commitmentOperators[j],
            ),
          ).toBe(true);
        }
      }
    });

    it('should allow regranting a revoked role', async () => {
      await accessControl._grantRole(OPERATOR_ROLE_1, OP1.either);
      await accessControl._revokeRole(OPERATOR_ROLE_1, OP1.either);
      expect(await accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(
        false,
      );

      expect(await accessControl._grantRole(OPERATOR_ROLE_1, OP1.either)).toBe(
        true,
      );
      expect(await accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(
        true,
      );
    });

    it.each(zeroKeyAccounts)(
      'should fail to grant role to the %s',
      async (_, account) => {
        await expect(
          accessControl._grantRole(OPERATOR_ROLE_1, account),
        ).rejects.toThrow('AccessControl: invalid account');
        expect(await accessControl.hasRole(OPERATOR_ROLE_1, account)).toBe(
          false,
        );
      },
    );
  });

  describe('_unsafeGrantRole', () => {
    it('should grant role', async () => {
      expect(
        await accessControl._unsafeGrantRole(OPERATOR_ROLE_1, OP1.either),
      ).toBe(true);
      expect(await accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(
        true,
      );
    });

    it('should return false if hasRole already', async () => {
      expect(
        await accessControl._unsafeGrantRole(OPERATOR_ROLE_1, OP1.either),
      ).toBe(true);
      expect(await accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(
        true,
      );

      expect(
        await accessControl._unsafeGrantRole(OPERATOR_ROLE_1, OP1.either),
      ).toBe(false);
      expect(await accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(
        true,
      );
    });

    // Should be refactored with c2c
    it('should grant role to a ContractAddress', async () => {
      expect(
        await accessControl._unsafeGrantRole(OPERATOR_ROLE_1, OP1_CONTRACT),
      ).toBe(true);
      expect(await accessControl.hasRole(OPERATOR_ROLE_1, OP1_CONTRACT)).toBe(
        true,
      );
    });

    it('should grant multiple roles', async () => {
      for (let i = 0; i < operatorRolesList.length; i++) {
        for (let j = 0; j < allOperators.length; j++) {
          expect(
            await accessControl._unsafeGrantRole(
              operatorRolesList[i],
              allOperators[j],
            ),
          ).toBe(true);
          expect(
            await accessControl.hasRole(operatorRolesList[i], allOperators[j]),
          ).toBe(true);
        }
      }
    });

    it('should match on subsequent hasRole with clean Either after dirty grant', async () => {
      const dirtyEither = {
        is_left: true,
        left: OP2.accountId,
        right: { bytes: new Uint8Array(32).fill(0xff) },
      };
      await accessControl._unsafeGrantRole(OPERATOR_ROLE_1, dirtyEither);

      // Clean Either should find the role
      expect(await accessControl.hasRole(OPERATOR_ROLE_1, OP2.either)).toBe(
        true,
      );
    });

    it('should match on subsequent hasRole with dirty Either after clean grant', async () => {
      await accessControl._unsafeGrantRole(OPERATOR_ROLE_1, OP2.either);

      const dirtyEither = {
        is_left: true,
        left: OP2.accountId,
        right: { bytes: new Uint8Array(32).fill(0xff) },
      };
      expect(await accessControl.hasRole(OPERATOR_ROLE_1, dirtyEither)).toBe(
        true,
      );
    });

    it('should return false for duplicate grant with dirty Either', async () => {
      // Init granted role
      await accessControl._unsafeGrantRole(OPERATOR_ROLE_1, OP1.either);

      const dirtyEither = {
        is_left: true,
        left: OP1.accountId,
        right: { bytes: new Uint8Array(32).fill(0xff) },
      };

      // Dirty Either should still detect the existing grant
      expect(
        await accessControl._unsafeGrantRole(OPERATOR_ROLE_1, dirtyEither),
      ).toBe(false);
    });

    it.each(zeroAccounts)(
      'should fail to grant role to the %s',
      async (_, account) => {
        await expect(
          accessControl._unsafeGrantRole(OPERATOR_ROLE_1, account),
        ).rejects.toThrow('AccessControl: invalid account');
        expect(await accessControl.hasRole(OPERATOR_ROLE_1, account)).toBe(
          false,
        );
      },
    );
  });

  describe('_revokeRole', () => {
    describe.each(operatorTypes)(
      'when the operator is a %s',
      (_, _operator) => {
        it('should revoke role', async () => {
          await accessControl._unsafeGrantRole(OPERATOR_ROLE_1, _operator);
          expect(
            await accessControl._revokeRole(OPERATOR_ROLE_1, _operator),
          ).toBe(true);
          expect(await accessControl.hasRole(OPERATOR_ROLE_1, _operator)).toBe(
            false,
          );
        });
      },
    );

    it('should return false if account does not have role', async () => {
      expect(await accessControl._revokeRole(OPERATOR_ROLE_1, OP1.either)).toBe(
        false,
      );
    });

    it('should revoke multiple roles', async () => {
      for (let i = 0; i < operatorRolesList.length; i++) {
        for (let j = 0; j < allOperators.length; j++) {
          await accessControl._unsafeGrantRole(
            operatorRolesList[i],
            allOperators[j],
          );
          expect(
            await accessControl._revokeRole(
              operatorRolesList[i],
              allOperators[j],
            ),
          ).toBe(true);
          expect(
            await accessControl.hasRole(operatorRolesList[i], allOperators[j]),
          ).toBe(false);
        }
      }
    });

    it('should revoke with dirty Either after clean grant', async () => {
      await accessControl._unsafeGrantRole(OPERATOR_ROLE_1, OP1.either);

      const dirtyEither = {
        is_left: true,
        left: OP1.accountId,
        right: { bytes: new Uint8Array(32).fill(0xff) },
      };

      expect(
        await accessControl._revokeRole(OPERATOR_ROLE_1, dirtyEither),
      ).toBe(true);
      expect(await accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(
        false,
      );
    });

    it('should return false when revoking ungranted role with dirty Either', async () => {
      const dirtyEither = {
        is_left: true,
        left: OP2.accountId,
        right: { bytes: new Uint8Array(32).fill(0xff) },
      };
      expect(
        await accessControl._revokeRole(OPERATOR_ROLE_1, dirtyEither),
      ).toBe(false);
    });

    it('should revoke with dirty left side on contract address', async () => {
      await accessControl._unsafeGrantRole(OPERATOR_ROLE_1, OP1_CONTRACT);

      const dirtyContract = {
        is_left: false,
        left: new Uint8Array(32).fill(0xff),
        right: OP1_CONTRACT.right,
      };
      expect(
        await accessControl._revokeRole(OPERATOR_ROLE_1, dirtyContract),
      ).toBe(true);
      expect(await accessControl.hasRole(OPERATOR_ROLE_1, OP1_CONTRACT)).toBe(
        false,
      );
    });
  });

  describe('privateState helpers', () => {
    describe('getCurrentSecretKey', () => {
      it('should return the injected secret key', async () => {
        await accessControl.privateState.injectSecretKey(ADMIN.secretKey);

        expect(await accessControl.privateState.getCurrentSecretKey()).toEqual(
          ADMIN.secretKey,
        );
      });

      it('should throw when the secret key is undefined', async () => {
        const sim = await AccessControlSimulator.create({
          privateState: { secretKey: undefined as unknown as Uint8Array },
        });

        await expect(sim.privateState.getCurrentSecretKey()).rejects.toThrow(
          'Missing secret key',
        );
      });
    });

    it('should expose an empty public ledger via getPublicState', async () => {
      expect(await accessControl.getPublicState()).toStrictEqual({});
    });
  });
});

// The base mock authenticates through `AuthPrfPseudonym`, which yields only
// canonical, non-zero key identifiers. This mock takes the caller as an
// argument, so a spec can act as any account.
describe('AccessControl: abnormal callers', () => {
  const DIRT = new Uint8Array(32).fill(0xff);

  const keyAccount = (key: Uint8Array, right: Uint8Array = zeroBytes) => ({
    is_left: true,
    left: key,
    right: { bytes: right },
  });

  const contractAccount = (address: Uint8Array) => ({
    is_left: false,
    left: zeroBytes,
    right: { bytes: address },
  });

  const callerOf = (account: Caller['account']): Caller => ({ account });

  const ADMIN_KEY = new Uint8Array(32).fill(1);
  const OPERATOR_KEY = new Uint8Array(32).fill(2);

  const ADMIN_ACCOUNT = keyAccount(ADMIN_KEY);
  const OPERATOR_ACCOUNT = keyAccount(OPERATOR_KEY);
  const OTHER_ACCOUNT = keyAccount(new Uint8Array(32).fill(3));
  const CONTRACT_ACCOUNT = contractAccount(new Uint8Array(32).fill(4));

  const ROLE = new Uint8Array(32).fill(0xaa);

  // Each role with the account `grantRoles` grants it to.
  const roles = [
    ['DEFAULT_ADMIN_ROLE', DEFAULT_ADMIN_ROLE, ADMIN_ACCOUNT],
    ['a role', ROLE, OPERATOR_ACCOUNT],
  ] as const;

  const UNAUTHORIZED_ERROR = 'AccessControl: unauthorized account';

  let accessControlCaller: AccessControlCallerSimulator;

  const grantRoles = async () => {
    await accessControlCaller._grantRole(DEFAULT_ADMIN_ROLE, ADMIN_ACCOUNT);
    await accessControlCaller._grantRole(ROLE, OPERATOR_ACCOUNT);
  };

  const setups = [
    ['no role is granted', async () => {}],
    ['other accounts hold roles', grantRoles],
  ] as const;

  beforeEach(async () => {
    accessControlCaller = await AccessControlCallerSimulator.create();
  });

  describe.each(zeroAccounts)('when the caller is the %s', (_, account) => {
    const caller = callerOf(account);

    describe.each(setups)('and %s', (_, setup) => {
      beforeEach(setup);

      it.each(roles)(
        'should reject it in assertOnlyRole for %s',
        async (_, roleId) => {
          await expect(
            accessControlCaller.assertOnlyRole(caller, roleId),
          ).rejects.toThrow(UNAUTHORIZED_ERROR);
        },
      );

      it.each(roles)(
        'should reject it in grantRole for %s',
        async (_, roleId) => {
          await expect(
            accessControlCaller.grantRole(caller, roleId, OTHER_ACCOUNT),
          ).rejects.toThrow(UNAUTHORIZED_ERROR);
          expect(await accessControlCaller.hasRole(roleId, OTHER_ACCOUNT)).toBe(
            false,
          );
        },
      );

      it.each(roles)(
        'should reject it in revokeRole for %s',
        async (_, roleId, holder) => {
          const held = await accessControlCaller.hasRole(roleId, holder);
          await expect(
            accessControlCaller.revokeRole(caller, roleId, holder),
          ).rejects.toThrow(UNAUTHORIZED_ERROR);
          expect(await accessControlCaller.hasRole(roleId, holder)).toBe(held);
        },
      );

      it.each(roles)(
        'should change nothing in renounceRole for %s',
        async (_, roleId, holder) => {
          const held = await accessControlCaller.hasRole(roleId, holder);
          await accessControlCaller.renounceRole(caller, roleId, account);
          expect(await accessControlCaller.hasRole(roleId, holder)).toBe(held);
          expect(await accessControlCaller.hasRole(roleId, account)).toBe(
            false,
          );
        },
      );
    });
  });

  describe('when the caller account is not canonical', () => {
    const operator = callerOf(keyAccount(OPERATOR_KEY, DIRT));

    beforeEach(grantRoles);

    it('should pass assertOnlyRole as its active arm', async () => {
      await accessControlCaller.assertOnlyRole(operator, ROLE);
    });

    it('should pass grantRole as its active arm', async () => {
      await accessControlCaller.grantRole(
        callerOf(keyAccount(ADMIN_KEY, DIRT)),
        ROLE,
        OTHER_ACCOUNT,
      );
      expect(await accessControlCaller.hasRole(ROLE, OTHER_ACCOUNT)).toBe(true);
    });

    it('should reject renounceRole with the canonical account as confirmation', async () => {
      await expect(
        accessControlCaller.renounceRole(operator, ROLE, OPERATOR_ACCOUNT),
      ).rejects.toThrow('AccessControl: bad confirmation');
      expect(await accessControlCaller.hasRole(ROLE, OPERATOR_ACCOUNT)).toBe(
        true,
      );
    });

    it('should revoke the canonical account in renounceRole with its own account as confirmation', async () => {
      await accessControlCaller.renounceRole(operator, ROLE, operator.account);
      expect(await accessControlCaller.hasRole(ROLE, OPERATOR_ACCOUNT)).toBe(
        false,
      );
    });
  });

  describe('when the caller is a contract', () => {
    const contract = callerOf(CONTRACT_ACCOUNT);

    beforeEach(grantRoles);

    it('should reject it in assertOnlyRole before a grant', async () => {
      await expect(
        accessControlCaller.assertOnlyRole(contract, ROLE),
      ).rejects.toThrow(UNAUTHORIZED_ERROR);
    });

    it('should pass assertOnlyRole for a role granted through _unsafeGrantRole', async () => {
      await accessControlCaller._unsafeGrantRole(ROLE, CONTRACT_ACCOUNT);
      await accessControlCaller.assertOnlyRole(contract, ROLE);
    });

    it('should reject it in assertOnlyRole for a role it was not granted', async () => {
      await accessControlCaller._unsafeGrantRole(ROLE, CONTRACT_ACCOUNT);
      await expect(
        accessControlCaller.assertOnlyRole(contract, DEFAULT_ADMIN_ROLE),
      ).rejects.toThrow(UNAUTHORIZED_ERROR);
    });
  });
});
