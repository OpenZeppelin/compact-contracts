import {
  CompactTypeBytes,
  CompactTypeVector,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import { NonFungibleTokenSimulator } from './simulators/NonFungibleTokenSimulator.js';

// Helpers
const buildAccountIdHash = (sk: Uint8Array): Uint8Array => {
  const rt_type = new CompactTypeVector(1, new CompactTypeBytes(32));
  return persistentHash(rt_type, [sk]);
};

const zeroBytes = utils.zeroUint8Array();

const eitherAccountId = (accountId: Uint8Array) => {
  return {
    is_left: true,
    left: accountId,
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
  const either = eitherAccountId(accountId);
  return { secretKey, accountId, either };
};

// Users
const OWNER = makeUser('OWNER');
const SPENDER = makeUser('SPENDER');
const RECIPIENT = makeUser('RECIPIENT');
const OTHER = makeUser('OTHER');
const UNAUTHORIZED = makeUser('UNAUTHORIZED');

// Contract addresses
const SOME_CONTRACT = eitherContract('CONTRACT');

// Zero values
const ZERO_ACCOUNT = eitherAccountId(zeroBytes);
const ZERO_CONTRACT = {
  is_left: false,
  left: zeroBytes,
  right: { bytes: zeroBytes },
};

// Contract Metadata
const NAME = 'NAME';
const SYMBOL = 'SYMBOL';
const EMPTY_STRING = '';
const INIT = true;
const BAD_INIT = false;

// Token Metadata
const TOKENID_1 = 1n;
const TOKENID_2 = 2n;
const TOKENID_3 = 3n;
const NON_EXISTENT_TOKEN = 0xdeadn;
const SOME_URI = 'https://some.example';
const EMPTY_URI = '';
const AMOUNT = 1n;

let token: NonFungibleTokenSimulator;

describe('NonFungibleToken', () => {
  describe('initializer and metadata', () => {
    it('should initialize metadata', async () => {
      token = await NonFungibleTokenSimulator.create(NAME, SYMBOL, INIT);
      expect(await token.name()).toEqual(NAME);
      expect(await token.symbol()).toEqual(SYMBOL);
    });

    it('should initialize empty metadata', async () => {
      token = await NonFungibleTokenSimulator.create(
        EMPTY_STRING,
        EMPTY_STRING,
        INIT,
      );
      expect(await token.name()).toEqual(EMPTY_STRING);
      expect(await token.symbol()).toEqual(EMPTY_STRING);
    });

    it('should initialize metadata with whitespace', async () => {
      token = await NonFungibleTokenSimulator.create(
        '  NAME  ',
        '  SYMBOL  ',
        INIT,
      );
      expect(await token.name()).toEqual('  NAME  ');
      expect(await token.symbol()).toEqual('  SYMBOL  ');
    });

    it('should initialize metadata with special characters', async () => {
      token = await NonFungibleTokenSimulator.create(
        'NAME!@#',
        'SYMBOL$%^',
        INIT,
      );
      expect(await token.name()).toEqual('NAME!@#');
      expect(await token.symbol()).toEqual('SYMBOL$%^');
    });

    it('should initialize metadata with very long strings', async () => {
      const longName = 'A'.repeat(1000);
      const longSymbol = 'B'.repeat(1000);
      token = await NonFungibleTokenSimulator.create(
        longName,
        longSymbol,
        INIT,
      );
      expect(await token.name()).toEqual(longName);
      expect(await token.symbol()).toEqual(longSymbol);
    });
  });

  beforeEach(async () => {
    token = await NonFungibleTokenSimulator.create(NAME, SYMBOL, INIT);
  });

  describe('balanceOf', () => {
    it('should return zero when requested account has no balance', async () => {
      expect(await token.balanceOf(OWNER.either)).toEqual(0n);
    });

    it('should return balance when requested account has tokens', async () => {
      await token._mint(OWNER.either, AMOUNT);
      expect(await token.balanceOf(OWNER.either)).toEqual(AMOUNT);
    });

    it('should return correct balance for multiple tokens', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await token._mint(OWNER.either, TOKENID_2);
      await token._mint(OWNER.either, TOKENID_3);
      expect(await token.balanceOf(OWNER.either)).toEqual(3n);
    });

    it('should return correct balance after burning multiple tokens', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await token._mint(OWNER.either, TOKENID_2);
      await token._mint(OWNER.either, TOKENID_3);
      await token._burn(TOKENID_1);
      await token._burn(TOKENID_2);
      expect(await token.balanceOf(OWNER.either)).toEqual(1n);
    });

    it('should return correct balance after transferring multiple tokens', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await token._mint(OWNER.either, TOKENID_2);
      await token._mint(OWNER.either, TOKENID_3);
      await token._transfer(OWNER.either, RECIPIENT.either, TOKENID_1);
      await token._transfer(OWNER.either, RECIPIENT.either, TOKENID_2);
      expect(await token.balanceOf(OWNER.either)).toEqual(1n);
      expect(await token.balanceOf(RECIPIENT.either)).toEqual(2n);
    });

    it('should return correct balance with non-canonical lookup (left)', async () => {
      await token._mint(OWNER.either, TOKENID_1);

      const nonCanonical = {
        is_left: true,
        left: OWNER.accountId,
        right: utils.encodeToAddress('JUNK_DATA'),
      };

      expect(await token.balanceOf(nonCanonical)).toEqual(1n);
    });

    it('should return correct balance with non-canonical lookup (right)', async () => {
      await token._unsafeMint(SOME_CONTRACT, TOKENID_1);

      const nonCanonical = {
        is_left: false,
        left: new Uint8Array(32).fill(1),
        right: SOME_CONTRACT.right,
      };

      expect(await token.balanceOf(nonCanonical)).toEqual(1n);
    });
  });

  describe('ownerOf', () => {
    it('should throw if token does not exist', async () => {
      await expect(token.ownerOf(NON_EXISTENT_TOKEN)).rejects.toThrow(
        'NonFungibleToken: nonexistent token',
      );
    });

    it('should throw if token has been burned', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await token._burn(TOKENID_1);
      await expect(token.ownerOf(TOKENID_1)).rejects.toThrow(
        'NonFungibleToken: nonexistent token',
      );
    });

    it('should return owner of token if it exists', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      expect(await token.ownerOf(TOKENID_1)).toEqual(OWNER.either);
    });

    it('should return correct owner for multiple tokens', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await token._mint(OWNER.either, TOKENID_2);
      await token._mint(OWNER.either, TOKENID_3);
      expect(await token.ownerOf(TOKENID_1)).toEqual(OWNER.either);
      expect(await token.ownerOf(TOKENID_2)).toEqual(OWNER.either);
      expect(await token.ownerOf(TOKENID_3)).toEqual(OWNER.either);
    });

    it('should return correct owner after multiple transfers', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await token._mint(OWNER.either, TOKENID_2);
      await token._transfer(OWNER.either, SPENDER.either, TOKENID_1);
      await token._transfer(OWNER.either, OTHER.either, TOKENID_2);
      expect(await token.ownerOf(TOKENID_1)).toEqual(SPENDER.either);
      expect(await token.ownerOf(TOKENID_2)).toEqual(OTHER.either);
    });

    it('should return correct owner after multiple burns and mints', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await token._burn(TOKENID_1);
      await token._mint(SPENDER.either, TOKENID_1);
      expect(await token.ownerOf(TOKENID_1)).toEqual(SPENDER.either);
    });
  });

  describe('tokenURI', () => {
    beforeEach(async () => {
      await token._mint(OWNER.either, TOKENID_1);
    });

    it('should throw if token does not exist', async () => {
      await expect(token.tokenURI(NON_EXISTENT_TOKEN)).rejects.toThrow(
        'NonFungibleToken: nonexistent token',
      );
    });

    it('should return the empty string for an unset tokenURI', async () => {
      expect(await token.tokenURI(TOKENID_1)).toEqual(EMPTY_URI);
    });

    it('should return the empty string if tokenURI set as default value', async () => {
      await token._setTokenURI(TOKENID_1, EMPTY_URI);
      expect(await token.tokenURI(TOKENID_1)).toEqual(EMPTY_URI);
    });

    it('should return some string if tokenURI is set', async () => {
      await token._setTokenURI(TOKENID_1, SOME_URI);
      expect(await token.tokenURI(TOKENID_1)).toEqual(SOME_URI);
    });

    it('should return very long tokenURI', async () => {
      const longURI = 'A'.repeat(1000);
      await token._setTokenURI(TOKENID_1, longURI);
      expect(await token.tokenURI(TOKENID_1)).toEqual(longURI);
    });

    it('should return tokenURI with special characters', async () => {
      const specialURI = '!@#$%^&*()_+';
      await token._setTokenURI(TOKENID_1, specialURI);
      expect(await token.tokenURI(TOKENID_1)).toEqual(specialURI);
    });

    it('should update tokenURI multiple times', async () => {
      await token._setTokenURI(TOKENID_1, 'URI1');
      await token._setTokenURI(TOKENID_1, 'URI2');
      await token._setTokenURI(TOKENID_1, 'URI3');
      expect(await token.tokenURI(TOKENID_1)).toEqual('URI3');
    });

    it('should maintain tokenURI after token transfer', async () => {
      await token._setTokenURI(TOKENID_1, SOME_URI);
      await token._transfer(OWNER.either, RECIPIENT.either, TOKENID_1);
      expect(await token.tokenURI(TOKENID_1)).toEqual(SOME_URI);
    });
  });

  describe('approve', () => {
    beforeEach(async () => {
      await token._mint(OWNER.either, TOKENID_1);
      expect(await token.getApproved(TOKENID_1)).toEqual(ZERO_ACCOUNT);
    });

    it('should throw if not owner', async () => {
      await token.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
      await expect(token.approve(SPENDER.either, TOKENID_1)).rejects.toThrow(
        'NonFungibleToken: invalid approver',
      );
    });

    it('should approve spender', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.approve(SPENDER.either, TOKENID_1);
      expect(await token.getApproved(TOKENID_1)).toEqual(SPENDER.either);
    });

    it('should allow operator to approve', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.setApprovalForAll(SPENDER.either, true);

      await token.privateState.injectSecretKey(SPENDER.secretKey);
      await token.approve(OTHER.either, TOKENID_1);
      expect(await token.getApproved(TOKENID_1)).toEqual(OTHER.either);
    });

    it('spender approved for only TOKENID_1 should not be able to approve', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.approve(SPENDER.either, TOKENID_1);

      await token.privateState.injectSecretKey(SPENDER.secretKey);
      await expect(token.approve(OTHER.either, TOKENID_1)).rejects.toThrow(
        'NonFungibleToken: invalid approver',
      );
    });

    it('should approve same address multiple times', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.approve(SPENDER.either, TOKENID_1);
      await token.approve(SPENDER.either, TOKENID_1);
      expect(await token.getApproved(TOKENID_1)).toEqual(SPENDER.either);
    });

    it('should approve after token transfer', async () => {
      await token._transfer(OWNER.either, SPENDER.either, TOKENID_1);

      await token.privateState.injectSecretKey(SPENDER.secretKey);
      await token.approve(OTHER.either, TOKENID_1);
      expect(await token.getApproved(TOKENID_1)).toEqual(OTHER.either);
    });

    it('should approve after token burn and remint', async () => {
      await token._burn(TOKENID_1);
      await token._mint(OWNER.either, TOKENID_1);

      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.approve(SPENDER.either, TOKENID_1);
      expect(await token.getApproved(TOKENID_1)).toEqual(SPENDER.either);
    });

    it('should approve with very long token ID', async () => {
      const longTokenId = BigInt('18446744073709551615');
      await token._mint(OWNER.either, longTokenId);

      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.approve(SPENDER.either, longTokenId);
      expect(await token.getApproved(longTokenId)).toEqual(SPENDER.either);
    });

    it('should normalize right-variant zero approval', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.approve(ZERO_CONTRACT, TOKENID_1);

      expect(await token.getApproved(TOKENID_1)).toEqual(ZERO_ACCOUNT);
    });
  });

  describe('getApproved', () => {
    beforeEach(async () => {
      await token._mint(OWNER.either, TOKENID_1);
    });

    it('should throw if token does not exist', async () => {
      await expect(token.getApproved(NON_EXISTENT_TOKEN)).rejects.toThrow(
        'NonFungibleToken: nonexistent token',
      );
    });

    it('should throw if token has been burned', async () => {
      await token._burn(TOKENID_1);
      await expect(token.getApproved(TOKENID_1)).rejects.toThrow(
        'NonFungibleToken: nonexistent token',
      );
    });

    it('should get current approved spender', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.approve(OWNER.either, TOKENID_1);
      expect(await token.getApproved(TOKENID_1)).toEqual(OWNER.either);
    });

    it('should return zero if approval not set', async () => {
      expect(await token.getApproved(TOKENID_1)).toEqual(ZERO_ACCOUNT);
    });
  });

  describe('setApprovalForAll', () => {
    it('should not approve zero address', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await token.privateState.injectSecretKey(OWNER.secretKey);

      await expect(token.setApprovalForAll(ZERO_ACCOUNT, true)).rejects.toThrow(
        'NonFungibleToken: invalid operator',
      );
    });

    it('should set operator', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await token.privateState.injectSecretKey(OWNER.secretKey);

      await token.setApprovalForAll(SPENDER.either, true);
      expect(await token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
        true,
      );
    });

    it('should allow operator to manage owner tokens', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await token._mint(OWNER.either, TOKENID_2);
      await token._mint(OWNER.either, TOKENID_3);

      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.setApprovalForAll(SPENDER.either, true);

      await token.privateState.injectSecretKey(SPENDER.secretKey);
      await token.transferFrom(OWNER.either, SPENDER.either, TOKENID_1);
      expect(await token.ownerOf(TOKENID_1)).toEqual(SPENDER.either);

      await token.approve(OTHER.either, TOKENID_2);
      expect(await token.getApproved(TOKENID_2)).toEqual(OTHER.either);

      await token.approve(SPENDER.either, TOKENID_3);
      expect(await token.getApproved(TOKENID_3)).toEqual(SPENDER.either);
    });

    it('should revoke approval for all', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await token.privateState.injectSecretKey(OWNER.secretKey);

      await token.setApprovalForAll(SPENDER.either, true);
      expect(await token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
        true,
      );

      await token.setApprovalForAll(SPENDER.either, false);
      expect(await token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
        false,
      );

      await token.privateState.injectSecretKey(SPENDER.secretKey);
      await expect(token.approve(SPENDER.either, TOKENID_1)).rejects.toThrow(
        'NonFungibleToken: invalid approver',
      );
    });

    it('should set approval for all to same address multiple times', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await token.privateState.injectSecretKey(OWNER.secretKey);

      await token.setApprovalForAll(SPENDER.either, true);
      await token.setApprovalForAll(SPENDER.either, true);
      expect(await token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
        true,
      );
    });

    it('should set approval for all after token transfer', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await token._transfer(OWNER.either, SPENDER.either, TOKENID_1);

      await token.privateState.injectSecretKey(SPENDER.secretKey);
      await token.setApprovalForAll(OTHER.either, true);
      expect(await token.isApprovedForAll(SPENDER.either, OTHER.either)).toBe(
        true,
      );
    });

    it('should set approval for all with multiple operators', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await token.privateState.injectSecretKey(OWNER.secretKey);

      await token.setApprovalForAll(SPENDER.either, true);
      await token.setApprovalForAll(OTHER.either, true);
      expect(await token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
        true,
      );
      expect(await token.isApprovedForAll(OWNER.either, OTHER.either)).toBe(
        true,
      );
    });

    it('should set approval for all with very long token IDs', async () => {
      const longTokenId = BigInt('18446744073709551615');
      await token._mint(OWNER.either, longTokenId);
      await token.privateState.injectSecretKey(OWNER.secretKey);

      await token.setApprovalForAll(SPENDER.either, true);
      expect(await token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
        true,
      );
    });
  });

  describe('isApprovedForAll', () => {
    it('should return false if approval not set', async () => {
      expect(await token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
        false,
      );
    });

    it('should return true if approval set', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.setApprovalForAll(SPENDER.either, true);
      expect(await token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
        true,
      );
    });

    it('should return correct result with non-canonical owner lookup', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.setApprovalForAll(SPENDER.either, true);

      const nonCanonical = {
        is_left: true,
        left: OWNER.accountId,
        right: utils.encodeToAddress('JUNK_DATA'),
      };

      expect(await token.isApprovedForAll(nonCanonical, SPENDER.either)).toBe(
        true,
      );
    });

    it('should return correct result with non-canonical operator lookup', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.setApprovalForAll(SPENDER.either, true);

      const nonCanonical = {
        is_left: true,
        left: SPENDER.accountId,
        right: utils.encodeToAddress('JUNK_DATA'),
      };

      expect(await token.isApprovedForAll(OWNER.either, nonCanonical)).toBe(
        true,
      );
    });
  });

  describe('transferFrom', () => {
    beforeEach(async () => {
      await token._mint(OWNER.either, TOKENID_1);
    });

    it('should not transfer to ContractAddress', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await expect(
        token.transferFrom(OWNER.either, SOME_CONTRACT, TOKENID_1),
      ).rejects.toThrow('NonFungibleToken: unsafe transfer');
    });

    it('should not transfer to zero address', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await expect(
        token.transferFrom(OWNER.either, ZERO_ACCOUNT, TOKENID_1),
      ).rejects.toThrow('NonFungibleToken: invalid receiver');
    });

    it('should not transfer from zero address', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await expect(
        token.transferFrom(ZERO_ACCOUNT, SPENDER.either, TOKENID_1),
      ).rejects.toThrow('NonFungibleToken: incorrect owner');
    });

    it('should not transfer from unauthorized', async () => {
      await token.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
      await expect(
        token.transferFrom(OWNER.either, UNAUTHORIZED.either, TOKENID_1),
      ).rejects.toThrow('NonFungibleToken: insufficient approval');
    });

    it('should not transfer token that has not been minted', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await expect(
        token.transferFrom(OWNER.either, SPENDER.either, NON_EXISTENT_TOKEN),
      ).rejects.toThrow('NonFungibleToken: nonexistent token');
    });

    it('should transfer token without approvers or operators', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.transferFrom(OWNER.either, RECIPIENT.either, TOKENID_1);
      expect(await token.ownerOf(TOKENID_1)).toEqual(RECIPIENT.either);
    });

    it('should transfer token via approved operator', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.approve(SPENDER.either, TOKENID_1);

      await token.privateState.injectSecretKey(SPENDER.secretKey);
      await token.transferFrom(OWNER.either, SPENDER.either, TOKENID_1);
      expect(await token.ownerOf(TOKENID_1)).toEqual(SPENDER.either);
    });

    it('should transfer token via approvedForAll operator', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.setApprovalForAll(SPENDER.either, true);

      await token.privateState.injectSecretKey(SPENDER.secretKey);
      await token.transferFrom(OWNER.either, SPENDER.either, TOKENID_1);
      expect(await token.ownerOf(TOKENID_1)).toEqual(SPENDER.either);
    });

    it('should allow transfer to same address', async () => {
      await token._approve(SPENDER.either, TOKENID_1, OWNER.either);
      await token._setApprovalForAll(OWNER.either, SPENDER.either, true);

      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.transferFrom(OWNER.either, OWNER.either, TOKENID_1);
      expect(await token.ownerOf(TOKENID_1)).toEqual(OWNER.either);
      expect(await token.balanceOf(OWNER.either)).toEqual(1n);
      expect(await token.getApproved(TOKENID_1)).toEqual(ZERO_ACCOUNT);
      expect(
        await token._isAuthorized(OWNER.either, SPENDER.either, TOKENID_1),
      ).toEqual(true);
    });

    it('should not transfer after approval revocation', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.approve(SPENDER.either, TOKENID_1);
      await token.approve(ZERO_ACCOUNT, TOKENID_1);

      await token.privateState.injectSecretKey(SPENDER.secretKey);
      await expect(
        token.transferFrom(OWNER.either, SPENDER.either, TOKENID_1),
      ).rejects.toThrow('NonFungibleToken: insufficient approval');
    });

    it('should not transfer after approval for all revocation', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.setApprovalForAll(SPENDER.either, true);
      await token.setApprovalForAll(SPENDER.either, false);

      await token.privateState.injectSecretKey(SPENDER.secretKey);
      await expect(
        token.transferFrom(OWNER.either, SPENDER.either, TOKENID_1),
      ).rejects.toThrow('NonFungibleToken: insufficient approval');
    });

    it('should transfer multiple tokens in sequence', async () => {
      await token._mint(OWNER.either, TOKENID_2);
      await token._mint(OWNER.either, TOKENID_3);

      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.approve(SPENDER.either, TOKENID_1);
      await token.approve(SPENDER.either, TOKENID_2);
      await token.approve(SPENDER.either, TOKENID_3);

      await token.privateState.injectSecretKey(SPENDER.secretKey);
      await token.transferFrom(OWNER.either, SPENDER.either, TOKENID_1);
      await token.transferFrom(OWNER.either, SPENDER.either, TOKENID_2);
      await token.transferFrom(OWNER.either, SPENDER.either, TOKENID_3);

      expect(await token.ownerOf(TOKENID_1)).toEqual(SPENDER.either);
      expect(await token.ownerOf(TOKENID_2)).toEqual(SPENDER.either);
      expect(await token.ownerOf(TOKENID_3)).toEqual(SPENDER.either);
    });

    it('should transfer with very long token IDs', async () => {
      const longTokenId = BigInt('18446744073709551615');
      await token._mint(OWNER.either, longTokenId);

      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.approve(SPENDER.either, longTokenId);

      await token.privateState.injectSecretKey(SPENDER.secretKey);
      await token.transferFrom(OWNER.either, SPENDER.either, longTokenId);
      expect(await token.ownerOf(longTokenId)).toEqual(SPENDER.either);
    });

    it('should revoke approval after transferFrom', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.approve(SPENDER.either, TOKENID_1);
      await token._setApprovalForAll(OWNER.either, SPENDER.either, true);

      await token.transferFrom(OWNER.either, OTHER.either, TOKENID_1);
      expect(await token.getApproved(TOKENID_1)).toEqual(ZERO_ACCOUNT);
      expect(
        await token._isAuthorized(OTHER.either, SPENDER.either, TOKENID_1),
      ).toBe(false);

      await token.privateState.injectSecretKey(SPENDER.secretKey);
      await expect(
        token.approve(UNAUTHORIZED.either, TOKENID_1),
      ).rejects.toThrow('NonFungibleToken: invalid approver');
      await expect(
        token.transferFrom(OTHER.either, UNAUTHORIZED.either, TOKENID_1),
      ).rejects.toThrow('NonFungibleToken: insufficient approval');
    });

    it('should store canonical zero after clearing approval via transfer', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.approve(SPENDER.either, TOKENID_1);

      await token.transferFrom(OWNER.either, RECIPIENT.either, TOKENID_1);

      // _update calls _approve(zeroAccount(), tokenId, zeroAccount()) internally,
      // which should store the left-variant zero
      expect(await token.getApproved(TOKENID_1)).toEqual(ZERO_ACCOUNT);
    });
  });

  describe('_requireOwned', () => {
    it('should throw if token has not been minted', async () => {
      await expect(token._requireOwned(TOKENID_1)).rejects.toThrow(
        'NonFungibleToken: nonexistent token',
      );
    });

    it('should throw if token has been burned', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await token._burn(TOKENID_1);
      await expect(token._requireOwned(TOKENID_1)).rejects.toThrow(
        'NonFungibleToken: nonexistent token',
      );
    });

    it('should return correct owner', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      expect(await token._requireOwned(TOKENID_1)).toEqual(OWNER.either);
    });
  });

  describe('_ownerOf', () => {
    it('should return zero address if token does not exist', async () => {
      expect(await token._ownerOf(NON_EXISTENT_TOKEN)).toEqual(ZERO_ACCOUNT);
    });

    it('should return owner of token', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      expect(await token._ownerOf(TOKENID_1)).toEqual(OWNER.either);
    });
  });

  describe('_approve', () => {
    it('should approve if auth is owner', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await token._approve(SPENDER.either, TOKENID_1, OWNER.either);
      expect(await token.getApproved(TOKENID_1)).toEqual(SPENDER.either);
    });

    it('should approve if auth is approved for all', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.setApprovalForAll(SPENDER.either, true);

      await token._approve(SPENDER.either, TOKENID_1, SPENDER.either);
      expect(await token.getApproved(TOKENID_1)).toEqual(SPENDER.either);
    });

    it('should throw if auth is unauthorized', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await expect(
        token._approve(SPENDER.either, TOKENID_1, UNAUTHORIZED.either),
      ).rejects.toThrow('NonFungibleToken: invalid approver');
    });

    it('should approve if auth is zero address', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await token._approve(SPENDER.either, TOKENID_1, ZERO_ACCOUNT);
      expect(await token.getApproved(TOKENID_1)).toEqual(SPENDER.either);
    });

    it('should canonicalize approved address', async () => {
      await token._mint(OWNER.either, TOKENID_1);

      const nonCanonical = {
        is_left: true,
        left: SPENDER.accountId,
        right: utils.encodeToAddress('JUNK_DATA'),
      };

      await token._approve(nonCanonical, TOKENID_1, OWNER.either);
      expect(await token.getApproved(TOKENID_1)).toEqual(SPENDER.either);
    });

    it('should normalize right-variant zero to zeroAccount()', async () => {
      await token._mint(OWNER.either, TOKENID_1);

      // Approve with a right-variant zero (contract address zero)
      await token._approve(ZERO_CONTRACT, TOKENID_1, OWNER.either);

      // getApproved should return the left-variant zeroAccount, not the right-variant
      expect(await token.getApproved(TOKENID_1)).toEqual(ZERO_ACCOUNT);
    });

    it('should normalize left-variant zero to zeroAccount()', async () => {
      await token._mint(OWNER.either, TOKENID_1);

      // First set a real approval
      await token._approve(SPENDER.either, TOKENID_1, OWNER.either);
      expect(await token.getApproved(TOKENID_1)).toEqual(SPENDER.either);

      // Clear it with left-variant zero
      await token._approve(ZERO_ACCOUNT, TOKENID_1, OWNER.either);
      expect(await token.getApproved(TOKENID_1)).toEqual(ZERO_ACCOUNT);
    });
  });

  describe('_checkAuthorized', () => {
    it('should throw if token not minted', async () => {
      await expect(
        token._checkAuthorized(ZERO_ACCOUNT, OWNER.either, TOKENID_1),
      ).rejects.toThrow('NonFungibleToken: nonexistent token');
    });

    it('should throw if unauthorized', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await expect(
        token._checkAuthorized(OWNER.either, UNAUTHORIZED.either, TOKENID_1),
      ).rejects.toThrow('NonFungibleToken: insufficient approval');
    });

    it('should not throw if approved', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.approve(SPENDER.either, TOKENID_1);
      await token._checkAuthorized(OWNER.either, SPENDER.either, TOKENID_1);
    });

    it('should not throw if approvedForAll', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.setApprovalForAll(SPENDER.either, true);
      await token._checkAuthorized(OWNER.either, SPENDER.either, TOKENID_1);
    });
  });

  describe('_isAuthorized', () => {
    beforeEach(async () => {
      await token._mint(OWNER.either, TOKENID_1);
    });

    it('should return true if spender is authorized', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.approve(SPENDER.either, TOKENID_1);
      expect(
        await token._isAuthorized(OWNER.either, SPENDER.either, TOKENID_1),
      ).toBe(true);
    });

    it('should return true if spender is authorized for all', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.setApprovalForAll(SPENDER.either, true);
      expect(
        await token._isAuthorized(OWNER.either, SPENDER.either, TOKENID_1),
      ).toBe(true);
    });

    it('should return true if spender is owner', async () => {
      expect(
        await token._isAuthorized(OWNER.either, OWNER.either, TOKENID_1),
      ).toBe(true);
    });

    it('should return false if spender is zero address', async () => {
      expect(
        await token._isAuthorized(OWNER.either, ZERO_ACCOUNT, TOKENID_1),
      ).toBe(false);
    });

    it('should return false for unauthorized', async () => {
      expect(
        await token._isAuthorized(OWNER.either, UNAUTHORIZED.either, TOKENID_1),
      ).toBe(false);
    });
  });

  describe('_getApproved', () => {
    beforeEach(async () => {
      await token._mint(OWNER.either, TOKENID_1);
    });

    it('should return zero address if token is not minted', async () => {
      expect(await token._getApproved(NON_EXISTENT_TOKEN)).toEqual(
        ZERO_ACCOUNT,
      );
    });

    it('should return approved address', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.approve(SPENDER.either, TOKENID_1);
      expect(await token._getApproved(TOKENID_1)).toEqual(SPENDER.either);
    });

    it('should return zero address if no approvals', async () => {
      expect(await token._getApproved(TOKENID_1)).toEqual(ZERO_ACCOUNT);
    });
  });

  describe('_setApprovalForAll', () => {
    it('should approve operator', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await token._setApprovalForAll(OWNER.either, SPENDER.either, true);
      expect(await token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
        true,
      );
    });

    it('should revoke operator approval', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.setApprovalForAll(SPENDER.either, true);
      expect(await token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
        true,
      );

      await token._setApprovalForAll(OWNER.either, SPENDER.either, false);
      expect(await token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
        false,
      );
    });

    it('should throw if operator is zero address (left)', async () => {
      await expect(
        token._setApprovalForAll(OWNER.either, ZERO_ACCOUNT, true),
      ).rejects.toThrow('NonFungibleToken: invalid operator');
    });

    it('should throw if operator is zero address (right)', async () => {
      await expect(
        token._setApprovalForAll(OWNER.either, ZERO_CONTRACT, true),
      ).rejects.toThrow('NonFungibleToken: invalid operator');
    });

    it('should fail if owner is zero address (left)', async () => {
      await expect(
        token._setApprovalForAll(ZERO_ACCOUNT, RECIPIENT.either, true),
      ).rejects.toThrow('NonFungibleToken: invalid owner');
    });

    it('should fail if owner is zero address (right)', async () => {
      await expect(
        token._setApprovalForAll(ZERO_CONTRACT, RECIPIENT.either, true),
      ).rejects.toThrow('NonFungibleToken: invalid owner');
    });

    it('should canonicalize owner and operator', async () => {
      await token._mint(OWNER.either, TOKENID_1);

      const nonCanonicalOwner = {
        is_left: true,
        left: OWNER.accountId,
        right: utils.encodeToAddress('JUNK_DATA'),
      };
      const nonCanonicalOp = {
        is_left: true,
        left: SPENDER.accountId,
        right: utils.encodeToAddress('JUNK_DATA'),
      };

      await token._setApprovalForAll(nonCanonicalOwner, nonCanonicalOp, true);
      expect(await token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
        true,
      );
    });
  });

  describe('_mint', () => {
    it('should not mint to ContractAddress', async () => {
      await expect(token._mint(SOME_CONTRACT, TOKENID_1)).rejects.toThrow(
        'NonFungibleToken: unsafe transfer',
      );
    });

    it('should not mint to zero address', async () => {
      await expect(token._mint(ZERO_ACCOUNT, TOKENID_1)).rejects.toThrow(
        'NonFungibleToken: invalid receiver',
      );
    });

    it('should not mint a token that already exists', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await expect(token._mint(OWNER.either, TOKENID_1)).rejects.toThrow(
        'NonFungibleToken: invalid sender',
      );
    });

    it('should mint token', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      expect(await token.ownerOf(TOKENID_1)).toEqual(OWNER.either);
      expect(await token.balanceOf(OWNER.either)).toEqual(1n);

      await token._mint(OWNER.either, TOKENID_2);
      await token._mint(OWNER.either, TOKENID_3);
      expect(await token.balanceOf(OWNER.either)).toEqual(3n);
    });

    it('should mint multiple tokens in sequence', async () => {
      for (let i = 0; i < 10; i++) {
        await token._mint(OWNER.either, TOKENID_1 + BigInt(i));
      }
      expect(await token.balanceOf(OWNER.either)).toEqual(10n);
    });

    it('should mint with very long token IDs', async () => {
      const longTokenId = BigInt('18446744073709551615');
      await token._mint(OWNER.either, longTokenId);
      expect(await token.ownerOf(longTokenId)).toEqual(OWNER.either);
    });

    it('should mint after burning', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await token._burn(TOKENID_1);
      await token._mint(OWNER.either, TOKENID_1);
      expect(await token.ownerOf(TOKENID_1)).toEqual(OWNER.either);
    });

    it('should mint with special characters in metadata', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await token._setTokenURI(TOKENID_1, '!@#$%^&*()_+');
      expect(await token.tokenURI(TOKENID_1)).toEqual('!@#$%^&*()_+');
    });

    it('should canonicalize recipient', async () => {
      const nonCanonical = {
        is_left: true,
        left: OWNER.accountId,
        right: utils.encodeToAddress('JUNK_DATA'),
      };

      await token._mint(nonCanonical, TOKENID_1);
      expect(await token.ownerOf(TOKENID_1)).toEqual(OWNER.either);
      expect(await token.balanceOf(OWNER.either)).toEqual(1n);
    });

    it('should not mint to zero (contract)', async () => {
      await expect(token._mint(ZERO_CONTRACT, TOKENID_1)).rejects.toThrow(
        'NonFungibleToken: unsafe transfer',
      );
    });
  });

  describe('_burn', () => {
    beforeEach(async () => {
      await token._mint(OWNER.either, TOKENID_1);
    });

    it('should burn token', async () => {
      expect(await token.balanceOf(OWNER.either)).toEqual(1n);

      await token._burn(TOKENID_1);
      expect(await token._ownerOf(TOKENID_1)).toEqual(ZERO_ACCOUNT);
      expect(await token.balanceOf(OWNER.either)).toEqual(0n);
    });

    it('should not burn a token that does not exist', async () => {
      await expect(token._burn(NON_EXISTENT_TOKEN)).rejects.toThrow(
        'NonFungibleToken: invalid sender',
      );
    });

    it('should clear approval when token is burned', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.approve(SPENDER.either, TOKENID_1);
      expect(await token.getApproved(TOKENID_1)).toEqual(SPENDER.either);

      await token._burn(TOKENID_1);
      expect(await token._getApproved(TOKENID_1)).toEqual(ZERO_ACCOUNT);
    });

    it('should burn multiple tokens in sequence', async () => {
      await token._mint(OWNER.either, TOKENID_2);
      await token._mint(OWNER.either, TOKENID_3);

      await token._burn(TOKENID_1);
      await token._burn(TOKENID_2);
      await token._burn(TOKENID_3);
      expect(await token.balanceOf(OWNER.either)).toEqual(0n);
    });

    it('should burn with very long token IDs', async () => {
      const longTokenId = BigInt('18446744073709551615');
      await token._mint(OWNER.either, longTokenId);
      await token._burn(longTokenId);
      expect(await token._ownerOf(longTokenId)).toEqual(ZERO_ACCOUNT);
    });

    it('should burn after transfer', async () => {
      await token._transfer(OWNER.either, SPENDER.either, TOKENID_1);
      await token._burn(TOKENID_1);
      expect(await token._ownerOf(TOKENID_1)).toEqual(ZERO_ACCOUNT);
    });

    it('should burn after approval', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.approve(SPENDER.either, TOKENID_1);
      await token._burn(TOKENID_1);
      expect(await token._ownerOf(TOKENID_1)).toEqual(ZERO_ACCOUNT);
      expect(await token._getApproved(TOKENID_1)).toEqual(ZERO_ACCOUNT);
    });

    it('should clear tokenURI on burn', async () => {
      await token._setTokenURI(TOKENID_1, SOME_URI);
      expect(await token.tokenURI(TOKENID_1)).toEqual(SOME_URI);

      await token._burn(TOKENID_1);

      await token._mint(OWNER.either, TOKENID_1);
      expect(await token.tokenURI(TOKENID_1)).toEqual(EMPTY_URI);
    });
  });

  describe('_transfer', () => {
    it('should not transfer to ContractAddress', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await expect(
        token._transfer(OWNER.either, SOME_CONTRACT, TOKENID_1),
      ).rejects.toThrow('NonFungibleToken: unsafe transfer');
    });

    it('should transfer token', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      expect(await token.balanceOf(OWNER.either)).toEqual(1n);
      expect(await token.balanceOf(SPENDER.either)).toEqual(0n);
      expect(await token.ownerOf(TOKENID_1)).toEqual(OWNER.either);

      await token._transfer(OWNER.either, SPENDER.either, TOKENID_1);
      expect(await token.balanceOf(OWNER.either)).toEqual(0n);
      expect(await token.balanceOf(SPENDER.either)).toEqual(1n);
      expect(await token.ownerOf(TOKENID_1)).toEqual(SPENDER.either);
    });

    it('should not transfer to zero address', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await expect(
        token._transfer(OWNER.either, ZERO_ACCOUNT, TOKENID_1),
      ).rejects.toThrow('NonFungibleToken: invalid receiver');
    });

    it('should throw if from does not own token', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await expect(
        token._transfer(UNAUTHORIZED.either, SPENDER.either, TOKENID_1),
      ).rejects.toThrow('NonFungibleToken: incorrect owner');
    });

    it('should throw if token does not exist', async () => {
      await expect(
        token._transfer(OWNER.either, SPENDER.either, NON_EXISTENT_TOKEN),
      ).rejects.toThrow('NonFungibleToken: nonexistent token');
    });

    it('should revoke approval after _transfer', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.approve(SPENDER.either, TOKENID_1);
      await token._transfer(OWNER.either, OTHER.either, TOKENID_1);
      expect(await token.getApproved(TOKENID_1)).toEqual(ZERO_ACCOUNT);
    });
  });

  describe('_setTokenURI', () => {
    it('should throw if token does not exist', async () => {
      await expect(
        token._setTokenURI(NON_EXISTENT_TOKEN, EMPTY_URI),
      ).rejects.toThrow('NonFungibleToken: nonexistent token');
    });

    it('should set tokenURI', async () => {
      await token._mint(OWNER.either, TOKENID_1);
      await token._setTokenURI(TOKENID_1, SOME_URI);
      expect(await token.tokenURI(TOKENID_1)).toEqual(SOME_URI);
    });
  });

  describe('_unsafeMint', () => {
    it('should mint to ContractAddress', async () => {
      await token._unsafeMint(SOME_CONTRACT, TOKENID_1);
    });

    it('should not mint to zero address (accountId)', async () => {
      await expect(token._unsafeMint(ZERO_ACCOUNT, TOKENID_1)).rejects.toThrow(
        'NonFungibleToken: invalid receiver',
      );
    });

    it('should not mint to zero address (contract)', async () => {
      await expect(token._unsafeMint(ZERO_CONTRACT, TOKENID_1)).rejects.toThrow(
        'NonFungibleToken: invalid receiver',
      );
    });

    it('should not mint a token that already exists', async () => {
      await token._unsafeMint(OWNER.either, TOKENID_1);
      await expect(token._unsafeMint(OWNER.either, TOKENID_1)).rejects.toThrow(
        'NonFungibleToken: invalid sender',
      );
    });

    it('should mint token to account', async () => {
      await token._unsafeMint(OWNER.either, TOKENID_1);
      expect(await token.ownerOf(TOKENID_1)).toEqual(OWNER.either);
      expect(await token.balanceOf(OWNER.either)).toEqual(1n);

      await token._unsafeMint(OWNER.either, TOKENID_2);
      await token._unsafeMint(OWNER.either, TOKENID_3);
      expect(await token.balanceOf(OWNER.either)).toEqual(3n);
    });
  });

  describe('_unsafeTransfer', () => {
    beforeEach(async () => {
      await token._mint(OWNER.either, TOKENID_1);
    });

    it('should transfer to ContractAddress', async () => {
      await token._unsafeTransfer(OWNER.either, SOME_CONTRACT, TOKENID_1);
    });

    it('should transfer token to account', async () => {
      expect(await token.balanceOf(OWNER.either)).toEqual(1n);
      expect(await token.balanceOf(SPENDER.either)).toEqual(0n);
      expect(await token.ownerOf(TOKENID_1)).toEqual(OWNER.either);

      await token._unsafeTransfer(OWNER.either, SPENDER.either, TOKENID_1);
      expect(await token.balanceOf(OWNER.either)).toEqual(0n);
      expect(await token.balanceOf(SPENDER.either)).toEqual(1n);
      expect(await token.ownerOf(TOKENID_1)).toEqual(SPENDER.either);
    });

    it('should not transfer to zero address (accountId)', async () => {
      await expect(
        token._unsafeTransfer(OWNER.either, ZERO_ACCOUNT, TOKENID_1),
      ).rejects.toThrow('NonFungibleToken: invalid receiver');
    });

    it('should not transfer to zero address (contract)', async () => {
      await expect(
        token._unsafeTransfer(OWNER.either, ZERO_CONTRACT, TOKENID_1),
      ).rejects.toThrow('NonFungibleToken: invalid receiver');
    });

    it('should throw if from does not own token', async () => {
      await expect(
        token._unsafeTransfer(
          UNAUTHORIZED.either,
          UNAUTHORIZED.either,
          TOKENID_1,
        ),
      ).rejects.toThrow('NonFungibleToken: incorrect owner');
    });

    it('should throw if token does not exist', async () => {
      await expect(
        token._unsafeTransfer(OWNER.either, SPENDER.either, NON_EXISTENT_TOKEN),
      ).rejects.toThrow('NonFungibleToken: nonexistent token');
    });

    it('should revoke approval after _unsafeTransfer', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.approve(SPENDER.either, TOKENID_1);
      await token._unsafeTransfer(OWNER.either, OTHER.either, TOKENID_1);
      expect(await token.getApproved(TOKENID_1)).toEqual(ZERO_ACCOUNT);
    });

    it('should canonicalize contract address recipient', async () => {
      const nonCanonical = {
        is_left: false,
        left: new Uint8Array(32).fill(1),
        right: SOME_CONTRACT.right,
      };

      await token._unsafeTransfer(OWNER.either, nonCanonical, TOKENID_1);
      expect(await token.ownerOf(TOKENID_1)).toEqual(SOME_CONTRACT);
      expect(await token.balanceOf(SOME_CONTRACT)).toEqual(1n);
    });

    it('should handle non-canonical fromAddress', async () => {
      const nonCanonical = {
        is_left: true,
        left: OWNER.accountId,
        right: utils.encodeToAddress('JUNK_DATA'),
      };

      await token._unsafeTransfer(nonCanonical, SPENDER.either, TOKENID_1);
      expect(await token.ownerOf(TOKENID_1)).toEqual(SPENDER.either);
    });
  });

  describe('_unsafeTransferFrom', () => {
    beforeEach(async () => {
      await token._mint(OWNER.either, TOKENID_1);
    });

    it('should transfer to ContractAddress', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token._unsafeTransferFrom(OWNER.either, SOME_CONTRACT, TOKENID_1);
    });

    it('should not transfer to zero address (accountId)', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await expect(
        token._unsafeTransferFrom(OWNER.either, ZERO_ACCOUNT, TOKENID_1),
      ).rejects.toThrow('NonFungibleToken: invalid receiver');
    });

    it('should not transfer to zero address (contract)', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await expect(
        token._unsafeTransferFrom(OWNER.either, ZERO_CONTRACT, TOKENID_1),
      ).rejects.toThrow('NonFungibleToken: invalid receiver');
    });

    it('should not transfer from zero address', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await expect(
        token._unsafeTransferFrom(ZERO_ACCOUNT, SPENDER.either, TOKENID_1),
      ).rejects.toThrow('NonFungibleToken: incorrect owner');
    });

    it('unapproved operator should not transfer', async () => {
      await token.privateState.injectSecretKey(SPENDER.secretKey);
      await expect(
        token._unsafeTransferFrom(OWNER.either, UNAUTHORIZED.either, TOKENID_1),
      ).rejects.toThrow('NonFungibleToken: insufficient approval');
    });

    it('should not transfer token that has not been minted', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await expect(
        token._unsafeTransferFrom(
          OWNER.either,
          SPENDER.either,
          NON_EXISTENT_TOKEN,
        ),
      ).rejects.toThrow('NonFungibleToken: nonexistent token');
    });

    it('should transfer token to spender via approved operator', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.approve(SPENDER.either, TOKENID_1);

      await token.privateState.injectSecretKey(SPENDER.secretKey);
      await token._unsafeTransferFrom(OWNER.either, SPENDER.either, TOKENID_1);
      expect(await token.ownerOf(TOKENID_1)).toEqual(SPENDER.either);
    });

    it('should transfer token to ContractAddress via approved operator', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.approve(SPENDER.either, TOKENID_1);

      await token.privateState.injectSecretKey(SPENDER.secretKey);
      await token._unsafeTransferFrom(OWNER.either, SOME_CONTRACT, TOKENID_1);
      expect(await token.ownerOf(TOKENID_1)).toEqual(SOME_CONTRACT);
    });

    it('should transfer token to spender via approvedForAll operator', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.setApprovalForAll(SPENDER.either, true);

      await token.privateState.injectSecretKey(SPENDER.secretKey);
      await token._unsafeTransferFrom(OWNER.either, SPENDER.either, TOKENID_1);
      expect(await token.ownerOf(TOKENID_1)).toEqual(SPENDER.either);
    });

    it('should transfer token to ContractAddress via approvedForAll operator', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.setApprovalForAll(SPENDER.either, true);

      await token.privateState.injectSecretKey(SPENDER.secretKey);
      await token._unsafeTransferFrom(OWNER.either, SOME_CONTRACT, TOKENID_1);
      expect(await token.ownerOf(TOKENID_1)).toEqual(SOME_CONTRACT);
    });

    it('should revoke approval after _unsafeTransferFrom', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);
      await token.approve(SPENDER.either, TOKENID_1);

      await token._unsafeTransferFrom(OWNER.either, OTHER.either, TOKENID_1);
      expect(await token.getApproved(TOKENID_1)).toEqual(ZERO_ACCOUNT);
    });

    it('should handle non-canonical fromAddress', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);

      const nonCanonical = {
        is_left: true,
        left: OWNER.accountId,
        right: utils.encodeToAddress('JUNK_DATA'),
      };

      await token._unsafeTransferFrom(nonCanonical, SPENDER.either, TOKENID_1);
      expect(await token.ownerOf(TOKENID_1)).toEqual(SPENDER.either);
    });

    it('should canonicalize contract address recipient', async () => {
      await token.privateState.injectSecretKey(OWNER.secretKey);

      const nonCanonical = {
        is_left: false,
        left: new Uint8Array(32).fill(1),
        right: SOME_CONTRACT.right,
      };

      await token._unsafeTransferFrom(OWNER.either, nonCanonical, TOKENID_1);
      expect(await token.ownerOf(TOKENID_1)).toEqual(SOME_CONTRACT);
      expect(await token.balanceOf(SOME_CONTRACT)).toEqual(1n);
    });
  });
});

