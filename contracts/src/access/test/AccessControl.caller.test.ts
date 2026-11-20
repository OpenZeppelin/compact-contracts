import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/fixtures/address.js';
import {
  AccessControlCallerSimulator,
  type Caller,
  type ContractAddress,
  type Either,
} from './simulators/AccessControlCallerSimulator.js';

// The base mock authenticates through `AuthPrfAddr`, which yields only
// canonical, non-zero key accounts. This mock takes the caller as an argument,
// so a spec can act as any account.

type Account = Either<Uint8Array, ContractAddress>;

const zeroBytes = utils.zeroUint8Array();
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

const callerOf = (account: Account): Caller => ({ account });

const ADMIN_KEY = new Uint8Array(32).fill(1);
const OPERATOR_KEY = new Uint8Array(32).fill(2);

const ADMIN = keyAccount(ADMIN_KEY);
const OPERATOR = keyAccount(OPERATOR_KEY);
const OTHER = keyAccount(new Uint8Array(32).fill(3));
const CONTRACT = contractAccount(new Uint8Array(32).fill(4));

const zeroAccounts = [
  ['zero account', keyAccount(zeroBytes)],
  ['contract-arm zero account', contractAccount(zeroBytes)],
  ['non-canonical zero account', keyAccount(zeroBytes, DIRT)],
] as const;

const DEFAULT_ADMIN_ROLE = zeroBytes;
const ROLE = new Uint8Array(32).fill(0xaa);

// Each role with the account `grantRoles` grants it to.
const roles = [
  ['DEFAULT_ADMIN_ROLE', DEFAULT_ADMIN_ROLE, ADMIN],
  ['a role', ROLE, OPERATOR],
] as const;

const UNAUTHORIZED = 'AccessControl: unauthorized account';

let accessControl: AccessControlCallerSimulator;

const grantRoles = async () => {
  await accessControl._grantRole(DEFAULT_ADMIN_ROLE, ADMIN);
  await accessControl._grantRole(ROLE, OPERATOR);
};

const setups = [
  ['no role is granted', async () => {}],
  ['other accounts hold roles', grantRoles],
] as const;

describe('AccessControl: abnormal callers', () => {
  beforeEach(async () => {
    accessControl = await AccessControlCallerSimulator.create();
  });

  describe.each(zeroAccounts)('when the caller is the %s', (_, account) => {
    const caller = callerOf(account);

    describe.each(setups)('and %s', (_, setup) => {
      beforeEach(setup);

      it.each(roles)(
        'should reject it in assertOnlyRole for %s',
        async (_, roleId) => {
          await expect(
            accessControl.assertOnlyRole(caller, roleId),
          ).rejects.toThrow(UNAUTHORIZED);
        },
      );

      it.each(roles)(
        'should reject it in grantRole for %s',
        async (_, roleId) => {
          await expect(
            accessControl.grantRole(caller, roleId, OTHER),
          ).rejects.toThrow(UNAUTHORIZED);
          expect(await accessControl.hasRole(roleId, OTHER)).toBe(false);
        },
      );

      it.each(roles)(
        'should reject it in revokeRole for %s',
        async (_, roleId, holder) => {
          const held = await accessControl.hasRole(roleId, holder);
          await expect(
            accessControl.revokeRole(caller, roleId, holder),
          ).rejects.toThrow(UNAUTHORIZED);
          expect(await accessControl.hasRole(roleId, holder)).toBe(held);
        },
      );

      it.each(roles)(
        'should change nothing in renounceRole for %s',
        async (_, roleId, holder) => {
          const held = await accessControl.hasRole(roleId, holder);
          await accessControl.renounceRole(caller, roleId, account);
          expect(await accessControl.hasRole(roleId, holder)).toBe(held);
          expect(await accessControl.hasRole(roleId, account)).toBe(false);
        },
      );
    });
  });

  describe('when the caller account is not canonical', () => {
    const operator = callerOf(keyAccount(OPERATOR_KEY, DIRT));

    beforeEach(grantRoles);

    it('should pass assertOnlyRole as its active arm', async () => {
      await accessControl.assertOnlyRole(operator, ROLE);
    });

    it('should pass grantRole as its active arm', async () => {
      await accessControl.grantRole(
        callerOf(keyAccount(ADMIN_KEY, DIRT)),
        ROLE,
        OTHER,
      );
      expect(await accessControl.hasRole(ROLE, OTHER)).toBe(true);
    });

    it('should reject renounceRole with the canonical account as confirmation', async () => {
      await expect(
        accessControl.renounceRole(operator, ROLE, OPERATOR),
      ).rejects.toThrow('AccessControl: bad confirmation');
      expect(await accessControl.hasRole(ROLE, OPERATOR)).toBe(true);
    });

    it('should revoke the canonical account in renounceRole with its own account as confirmation', async () => {
      await accessControl.renounceRole(operator, ROLE, operator.account);
      expect(await accessControl.hasRole(ROLE, OPERATOR)).toBe(false);
    });
  });

  describe('when the caller is a contract', () => {
    const contract = callerOf(CONTRACT);

    beforeEach(grantRoles);

    it('should reject it in assertOnlyRole before a grant', async () => {
      await expect(
        accessControl.assertOnlyRole(contract, ROLE),
      ).rejects.toThrow(UNAUTHORIZED);
    });

    it('should pass assertOnlyRole for a role granted through _unsafeGrantRole', async () => {
      await accessControl._unsafeGrantRole(ROLE, CONTRACT);
      await accessControl.assertOnlyRole(contract, ROLE);
    });

    it('should reject it in assertOnlyRole for a role it was not granted', async () => {
      await accessControl._unsafeGrantRole(ROLE, CONTRACT);
      await expect(
        accessControl.assertOnlyRole(contract, DEFAULT_ADMIN_ROLE),
      ).rejects.toThrow(UNAUTHORIZED);
    });
  });
});
