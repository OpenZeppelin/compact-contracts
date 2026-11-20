import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/fixtures/address.js';
import {
  type Caller,
  type ContractAddress,
  type Either,
  FungibleTokenCallerSimulator,
} from './simulators/FungibleTokenCallerSimulator.js';

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
const NON_CANONICAL_BOB = userAccount(bytesOf(2), bytesOf(9));

const ZERO_CALLERS: [string, Account][] = [
  ['the zero account', ZERO],
  ['the contract-arm zero account', CONTRACT_ARM_ZERO],
  ['a non-canonical zero account', NON_CANONICAL_ZERO],
];

const NAME = 'NAME';
const SYMBOL = 'SYMBOL';
const DECIMALS = 18n;
const SUPPLY = 100n;

const INVALID_SENDER = 'FungibleToken: invalid sender';
const INVALID_OWNER = 'FungibleToken: invalid owner';
const INSUFFICIENT_ALLOWANCE = 'FungibleToken: insufficient allowance';

let token: FungibleTokenCallerSimulator;

describe('FungibleToken: abnormal callers', () => {
  beforeEach(async () => {
    token = await FungibleTokenCallerSimulator.create(NAME, SYMBOL, DECIMALS);
    await token._mint(ALICE, SUPPLY);
  });

  const expectUnchanged = async () => {
    expect(await token.balanceOf(ALICE)).toEqual(SUPPLY);
    expect(await token.balanceOf(MALLORY)).toEqual(0n);
    expect(await token.balanceOf(ZERO)).toEqual(0n);
    expect(await token.totalSupply()).toEqual(SUPPLY);
  };

  describe.each(ZERO_CALLERS)('when the caller is %s', (_, account) => {
    const caller = callerOf(account);

    it('should fail transfer', async () => {
      await expect(token.transfer(caller, MALLORY, 10n)).rejects.toThrow(
        INVALID_SENDER,
      );
      await expectUnchanged();
    });

    it('should fail _unsafeTransfer', async () => {
      await expect(token._unsafeTransfer(caller, MALLORY, 10n)).rejects.toThrow(
        INVALID_SENDER,
      );
      await expectUnchanged();
    });

    it('should fail approve', async () => {
      await expect(token.approve(caller, MALLORY, 10n)).rejects.toThrow(
        INVALID_OWNER,
      );
      expect(await token.allowance(account, MALLORY)).toEqual(0n);
      await expectUnchanged();
    });

    it('should fail transferFrom of a positive value from a holder', async () => {
      await expect(
        token.transferFrom(caller, ALICE, MALLORY, 10n),
      ).rejects.toThrow(INSUFFICIENT_ALLOWANCE);
      await expectUnchanged();
    });

    it('should fail _unsafeTransferFrom of a positive value from a holder', async () => {
      await expect(
        token._unsafeTransferFrom(caller, ALICE, MALLORY, 10n),
      ).rejects.toThrow(INSUFFICIENT_ALLOWANCE);
      await expectUnchanged();
    });

    describe('when `fromAddress` is the same zero account', () => {
      it('should fail transferFrom of a positive value', async () => {
        await expect(
          token.transferFrom(caller, account, MALLORY, 10n),
        ).rejects.toThrow(INSUFFICIENT_ALLOWANCE);
        await expectUnchanged();
      });

      it('should fail _unsafeTransferFrom of a positive value', async () => {
        await expect(
          token._unsafeTransferFrom(caller, account, MALLORY, 10n),
        ).rejects.toThrow(INSUFFICIENT_ALLOWANCE);
        await expectUnchanged();
      });

      it('should fail transferFrom of 0', async () => {
        await expect(
          token.transferFrom(caller, account, MALLORY, 0n),
        ).rejects.toThrow(INVALID_SENDER);
        await expectUnchanged();
      });

      it('should fail _unsafeTransferFrom of 0', async () => {
        await expect(
          token._unsafeTransferFrom(caller, account, MALLORY, 0n),
        ).rejects.toThrow(INVALID_SENDER);
        await expectUnchanged();
      });
    });
  });

  describe('when transferFrom moves 0 from a holder', () => {
    it.each(ZERO_CALLERS)(
      'should pass for %s and change nothing',
      async (_, account) => {
        expect(
          await token.transferFrom(callerOf(account), ALICE, MALLORY, 0n),
        ).toBe(true);
        expect(await token.allowance(ALICE, account)).toEqual(0n);
        await expectUnchanged();
      },
    );

    it('should pass for a caller without an allowance and change nothing', async () => {
      expect(
        await token.transferFrom(callerOf(MALLORY), ALICE, MALLORY, 0n),
      ).toBe(true);
      expect(await token.allowance(ALICE, MALLORY)).toEqual(0n);
      await expectUnchanged();
    });
  });

  describe('when an account calls with a non-zero inactive arm', () => {
    it('should transfer the balance of its active arm', async () => {
      await token.transfer(callerOf(NON_CANONICAL_ALICE), BOB, 10n);
      expect(await token.balanceOf(ALICE)).toEqual(SUPPLY - 10n);
      expect(await token.balanceOf(BOB)).toEqual(10n);
      expect(await token.totalSupply()).toEqual(SUPPLY);
    });

    it('should approve for its active arm', async () => {
      await token.approve(callerOf(NON_CANONICAL_ALICE), BOB, 10n);
      expect(await token.allowance(ALICE, BOB)).toEqual(10n);
    });

    it('should spend an allowance granted to its active arm', async () => {
      await token.approve(callerOf(ALICE), BOB, 10n);
      await token.transferFrom(
        callerOf(NON_CANONICAL_BOB),
        ALICE,
        MALLORY,
        10n,
      );
      expect(await token.allowance(ALICE, BOB)).toEqual(0n);
      expect(await token.balanceOf(ALICE)).toEqual(SUPPLY - 10n);
      expect(await token.balanceOf(MALLORY)).toEqual(10n);
    });
  });

  describe('when the caller is a contract account', () => {
    beforeEach(async () => {
      await token._unsafeMint(CONTRACT, 50n);
    });

    it('should transfer a balance it holds', async () => {
      await token.transfer(callerOf(CONTRACT), BOB, 20n);
      expect(await token.balanceOf(CONTRACT)).toEqual(30n);
      expect(await token.balanceOf(BOB)).toEqual(20n);
      expect(await token.totalSupply()).toEqual(SUPPLY + 50n);
    });
  });
});