// Uninitialized tests
type FailingCircuits = [
  method: keyof NonFungibleTokenSimulator,
  args: unknown[],
];

const circuitsToFail: FailingCircuits[] = [
  ['name', []],
  ['symbol', []],
  ['balanceOf', [OWNER.either]],
  ['ownerOf', [TOKENID_1]],
  ['tokenURI', [TOKENID_1]],
  ['approve', [OWNER.either, TOKENID_1]],
  ['getApproved', [TOKENID_1]],
  ['setApprovalForAll', [SPENDER.either, true]],
  ['isApprovedForAll', [OWNER.either, SPENDER.either]],
  ['transferFrom', [OWNER.either, RECIPIENT.either, TOKENID_1]],
  ['_requireOwned', [TOKENID_1]],
  ['_ownerOf', [TOKENID_1]],
  ['_approve', [OWNER.either, TOKENID_1, SPENDER.either]],
  ['_checkAuthorized', [OWNER.either, SPENDER.either, TOKENID_1]],
  ['_isAuthorized', [OWNER.either, SPENDER.either, TOKENID_1]],
  ['_getApproved', [TOKENID_1]],
  ['_setApprovalForAll', [OWNER.either, SPENDER.either, true]],
  ['_mint', [OWNER.either, TOKENID_1]],
  ['_burn', [TOKENID_1]],
  ['_transfer', [OWNER.either, RECIPIENT.either, TOKENID_1]],
  ['_setTokenURI', [TOKENID_1, EMPTY_URI]],
  ['_unsafeTransferFrom', [OWNER.either, RECIPIENT.either, TOKENID_1]],
  ['_unsafeTransfer', [OWNER.either, RECIPIENT.either, TOKENID_1]],
  ['_unsafeMint', [OWNER.either, TOKENID_1]],
];

