import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/fixtures/address.js';
import {
  type Caller,
  type ContractAddress,
  type Either,
  MultiTokenCallerSimulator,
} from './simulators/MultiTokenCallerSimulator.js';

// The base mock authenticates through `AuthPrfAddr`, which cannot produce the
// zero account. This mock takes the caller as an argument, so a spec can act
// as any account shape.

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

const ALICE = userAccount(bytesOf(1));
const BOB = userAccount(bytesOf(2));
const MALLORY = userAccount(bytesOf(3));
const CONTRACT = contractAccount(bytesOf(7));

const ZERO = userAccount(zeroBytes);
const CONTRACT_ARM_ZERO = contractAccount(zeroBytes);
const NON_CANONICAL_ZERO = userAccount(zeroBytes, bytesOf(9));
const NON_CANONICAL_ALICE = userAccount(bytesOf(1), bytesOf(9));

const URI = 'https://uri.com/mock_v1';
const ID = 1n;
const AMOUNT = 100n;

const INVALID_SENDER = 'MultiToken: invalid sender';
const INVALID_OWNER = 'MultiToken: invalid owner';
const UNAUTHORIZED_OPERATOR = 'MultiToken: unauthorized operator';

// `_unsafeTransferFrom` compares the caller's account as a whole with the
// canonical `fromAddress`, so a non-zero inactive arm never matches it.
const ZERO_CALLERS: [string, Account, string][] = [
  ['the zero account', ZERO, INVALID_SENDER],
  ['the contract-arm zero account', CONTRACT_ARM_ZERO, INVALID_SENDER],
  ['a non-canonical zero account', NON_CANONICAL_ZERO, UNAUTHORIZED_OPERATOR],
];

let token: MultiTokenCallerSimulator;

describe('MultiToken: abnormal callers', () => {
  beforeEach(async () => {
    token = await MultiTokenCallerSimulator.create(URI);
    await token._mint(ALICE, ID, AMOUNT);
  });

  const expectUnchanged = async () => {
    expect(await token.balanceOf(ALICE, ID)).toEqual(AMOUNT);
    expect(await token.balanceOf(BOB, ID)).toEqual(0n);
    expect(await token.balanceOf(MALLORY, ID)).toEqual(0n);
  };

  describe.each(ZERO_CALLERS)(
    'when the caller is %s',
    (_, account, fromZeroError) => {
      const caller = callerOf(account);

      it('should fail transferFrom from a holder', async () => {
        await expect(
          token.transferFrom(caller, ALICE, MALLORY, ID, 10n),
        ).rejects.toThrow(UNAUTHORIZED_OPERATOR);
        await expectUnchanged();
      });

      it('should fail _unsafeTransferFrom from a holder', async () => {
        await expect(
          token._unsafeTransferFrom(caller, ALICE, MALLORY, ID, 10n),
        ).rejects.toThrow(UNAUTHORIZED_OPERATOR);
        await expectUnchanged();
      });

      it('should fail setApprovalForAll', async () => {
        await expect(
          token.setApprovalForAll(caller, MALLORY, true),
        ).rejects.toThrow(INVALID_OWNER);
        expect(await token.isApprovedForAll(account, MALLORY)).toBe(false);
        await expectUnchanged();
      });

      it('should fail transferFrom from the same zero account', async () => {
        await expect(
          token.transferFrom(caller, account, MALLORY, ID, 10n),
        ).rejects.toThrow(fromZeroError);
        await expectUnchanged();
      });

      it('should fail _unsafeTransferFrom from the same zero account', async () => {
        await expect(
          token._unsafeTransferFrom(caller, account, MALLORY, ID, 10n),
        ).rejects.toThrow(fromZeroError);
        await expectUnchanged();
      });
    },
  );

  describe('when a holder calls with a non-zero inactive arm', () => {
    const caller = callerOf(NON_CANONICAL_ALICE);

    it('should set an operator for the holder', async () => {
      await token.setApprovalForAll(caller, MALLORY, true);
      expect(await token.isApprovedForAll(ALICE, MALLORY)).toBe(true);
    });

    it('should fail transferFrom of its own tokens', async () => {
      await expect(
        token.transferFrom(caller, ALICE, BOB, ID, 10n),
      ).rejects.toThrow(UNAUTHORIZED_OPERATOR);
      await expectUnchanged();
    });

    it('should fail _unsafeTransferFrom of its own tokens', async () => {
      await expect(
        token._unsafeTransferFrom(caller, ALICE, BOB, ID, 10n),
      ).rejects.toThrow(UNAUTHORIZED_OPERATOR);
      await expectUnchanged();
    });
  });

  describe('when the caller is a contract account', () => {
    beforeEach(async () => {
      await token._unsafeMint(CONTRACT, ID, 50n);
    });

    it('should transfer tokens it holds', async () => {
      await token.transferFrom(callerOf(CONTRACT), CONTRACT, BOB, ID, 20n);
      expect(await token.balanceOf(CONTRACT, ID)).toEqual(30n);
      expect(await token.balanceOf(BOB, ID)).toEqual(20n);
    });
  });
});
