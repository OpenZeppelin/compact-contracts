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
    it('should initialize metadata', () => {
      token = new NonFungibleTokenSimulator(NAME, SYMBOL, INIT);
      expect(token.name()).toEqual(NAME);
      expect(token.symbol()).toEqual(SYMBOL);
    });

    it('should initialize empty metadata', () => {
      token = new NonFungibleTokenSimulator(EMPTY_STRING, EMPTY_STRING, INIT);
      expect(token.name()).toEqual(EMPTY_STRING);
      expect(token.symbol()).toEqual(EMPTY_STRING);
    });

    it('should initialize metadata with whitespace', () => {
      token = new NonFungibleTokenSimulator('  NAME  ', '  SYMBOL  ', INIT);
      expect(token.name()).toEqual('  NAME  ');
      expect(token.symbol()).toEqual('  SYMBOL  ');
    });

    it('should initialize metadata with special characters', () => {
      token = new NonFungibleTokenSimulator('NAME!@#', 'SYMBOL$%^', INIT);
      expect(token.name()).toEqual('NAME!@#');
      expect(token.symbol()).toEqual('SYMBOL$%^');
    });

    it('should initialize metadata with very long strings', () => {
      const longName = 'A'.repeat(1000);
      const longSymbol = 'B'.repeat(1000);
      token = new NonFungibleTokenSimulator(longName, longSymbol, INIT);
      expect(token.name()).toEqual(longName);
      expect(token.symbol()).toEqual(longSymbol);
    });
  });

  beforeEach(() => {
    token = new NonFungibleTokenSimulator(NAME, SYMBOL, INIT);
  });

  describe('computeAccountId', () => {
    const users = [OWNER, SPENDER, RECIPIENT, UNAUTHORIZED];

    it('should match the test helper derivation', () => {
      for (const user of users) {
        expect(token.computeAccountId(user.secretKey)).toEqual(user.accountId);
      }
    });

    it('should produce distinct identifiers for distinct keys', () => {
      const ids = users.map((u) => token.computeAccountId(u.secretKey));
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          expect(ids[i]).not.toEqual(ids[j]);
        }
      }
    });
  });

  describe('ZERO', () => {
    it('should return a left variant', () => {
      const zero = token.ZERO();
      expect(zero.is_left).toBe(true);
    });

    it('should have zero left branch', () => {
      const zero = token.ZERO();
      expect(zero.left).toEqual(zeroBytes);
    });

    it('should have zero right branch', () => {
      const zero = token.ZERO();
      expect(zero.right).toEqual({ bytes: zeroBytes });
    });

    it('should be canonical', () => {
      const zero = token.ZERO();
      expect(zero).toEqual(ZERO_ACCOUNT);
    });

    it('should not equal a right-variant zero', () => {
      const zero = token.ZERO();
      expect(zero).not.toEqual(ZERO_CONTRACT);
    });
  });

  describe('balanceOf', () => {
    it('should return zero when requested account has no balance', () => {
      expect(token.balanceOf(OWNER.either)).toEqual(0n);
    });

    it('should return balance when requested account has tokens', () => {
      token._mint(OWNER.either, AMOUNT);
      expect(token.balanceOf(OWNER.either)).toEqual(AMOUNT);
    });

    it('should return correct balance for multiple tokens', () => {
      token._mint(OWNER.either, TOKENID_1);
      token._mint(OWNER.either, TOKENID_2);
      token._mint(OWNER.either, TOKENID_3);
      expect(token.balanceOf(OWNER.either)).toEqual(3n);
    });

    it('should return correct balance after burning multiple tokens', () => {
      token._mint(OWNER.either, TOKENID_1);
      token._mint(OWNER.either, TOKENID_2);
      token._mint(OWNER.either, TOKENID_3);
      token._burn(TOKENID_1);
      token._burn(TOKENID_2);
      expect(token.balanceOf(OWNER.either)).toEqual(1n);
    });

    it('should return correct balance after transferring multiple tokens', () => {
      token._mint(OWNER.either, TOKENID_1);
      token._mint(OWNER.either, TOKENID_2);
      token._mint(OWNER.either, TOKENID_3);
      token._transfer(OWNER.either, RECIPIENT.either, TOKENID_1);
      token._transfer(OWNER.either, RECIPIENT.either, TOKENID_2);
      expect(token.balanceOf(OWNER.either)).toEqual(1n);
      expect(token.balanceOf(RECIPIENT.either)).toEqual(2n);
    });

    it('should return correct balance with non-canonical lookup (left)', () => {
      token._mint(OWNER.either, TOKENID_1);

      const nonCanonical = {
        is_left: true,
        left: OWNER.accountId,
        right: utils.encodeToAddress('JUNK_DATA'),
      };

      expect(token.balanceOf(nonCanonical)).toEqual(1n);
    });

    it('should return correct balance with non-canonical lookup (right)', () => {
      token._unsafeMint(SOME_CONTRACT, TOKENID_1);

      const nonCanonical = {
        is_left: false,
        left: new Uint8Array(32).fill(1),
        right: SOME_CONTRACT.right,
      };

      expect(token.balanceOf(nonCanonical)).toEqual(1n);
    });
  });

  describe('ownerOf', () => {
    it('should throw if token does not exist', () => {
      expect(() => {
        token.ownerOf(NON_EXISTENT_TOKEN);
      }).toThrow('NonFungibleToken: nonexistent token');
    });

    it('should throw if token has been burned', () => {
      token._mint(OWNER.either, TOKENID_1);
      token._burn(TOKENID_1);
      expect(() => {
        token.ownerOf(TOKENID_1);
      }).toThrow('NonFungibleToken: nonexistent token');
    });

    it('should return owner of token if it exists', () => {
      token._mint(OWNER.either, TOKENID_1);
      expect(token.ownerOf(TOKENID_1)).toEqual(OWNER.either);
    });

    it('should return correct owner for multiple tokens', () => {
      token._mint(OWNER.either, TOKENID_1);
      token._mint(OWNER.either, TOKENID_2);
      token._mint(OWNER.either, TOKENID_3);
      expect(token.ownerOf(TOKENID_1)).toEqual(OWNER.either);
      expect(token.ownerOf(TOKENID_2)).toEqual(OWNER.either);
      expect(token.ownerOf(TOKENID_3)).toEqual(OWNER.either);
    });

    it('should return correct owner after multiple transfers', () => {
      token._mint(OWNER.either, TOKENID_1);
      token._mint(OWNER.either, TOKENID_2);
      token._transfer(OWNER.either, SPENDER.either, TOKENID_1);
      token._transfer(OWNER.either, OTHER.either, TOKENID_2);
      expect(token.ownerOf(TOKENID_1)).toEqual(SPENDER.either);
      expect(token.ownerOf(TOKENID_2)).toEqual(OTHER.either);
    });

    it('should return correct owner after multiple burns and mints', () => {
      token._mint(OWNER.either, TOKENID_1);
      token._burn(TOKENID_1);
      token._mint(SPENDER.either, TOKENID_1);
      expect(token.ownerOf(TOKENID_1)).toEqual(SPENDER.either);
    });
  });

  describe('tokenURI', () => {
    beforeEach(() => {
      token._mint(OWNER.either, TOKENID_1);
    });

    it('should throw if token does not exist', () => {
      expect(() => {
        token.tokenURI(NON_EXISTENT_TOKEN);
      }).toThrow('NonFungibleToken: nonexistent token');
    });

    it('should return the empty string for an unset tokenURI', () => {
      expect(token.tokenURI(TOKENID_1)).toEqual(EMPTY_URI);
    });

    it('should return the empty string if tokenURI set as default value', () => {
      token._setTokenURI(TOKENID_1, EMPTY_URI);
      expect(token.tokenURI(TOKENID_1)).toEqual(EMPTY_URI);
    });

    it('should return some string if tokenURI is set', () => {
      token._setTokenURI(TOKENID_1, SOME_URI);
      expect(token.tokenURI(TOKENID_1)).toEqual(SOME_URI);
    });

    it('should return very long tokenURI', () => {
      const longURI = 'A'.repeat(1000);
      token._setTokenURI(TOKENID_1, longURI);
      expect(token.tokenURI(TOKENID_1)).toEqual(longURI);
    });

    it('should return tokenURI with special characters', () => {
      const specialURI = '!@#$%^&*()_+';
      token._setTokenURI(TOKENID_1, specialURI);
      expect(token.tokenURI(TOKENID_1)).toEqual(specialURI);
    });

    it('should update tokenURI multiple times', () => {
      token._setTokenURI(TOKENID_1, 'URI1');
      token._setTokenURI(TOKENID_1, 'URI2');
      token._setTokenURI(TOKENID_1, 'URI3');
      expect(token.tokenURI(TOKENID_1)).toEqual('URI3');
    });

    it('should maintain tokenURI after token transfer', () => {
      token._setTokenURI(TOKENID_1, SOME_URI);
      token._transfer(OWNER.either, RECIPIENT.either, TOKENID_1);
      expect(token.tokenURI(TOKENID_1)).toEqual(SOME_URI);
    });
  });

  describe('approve', () => {
    beforeEach(() => {
      token._mint(OWNER.either, TOKENID_1);
      expect(token.getApproved(TOKENID_1)).toEqual(ZERO_ACCOUNT);
    });

    it('should throw if not owner', () => {
      token.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
      expect(() => {
        token.approve(SPENDER.either, TOKENID_1);
      }).toThrow('NonFungibleToken: invalid approver');
    });

    it('should approve spender', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.approve(SPENDER.either, TOKENID_1);
      expect(token.getApproved(TOKENID_1)).toEqual(SPENDER.either);
    });

    it('should allow operator to approve', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.setApprovalForAll(SPENDER.either, true);

      token.privateState.injectSecretKey(SPENDER.secretKey);
      token.approve(OTHER.either, TOKENID_1);
      expect(token.getApproved(TOKENID_1)).toEqual(OTHER.either);
    });

    it('spender approved for only TOKENID_1 should not be able to approve', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.approve(SPENDER.either, TOKENID_1);

      token.privateState.injectSecretKey(SPENDER.secretKey);
      expect(() => {
        token.approve(OTHER.either, TOKENID_1);
      }).toThrow('NonFungibleToken: invalid approver');
    });

    it('should approve same address multiple times', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.approve(SPENDER.either, TOKENID_1);
      token.approve(SPENDER.either, TOKENID_1);
      expect(token.getApproved(TOKENID_1)).toEqual(SPENDER.either);
    });

    it('should approve after token transfer', () => {
      token._transfer(OWNER.either, SPENDER.either, TOKENID_1);

      token.privateState.injectSecretKey(SPENDER.secretKey);
      token.approve(OTHER.either, TOKENID_1);
      expect(token.getApproved(TOKENID_1)).toEqual(OTHER.either);
    });

    it('should approve after token burn and remint', () => {
      token._burn(TOKENID_1);
      token._mint(OWNER.either, TOKENID_1);

      token.privateState.injectSecretKey(OWNER.secretKey);
      token.approve(SPENDER.either, TOKENID_1);
      expect(token.getApproved(TOKENID_1)).toEqual(SPENDER.either);
    });

    it('should approve with very long token ID', () => {
      const longTokenId = BigInt('18446744073709551615');
      token._mint(OWNER.either, longTokenId);

      token.privateState.injectSecretKey(OWNER.secretKey);
      token.approve(SPENDER.either, longTokenId);
      expect(token.getApproved(longTokenId)).toEqual(SPENDER.either);
    });

    it('should normalize right-variant zero approval', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.approve(ZERO_CONTRACT, TOKENID_1);

      expect(token.getApproved(TOKENID_1)).toEqual(ZERO_ACCOUNT);
    });
  });

  describe('getApproved', () => {
    beforeEach(() => {
      token._mint(OWNER.either, TOKENID_1);
    });

    it('should throw if token does not exist', () => {
      expect(() => {
        token.getApproved(NON_EXISTENT_TOKEN);
      }).toThrow('NonFungibleToken: nonexistent token');
    });

    it('should throw if token has been burned', () => {
      token._burn(TOKENID_1);
      expect(() => {
        token.getApproved(TOKENID_1);
      }).toThrow('NonFungibleToken: nonexistent token');
    });

    it('should get current approved spender', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.approve(OWNER.either, TOKENID_1);
      expect(token.getApproved(TOKENID_1)).toEqual(OWNER.either);
    });

    it('should return zero if approval not set', () => {
      expect(token.getApproved(TOKENID_1)).toEqual(ZERO_ACCOUNT);
    });
  });

  describe('setApprovalForAll', () => {
    it('should not approve zero address', () => {
      token._mint(OWNER.either, TOKENID_1);
      token.privateState.injectSecretKey(OWNER.secretKey);

      expect(() => {
        token.setApprovalForAll(ZERO_ACCOUNT, true);
      }).toThrow('NonFungibleToken: invalid operator');
    });

    it('should set operator', () => {
      token._mint(OWNER.either, TOKENID_1);
      token.privateState.injectSecretKey(OWNER.secretKey);

      token.setApprovalForAll(SPENDER.either, true);
      expect(token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(true);
    });

    it('should allow operator to manage owner tokens', () => {
      token._mint(OWNER.either, TOKENID_1);
      token._mint(OWNER.either, TOKENID_2);
      token._mint(OWNER.either, TOKENID_3);

      token.privateState.injectSecretKey(OWNER.secretKey);
      token.setApprovalForAll(SPENDER.either, true);

      token.privateState.injectSecretKey(SPENDER.secretKey);
      token.transferFrom(OWNER.either, SPENDER.either, TOKENID_1);
      expect(token.ownerOf(TOKENID_1)).toEqual(SPENDER.either);

      token.approve(OTHER.either, TOKENID_2);
      expect(token.getApproved(TOKENID_2)).toEqual(OTHER.either);

      token.approve(SPENDER.either, TOKENID_3);
      expect(token.getApproved(TOKENID_3)).toEqual(SPENDER.either);
    });

    it('should revoke approval for all', () => {
      token._mint(OWNER.either, TOKENID_1);
      token.privateState.injectSecretKey(OWNER.secretKey);

      token.setApprovalForAll(SPENDER.either, true);
      expect(token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(true);

      token.setApprovalForAll(SPENDER.either, false);
      expect(token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(false);

      token.privateState.injectSecretKey(SPENDER.secretKey);
      expect(() => {
        token.approve(SPENDER.either, TOKENID_1);
      }).toThrow('NonFungibleToken: invalid approver');
    });

    it('should set approval for all to same address multiple times', () => {
      token._mint(OWNER.either, TOKENID_1);
      token.privateState.injectSecretKey(OWNER.secretKey);

      token.setApprovalForAll(SPENDER.either, true);
      token.setApprovalForAll(SPENDER.either, true);
      expect(token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(true);
    });

    it('should set approval for all after token transfer', () => {
      token._mint(OWNER.either, TOKENID_1);
      token._transfer(OWNER.either, SPENDER.either, TOKENID_1);

      token.privateState.injectSecretKey(SPENDER.secretKey);
      token.setApprovalForAll(OTHER.either, true);
      expect(token.isApprovedForAll(SPENDER.either, OTHER.either)).toBe(true);
    });

    it('should set approval for all with multiple operators', () => {
      token._mint(OWNER.either, TOKENID_1);
      token.privateState.injectSecretKey(OWNER.secretKey);

      token.setApprovalForAll(SPENDER.either, true);
      token.setApprovalForAll(OTHER.either, true);
      expect(token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(true);
      expect(token.isApprovedForAll(OWNER.either, OTHER.either)).toBe(true);
    });

    it('should set approval for all with very long token IDs', () => {
      const longTokenId = BigInt('18446744073709551615');
      token._mint(OWNER.either, longTokenId);
      token.privateState.injectSecretKey(OWNER.secretKey);

      token.setApprovalForAll(SPENDER.either, true);
      expect(token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(true);
    });
  });

  describe('isApprovedForAll', () => {
    it('should return false if approval not set', () => {
      expect(token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(false);
    });

    it('should return true if approval set', () => {
      token._mint(OWNER.either, TOKENID_1);
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.setApprovalForAll(SPENDER.either, true);
      expect(token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(true);
    });

    it('should return correct result with non-canonical owner lookup', () => {
      token._mint(OWNER.either, TOKENID_1);
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.setApprovalForAll(SPENDER.either, true);

      const nonCanonical = {
        is_left: true,
        left: OWNER.accountId,
        right: utils.encodeToAddress('JUNK_DATA'),
      };

      expect(token.isApprovedForAll(nonCanonical, SPENDER.either)).toBe(true);
    });

    it('should return correct result with non-canonical operator lookup', () => {
      token._mint(OWNER.either, TOKENID_1);
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.setApprovalForAll(SPENDER.either, true);

      const nonCanonical = {
        is_left: true,
        left: SPENDER.accountId,
        right: utils.encodeToAddress('JUNK_DATA'),
      };

      expect(token.isApprovedForAll(OWNER.either, nonCanonical)).toBe(true);
    });
  });

  describe('transferFrom', () => {
    beforeEach(() => {
      token._mint(OWNER.either, TOKENID_1);
    });

    it('should not transfer to ContractAddress', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      expect(() => {
        token.transferFrom(OWNER.either, SOME_CONTRACT, TOKENID_1);
      }).toThrow('NonFungibleToken: unsafe transfer');
    });

    it('should not transfer to zero address', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      expect(() => {
        token.transferFrom(OWNER.either, ZERO_ACCOUNT, TOKENID_1);
      }).toThrow('NonFungibleToken: invalid receiver');
    });

    it('should not transfer from zero address', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      expect(() => {
        token.transferFrom(ZERO_ACCOUNT, SPENDER.either, TOKENID_1);
      }).toThrow('NonFungibleToken: incorrect owner');
    });

    it('should not transfer from unauthorized', () => {
      token.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
      expect(() => {
        token.transferFrom(OWNER.either, UNAUTHORIZED.either, TOKENID_1);
      }).toThrow('NonFungibleToken: insufficient approval');
    });

    it('should not transfer token that has not been minted', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      expect(() => {
        token.transferFrom(OWNER.either, SPENDER.either, NON_EXISTENT_TOKEN);
      }).toThrow('NonFungibleToken: nonexistent token');
    });

    it('should transfer token without approvers or operators', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.transferFrom(OWNER.either, RECIPIENT.either, TOKENID_1);
      expect(token.ownerOf(TOKENID_1)).toEqual(RECIPIENT.either);
    });

    it('should transfer token via approved operator', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.approve(SPENDER.either, TOKENID_1);

      token.privateState.injectSecretKey(SPENDER.secretKey);
      token.transferFrom(OWNER.either, SPENDER.either, TOKENID_1);
      expect(token.ownerOf(TOKENID_1)).toEqual(SPENDER.either);
    });

    it('should transfer token via approvedForAll operator', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.setApprovalForAll(SPENDER.either, true);

      token.privateState.injectSecretKey(SPENDER.secretKey);
      token.transferFrom(OWNER.either, SPENDER.either, TOKENID_1);
      expect(token.ownerOf(TOKENID_1)).toEqual(SPENDER.either);
    });

    it('should allow transfer to same address', () => {
      token._approve(SPENDER.either, TOKENID_1, OWNER.either);
      token._setApprovalForAll(OWNER.either, SPENDER.either, true);

      token.privateState.injectSecretKey(OWNER.secretKey);
      expect(() => {
        token.transferFrom(OWNER.either, OWNER.either, TOKENID_1);
      }).not.toThrow();
      expect(token.ownerOf(TOKENID_1)).toEqual(OWNER.either);
      expect(token.balanceOf(OWNER.either)).toEqual(1n);
      expect(token.getApproved(TOKENID_1)).toEqual(ZERO_ACCOUNT);
      expect(
        token._isAuthorized(OWNER.either, SPENDER.either, TOKENID_1),
      ).toEqual(true);
    });

    it('should not transfer after approval revocation', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.approve(SPENDER.either, TOKENID_1);
      token.approve(ZERO_ACCOUNT, TOKENID_1);

      token.privateState.injectSecretKey(SPENDER.secretKey);
      expect(() => {
        token.transferFrom(OWNER.either, SPENDER.either, TOKENID_1);
      }).toThrow('NonFungibleToken: insufficient approval');
    });

    it('should not transfer after approval for all revocation', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.setApprovalForAll(SPENDER.either, true);
      token.setApprovalForAll(SPENDER.either, false);

      token.privateState.injectSecretKey(SPENDER.secretKey);
      expect(() => {
        token.transferFrom(OWNER.either, SPENDER.either, TOKENID_1);
      }).toThrow('NonFungibleToken: insufficient approval');
    });

    it('should transfer multiple tokens in sequence', () => {
      token._mint(OWNER.either, TOKENID_2);
      token._mint(OWNER.either, TOKENID_3);

      token.privateState.injectSecretKey(OWNER.secretKey);
      token.approve(SPENDER.either, TOKENID_1);
      token.approve(SPENDER.either, TOKENID_2);
      token.approve(SPENDER.either, TOKENID_3);

      token.privateState.injectSecretKey(SPENDER.secretKey);
      token.transferFrom(OWNER.either, SPENDER.either, TOKENID_1);
      token.transferFrom(OWNER.either, SPENDER.either, TOKENID_2);
      token.transferFrom(OWNER.either, SPENDER.either, TOKENID_3);

      expect(token.ownerOf(TOKENID_1)).toEqual(SPENDER.either);
      expect(token.ownerOf(TOKENID_2)).toEqual(SPENDER.either);
      expect(token.ownerOf(TOKENID_3)).toEqual(SPENDER.either);
    });

    it('should transfer with very long token IDs', () => {
      const longTokenId = BigInt('18446744073709551615');
      token._mint(OWNER.either, longTokenId);

      token.privateState.injectSecretKey(OWNER.secretKey);
      token.approve(SPENDER.either, longTokenId);

      token.privateState.injectSecretKey(SPENDER.secretKey);
      token.transferFrom(OWNER.either, SPENDER.either, longTokenId);
      expect(token.ownerOf(longTokenId)).toEqual(SPENDER.either);
    });

    it('should revoke approval after transferFrom', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.approve(SPENDER.either, TOKENID_1);
      token._setApprovalForAll(OWNER.either, SPENDER.either, true);

      token.transferFrom(OWNER.either, OTHER.either, TOKENID_1);
      expect(token.getApproved(TOKENID_1)).toEqual(ZERO_ACCOUNT);
      expect(token._isAuthorized(OTHER.either, SPENDER.either, TOKENID_1)).toBe(
        false,
      );

      token.privateState.injectSecretKey(SPENDER.secretKey);
      expect(() => {
        token.approve(UNAUTHORIZED.either, TOKENID_1);
      }).toThrow('NonFungibleToken: invalid approver');
      expect(() => {
        token.transferFrom(OTHER.either, UNAUTHORIZED.either, TOKENID_1);
      }).toThrow('NonFungibleToken: insufficient approval');
    });

    it('should store canonical zero after clearing approval via transfer', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.approve(SPENDER.either, TOKENID_1);

      token.transferFrom(OWNER.either, RECIPIENT.either, TOKENID_1);

      // _update calls _approve(ZERO(), tokenId, ZERO()) internally,
      // which should store the left-variant zero
      expect(token.getApproved(TOKENID_1)).toEqual(ZERO_ACCOUNT);
    });
  });

  describe('_requireOwned', () => {
    it('should throw if token has not been minted', () => {
      expect(() => {
        token._requireOwned(TOKENID_1);
      }).toThrow('NonFungibleToken: nonexistent token');
    });

    it('should throw if token has been burned', () => {
      token._mint(OWNER.either, TOKENID_1);
      token._burn(TOKENID_1);
      expect(() => {
        token._requireOwned(TOKENID_1);
      }).toThrow('NonFungibleToken: nonexistent token');
    });

    it('should return correct owner', () => {
      token._mint(OWNER.either, TOKENID_1);
      expect(token._requireOwned(TOKENID_1)).toEqual(OWNER.either);
    });
  });

  describe('_ownerOf', () => {
    it('should return zero address if token does not exist', () => {
      expect(token._ownerOf(NON_EXISTENT_TOKEN)).toEqual(ZERO_ACCOUNT);
    });

    it('should return owner of token', () => {
      token._mint(OWNER.either, TOKENID_1);
      expect(token._ownerOf(TOKENID_1)).toEqual(OWNER.either);
    });
  });

  describe('_approve', () => {
    it('should approve if auth is owner', () => {
      token._mint(OWNER.either, TOKENID_1);
      token._approve(SPENDER.either, TOKENID_1, OWNER.either);
      expect(token.getApproved(TOKENID_1)).toEqual(SPENDER.either);
    });

    it('should approve if auth is approved for all', () => {
      token._mint(OWNER.either, TOKENID_1);
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.setApprovalForAll(SPENDER.either, true);

      token._approve(SPENDER.either, TOKENID_1, SPENDER.either);
      expect(token.getApproved(TOKENID_1)).toEqual(SPENDER.either);
    });

    it('should throw if auth is unauthorized', () => {
      token._mint(OWNER.either, TOKENID_1);
      expect(() => {
        token._approve(SPENDER.either, TOKENID_1, UNAUTHORIZED.either);
      }).toThrow('NonFungibleToken: invalid approver');
    });

    it('should approve if auth is zero address', () => {
      token._mint(OWNER.either, TOKENID_1);
      token._approve(SPENDER.either, TOKENID_1, ZERO_ACCOUNT);
      expect(token.getApproved(TOKENID_1)).toEqual(SPENDER.either);
    });

    it('should canonicalize approved address', () => {
      token._mint(OWNER.either, TOKENID_1);

      const nonCanonical = {
        is_left: true,
        left: SPENDER.accountId,
        right: utils.encodeToAddress('JUNK_DATA'),
      };

      token._approve(nonCanonical, TOKENID_1, OWNER.either);
      expect(token.getApproved(TOKENID_1)).toEqual(SPENDER.either);
    });

    it('should normalize right-variant zero to ZERO()', () => {
      token._mint(OWNER.either, TOKENID_1);

      // Approve with a right-variant zero (contract address zero)
      token._approve(ZERO_CONTRACT, TOKENID_1, OWNER.either);

      // getApproved should return the left-variant ZERO, not the right-variant
      expect(token.getApproved(TOKENID_1)).toEqual(ZERO_ACCOUNT);
    });

    it('should normalize left-variant zero to ZERO()', () => {
      token._mint(OWNER.either, TOKENID_1);

      // First set a real approval
      token._approve(SPENDER.either, TOKENID_1, OWNER.either);
      expect(token.getApproved(TOKENID_1)).toEqual(SPENDER.either);

      // Clear it with left-variant zero
      token._approve(ZERO_ACCOUNT, TOKENID_1, OWNER.either);
      expect(token.getApproved(TOKENID_1)).toEqual(ZERO_ACCOUNT);
    });
  });

  describe('_checkAuthorized', () => {
    it('should throw if token not minted', () => {
      expect(() => {
        token._checkAuthorized(ZERO_ACCOUNT, OWNER.either, TOKENID_1);
      }).toThrow('NonFungibleToken: nonexistent token');
    });

    it('should throw if unauthorized', () => {
      token._mint(OWNER.either, TOKENID_1);
      expect(() => {
        token._checkAuthorized(OWNER.either, UNAUTHORIZED.either, TOKENID_1);
      }).toThrow('NonFungibleToken: insufficient approval');
    });

    it('should not throw if approved', () => {
      token._mint(OWNER.either, TOKENID_1);
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.approve(SPENDER.either, TOKENID_1);
      token._checkAuthorized(OWNER.either, SPENDER.either, TOKENID_1);
    });

    it('should not throw if approvedForAll', () => {
      token._mint(OWNER.either, TOKENID_1);
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.setApprovalForAll(SPENDER.either, true);
      token._checkAuthorized(OWNER.either, SPENDER.either, TOKENID_1);
    });
  });

  describe('_isAuthorized', () => {
    beforeEach(() => {
      token._mint(OWNER.either, TOKENID_1);
    });

    it('should return true if spender is authorized', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.approve(SPENDER.either, TOKENID_1);
      expect(token._isAuthorized(OWNER.either, SPENDER.either, TOKENID_1)).toBe(
        true,
      );
    });

    it('should return true if spender is authorized for all', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.setApprovalForAll(SPENDER.either, true);
      expect(token._isAuthorized(OWNER.either, SPENDER.either, TOKENID_1)).toBe(
        true,
      );
    });

    it('should return true if spender is owner', () => {
      expect(token._isAuthorized(OWNER.either, OWNER.either, TOKENID_1)).toBe(
        true,
      );
    });

    it('should return false if spender is zero address', () => {
      expect(token._isAuthorized(OWNER.either, ZERO_ACCOUNT, TOKENID_1)).toBe(
        false,
      );
    });

    it('should return false for unauthorized', () => {
      expect(
        token._isAuthorized(OWNER.either, UNAUTHORIZED.either, TOKENID_1),
      ).toBe(false);
    });
  });

  describe('_getApproved', () => {
    beforeEach(() => {
      token._mint(OWNER.either, TOKENID_1);
    });

    it('should return zero address if token is not minted', () => {
      expect(token._getApproved(NON_EXISTENT_TOKEN)).toEqual(ZERO_ACCOUNT);
    });

    it('should return approved address', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.approve(SPENDER.either, TOKENID_1);
      expect(token._getApproved(TOKENID_1)).toEqual(SPENDER.either);
    });

    it('should return zero address if no approvals', () => {
      expect(token._getApproved(TOKENID_1)).toEqual(ZERO_ACCOUNT);
    });
  });

  describe('_setApprovalForAll', () => {
    it('should approve operator', () => {
      token._mint(OWNER.either, TOKENID_1);
      token._setApprovalForAll(OWNER.either, SPENDER.either, true);
      expect(token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(true);
    });

    it('should revoke operator approval', () => {
      token._mint(OWNER.either, TOKENID_1);
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.setApprovalForAll(SPENDER.either, true);
      expect(token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(true);

      token._setApprovalForAll(OWNER.either, SPENDER.either, false);
      expect(token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(false);
    });

    it('should throw if operator is zero address (left)', () => {
      expect(() => {
        token._setApprovalForAll(OWNER.either, ZERO_ACCOUNT, true);
      }).toThrow('NonFungibleToken: invalid operator');
    });

    it('should throw if operator is zero address (right)', () => {
      expect(() => {
        token._setApprovalForAll(OWNER.either, ZERO_CONTRACT, true);
      }).toThrow('NonFungibleToken: invalid operator');
    });

    it('should fail if owner is zero address (left)', () => {
      expect(() => {
        token._setApprovalForAll(ZERO_ACCOUNT, RECIPIENT.either, true);
      }).toThrow('NonFungibleToken: invalid owner');
    });

    it('should fail if owner is zero address (right)', () => {
      expect(() => {
        token._setApprovalForAll(ZERO_CONTRACT, RECIPIENT.either, true);
      }).toThrow('NonFungibleToken: invalid owner');
    });

    it('should canonicalize owner and operator', () => {
      token._mint(OWNER.either, TOKENID_1);

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

      token._setApprovalForAll(nonCanonicalOwner, nonCanonicalOp, true);
      expect(token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(true);
    });
  });

  describe('_mint', () => {
    it('should not mint to ContractAddress', () => {
      expect(() => {
        token._mint(SOME_CONTRACT, TOKENID_1);
      }).toThrow('NonFungibleToken: unsafe transfer');
    });

    it('should not mint to zero address', () => {
      expect(() => {
        token._mint(ZERO_ACCOUNT, TOKENID_1);
      }).toThrow('NonFungibleToken: invalid receiver');
    });

    it('should not mint a token that already exists', () => {
      token._mint(OWNER.either, TOKENID_1);
      expect(() => {
        token._mint(OWNER.either, TOKENID_1);
      }).toThrow('NonFungibleToken: invalid sender');
    });

    it('should mint token', () => {
      token._mint(OWNER.either, TOKENID_1);
      expect(token.ownerOf(TOKENID_1)).toEqual(OWNER.either);
      expect(token.balanceOf(OWNER.either)).toEqual(1n);

      token._mint(OWNER.either, TOKENID_2);
      token._mint(OWNER.either, TOKENID_3);
      expect(token.balanceOf(OWNER.either)).toEqual(3n);
    });

    it('should mint multiple tokens in sequence', () => {
      for (let i = 0; i < 10; i++) {
        token._mint(OWNER.either, TOKENID_1 + BigInt(i));
      }
      expect(token.balanceOf(OWNER.either)).toEqual(10n);
    });

    it('should mint with very long token IDs', () => {
      const longTokenId = BigInt('18446744073709551615');
      token._mint(OWNER.either, longTokenId);
      expect(token.ownerOf(longTokenId)).toEqual(OWNER.either);
    });

    it('should mint after burning', () => {
      token._mint(OWNER.either, TOKENID_1);
      token._burn(TOKENID_1);
      token._mint(OWNER.either, TOKENID_1);
      expect(token.ownerOf(TOKENID_1)).toEqual(OWNER.either);
    });

    it('should mint with special characters in metadata', () => {
      token._mint(OWNER.either, TOKENID_1);
      token._setTokenURI(TOKENID_1, '!@#$%^&*()_+');
      expect(token.tokenURI(TOKENID_1)).toEqual('!@#$%^&*()_+');
    });

    it('should canonicalize recipient', () => {
      const nonCanonical = {
        is_left: true,
        left: OWNER.accountId,
        right: utils.encodeToAddress('JUNK_DATA'),
      };

      token._mint(nonCanonical, TOKENID_1);
      expect(token.ownerOf(TOKENID_1)).toEqual(OWNER.either);
      expect(token.balanceOf(OWNER.either)).toEqual(1n);
    });

    it('should not mint to zero (contract)', () => {
      expect(() => {
        token._mint(ZERO_CONTRACT, TOKENID_1);
      }).toThrow('NonFungibleToken: unsafe transfer');
    });
  });

  describe('_burn', () => {
    beforeEach(() => {
      token._mint(OWNER.either, TOKENID_1);
    });

    it('should burn token', () => {
      expect(token.balanceOf(OWNER.either)).toEqual(1n);

      token._burn(TOKENID_1);
      expect(token._ownerOf(TOKENID_1)).toEqual(ZERO_ACCOUNT);
      expect(token.balanceOf(OWNER.either)).toEqual(0n);
    });

    it('should not burn a token that does not exist', () => {
      expect(() => {
        token._burn(NON_EXISTENT_TOKEN);
      }).toThrow('NonFungibleToken: invalid sender');
    });

    it('should clear approval when token is burned', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.approve(SPENDER.either, TOKENID_1);
      expect(token.getApproved(TOKENID_1)).toEqual(SPENDER.either);

      token._burn(TOKENID_1);
      expect(token._getApproved(TOKENID_1)).toEqual(ZERO_ACCOUNT);
    });

    it('should burn multiple tokens in sequence', () => {
      token._mint(OWNER.either, TOKENID_2);
      token._mint(OWNER.either, TOKENID_3);

      token._burn(TOKENID_1);
      token._burn(TOKENID_2);
      token._burn(TOKENID_3);
      expect(token.balanceOf(OWNER.either)).toEqual(0n);
    });

    it('should burn with very long token IDs', () => {
      const longTokenId = BigInt('18446744073709551615');
      token._mint(OWNER.either, longTokenId);
      token._burn(longTokenId);
      expect(token._ownerOf(longTokenId)).toEqual(ZERO_ACCOUNT);
    });

    it('should burn after transfer', () => {
      token._transfer(OWNER.either, SPENDER.either, TOKENID_1);
      token._burn(TOKENID_1);
      expect(token._ownerOf(TOKENID_1)).toEqual(ZERO_ACCOUNT);
    });

    it('should burn after approval', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.approve(SPENDER.either, TOKENID_1);
      token._burn(TOKENID_1);
      expect(token._ownerOf(TOKENID_1)).toEqual(ZERO_ACCOUNT);
      expect(token._getApproved(TOKENID_1)).toEqual(ZERO_ACCOUNT);
    });

    it('should clear tokenURI on burn', () => {
      token._setTokenURI(TOKENID_1, SOME_URI);
      expect(token.tokenURI(TOKENID_1)).toEqual(SOME_URI);

      token._burn(TOKENID_1);

      token._mint(OWNER.either, TOKENID_1);
      expect(token.tokenURI(TOKENID_1)).toEqual(EMPTY_URI);
    });
  });

  describe('_transfer', () => {
    it('should not transfer to ContractAddress', () => {
      token._mint(OWNER.either, TOKENID_1);
      expect(() => {
        token._transfer(OWNER.either, SOME_CONTRACT, TOKENID_1);
      }).toThrow('NonFungibleToken: unsafe transfer');
    });

    it('should transfer token', () => {
      token._mint(OWNER.either, TOKENID_1);
      expect(token.balanceOf(OWNER.either)).toEqual(1n);
      expect(token.balanceOf(SPENDER.either)).toEqual(0n);
      expect(token.ownerOf(TOKENID_1)).toEqual(OWNER.either);

      token._transfer(OWNER.either, SPENDER.either, TOKENID_1);
      expect(token.balanceOf(OWNER.either)).toEqual(0n);
      expect(token.balanceOf(SPENDER.either)).toEqual(1n);
      expect(token.ownerOf(TOKENID_1)).toEqual(SPENDER.either);
    });

    it('should not transfer to zero address', () => {
      token._mint(OWNER.either, TOKENID_1);
      expect(() => {
        token._transfer(OWNER.either, ZERO_ACCOUNT, TOKENID_1);
      }).toThrow('NonFungibleToken: invalid receiver');
    });

    it('should throw if from does not own token', () => {
      token._mint(OWNER.either, TOKENID_1);
      expect(() => {
        token._transfer(UNAUTHORIZED.either, SPENDER.either, TOKENID_1);
      }).toThrow('NonFungibleToken: incorrect owner');
    });

    it('should throw if token does not exist', () => {
      expect(() => {
        token._transfer(OWNER.either, SPENDER.either, NON_EXISTENT_TOKEN);
      }).toThrow('NonFungibleToken: nonexistent token');
    });

    it('should revoke approval after _transfer', () => {
      token._mint(OWNER.either, TOKENID_1);
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.approve(SPENDER.either, TOKENID_1);
      token._transfer(OWNER.either, OTHER.either, TOKENID_1);
      expect(token.getApproved(TOKENID_1)).toEqual(ZERO_ACCOUNT);
    });
  });

  describe('_setTokenURI', () => {
    it('should throw if token does not exist', () => {
      expect(() => {
        token._setTokenURI(NON_EXISTENT_TOKEN, EMPTY_URI);
      }).toThrow('NonFungibleToken: nonexistent token');
    });

    it('should set tokenURI', () => {
      token._mint(OWNER.either, TOKENID_1);
      token._setTokenURI(TOKENID_1, SOME_URI);
      expect(token.tokenURI(TOKENID_1)).toEqual(SOME_URI);
    });
  });

  describe('_unsafeMint', () => {
    it('should mint to ContractAddress', () => {
      expect(() => {
        token._unsafeMint(SOME_CONTRACT, TOKENID_1);
      }).not.toThrow();
    });

    it('should not mint to zero address (accountId)', () => {
      expect(() => {
        token._unsafeMint(ZERO_ACCOUNT, TOKENID_1);
      }).toThrow('NonFungibleToken: invalid receiver');
    });

    it('should not mint to zero address (contract)', () => {
      expect(() => {
        token._unsafeMint(ZERO_CONTRACT, TOKENID_1);
      }).toThrow('NonFungibleToken: invalid receiver');
    });

    it('should not mint a token that already exists', () => {
      token._unsafeMint(OWNER.either, TOKENID_1);
      expect(() => {
        token._unsafeMint(OWNER.either, TOKENID_1);
      }).toThrow('NonFungibleToken: invalid sender');
    });

    it('should mint token to account', () => {
      token._unsafeMint(OWNER.either, TOKENID_1);
      expect(token.ownerOf(TOKENID_1)).toEqual(OWNER.either);
      expect(token.balanceOf(OWNER.either)).toEqual(1n);

      token._unsafeMint(OWNER.either, TOKENID_2);
      token._unsafeMint(OWNER.either, TOKENID_3);
      expect(token.balanceOf(OWNER.either)).toEqual(3n);
    });
  });

  describe('_unsafeTransfer', () => {
    beforeEach(() => {
      token._mint(OWNER.either, TOKENID_1);
    });

    it('should transfer to ContractAddress', () => {
      expect(() => {
        token._unsafeTransfer(OWNER.either, SOME_CONTRACT, TOKENID_1);
      }).not.toThrow();
    });

    it('should transfer token to account', () => {
      expect(token.balanceOf(OWNER.either)).toEqual(1n);
      expect(token.balanceOf(SPENDER.either)).toEqual(0n);
      expect(token.ownerOf(TOKENID_1)).toEqual(OWNER.either);

      token._unsafeTransfer(OWNER.either, SPENDER.either, TOKENID_1);
      expect(token.balanceOf(OWNER.either)).toEqual(0n);
      expect(token.balanceOf(SPENDER.either)).toEqual(1n);
      expect(token.ownerOf(TOKENID_1)).toEqual(SPENDER.either);
    });

    it('should not transfer to zero address (accountId)', () => {
      expect(() => {
        token._unsafeTransfer(OWNER.either, ZERO_ACCOUNT, TOKENID_1);
      }).toThrow('NonFungibleToken: invalid receiver');
    });

    it('should not transfer to zero address (contract)', () => {
      expect(() => {
        token._unsafeTransfer(OWNER.either, ZERO_CONTRACT, TOKENID_1);
      }).toThrow('NonFungibleToken: invalid receiver');
    });

    it('should throw if from does not own token', () => {
      expect(() => {
        token._unsafeTransfer(
          UNAUTHORIZED.either,
          UNAUTHORIZED.either,
          TOKENID_1,
        );
      }).toThrow('NonFungibleToken: incorrect owner');
    });

    it('should throw if token does not exist', () => {
      expect(() => {
        token._unsafeTransfer(OWNER.either, SPENDER.either, NON_EXISTENT_TOKEN);
      }).toThrow('NonFungibleToken: nonexistent token');
    });

    it('should revoke approval after _unsafeTransfer', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.approve(SPENDER.either, TOKENID_1);
      token._unsafeTransfer(OWNER.either, OTHER.either, TOKENID_1);
      expect(token.getApproved(TOKENID_1)).toEqual(ZERO_ACCOUNT);
    });

    it('should canonicalize contract address recipient', () => {
      const nonCanonical = {
        is_left: false,
        left: new Uint8Array(32).fill(1),
        right: SOME_CONTRACT.right,
      };

      token._unsafeTransfer(OWNER.either, nonCanonical, TOKENID_1);
      expect(token.ownerOf(TOKENID_1)).toEqual(SOME_CONTRACT);
      expect(token.balanceOf(SOME_CONTRACT)).toEqual(1n);
    });

    it('should handle non-canonical fromAddress', () => {
      const nonCanonical = {
        is_left: true,
        left: OWNER.accountId,
        right: utils.encodeToAddress('JUNK_DATA'),
      };

      token._unsafeTransfer(nonCanonical, SPENDER.either, TOKENID_1);
      expect(token.ownerOf(TOKENID_1)).toEqual(SPENDER.either);
    });
  });

  describe('_unsafeTransferFrom', () => {
    beforeEach(() => {
      token._mint(OWNER.either, TOKENID_1);
    });

    it('should transfer to ContractAddress', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      expect(() => {
        token._unsafeTransferFrom(OWNER.either, SOME_CONTRACT, TOKENID_1);
      }).not.toThrow();
    });

    it('should not transfer to zero address (accountId)', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      expect(() => {
        token._unsafeTransferFrom(OWNER.either, ZERO_ACCOUNT, TOKENID_1);
      }).toThrow('NonFungibleToken: invalid receiver');
    });

    it('should not transfer to zero address (contract)', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      expect(() => {
        token._unsafeTransferFrom(OWNER.either, ZERO_CONTRACT, TOKENID_1);
      }).toThrow('NonFungibleToken: invalid receiver');
    });

    it('should not transfer from zero address', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      expect(() => {
        token._unsafeTransferFrom(ZERO_ACCOUNT, SPENDER.either, TOKENID_1);
      }).toThrow('NonFungibleToken: incorrect owner');
    });

    it('unapproved operator should not transfer', () => {
      token.privateState.injectSecretKey(SPENDER.secretKey);
      expect(() => {
        token._unsafeTransferFrom(OWNER.either, UNAUTHORIZED.either, TOKENID_1);
      }).toThrow('NonFungibleToken: insufficient approval');
    });

    it('should not transfer token that has not been minted', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      expect(() => {
        token._unsafeTransferFrom(
          OWNER.either,
          SPENDER.either,
          NON_EXISTENT_TOKEN,
        );
      }).toThrow('NonFungibleToken: nonexistent token');
    });

    it('should transfer token to spender via approved operator', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.approve(SPENDER.either, TOKENID_1);

      token.privateState.injectSecretKey(SPENDER.secretKey);
      token._unsafeTransferFrom(OWNER.either, SPENDER.either, TOKENID_1);
      expect(token.ownerOf(TOKENID_1)).toEqual(SPENDER.either);
    });

    it('should transfer token to ContractAddress via approved operator', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.approve(SPENDER.either, TOKENID_1);

      token.privateState.injectSecretKey(SPENDER.secretKey);
      token._unsafeTransferFrom(OWNER.either, SOME_CONTRACT, TOKENID_1);
      expect(token.ownerOf(TOKENID_1)).toEqual(SOME_CONTRACT);
    });

    it('should transfer token to spender via approvedForAll operator', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.setApprovalForAll(SPENDER.either, true);

      token.privateState.injectSecretKey(SPENDER.secretKey);
      token._unsafeTransferFrom(OWNER.either, SPENDER.either, TOKENID_1);
      expect(token.ownerOf(TOKENID_1)).toEqual(SPENDER.either);
    });

    it('should transfer token to ContractAddress via approvedForAll operator', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.setApprovalForAll(SPENDER.either, true);

      token.privateState.injectSecretKey(SPENDER.secretKey);
      token._unsafeTransferFrom(OWNER.either, SOME_CONTRACT, TOKENID_1);
      expect(token.ownerOf(TOKENID_1)).toEqual(SOME_CONTRACT);
    });

    it('should revoke approval after _unsafeTransferFrom', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);
      token.approve(SPENDER.either, TOKENID_1);

      token._unsafeTransferFrom(OWNER.either, OTHER.either, TOKENID_1);
      expect(token.getApproved(TOKENID_1)).toEqual(ZERO_ACCOUNT);
    });

    it('should handle non-canonical fromAddress', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);

      const nonCanonical = {
        is_left: true,
        left: OWNER.accountId,
        right: utils.encodeToAddress('JUNK_DATA'),
      };

      token._unsafeTransferFrom(nonCanonical, SPENDER.either, TOKENID_1);
      expect(token.ownerOf(TOKENID_1)).toEqual(SPENDER.either);
    });

    it('should canonicalize contract address recipient', () => {
      token.privateState.injectSecretKey(OWNER.secretKey);

      const nonCanonical = {
        is_left: false,
        left: new Uint8Array(32).fill(1),
        right: SOME_CONTRACT.right,
      };

      token._unsafeTransferFrom(OWNER.either, nonCanonical, TOKENID_1);
      expect(token.ownerOf(TOKENID_1)).toEqual(SOME_CONTRACT);
      expect(token.balanceOf(SOME_CONTRACT)).toEqual(1n);
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
  beforeEach(() => {
    uninitializedToken = new NonFungibleTokenSimulator(NAME, SYMBOL, BAD_INIT);
  });

  it.each(circuitsToFail)('%s should fail', (circuitName, args) => {
    expect(() => {
      (uninitializedToken[circuitName] as (...args: unknown[]) => unknown)(
        ...args,
      );
    }).toThrow('Initializable: contract not initialized');
  });
});

describe('NonFungibleTokenSimulator wiring', () => {
  it('should expose an empty public ledger via getPublicState', () => {
    const sim = new NonFungibleTokenSimulator(NAME, SYMBOL, INIT);

    expect(sim.getPublicState()).toStrictEqual({});
  });

  describe('privateState getCurrentSecretKey', () => {
    it('should return the injected secret key', () => {
      const sim = new NonFungibleTokenSimulator(NAME, SYMBOL, INIT);
      sim.privateState.injectSecretKey(OWNER.secretKey);

      expect(sim.privateState.getCurrentSecretKey()).toEqual(OWNER.secretKey);
    });

    it('should throw when the secret key is undefined', () => {
      const sim = new NonFungibleTokenSimulator(NAME, SYMBOL, INIT, {
        privateState: { secretKey: undefined as unknown as Uint8Array },
      });

      expect(() => sim.privateState.getCurrentSecretKey()).toThrow(
        'Missing secret key',
      );
    });
  });
});