let uninitializedToken: NonFungibleTokenSimulator;

describe('Uninitialized NonFungibleToken', () => {
  beforeEach(async () => {
    uninitializedToken = await NonFungibleTokenSimulator.create(
      NAME,
      SYMBOL,
      BAD_INIT,
    );
  });

  it.each(circuitsToFail)('%s should fail', async (circuitName, args) => {
    await expect(
      (
        uninitializedToken[circuitName] as (
          ...args: unknown[]
        ) => Promise<unknown>
      )(...args),
    ).rejects.toThrow('NonFungibleToken: contract not initialized');
  });
});

describe('NonFungibleTokenSimulator wiring', () => {
  it('should expose an empty public ledger via getPublicState', async () => {
    const sim = await NonFungibleTokenSimulator.create(NAME, SYMBOL, INIT);

    expect(await sim.getPublicState()).toStrictEqual({});
  });

  describe('privateState getCurrentSecretKey', () => {
    it('should return the injected secret key', async () => {
      const sim = await NonFungibleTokenSimulator.create(NAME, SYMBOL, INIT);
      await sim.privateState.injectSecretKey(OWNER.secretKey);

      expect(await sim.privateState.getCurrentSecretKey()).toEqual(
        OWNER.secretKey,
      );
    });

    it('should throw when the secret key is undefined', async () => {
      const sim = await NonFungibleTokenSimulator.create(NAME, SYMBOL, INIT, {
        privateState: { secretKey: undefined as unknown as Uint8Array },
      });

      await expect(sim.privateState.getCurrentSecretKey()).rejects.toThrow(
        'Missing secret key',
      );
    });
  });
});
