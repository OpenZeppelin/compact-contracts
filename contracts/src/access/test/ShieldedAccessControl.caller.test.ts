import {
  CompactTypeBytes,
  CompactTypeVector,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/fixtures/address.js';
import {
  type Caller,
  type ContractAddress,
  type Either,
  ShieldedAccessControlCallerSimulator,
} from './simulators/ShieldedAccessControlCallerSimulator.js';

// The base mock authenticates through `AuthPrfAddr` and reads the blinding
// through `RandBlinding`, which yield only a canonical, non-zero key account
// and a non-zero blinding. This mock takes both as arguments, so a spec can
// act as any account under any blinding.

type Account = Either<Uint8Array, ContractAddress>;

const zeroBytes = utils.zeroUint8Array();
const DIRT = new Uint8Array(32).fill(0xff);

const keyAccount = (key: Uint8Array, right: Uint8Array = zeroBytes) => ({
  is_left: true,
  left: key,
  right: { bytes: right },
});

const contractAccount = (
  address: Uint8Array,
  left: Uint8Array = zeroBytes,
) => ({
  is_left: false,
  left,
  right: { bytes: address },
});

const callerOf = (account: Account): Caller => ({ account });

const encodePadded32 = (value: string): Uint8Array => {
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode(value));
  return out;
};

// The account commitment as the module derives it.
const commitmentOf = (key: Uint8Array, blinding: Uint8Array): Uint8Array =>
  persistentHash(new CompactTypeVector(3, new CompactTypeBytes(32)), [
    blinding,
    encodePadded32('ShieldedAccessControl:account'),
    key,
  ]);

const INSTANCE_SALT = new Uint8Array(32).fill(7);

const BLINDING = Uint8Array.from(Buffer.alloc(32, 'BLINDING'));
const FRESH_BLINDING = Uint8Array.from(Buffer.alloc(32, 'FRESH_BLINDING'));
const ZERO_BLINDING = new Uint8Array(32);

const ADMIN_KEY = new Uint8Array(32).fill(1);
const OPERATOR_KEY = new Uint8Array(32).fill(2);
const OTHER_KEY = new Uint8Array(32).fill(3);

const ADMIN = callerOf(keyAccount(ADMIN_KEY));
const OPERATOR = callerOf(keyAccount(OPERATOR_KEY));

const OPERATOR_COMMITMENT = commitmentOf(OPERATOR_KEY, BLINDING);
const OTHER_COMMITMENT = commitmentOf(OTHER_KEY, BLINDING);

const DEFAULT_ADMIN_ROLE = zeroBytes;
const ROLE = new Uint8Array(32).fill(0xaa);

const ZERO_ACCOUNT_ERROR = 'ShieldedAccessControl: zero account';
const ZERO_BLINDING_ERROR = 'ShieldedAccessControl: zero blinding';

let contract: ShieldedAccessControlCallerSimulator;

