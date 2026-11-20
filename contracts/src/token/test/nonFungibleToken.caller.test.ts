import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/fixtures/address.js';
import {
  type Caller,
  type ContractAddress,
  type Either,
  NonFungibleTokenCallerSimulator,
} from './simulators/NonFungibleTokenCallerSimulator.js';

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

const ZERO_CALLERS: [string, Account][] = [
  ['the zero account', ZERO],
  ['the contract-arm zero account', CONTRACT_ARM_ZERO],
  ['a non-canonical zero account', NON_CANONICAL_ZERO],
];

const NAME = 'NAME';
const SYMBOL = 'SYMBOL';
const TOKEN = 1n;
const CONTRACT_TOKEN = 2n;

const INVALID_CALLER = 'NonFungibleToken: invalid caller';
const INVALID_OWNER = 'NonFungibleToken: invalid owner';
const INSUFFICIENT_APPROVAL = 'NonFungibleToken: insufficient approval';

let token: NonFungibleTokenCallerSimulator;

describe('NonFungibleToken: abnormal callers', () => {
  beforeEach(async () => {
    token = await NonFungibleTokenCallerSimulator.create(NAME, SYMBOL);
    await token._mint(ALICE, TOKEN);
  });

  const expectUnchanged = async () => {
    expect(await token.ownerOf(TOKEN)).toEqual(ALICE);
    expect(await token.getApproved(TOKEN)).toEqual(ZERO);
    expect(await token.balanceOf(ALICE)).toEqual(1n);
    expect(await token.balanceOf(MALLORY)).toEqual(0n);
  };

  describe.each(ZERO_CALLERS)('when the caller is %s', (_, account) => {
    const caller = callerOf(account);

    it('should fail approve', async () => {
      await expect(token.approve(caller, MALLORY, TOKEN)).rejects.toThrow(
        INVALID_CALLER,
      );
      await expectUnchanged();
    });

    it('should fail transferFrom', async () => {
      await expect(
        token.transferFrom(caller, ALICE, MALLORY, TOKEN),
      ).rejects.toThrow(INVALID_CALLER);
      await expectUnchanged();
    });

    it('should fail _unsafeTransferFrom', async () => {
      await expect(
        token._unsafeTransferFrom(caller, ALICE, MALLORY, TOKEN),
      ).rejects.toThrow(INVALID_CALLER);
      await expectUnchanged();
    });

    it('should fail setApprovalForAll', async () => {
      await expect(
        token.setApprovalForAll(caller, MALLORY, true),
      ).rejects.toThrow(INVALID_OWNER);
      expect(await token.isApprovedForAll(account, MALLORY)).toBe(false);
      await expectUnchanged();
    });
  });

  describe('when the owner calls with a non-zero inactive arm', () => {
    const caller = callerOf(NON_CANONICAL_ALICE);

    it('should approve as the owner', async () => {
      await token.approve(caller, BOB, TOKEN);
      expect(await token.getApproved(TOKEN)).toEqual(BOB);
    });

    it('should set an operator for the owner', async () => {
      await token.setApprovalForAll(caller, BOB, true);
      expect(await token.isApprovedForAll(ALICE, BOB)).toBe(true);
    });

    it('should transfer the token with transferFrom', async () => {
      await token.transferFrom(caller, ALICE, BOB, TOKEN);
      expect(await token.ownerOf(TOKEN)).toEqual(BOB);
      expect(await token.balanceOf(ALICE)).toEqual(0n);
      expect(await token.balanceOf(BOB)).toEqual(1n);
    });

    it('should transfer the token with _unsafeTransferFrom', async () => {
      await token._unsafeTransferFrom(caller, ALICE, BOB, TOKEN);
      expect(await token.ownerOf(TOKEN)).toEqual(BOB);
      expect(await token.balanceOf(ALICE)).toEqual(0n);
      expect(await token.balanceOf(BOB)).toEqual(1n);
    });
  });

  describe('when the caller is a contract account', () => {
    const caller = callerOf(CONTRACT);

    beforeEach(async () => {
      await token._unsafeMint(CONTRACT, CONTRACT_TOKEN);
    });

    it('should transfer a token it owns', async () => {
      await token.transferFrom(caller, CONTRACT, BOB, CONTRACT_TOKEN);
      expect(await token.ownerOf(CONTRACT_TOKEN)).toEqual(BOB);
      expect(await token.balanceOf(CONTRACT)).toEqual(0n);
      expect(await token.balanceOf(BOB)).toEqual(1n);
    });

    it("should fail to transfer another account's token", async () => {
      await expect(
        token.transferFrom(caller, ALICE, BOB, TOKEN),
      ).rejects.toThrow(INSUFFICIENT_APPROVAL);
      expect(await token.ownerOf(TOKEN)).toEqual(ALICE);
      expect(await token.balanceOf(BOB)).toEqual(0n);
    });
  });
});
