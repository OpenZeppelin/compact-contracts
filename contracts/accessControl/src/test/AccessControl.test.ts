import {
  type CoinPublicKey,
  convert_bigint_to_Uint8Array,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { AccessControlSimulator } from './simulators/AccessControlSimulator.js';
import * as utils from './utils/address.js';

// Callers
const OPERATOR_1 = utils.toHexPadded('OPERATOR_1');
const ADMIN = utils.toHexPadded('ADMIN');
const UNAUTHORIZED = utils.toHexPadded('UNAUTHORIZED');
const OPERATOR_CONTRACT = utils.toHexPadded('OPERATOR_CONTRACT');

// Encoded PK/Addresses
const Z_OPERATOR_1 = utils.createEitherTestUser('OPERATOR_1');
const Z_OPERATOR_2 = utils.createEitherTestUser('OPERATOR_2');
const Z_ADMIN = utils.createEitherTestUser('ADMIN');
const Z_UNAUTHORIZED = utils.createEitherTestUser('UNAUTHORIZED');
const Z_OPERATOR_CONTRACT =
  utils.createEitherTestContractAddress('OPERATOR_CONTRACT');

// Roles
const DEFAULT_ADMIN_ROLE = utils.zeroUint8Array();
const OPERATOR_ROLE_1 = convert_bigint_to_Uint8Array(32, 1n);
const OPERATOR_ROLE_2 = convert_bigint_to_Uint8Array(32, 2n);
const OPERATOR_ROLE_3 = convert_bigint_to_Uint8Array(32, 3n);
const CUSTOM_ADMIN_ROLE = convert_bigint_to_Uint8Array(32, 4n);
const UNINITIALIZED_ROLE = convert_bigint_to_Uint8Array(32, 5n);

let accessControl: AccessControlSimulator;
let caller: CoinPublicKey;

const callerTypes = {
  contract: OPERATOR_CONTRACT,
  pubkey: OPERATOR_1
}

const operatorTypes = [
  ['contract', Z_OPERATOR_CONTRACT],
  ['pubkey', Z_OPERATOR_1],
] as const;

describe('AccessControl', () => {
  beforeEach(() => {
    accessControl = new AccessControlSimulator();
  });

  describe('hasRole', () => {
    beforeEach(() => {
      accessControl._grantRole(OPERATOR_ROLE_1, Z_OPERATOR_1);
    });

    it('should return true when operator has a role', () => {
      expect(accessControl.hasRole(OPERATOR_ROLE_1, Z_OPERATOR_1)).toBe(true);
    });

    it('should return false when unauthorized', () => {
      expect(accessControl.hasRole(OPERATOR_ROLE_1, Z_UNAUTHORIZED)).toBe(
        false,
      );
    });

    it('should return false when role does not exist', () => {
      expect(accessControl.hasRole(UNINITIALIZED_ROLE, Z_OPERATOR_1)).toBe(
        false,
      );
    });
  });

  describe('assertOnlyRole', () => {
    beforeEach(() => {
      accessControl._grantRole(OPERATOR_ROLE_1, Z_OPERATOR_1);
      caller = OPERATOR_1;
    });

    it('should allow operator with role to call', () => {
      expect(() =>
        accessControl.assertOnlyRole(OPERATOR_ROLE_1, caller),
      ).not.toThrow();
    });

    it('should throw if caller is unauthorized', () => {
      caller = UNAUTHORIZED;
      expect(() =>
        accessControl.assertOnlyRole(OPERATOR_ROLE_1, caller),
      ).toThrow('AccessControl: unauthorized account');
    });
  });

  describe('_checkRole', () => {
    beforeEach(() => {
      accessControl._grantRole(OPERATOR_ROLE_1, Z_OPERATOR_1);
      accessControl._unsafeGrantRole(OPERATOR_ROLE_1, Z_OPERATOR_CONTRACT);
    });

    describe.each(operatorTypes)(
      'when the operator is a %s',
      (_operatorType, _operator) => {
        it(`should not throw if ${_operatorType} has role`, () => {
          expect(() =>
            accessControl._checkRole(OPERATOR_ROLE_1, _operator),
          ).not.toThrow();
        });
      },
    );

    it('should throw if operator is unauthorized', () => {
      expect(() =>
        accessControl._checkRole(OPERATOR_ROLE_1, Z_UNAUTHORIZED),
      ).toThrow('AccessControl: unauthorized account');
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
      accessControl._grantRole(DEFAULT_ADMIN_ROLE, Z_ADMIN);
      caller = ADMIN;
    });

    it('admin should grant role', () => {
      accessControl.grantRole(OPERATOR_ROLE_1, Z_OPERATOR_1, caller);
      expect(accessControl.hasRole(OPERATOR_ROLE_1, Z_OPERATOR_1)).toBe(true);
    });

    it('admin should grant multiple roles', () => {
      accessControl.grantRole(OPERATOR_ROLE_1, Z_OPERATOR_1, caller);
      accessControl.grantRole(OPERATOR_ROLE_1, Z_OPERATOR_2, caller);
      accessControl.grantRole(OPERATOR_ROLE_2, Z_OPERATOR_1, caller);
      accessControl.grantRole(OPERATOR_ROLE_2, Z_OPERATOR_2, caller);

      expect(accessControl.hasRole(OPERATOR_ROLE_1, Z_OPERATOR_1)).toBe(true);
      expect(accessControl.hasRole(OPERATOR_ROLE_1, Z_OPERATOR_2)).toBe(true);
      expect(accessControl.hasRole(OPERATOR_ROLE_2, Z_OPERATOR_1)).toBe(true);
      expect(accessControl.hasRole(OPERATOR_ROLE_2, Z_OPERATOR_2)).toBe(true);
    });

    it('should throw if operator grants role', () => {
      accessControl.grantRole(OPERATOR_ROLE_1, Z_OPERATOR_1, caller);

      caller = OPERATOR_1;
      expect(() => {
        accessControl.grantRole(OPERATOR_ROLE_1, Z_UNAUTHORIZED, caller);
      }).toThrow('AccessControl: unauthorized account');
    });

    it('should throw if admin grants role to ContractAddress', () => {
      expect(() => {
        accessControl.grantRole(OPERATOR_ROLE_1, Z_OPERATOR_CONTRACT, caller);
      }).toThrow('AccessControl: unsafe role approval');
    });
  });

  describe('revokeRole', () => {
    beforeEach(() => {
      accessControl._grantRole(DEFAULT_ADMIN_ROLE, Z_ADMIN);
      accessControl._grantRole(OPERATOR_ROLE_1, Z_OPERATOR_1);
      accessControl._unsafeGrantRole(OPERATOR_ROLE_1, Z_OPERATOR_CONTRACT);
    });

    describe.each(operatorTypes)(
      'when the operator is a %s',
      (_, Z_OPERATOR, OPERATOR_CALLER) => {
        it('admin should revoke role', () => {
          caller = ADMIN;

          accessControl.revokeRole(OPERATOR_ROLE_1, Z_OPERATOR, caller);
          expect(accessControl.hasRole(OPERATOR_ROLE_1, Z_OPERATOR)).toBe(
            false,
          );
        });

        it('should throw if operator revokes role', () => {
          caller = OPERATOR_CALLER;

          expect(() => {
            accessControl.revokeRole(OPERATOR_ROLE_1, Z_UNAUTHORIZED, caller);
          }).toThrow('AccessControl: unauthorized account');
        });
      },
    );

    it('admin should revoke multiple roles', () => {
      caller = ADMIN;

      accessControl.grantRole(OPERATOR_ROLE_1, Z_OPERATOR_2, caller);
      accessControl.grantRole(OPERATOR_ROLE_2, Z_OPERATOR_1, caller);
      accessControl.grantRole(OPERATOR_ROLE_2, Z_OPERATOR_2, caller);
      accessControl._unsafeGrantRole(OPERATOR_ROLE_1, Z_OPERATOR_CONTRACT);

      accessControl.revokeRole(OPERATOR_ROLE_1, Z_OPERATOR_1, caller);
      accessControl.revokeRole(OPERATOR_ROLE_1, Z_OPERATOR_2, caller);
      accessControl.revokeRole(OPERATOR_ROLE_2, Z_OPERATOR_1, caller);
      accessControl.revokeRole(OPERATOR_ROLE_2, Z_OPERATOR_2, caller);
      accessControl.revokeRole(OPERATOR_ROLE_1, Z_OPERATOR_CONTRACT, caller);

      expect(accessControl.hasRole(OPERATOR_ROLE_1, Z_OPERATOR_1)).toBe(false);
      expect(accessControl.hasRole(OPERATOR_ROLE_1, Z_OPERATOR_2)).toBe(false);
      expect(accessControl.hasRole(OPERATOR_ROLE_2, Z_OPERATOR_1)).toBe(false);
      expect(accessControl.hasRole(OPERATOR_ROLE_2, Z_OPERATOR_2)).toBe(false);
      expect(accessControl.hasRole(OPERATOR_ROLE_1, Z_OPERATOR_CONTRACT)).toBe(
        false,
      );
    });
  });

  describe('renounceRole', () => {
    beforeEach(() => {
      accessControl._grantRole(OPERATOR_ROLE_1, Z_OPERATOR_1);
      caller = OPERATOR_1;
    });

    it('should allow operator to renounce own role', () => {
      accessControl.renounceRole(OPERATOR_ROLE_1, Z_OPERATOR_1, caller);
      expect(accessControl.hasRole(OPERATOR_ROLE_1, Z_OPERATOR_1)).toBe(false);
    });

    it('ContractAddress renounce should throw', () => {
      caller = OPERATOR_CONTRACT;
      expect(
        accessControl._unsafeGrantRole(OPERATOR_ROLE_1, Z_OPERATOR_CONTRACT),
      ).toBe(true);
      expect(() => {
        accessControl.renounceRole(
          OPERATOR_ROLE_1,
          Z_OPERATOR_CONTRACT,
          caller,
        );
      }).toThrow('AccessControl: bad confirmation');
    });

    it('unauthorized renounce should throw', () => {
      caller = UNAUTHORIZED;
      expect(() => {
        accessControl.renounceRole(OPERATOR_ROLE_1, Z_OPERATOR_1, caller);
      }).toThrow('AccessControl: bad confirmation');
    });
  });

  describe('_setRoleAdmin', () => {
    it('should set role admin', () => {
      accessControl._setRoleAdmin(OPERATOR_ROLE_1, CUSTOM_ADMIN_ROLE);
      expect(accessControl.getRoleAdmin(OPERATOR_ROLE_1)).toEqual(
        CUSTOM_ADMIN_ROLE,
      );
    });

    it('should set multiple role admins', () => {
      accessControl._setRoleAdmin(OPERATOR_ROLE_1, CUSTOM_ADMIN_ROLE);
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
  });

  describe('_grantRole', () => {
    it('should grant role', () => {
      expect(accessControl._grantRole(OPERATOR_ROLE_1, Z_OPERATOR_1)).toBe(
        true,
      );
      expect(accessControl.hasRole(OPERATOR_ROLE_1, Z_OPERATOR_1)).toBe(true);
    });

    it('should fail to grant role to a ContractAddress', () => {
      expect(() => {
        accessControl._grantRole(OPERATOR_ROLE_1, Z_OPERATOR_CONTRACT);
      }).toThrow('AccessControl: unsafe role approval');
    });

    it('should grant multiple roles', () => {
      expect(accessControl._grantRole(OPERATOR_ROLE_1, Z_OPERATOR_1)).toBe(
        true,
      );
      expect(accessControl._grantRole(OPERATOR_ROLE_1, Z_OPERATOR_2)).toBe(
        true,
      );
      expect(accessControl._grantRole(OPERATOR_ROLE_2, Z_OPERATOR_1)).toBe(
        true,
      );
      expect(accessControl._grantRole(OPERATOR_ROLE_2, Z_OPERATOR_2)).toBe(
        true,
      );

      expect(accessControl.hasRole(OPERATOR_ROLE_1, Z_OPERATOR_1)).toBe(true);
      expect(accessControl.hasRole(OPERATOR_ROLE_1, Z_OPERATOR_2)).toBe(true);
      expect(accessControl.hasRole(OPERATOR_ROLE_2, Z_OPERATOR_1)).toBe(true);
      expect(accessControl.hasRole(OPERATOR_ROLE_2, Z_OPERATOR_2)).toBe(true);
    });
  });

  describe('_unsafeGrantRole', () => {
    it('should grant role', () => {
      expect(
        accessControl._unsafeGrantRole(OPERATOR_ROLE_1, Z_OPERATOR_1),
      ).toBe(true);
      expect(accessControl.hasRole(OPERATOR_ROLE_1, Z_OPERATOR_1)).toBe(true);
    });

    it('should grant role to a ContractAddress', () => {
      expect(
        accessControl._unsafeGrantRole(OPERATOR_ROLE_1, Z_OPERATOR_CONTRACT),
      ).toBe(true);
      expect(accessControl.hasRole(OPERATOR_ROLE_1, Z_OPERATOR_CONTRACT)).toBe(
        true,
      );
    });

    it('should grant multiple roles', () => {
      expect(
        accessControl._unsafeGrantRole(OPERATOR_ROLE_1, Z_OPERATOR_1),
      ).toBe(true);
      expect(
        accessControl._unsafeGrantRole(OPERATOR_ROLE_1, Z_OPERATOR_2),
      ).toBe(true);
      expect(
        accessControl._unsafeGrantRole(OPERATOR_ROLE_2, Z_OPERATOR_1),
      ).toBe(true);
      expect(
        accessControl._unsafeGrantRole(OPERATOR_ROLE_2, Z_OPERATOR_2),
      ).toBe(true);

      expect(accessControl.hasRole(OPERATOR_ROLE_1, Z_OPERATOR_1)).toBe(true);
      expect(accessControl.hasRole(OPERATOR_ROLE_1, Z_OPERATOR_2)).toBe(true);
      expect(accessControl.hasRole(OPERATOR_ROLE_2, Z_OPERATOR_1)).toBe(true);
      expect(accessControl.hasRole(OPERATOR_ROLE_2, Z_OPERATOR_2)).toBe(true);
    });
  });

  describe('_revokeRole', () => {
    describe.each(operatorTypes)(
      'when the operator is a %s',
      (_, Z_OPERATOR, _OPERATOR_CALLER) => {
        it('should revoke role', () => {
          accessControl._unsafeGrantRole(OPERATOR_ROLE_1, Z_OPERATOR);
          expect(accessControl._revokeRole(OPERATOR_ROLE_1, Z_OPERATOR)).toBe(
            true,
          );
          expect(accessControl.hasRole(OPERATOR_ROLE_1, Z_OPERATOR)).toBe(
            false,
          );
        });
      },
    );
  });
});