describe('ShieldedAccessControl: abnormal callers', () => {
  beforeEach(async () => {
    contract = await ShieldedAccessControlCallerSimulator.create(INSTANCE_SALT);
    await contract._grantRole(
      DEFAULT_ADMIN_ROLE,
      commitmentOf(ADMIN_KEY, BLINDING),
    );
    await contract._grantRole(ROLE, OPERATOR_COMMITMENT);
  });

  describe('when the blinding is zero', () => {
    it('should reject the holder in assertOnlyRole', async () => {
      await expect(
        contract.assertOnlyRole(OPERATOR, ZERO_BLINDING, ROLE),
      ).rejects.toThrow(ZERO_BLINDING_ERROR);
    });

    it('should reject the holder in canProveRole', async () => {
      await expect(
        contract.canProveRole(OPERATOR, ZERO_BLINDING, ROLE),
      ).rejects.toThrow(ZERO_BLINDING_ERROR);
    });

    it('should reject the admin in grantRole', async () => {
      await expect(
        contract.grantRole(ADMIN, ZERO_BLINDING, ROLE, OTHER_COMMITMENT),
      ).rejects.toThrow(ZERO_BLINDING_ERROR);
      expect(
        await contract.canProveRole(
          callerOf(keyAccount(OTHER_KEY)),
          BLINDING,
          ROLE,
        ),
      ).toBe(false);
    });

    it('should reject the admin in revokeRole', async () => {
      await expect(
        contract.revokeRole(ADMIN, ZERO_BLINDING, ROLE, OPERATOR_COMMITMENT),
      ).rejects.toThrow(ZERO_BLINDING_ERROR);
      expect(await contract.canProveRole(OPERATOR, BLINDING, ROLE)).toBe(true);
    });

    it('should reject the holder in renounceRole', async () => {
      await expect(
        contract.renounceRole(
          OPERATOR,
          ZERO_BLINDING,
          ROLE,
          OPERATOR_COMMITMENT,
        ),
      ).rejects.toThrow(ZERO_BLINDING_ERROR);
      expect(await contract.canProveRole(OPERATOR, BLINDING, ROLE)).toBe(true);
    });

    it('should reject the holder even when its zero-blinding commitment was granted', async () => {
      const holder = callerOf(keyAccount(OTHER_KEY));
      await contract._grantRole(ROLE, commitmentOf(OTHER_KEY, ZERO_BLINDING));

      await expect(
        contract.assertOnlyRole(holder, ZERO_BLINDING, ROLE),
      ).rejects.toThrow(ZERO_BLINDING_ERROR);
    });
  });

  describe.each([
    ['zero account', keyAccount(zeroBytes)],
    ['non-canonical zero account', keyAccount(zeroBytes, DIRT)],
  ])('when the caller is the %s', (_, account) => {
    const caller = callerOf(account);

    describe.each([
      ['a fresh blinding', FRESH_BLINDING],
      ["a holder's blinding", BLINDING],
      ['a zero blinding', ZERO_BLINDING],
    ])('with %s', (_, blinding) => {
      it.each([
        [
          'assertOnlyRole',
          () => contract.assertOnlyRole(caller, blinding, ROLE),
        ],
        ['canProveRole', () => contract.canProveRole(caller, blinding, ROLE)],
        [
          'grantRole',
          () => contract.grantRole(caller, blinding, ROLE, OTHER_COMMITMENT),
        ],
        [
          'renounceRole',
          () =>
            contract.renounceRole(
              caller,
              blinding,
              ROLE,
              commitmentOf(zeroBytes, blinding),
            ),
        ],
        [
          'revokeRole',
          () =>
            contract.revokeRole(caller, blinding, ROLE, OPERATOR_COMMITMENT),
        ],
      ])('should reject it in %s', async (_, call) => {
        await expect(call()).rejects.toThrow(ZERO_ACCOUNT_ERROR);
      });
    });

    it('should reject it even when a commitment over the zero key was granted', async () => {
      await contract._grantRole(ROLE, commitmentOf(zeroBytes, BLINDING));

      await expect(
        contract.assertOnlyRole(caller, BLINDING, ROLE),
      ).rejects.toThrow(ZERO_ACCOUNT_ERROR);
      await expect(
        contract.canProveRole(caller, BLINDING, ROLE),
      ).rejects.toThrow(ZERO_ACCOUNT_ERROR);
    });
  });

  describe.each([
    ['contract', contractAccount(new Uint8Array(32).fill(4))],
    ['contract-arm zero account', contractAccount(zeroBytes)],
    [
      "contract carrying a holder's key in its inactive arm",
      contractAccount(new Uint8Array(32).fill(4), OPERATOR_KEY),
    ],
  ])('when the caller is a %s', (_, account) => {
    const caller = callerOf(account);

    it.each([
      ['assertOnlyRole', () => contract.assertOnlyRole(caller, BLINDING, ROLE)],
      ['canProveRole', () => contract.canProveRole(caller, BLINDING, ROLE)],
      [
        'grantRole',
        () => contract.grantRole(caller, BLINDING, ROLE, OTHER_COMMITMENT),
      ],
      [
        'renounceRole',
        () =>
          contract.renounceRole(caller, BLINDING, ROLE, OPERATOR_COMMITMENT),
      ],
      [
        'revokeRole',
        () => contract.revokeRole(caller, BLINDING, ROLE, OPERATOR_COMMITMENT),
      ],
    ])('should reject it in %s', async (_, call) => {
      await expect(call()).rejects.toThrow('Account: contract account');
    });
  });

  describe('when the caller account is not canonical', () => {
    const operator = callerOf(keyAccount(OPERATOR_KEY, DIRT));

    it('should pass assertOnlyRole as its key', async () => {
      await contract.assertOnlyRole(operator, BLINDING, ROLE);
    });

    it('should return true from canProveRole as its key', async () => {
      expect(await contract.canProveRole(operator, BLINDING, ROLE)).toBe(true);
    });

    it('should pass grantRole as its key', async () => {
      await contract.grantRole(
        callerOf(keyAccount(ADMIN_KEY, DIRT)),
        BLINDING,
        ROLE,
        OTHER_COMMITMENT,
      );
      expect(
        await contract.canProveRole(
          callerOf(keyAccount(OTHER_KEY)),
          BLINDING,
          ROLE,
        ),
      ).toBe(true);
    });

    it('should renounce the role of its key', async () => {
      await contract.renounceRole(
        operator,
        BLINDING,
        ROLE,
        OPERATOR_COMMITMENT,
      );
      expect(await contract.canProveRole(OPERATOR, BLINDING, ROLE)).toBe(false);
    });
  });
});
