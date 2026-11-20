import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/fixtures/address.js';
import {
  type Caller,
  ConfidentialFungibleTokenCallerSimulator,
  type ContractAddress,
  type Either,
} from './simulators/ConfidentialFungibleTokenCallerSimulator.js';

// The base mock authenticates through `AuthPrfAddr`, which cannot produce the
// zero account. This mock takes the caller as an argument, so a spec can act
// as any account shape. This spec runs dry only: every case deploys the full
// token and proves several heavy circuits, and the base suite keeps its
// functional cases dry as well.

type Account = Either<Uint8Array, ContractAddress>;

const zeroBytes = utils.zeroUint8Array();
const bytesOf = (byte: number) => new Uint8Array(32).fill(byte);

const userAccount = (key: Uint8Array, inactive = zeroBytes): Account => ({
  is_left: true,
  left: key,
  right: { bytes: inactive },
});

const contractAccount = (
  address: Uint8Array,
  inactive = zeroBytes,
): Account => ({
  is_left: false,
  left: inactive,
  right: { bytes: address },
});

const callerOf = (account: Account): Caller => ({ account });

const ALICE_ID = bytesOf(1);
const BOB_ID = bytesOf(2);
const CONTRACT_ID = bytesOf(7);

const ALICE = userAccount(ALICE_ID);
const BOB = userAccount(BOB_ID);
const CONTRACT = contractAccount(CONTRACT_ID);

const ZERO = userAccount(zeroBytes);
const CONTRACT_ARM_ZERO = contractAccount(zeroBytes);
const NON_CANONICAL_ZERO = userAccount(zeroBytes, bytesOf(9));
const NON_CANONICAL_ALICE = userAccount(ALICE_ID, bytesOf(9));

const ALICE_EK = bytesOf(0x11);
const BOB_EK = bytesOf(0x22);
const ZERO_EK = bytesOf(0x33);

const NAME = 'Confidential';
const SYMBOL = 'CNF';
const DECIMALS = 18n;
const AMOUNT = 100n;

const CONTRACT_ACCOUNT = 'Account: contract account';
const INVALID_CALLER = 'ConfidentialFungibleToken: invalid caller';
const SENDER_NOT_REGISTERED =
  'ConfidentialFungibleToken: sender not registered';
const INVALID_RECEIVER = 'ConfidentialFungibleToken: invalid receiver';
const INVALID_SPENDER = 'ConfidentialFungibleToken: invalid spender';
const NO_ESCROW = 'ConfidentialFungibleToken: no escrow';

let cft: ConfidentialFungibleTokenCallerSimulator;

const register = async (account: Account, ek: Uint8Array) => {
  await cft.privateState.switchEncryptionKey(ek);
  return cft.register(callerOf(account));
};

// Mints `amount` to `account`, sweeps it into spendable and caches it. Leaves
// `ek` active.
const fund = async (account: Account, ek: Uint8Array, amount: bigint) => {
  await cft.privateState.switchEncryptionKey(ek);
  await cft._mint(account.left, amount);
  await cft.sweep(callerOf(account));
  await cft.privateState.cachePlaintext(
    await cft.balanceOf(account.left),
    amount,
  );
};

const snapshot = async () => {
  const ids = [ALICE_ID, BOB_ID, CONTRACT_ID, zeroBytes];
  const views = [];
  for (const id of ids) {
    views.push({
      registered: await cft.isRegistered(id),
      balance: await cft.balanceOf(id),
      pending: await cft.pendingOf(id),
    });
  }
  return { views, escrow: await cft.allowance(ALICE_ID, BOB_ID) };
};

const CALLER_CIRCUITS: [string, (caller: Caller) => Promise<unknown>][] = [
  ['registerWithKey', (caller) => cft.register(caller)],
  ['_burn', (caller) => cft._burn(caller, 10n)],
  ['transfer', (caller) => cft.transfer(caller, BOB_ID, 10n)],
  ['_move', (caller) => cft._move(caller, BOB_ID, 10n)],
  ['sweep', (caller) => cft.sweep(caller)],
  ['approve', (caller) => cft.approve(caller, BOB_ID, 10n)],
  ['transferFrom', (caller) => cft.transferFrom(caller, ALICE_ID, BOB_ID, 10n)],
  ['_burnFrom', (caller) => cft._burnFrom(caller, ALICE_ID, 10n)],
  ['clearMemos', (caller) => cft.clearMemos(caller, 0n)],
];

