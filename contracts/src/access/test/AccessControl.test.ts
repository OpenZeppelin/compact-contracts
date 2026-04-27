import {
  CompactTypeBytes,
  CompactTypeVector,
  convertFieldToBytes,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import { AccessControlSimulator } from './simulators/AccessControlSimulator.js';

// Helpers
const buildAccountIdHash = (sk: Uint8Array): Uint8Array => {
  const rt_type = new CompactTypeVector(1, new CompactTypeBytes(32));
  return persistentHash(rt_type, [sk]);
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
const OPERATOR_ROLE_1 = convertFieldToBytes(32, 1n, '');
const OPERATOR_ROLE_2 = convertFieldToBytes(32, 2n, '');
const OPERATOR_ROLE_3 = convertFieldToBytes(32, 3n, '');
const CUSTOM_ADMIN_ROLE = convertFieldToBytes(32, 4n, '');
const UNINITIALIZED_ROLE = convertFieldToBytes(32, 5n, '');

// Lists
const operatorRolesList = [OPERATOR_ROLE_1, OPERATOR_ROLE_2];
const commitmentOperators = [OP1.either, OP2.either, OP3.either];
const allOperators = [...commitmentOperators, OP1_CONTRACT];

let accessControl: AccessControlSimulator;

const operatorTypes = [
  ['contract', OP1_CONTRACT],
  ['commitment', OP1.either],
] as const;

describe('AccessControl', () => {
  beforeEach(() => {
    accessControl = new AccessControlSimulator();
  });

  describe('hasRole', () => {
    beforeEach(() => {
      accessControl._grantRole(OPERATOR_ROLE_1, OP1.either);
    });

    it('should return true when operator has a role', () => {
      expect(accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(true);
    });

    it('should return false when unauthorized', () => {
      expect(accessControl.hasRole(OPERATOR_ROLE_1, UNAUTHORIZED.either)).toBe(
        false,
      );
    });

    it('should return false when role does not exist', () => {
      expect(accessControl.hasRole(UNINITIALIZED_ROLE, OP1.either)).toBe(false);
    });

    it('should return true when queried with dirty Either (canonicalization)', () => {
      const dirtyEither = {
        is_left: true,
        left: OP1.accountId,
        right: { bytes: new Uint8Array(32).fill(0xff) },
      };
      expect(accessControl.hasRole(OPERATOR_ROLE_1, dirtyEither)).toBe(true);
    });

    it('should return false when dirty Either has wrong accountId', () => {
      const dirtyEither = {
        is_left: true,
        left: UNAUTHORIZED.accountId,
        right: { bytes: new Uint8Array(32).fill(0xff) },
      };
      expect(accessControl.hasRole(OPERATOR_ROLE_1, dirtyEither)).toBe(false);
    });

    it('should match hasRole with dirty left side on contract address', () => {
      accessControl._unsafeGrantRole(OPERATOR_ROLE_1, OP1_CONTRACT);

      const dirtyContract = {
        is_left: false,
        left: new Uint8Array(32).fill(0xff),
        right: OP1_CONTRACT.right,
      };
      expect(accessControl.hasRole(OPERATOR_ROLE_1, dirtyContract)).toBe(true);
    });
  });

  describe('assertOnlyRole', () => {
    beforeEach(() => {
      accessControl._grantRole(OPERATOR_ROLE_1, OP1.either);
    });

    it('should allow operator with role to call', () => {
      // Set secret key for OP1
      accessControl.privateState.injectSecretKey(OP1.secretKey);

      expect(() => accessControl.assertOnlyRole(OPERATOR_ROLE_1)).not.toThrow();
    });

    it('should fail if caller is unauthorized', () => {
      // Set bad secret key
      accessControl.privateState.injectSecretKey(UNAUTHORIZED.secretKey);

      expect(() => accessControl.assertOnlyRole(OPERATOR_ROLE_1)).toThrow(
        'AccessControl: unauthorized account',
      );
    });
  });

  describe('_checkRole', () => {
    beforeEach(() => {
      accessControl._grantRole(OPERATOR_ROLE_1, OP1.either);
      accessControl._unsafeGrantRole(OPERATOR_ROLE_1, OP1_CONTRACT);
    });

    it('should not fail if user has role', () => {
      expect(accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(true);

      expect(() =>
        accessControl._checkRole(OPERATOR_ROLE_1, OP1.either),
      ).not.toThrow();
    });

    it('should not fail if contract has role', () => {
      expect(accessControl.hasRole(OPERATOR_ROLE_1, OP1_CONTRACT)).toBe(true);

      expect(() =>
        accessControl._checkRole(OPERATOR_ROLE_1, OP1_CONTRACT),
      ).not.toThrow();
    });

    it('should fail if operator is unauthorized', () => {
      expect(() =>
        accessControl._checkRole(OPERATOR_ROLE_1, UNAUTHORIZED.either),
      ).toThrow('AccessControl: unauthorized account');
    });
  });

  describe('DEFAULT_ADMIN_ROLE', () => {
    it('should return zero bytes', () => {
      expect(accessControl.DEFAULT_ADMIN_ROLE()).toEqual(DEFAULT_ADMIN_ROLE);
    });
  });

  describe('getRoleAdmin', () => {
    it('should return default admin role if admin role not set', () => {
      expect(accessControl.getRoleAdmin(OPERATOR_ROLE_1)).toEqual(
        DEFAULT_ADMIN_ROLE,
      );
    });

    it('should return custom admin role if set', () => {
      accessControl._setRoleAdmin(OPERATOR_ROLE_1, CUSTOM_ADMIN_ROLE);
      expect(accessControl.getRoleAdmin(OPERATOR_ROLE_1)).toEqual(
        CUSTOM_ADMIN_ROLE,
      );
    });
  });

  describe('grantRole', () => {
    beforeEach(() => {
      accessControl._grantRole(DEFAULT_ADMIN_ROLE, ADMIN.either);
    });

    it('admin should grant role', () => {
      // Set admin SK
      accessControl.privateState.injectSecretKey(ADMIN.secretKey);

      accessControl.grantRole(OPERATOR_ROLE_1, OP1.either);
      expect(accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(true);
    });

    it('admin should grant multiple roles', () => {
      // Set admin SK
      accessControl.privateState.injectSecretKey(ADMIN.secretKey);

      for (let i = 0; i < operatorRolesList.length; i++) {
        for (let j = 0; j < commitmentOperators.length; j++) {
          accessControl.grantRole(operatorRolesList[i], commitmentOperators[j]);
          expect(
            accessControl.hasRole(operatorRolesList[i], commitmentOperators[j]),
          ).toBe(true);
        }
      }
    });

    it('should fail if unauthorized grants role', () => {
      // Set unauthorized SK
      accessControl.privateState.injectSecretKey(UNAUTHORIZED.secretKey);

      expect(() => {
        accessControl.grantRole(OPERATOR_ROLE_1, OP1.either);
      }).toThrow('AccessControl: unauthorized account');
    });

    it('should fail if operator grants role', () => {
      // Set admin SK
      accessControl.privateState.injectSecretKey(ADMIN.secretKey);
      accessControl.grantRole(OPERATOR_ROLE_1, OP1.either);

      // Set OP1 SK
      accessControl.privateState.injectSecretKey(OP1.secretKey);

      expect(() => {
        accessControl.grantRole(OPERATOR_ROLE_1, OP2.either);
      }).toThrow('AccessControl: unauthorized account');
    });

    it('should fail if admin grants role to ContractAddress', () => {
      // Set admin SK
      accessControl.privateState.injectSecretKey(ADMIN.secretKey);

      expect(() => {
        accessControl.grantRole(OPERATOR_ROLE_1, OP1_CONTRACT);
      }).toThrow('AccessControl: unsafe role approval');
    });

    it('admin should not be able to grant after self-revocation', () => {
      // Set admin SK
      accessControl.privateState.injectSecretKey(ADMIN.secretKey);

      accessControl.revokeRole(DEFAULT_ADMIN_ROLE, ADMIN.either);

      expect(() =>
        accessControl.grantRole(OPERATOR_ROLE_1, OP1.either),
      ).toThrow('AccessControl: unauthorized account');
    });

    it('admin should not be able to grant after renouncing role', () => {
      // Set admin SK
      accessControl.privateState.injectSecretKey(ADMIN.secretKey);

      accessControl.renounceRole(DEFAULT_ADMIN_ROLE, ADMIN.either);

      expect(() =>
        accessControl.grantRole(OPERATOR_ROLE_1, OP1.either),
      ).toThrow('AccessControl: unauthorized account');
    });

    it('admin authority should not be transitive across role hierarchies', () => {
      accessControl._setRoleAdmin(OPERATOR_ROLE_2, OPERATOR_ROLE_1);
      accessControl._grantRole(OPERATOR_ROLE_1, OP1.either);

      accessControl.privateState.injectSecretKey(ADMIN.secretKey);

      // ADMIN holds DEFAULT_ADMIN_ROLE but not OPERATOR_ROLE_1
      expect(() =>
        accessControl.grantRole(OPERATOR_ROLE_2, OP2.either),
      ).toThrow('AccessControl: unauthorized account');

      // OP1 holds OPERATOR_ROLE_1 which is admin of OPERATOR_ROLE_2
      accessControl.privateState.injectSecretKey(OP1.secretKey);
      expect(() =>
        accessControl.grantRole(OPERATOR_ROLE_2, OP2.either),
      ).not.toThrow();
    });

    it('admin should re-grant a role after revoking it', () => {
      accessControl.privateState.injectSecretKey(ADMIN.secretKey);

      accessControl.grantRole(OPERATOR_ROLE_1, OP1.either);
      expect(accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(true);

      accessControl.revokeRole(OPERATOR_ROLE_1, OP1.either);
      expect(accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(false);

      accessControl.grantRole(OPERATOR_ROLE_1, OP1.either);
      expect(accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(true);
    });

    it('should be idempotent when granting an already-held role', () => {
      accessControl.privateState.injectSecretKey(ADMIN.secretKey);

      accessControl.grantRole(OPERATOR_ROLE_1, OP1.either);
      expect(accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(true);

      // Second grant should not throw or corrupt state
      expect(() =>
        accessControl.grantRole(OPERATOR_ROLE_1, OP1.either),
      ).not.toThrow();
      expect(accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(true);

      // Revoke should still work normally after double-grant
      accessControl.revokeRole(OPERATOR_ROLE_1, OP1.either);
      expect(accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(false);
    });
  });

  describe('revokeRole', () => {
    beforeEach(() => {
      accessControl._grantRole(DEFAULT_ADMIN_ROLE, ADMIN.either);
      accessControl._grantRole(OPERATOR_ROLE_1, OP1.either);
      accessControl._unsafeGrantRole(OPERATOR_ROLE_1, OP1_CONTRACT);
    });

    describe.each(
      operatorTypes,
    )('when the operator is a %s', (_operatorType, _operator) => {
      it('admin should revoke role', () => {
        // Set admin SK
        accessControl.privateState.injectSecretKey(ADMIN.secretKey);

        accessControl.revokeRole(OPERATOR_ROLE_1, _operator);
        expect(accessControl.hasRole(OPERATOR_ROLE_1, _operator)).toBe(false);
      });
    });

    it('should fail if unauthorized revokes role', () => {
      accessControl.privateState.injectSecretKey(UNAUTHORIZED.secretKey);

      expect(() => {
        accessControl.revokeRole(OPERATOR_ROLE_1, OP1.either);
      }).toThrow('AccessControl: unauthorized account');
    });

    it('should fail if operator revokes role', () => {
      accessControl.privateState.injectSecretKey(OP1.secretKey);

      expect(() => {
        accessControl.revokeRole(OPERATOR_ROLE_1, OP2.either);
      }).toThrow('AccessControl: unauthorized account');
    });

    it('admin should revoke multiple roles', () => {
      accessControl.privateState.injectSecretKey(ADMIN.secretKey);

      for (let i = 0; i < operatorRolesList.length; i++) {
        for (let j = 0; j < allOperators.length; j++) {
          accessControl._unsafeGrantRole(operatorRolesList[i], allOperators[j]);
          accessControl.revokeRole(operatorRolesList[i], allOperators[j]);
          expect(
            accessControl.hasRole(operatorRolesList[i], allOperators[j]),
          ).toBe(false);
        }
      }
    });

    it('should not corrupt state when revoking a never-granted role', () => {
      accessControl.privateState.injectSecretKey(ADMIN.secretKey);

      // Revoke a role that was never granted to OP2
      accessControl.revokeRole(OPERATOR_ROLE_2, OP2.either);
      expect(accessControl.hasRole(OPERATOR_ROLE_2, OP2.either)).toBe(false);

      // Subsequent grant should still work
      accessControl.grantRole(OPERATOR_ROLE_2, OP2.either);
      expect(accessControl.hasRole(OPERATOR_ROLE_2, OP2.either)).toBe(true);
    });
  });

  describe('renounceRole', () => {
    beforeEach(() => {
      accessControl._grantRole(OPERATOR_ROLE_1, OP1.either);
    });

    it('should allow operator to renounce own role', () => {
      accessControl.privateState.injectSecretKey(OP1.secretKey);

      accessControl.renounceRole(OPERATOR_ROLE_1, OP1.either);
      expect(accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(false);
    });

    // Should be refactored with c2c
    it('should fail when renouncing as a ContractAddress', () => {
      accessControl._unsafeGrantRole(OPERATOR_ROLE_1, OP1_CONTRACT);

      accessControl.privateState.injectSecretKey(ADMIN.secretKey);

      expect(() => {
        accessControl.renounceRole(OPERATOR_ROLE_1, OP1_CONTRACT);
      }).toThrow('AccessControl: bad confirmation');
    });

    it('should fail when unauthorized renounces role', () => {
      accessControl.privateState.injectSecretKey(UNAUTHORIZED.secretKey);

      expect(() => {
        accessControl.renounceRole(OPERATOR_ROLE_1, OP1.either);
      }).toThrow('AccessControl: bad confirmation');
    });

    it('should not fail when renouncing a role not held', () => {
      accessControl.privateState.injectSecretKey(OP1.secretKey);
      // Confirm role not already held
      expect(accessControl.hasRole(OPERATOR_ROLE_3, OP1.either)).toBe(false);

      accessControl.renounceRole(OPERATOR_ROLE_3, OP1.either);
      expect(accessControl.hasRole(OPERATOR_ROLE_3, OP1.either)).toBe(false);
    });
  });

  describe('_setRoleAdmin', () => {
    beforeEach(() => {
      accessControl._setRoleAdmin(OPERATOR_ROLE_1, CUSTOM_ADMIN_ROLE);
    });

    it('should set role admin', () => {
      expect(accessControl.getRoleAdmin(OPERATOR_ROLE_1)).toEqual(
        CUSTOM_ADMIN_ROLE,
      );
    });

    it('should set multiple role admins', () => {
      accessControl._setRoleAdmin(OPERATOR_ROLE_2, CUSTOM_ADMIN_ROLE);
      accessControl._setRoleAdmin(OPERATOR_ROLE_3, CUSTOM_ADMIN_ROLE);

      expect(accessControl.getRoleAdmin(OPERATOR_ROLE_1)).toEqual(
        CUSTOM_ADMIN_ROLE,
      );
      expect(accessControl.getRoleAdmin(OPERATOR_ROLE_2)).toEqual(
        CUSTOM_ADMIN_ROLE,
      );
      expect(accessControl.getRoleAdmin(OPERATOR_ROLE_3)).toEqual(
        CUSTOM_ADMIN_ROLE,
      );
    });

    it('should authorize new admin to grant / revoke roles', () => {
      accessControl._grantRole(CUSTOM_ADMIN_ROLE, CUSTOM_ADMIN.either);
      accessControl._setRoleAdmin(OPERATOR_ROLE_1, CUSTOM_ADMIN_ROLE);

      // Set custom admin SK
      accessControl.privateState.injectSecretKey(CUSTOM_ADMIN.secretKey);

      // Grant role and check it's been granted
      expect(() =>
        accessControl.grantRole(OPERATOR_ROLE_1, OP1.either),
      ).not.toThrow();
      expect(accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(true);

      // Revoke role and check it's been revoked
      expect(() =>
        accessControl.revokeRole(OPERATOR_ROLE_1, OP1.either),
      ).not.toThrow();
      expect(accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(false);
    });

    it('should disallow previous admin from granting / revoking roles', () => {
      accessControl._grantRole(DEFAULT_ADMIN_ROLE, ADMIN.either);
      accessControl._grantRole(CUSTOM_ADMIN_ROLE, CUSTOM_ADMIN.either);
      accessControl._setRoleAdmin(OPERATOR_ROLE_1, CUSTOM_ADMIN_ROLE);

      // Set init admin
      accessControl.privateState.injectSecretKey(ADMIN.secretKey);

      expect(() => {
        accessControl.grantRole(OPERATOR_ROLE_1, OP1.either);
      }).toThrow('AccessControl: unauthorized account');

      expect(() => {
        accessControl.revokeRole(OPERATOR_ROLE_1, OP1.either);
      }).toThrow('AccessControl: unauthorized account');
    });

    it('should allow overwriting admin role and transfer authority', () => {
      const NEW_ADMIN_ROLE = convertFieldToBytes(32, 99n, '');
      const NEW_ADMIN = makeUser('NEW_ADMIN');

      accessControl._grantRole(CUSTOM_ADMIN_ROLE, CUSTOM_ADMIN.either);
      accessControl._grantRole(NEW_ADMIN_ROLE, NEW_ADMIN.either);
      accessControl._setRoleAdmin(OPERATOR_ROLE_1, CUSTOM_ADMIN_ROLE);

      // CUSTOM_ADMIN can grant
      accessControl.privateState.injectSecretKey(CUSTOM_ADMIN.secretKey);
      expect(() =>
        accessControl.grantRole(OPERATOR_ROLE_1, OP1.either),
      ).not.toThrow();

      // Overwrite admin role
      accessControl._setRoleAdmin(OPERATOR_ROLE_1, NEW_ADMIN_ROLE);

      // CUSTOM_ADMIN should lose authority
      expect(() =>
        accessControl.grantRole(OPERATOR_ROLE_1, OP2.either),
      ).toThrow('AccessControl: unauthorized account');

      // NEW_ADMIN should gain authority
      accessControl.privateState.injectSecretKey(NEW_ADMIN.secretKey);
      expect(() =>
        accessControl.grantRole(OPERATOR_ROLE_1, OP2.either),
      ).not.toThrow();
    });
  });

  describe('_grantRole', () => {
    it('should grant role', () => {
      expect(accessControl._grantRole(OPERATOR_ROLE_1, OP1.either)).toBe(true);
      expect(accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(true);
    });

    it('should return false if hasRole already', () => {
      expect(accessControl._grantRole(OPERATOR_ROLE_1, OP1.either)).toBe(true);
      expect(accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(true);

      expect(accessControl._grantRole(OPERATOR_ROLE_1, OP1.either)).toBe(false);
      expect(accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(true);
    });

    // Should be refactored with c2c
    it('should fail to grant role to a ContractAddress', () => {
      expect(() => {
        accessControl._grantRole(OPERATOR_ROLE_1, OP1_CONTRACT);
      }).toThrow('AccessControl: unsafe role approval');
    });

    it('should grant multiple roles', () => {
      for (let i = 0; i < operatorRolesList.length; i++) {
        for (let j = 0; j < commitmentOperators.length; j++) {
          accessControl._grantRole(
            operatorRolesList[i],
            commitmentOperators[j],
          );
          expect(
            accessControl.hasRole(operatorRolesList[i], commitmentOperators[j]),
          ).toBe(true);
        }
      }
    });

    it('should allow regranting a revoked role', () => {
      accessControl._grantRole(OPERATOR_ROLE_1, OP1.either);
      accessControl._revokeRole(OPERATOR_ROLE_1, OP1.either);
      expect(accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(false);

      expect(accessControl._grantRole(OPERATOR_ROLE_1, OP1.either)).toBe(true);
      expect(accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(true);
    });
  });

  describe('_unsafeGrantRole', () => {
    it('should grant role', () => {
      expect(accessControl._unsafeGrantRole(OPERATOR_ROLE_1, OP1.either)).toBe(
        true,
      );
      expect(accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(true);
    });

    it('should return false if hasRole already', () => {
      expect(accessControl._unsafeGrantRole(OPERATOR_ROLE_1, OP1.either)).toBe(
        true,
      );
      expect(accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(true);

      expect(accessControl._unsafeGrantRole(OPERATOR_ROLE_1, OP1.either)).toBe(
        false,
      );
      expect(accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(true);
    });

    // Should be refactored with c2c
    it('should grant role to a ContractAddress', () => {
      expect(
        accessControl._unsafeGrantRole(OPERATOR_ROLE_1, OP1_CONTRACT),
      ).toBe(true);
      expect(accessControl.hasRole(OPERATOR_ROLE_1, OP1_CONTRACT)).toBe(true);
    });

    it('should grant multiple roles', () => {
      for (let i = 0; i < operatorRolesList.length; i++) {
        for (let j = 0; j < allOperators.length; j++) {
          expect(
            accessControl._unsafeGrantRole(
              operatorRolesList[i],
              allOperators[j],
            ),
          ).toBe(true);
          expect(
            accessControl.hasRole(operatorRolesList[i], allOperators[j]),
          ).toBe(true);
        }
      }
    });

    it('should match on subsequent hasRole with clean Either after dirty grant', () => {
      const dirtyEither = {
        is_left: true,
        left: OP2.accountId,
        right: { bytes: new Uint8Array(32).fill(0xff) },
      };
      accessControl._unsafeGrantRole(OPERATOR_ROLE_1, dirtyEither);

      // Clean Either should find the role
      expect(accessControl.hasRole(OPERATOR_ROLE_1, OP2.either)).toBe(true);
    });

    it('should match on subsequent hasRole with dirty Either after clean grant', () => {
      accessControl._unsafeGrantRole(OPERATOR_ROLE_1, OP2.either);

      const dirtyEither = {
        is_left: true,
        left: OP2.accountId,
        right: { bytes: new Uint8Array(32).fill(0xff) },
      };
      expect(accessControl.hasRole(OPERATOR_ROLE_1, dirtyEither)).toBe(true);
    });

    it('should return false for duplicate grant with dirty Either', () => {
      // Init granted role
      accessControl._unsafeGrantRole(OPERATOR_ROLE_1, OP1.either);

      const dirtyEither = {
        is_left: true,
        left: OP1.accountId,
        right: { bytes: new Uint8Array(32).fill(0xff) },
      };

      // Dirty Either should still detect the existing grant
      expect(accessControl._unsafeGrantRole(OPERATOR_ROLE_1, dirtyEither)).toBe(
        false,
      );
    });
  });

  describe('_revokeRole', () => {
    describe.each(
      operatorTypes,
    )('when the operator is a %s', (_, _operator) => {
      it('should revoke role', () => {
        accessControl._unsafeGrantRole(OPERATOR_ROLE_1, _operator);
        expect(accessControl._revokeRole(OPERATOR_ROLE_1, _operator)).toBe(
          true,
        );
        expect(accessControl.hasRole(OPERATOR_ROLE_1, _operator)).toBe(false);
      });
    });

    it('should return false if account does not have role', () => {
      expect(accessControl._revokeRole(OPERATOR_ROLE_1, OP1.either)).toBe(
        false,
      );
    });

    it('should revoke multiple roles', () => {
      for (let i = 0; i < operatorRolesList.length; i++) {
        for (let j = 0; j < allOperators.length; j++) {
          accessControl._unsafeGrantRole(operatorRolesList[i], allOperators[j]);
          expect(
            accessControl._revokeRole(operatorRolesList[i], allOperators[j]),
          ).toBe(true);
          expect(
            accessControl.hasRole(operatorRolesList[i], allOperators[j]),
          ).toBe(false);
        }
      }
    });

    it('should revoke with dirty Either after clean grant', () => {
      accessControl._unsafeGrantRole(OPERATOR_ROLE_1, OP1.either);

      const dirtyEither = {
        is_left: true,
        left: OP1.accountId,
        right: { bytes: new Uint8Array(32).fill(0xff) },
      };

      expect(accessControl._revokeRole(OPERATOR_ROLE_1, dirtyEither)).toBe(
        true,
      );
      expect(accessControl.hasRole(OPERATOR_ROLE_1, OP1.either)).toBe(false);
    });

    it('should return false when revoking ungranted role with dirty Either', () => {
      const dirtyEither = {
        is_left: true,
        left: OP2.accountId,
        right: { bytes: new Uint8Array(32).fill(0xff) },
      };
      expect(accessControl._revokeRole(OPERATOR_ROLE_1, dirtyEither)).toBe(
        false,
      );
    });

    it('should revoke with dirty left side on contract address', () => {
      accessControl._unsafeGrantRole(OPERATOR_ROLE_1, OP1_CONTRACT);

      const dirtyContract = {
        is_left: false,
        left: new Uint8Array(32).fill(0xff),
        right: OP1_CONTRACT.right,
      };
      expect(accessControl._revokeRole(OPERATOR_ROLE_1, dirtyContract)).toBe(
        true,
      );
      expect(accessControl.hasRole(OPERATOR_ROLE_1, OP1_CONTRACT)).toBe(false);
    });
  });

  describe('computeAccountId', () => {
    it('should match the test helper derivation', () => {
      const users = [OP1, OP2, OP3];

      for (let i = 0; i < users.length; i++) {
        expect(accessControl.computeAccountId(users[i].secretKey)).toEqual(
          users[i].accountId,
        );
      }
    });

    it('should produce distinct identifiers for distinct keys', () => {
      const users = [ADMIN, CUSTOM_ADMIN, OP1, OP2, OP3, UNAUTHORIZED];
      const ids = users.map((u) => accessControl.computeAccountId(u.secretKey));

      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          expect(ids[i]).not.toEqual(ids[j]);
        }
      }
    });
  });
});