describe.skipIf(isLiveBackend())(
  'ConfidentialFungibleToken: abnormal callers',
  () => {
    beforeEach(async () => {
      cft = await ConfidentialFungibleTokenCallerSimulator.create(
        NAME,
        SYMBOL,
        DECIMALS,
      );
      await register(BOB, BOB_EK);
    });

    describe.each([
      ['a contract account', CONTRACT],
      ['the contract-arm zero account', CONTRACT_ARM_ZERO],
    ])('when the caller is %s', (_, account) => {
      const caller = callerOf(account);

      beforeEach(async () => {
        await register(ALICE, ALICE_EK);
        await fund(ALICE, ALICE_EK, AMOUNT);
      });

      it.each(CALLER_CIRCUITS)('should fail %s', async (_, call) => {
        const before = await snapshot();
        await expect(call(caller)).rejects.toThrow(CONTRACT_ACCOUNT);
        expect(await snapshot()).toEqual(before);
      });
    });

    describe('when an account calls with a non-zero inactive arm', () => {
      const caller = callerOf(NON_CANONICAL_ALICE);

      it('should register under its key', async () => {
        await cft.privateState.switchEncryptionKey(ALICE_EK);
        expect(await cft.register(caller)).toEqual(ALICE_ID);
        expect(await cft.isRegistered(ALICE_ID)).toBe(true);
      });

      it('should transfer from the balance of its key', async () => {
        await register(NON_CANONICAL_ALICE, ALICE_EK);
        await fund(NON_CANONICAL_ALICE, ALICE_EK, AMOUNT);

        expect(await cft.transfer(caller, BOB_ID, 30n)).toEqual(ALICE_ID);

        // Burning exactly the remainder proves the balance of the key.
        await cft.privateState.cachePlaintext(
          await cft.balanceOf(ALICE_ID),
          AMOUNT - 30n,
        );
        expect(await cft._burn(caller, AMOUNT - 30n)).toEqual(ALICE_ID);
      });
    });

    describe.each([
      ['the zero account', ZERO],
      ['a non-canonical zero account', NON_CANONICAL_ZERO],
    ])('when the caller is %s', (_, account) => {
      const caller = callerOf(account);

      beforeEach(async () => {
        await register(ALICE, ALICE_EK);
        await fund(ALICE, ALICE_EK, AMOUNT);
        await cft.approve(callerOf(ALICE), BOB_ID, 40n);
      });

      it('should fail transfer while unregistered', async () => {
        const before = await snapshot();
        await expect(cft.transfer(caller, BOB_ID, 10n)).rejects.toThrow(
          SENDER_NOT_REGISTERED,
        );
        expect(await snapshot()).toEqual(before);
      });

      it('should fail transferFrom from another account', async () => {
        const before = await snapshot();
        await expect(
          cft.transferFrom(caller, ALICE_ID, BOB_ID, 10n),
        ).rejects.toThrow(NO_ESCROW);
        expect(await snapshot()).toEqual(before);
      });

      it('should fail _burnFrom from another account', async () => {
        const before = await snapshot();
        await expect(cft._burnFrom(caller, ALICE_ID, 10n)).rejects.toThrow(
          NO_ESCROW,
        );
        expect(await snapshot()).toEqual(before);
      });

      it('should fail registerWithKey', async () => {
        const before = await snapshot();
        await expect(register(account, ZERO_EK)).rejects.toThrow(
          INVALID_CALLER,
        );
        expect(await cft.isRegistered(zeroBytes)).toBe(false);
        expect(await snapshot()).toEqual(before);
      });
    });

    describe('when the zero account is the counterparty', () => {
      beforeEach(async () => {
        await register(ALICE, ALICE_EK);
        await fund(ALICE, ALICE_EK, AMOUNT);
      });

      it('should fail _mint to it', async () => {
        const before = await snapshot();
        await expect(cft._mint(zeroBytes, 10n)).rejects.toThrow(
          INVALID_RECEIVER,
        );
        expect(await snapshot()).toEqual(before);
      });

      it('should fail transfer to it', async () => {
        const before = await snapshot();
        await expect(
          cft.transfer(callerOf(ALICE), zeroBytes, 10n),
        ).rejects.toThrow(INVALID_RECEIVER);
        expect(await snapshot()).toEqual(before);
      });

      it('should fail _move to it', async () => {
        const before = await snapshot();
        await expect(
          cft._move(callerOf(ALICE), zeroBytes, 10n),
        ).rejects.toThrow(INVALID_RECEIVER);
        expect(await snapshot()).toEqual(before);
      });

      it('should fail transferFrom to it', async () => {
        await cft.approve(callerOf(ALICE), BOB_ID, 40n);
        const before = await snapshot();
        await expect(
          cft.transferFrom(callerOf(BOB), ALICE_ID, zeroBytes, 10n),
        ).rejects.toThrow(INVALID_RECEIVER);
        expect(await snapshot()).toEqual(before);
      });

      it('should fail approve of it as spender', async () => {
        const before = await snapshot();
        await expect(
          cft.approve(callerOf(ALICE), zeroBytes, 10n),
        ).rejects.toThrow(INVALID_SPENDER);
        expect(await snapshot()).toEqual(before);
      });
    });
  },
);
