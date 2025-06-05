import type { CoinPublicKey } from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { ERC721Simulator } from './simulators/ERC721Simulator';
import type { MaybeString } from './types/string';
import {
  createEitherTestContractAddress,
  createEitherTestUser,
  ZERO_KEY,
} from './utils/address';

const NONE_STRING: MaybeString = {
  is_some: false,
  value: '',
};
const SOME_STRING: MaybeString = {
  is_some: true,
  value: 'https://openzeppelin.example',
};

const NAME = 'NAME';
const SYMBOL = 'SYMBOL';
const EMPTY_STRING = '';

const TOKENID: bigint = BigInt(1);
const _AMOUNT: bigint = BigInt(1);

const _OWNER = String(Buffer.from('OWNER', 'ascii').toString('hex')).padStart(
  64,
  '0',
);
const _SPENDER = String(
  Buffer.from('SPENDER', 'ascii').toString('hex'),
).padStart(64, '0');
const _UNAUTHORIZED = String(
  Buffer.from('UNAUTHORIZED', 'ascii').toString('hex'),
).padStart(64, '0');

const _Z_OWNER = createEitherTestUser('OWNER');
const _Z_SPENDER = createEitherTestUser('SPENDER');
const _Z_OTHER = createEitherTestUser('OTHER');
const _SOME_CONTRACT = createEitherTestContractAddress('CONTRACT');

let token: ERC721Simulator;
let _caller: CoinPublicKey;

describe('ERC721', () => {
  describe('initializer and metadata', () => {
    it('should initialize metadata', () => {
      token = new ERC721Simulator(NAME, SYMBOL);

      expect(token.name()).toEqual(NAME);
      expect(token.symbol()).toEqual(SYMBOL);
      expect(() => {
        token.assertInitialized();
      }).not.toThrow();
    });

    it('should initialize empty metadata', () => {
      token = new ERC721Simulator(EMPTY_STRING, EMPTY_STRING);

      expect(token.name()).toEqual(EMPTY_STRING);
      expect(token.symbol()).toEqual(EMPTY_STRING);
    });

    it('should initialize metadata with whitespace', () => {
      token = new ERC721Simulator('  NAME  ', '  SYMBOL  ');
      expect(token.name()).toEqual('  NAME  ');
      expect(token.symbol()).toEqual('  SYMBOL  ');
    });

    it('should initialize metadata with special characters', () => {
      token = new ERC721Simulator('NAME!@#', 'SYMBOL$%^');
      expect(token.name()).toEqual('NAME!@#');
      expect(token.symbol()).toEqual('SYMBOL$%^');
    });

    it('should initialize metadata with very long strings', () => {
      const longName = 'A'.repeat(1000);
      const longSymbol = 'B'.repeat(1000);
      token = new ERC721Simulator(longName, longSymbol);
      expect(token.name()).toEqual(longName);
      expect(token.symbol()).toEqual(longSymbol);
    });
  });

  beforeEach(() => {
    token = new ERC721Simulator(NAME, SYMBOL);
  });

  describe('balanceOf', () => {
    it('should return zero when requested account has no balance', () => {
      expect(token.balanceOf(_Z_OWNER)).toEqual(0n);
    });

    it('should return balance when requested account has tokens', () => {
      token._mint(_Z_OWNER, _AMOUNT);
      expect(token.balanceOf(_Z_OWNER)).toEqual(_AMOUNT);
    });

    it('should return correct balance for multiple tokens', () => {
      token._mint(_Z_OWNER, TOKENID);
      token._mint(_Z_OWNER, TOKENID + 1n);
      token._mint(_Z_OWNER, TOKENID + 2n);
      expect(token.balanceOf(_Z_OWNER)).toEqual(3n);
    });

    it('should return correct balance after burning multiple tokens', () => {
      token._mint(_Z_OWNER, TOKENID);
      token._mint(_Z_OWNER, TOKENID + 1n);
      token._mint(_Z_OWNER, TOKENID + 2n);
      token._burn(TOKENID);
      token._burn(TOKENID + 1n);
      expect(token.balanceOf(_Z_OWNER)).toEqual(1n);
    });

    it('should return correct balance after transferring multiple tokens', () => {
      token._mint(_Z_OWNER, TOKENID);
      token._mint(_Z_OWNER, TOKENID + 1n);
      token._mint(_Z_OWNER, TOKENID + 2n);
      token._transfer(_Z_OWNER, _Z_SPENDER, TOKENID);
      token._transfer(_Z_OWNER, _Z_SPENDER, TOKENID + 1n);
      expect(token.balanceOf(_Z_OWNER)).toEqual(1n);
      expect(token.balanceOf(_Z_SPENDER)).toEqual(2n);
    });
  });

  describe('ownerOf', () => {
    it('should throw if tokenId does not exist', () => {
      expect(() => {
        token.ownerOf(TOKENID);
      }).toThrow('ERC721: Nonexistent Token');
    });

    it('should throw if tokenId has been burned', () => {
      token._mint(_Z_OWNER, TOKENID);
      token._burn(TOKENID);
      expect(() => {
        token.ownerOf(TOKENID);
      }).toThrow('ERC721: Nonexistent Token');
    });

    it('should return owner of token if it exists', () => {
      token._mint(_Z_OWNER, TOKENID);
      expect(token.ownerOf(TOKENID)).toEqual(_Z_OWNER);
    });

    it('should return correct owner for multiple tokens', () => {
      token._mint(_Z_OWNER, TOKENID);
      token._mint(_Z_OWNER, TOKENID + 1n);
      token._mint(_Z_OWNER, TOKENID + 2n);
      expect(token.ownerOf(TOKENID)).toEqual(_Z_OWNER);
      expect(token.ownerOf(TOKENID + 1n)).toEqual(_Z_OWNER);
      expect(token.ownerOf(TOKENID + 2n)).toEqual(_Z_OWNER);
    });

    it('should return correct owner after multiple transfers', () => {
      token._mint(_Z_OWNER, TOKENID);
      token._mint(_Z_OWNER, TOKENID + 1n);
      token._transfer(_Z_OWNER, _Z_SPENDER, TOKENID);
      token._transfer(_Z_OWNER, _Z_OTHER, TOKENID + 1n);
      expect(token.ownerOf(TOKENID)).toEqual(_Z_SPENDER);
      expect(token.ownerOf(TOKENID + 1n)).toEqual(_Z_OTHER);
    });

    it('should return correct owner after multiple burns and mints', () => {
      token._mint(_Z_OWNER, TOKENID);
      token._burn(TOKENID);
      token._mint(_Z_SPENDER, TOKENID);
      expect(token.ownerOf(TOKENID)).toEqual(_Z_SPENDER);
    });
  });

  describe('tokenURI', () => {
    it('should throw if token does not exist', () => {
      expect(() => {
        token.tokenURI(TOKENID);
      }).toThrow('ERC721: Nonexistent Token');
    });

    it('should return none if tokenURI set as default value', () => {
      token._mint(_Z_OWNER, TOKENID);
      token._setTokenURI(TOKENID, NONE_STRING);
      expect(token.tokenURI(TOKENID)).toEqual(NONE_STRING);
    });

    it('should return some string if tokenURI is set', () => {
      token._mint(_Z_OWNER, TOKENID);
      token._setTokenURI(TOKENID, SOME_STRING);
      expect(token.tokenURI(TOKENID)).toEqual(SOME_STRING);
    });

    it('should return empty string tokenURI', () => {
      token._mint(_Z_OWNER, TOKENID);
      token._setTokenURI(TOKENID, { is_some: true, value: '' });
      expect(token.tokenURI(TOKENID)).toEqual({ is_some: true, value: '' });
    });

    it('should return very long tokenURI', () => {
      const longURI = 'A'.repeat(1000);
      token._mint(_Z_OWNER, TOKENID);
      token._setTokenURI(TOKENID, { is_some: true, value: longURI });
      expect(token.tokenURI(TOKENID)).toEqual({ is_some: true, value: longURI });
    });

    it('should return tokenURI with special characters', () => {
      const specialURI = '!@#$%^&*()_+';
      token._mint(_Z_OWNER, TOKENID);
      token._setTokenURI(TOKENID, { is_some: true, value: specialURI });
      expect(token.tokenURI(TOKENID)).toEqual({ is_some: true, value: specialURI });
    });

    it('should update tokenURI multiple times', () => {
      token._mint(_Z_OWNER, TOKENID);
      token._setTokenURI(TOKENID, { is_some: true, value: 'URI1' });
      token._setTokenURI(TOKENID, { is_some: true, value: 'URI2' });
      token._setTokenURI(TOKENID, { is_some: true, value: 'URI3' });
      expect(token.tokenURI(TOKENID)).toEqual({ is_some: true, value: 'URI3' });
    });

    it('should maintain tokenURI after token transfer', () => {
      token._mint(_Z_OWNER, TOKENID);
      token._setTokenURI(TOKENID, SOME_STRING);
      token._transfer(_Z_OWNER, _Z_SPENDER, TOKENID);
      expect(token.tokenURI(TOKENID)).toEqual(SOME_STRING);
    });
  });

  describe('approve', () => {
    beforeEach(() => {
      token._mint(_Z_OWNER, TOKENID);
      expect(token.getApproved(TOKENID)).toEqual(ZERO_KEY);
    });

    it('should throw if not owner', () => {
      _caller = _UNAUTHORIZED;
      expect(() => {
        token.approve(_Z_SPENDER, TOKENID, _caller);
      }).toThrow('ERC721: Invalid Approver');
    });

    it('should approve spender', () => {
      _caller = _OWNER;
      token.approve(_Z_SPENDER, TOKENID, _caller);
      expect(token.getApproved(TOKENID)).toEqual(_Z_SPENDER);
    });

    it('spender that is approved for all tokens should be able to approve', () => {
      _caller = _OWNER;
      token.setApprovalForAll(_Z_SPENDER, true, _caller);
      _caller = _SPENDER;
      token.approve(_Z_OTHER, TOKENID, _caller);
      expect(token.getApproved(TOKENID)).toEqual(_Z_OTHER);
    });

    it('spender approved for only TOKENID should not be able to approve', () => {
      _caller = _OWNER;
      token.approve(_Z_SPENDER, TOKENID, _caller);
      _caller = _SPENDER;
      expect(() => {
        token.approve(_Z_OTHER, TOKENID, _caller);
      }).toThrow('ERC721: Invalid Approver');
    });

    // TODO: Is this the intended behavior per ERC721 spec?
    // it('should not approve zero address', () => {
    //   _caller = _OWNER;
    //   expect(() => {
    //     token.approve(ZERO_KEY, TOKENID, _caller);
    //   }).toThrow('ERC721: Invalid Operator');
    // });

    it('should approve same address multiple times', () => {
      _caller = _OWNER;
      token.approve(_Z_SPENDER, TOKENID, _caller);
      token.approve(_Z_SPENDER, TOKENID, _caller);
      expect(token.getApproved(TOKENID)).toEqual(_Z_SPENDER);
    });

    it('should approve after token transfer', () => {
      _caller = _OWNER;
      token._transfer(_Z_OWNER, _Z_SPENDER, TOKENID);
      _caller = _SPENDER;
      token.approve(_Z_OTHER, TOKENID, _caller);
      expect(token.getApproved(TOKENID)).toEqual(_Z_OTHER);
    });

    it('should approve after token burn and remint', () => {
      _caller = _OWNER;
      token._burn(TOKENID);
      token._mint(_Z_OWNER, TOKENID);
      token.approve(_Z_SPENDER, TOKENID, _caller);
      expect(token.getApproved(TOKENID)).toEqual(_Z_SPENDER);
    });

    it('should approve with very long token ID', () => {
      _caller = _OWNER;
      const longTokenId = BigInt('18446744073709551615');
      token._mint(_Z_OWNER, longTokenId);
      token.approve(_Z_SPENDER, longTokenId, _caller);
      expect(token.getApproved(longTokenId)).toEqual(_Z_SPENDER);
    });
  });

  describe('getApproved', () => {
    it('should throw if tokenId does not exist', () => {
      expect(() => {
        token.getApproved(TOKENID);
      }).toThrow('ERC721: Nonexistent Token');
    });

    it('should throw if tokenId has been burned', () => {
      token._mint(_Z_OWNER, TOKENID);
      token._burn(TOKENID);
      expect(() => {
        token.getApproved(TOKENID);
      }).toThrow('ERC721: Nonexistent Token');
    });

    it('should get current approved spender', () => {
      token._mint(_Z_OWNER, TOKENID);
      token.approve(_Z_OWNER, TOKENID);
      expect(token.getApproved(TOKENID)).toEqual(_Z_OWNER);
    });

    it('should return zero key if approval not set', () => {
      token._mint(_Z_OWNER, TOKENID);
      expect(token.getApproved(TOKENID)).toEqual(ZERO_KEY);
    });
  });

  describe('setApprovalForAll', () => {
    it('should not approve zero address', () => {
      _caller = _OWNER;
      token._mint(_Z_OWNER, TOKENID);
      expect(() => {
        token.setApprovalForAll(ZERO_KEY, true, _caller);
      }).toThrow('ERC721: Invalid Operator');
    });

    it('should approve operator for all tokens', () => {
      _caller = _OWNER;
      token._mint(_Z_OWNER, TOKENID);

      token.setApprovalForAll(_Z_SPENDER, true, _OWNER);
      expect(token.isApprovedForAll(_Z_OWNER, _Z_SPENDER)).toBe(true);
    });

    it('spender should manage all tokens', () => {
      _caller = _OWNER;
      token._mint(_Z_OWNER, TOKENID);
      token._mint(_Z_OWNER, TOKENID + 1n);
      token._mint(_Z_OWNER, TOKENID + 2n);

      token.setApprovalForAll(_Z_SPENDER, true, _OWNER);
      token.transferFrom(_Z_OWNER, _Z_SPENDER, TOKENID, _SPENDER);
      expect(token.ownerOf(TOKENID)).toEqual(_Z_SPENDER);

      token.approve(_Z_OTHER, TOKENID + 1n, _SPENDER);
      expect(token.getApproved(TOKENID + 1n)).toEqual(_Z_OTHER);

      token.approve(_Z_SPENDER, TOKENID + 2n, _SPENDER);
      expect(token.getApproved(TOKENID + 2n)).toEqual(_Z_SPENDER);
    });

    it('should revoke approval for all', () => {
      _caller = _OWNER;
      token._mint(_Z_OWNER, TOKENID);
      token.setApprovalForAll(_Z_SPENDER, true, _caller);
      expect(token.isApprovedForAll(_Z_OWNER, _Z_SPENDER)).toBe(true);

      token.setApprovalForAll(_Z_SPENDER, false, _caller);
      expect(token.isApprovedForAll(_Z_OWNER, _Z_SPENDER)).toBe(false);

      _caller = _SPENDER;
      expect(() => {
        token.approve(_Z_SPENDER, TOKENID, _caller);
      }).toThrow('ERC721: Invalid Approver');
    });

    it('should set approval for all to same address multiple times', () => {
      _caller = _OWNER;
      token._mint(_Z_OWNER, TOKENID);
      token.setApprovalForAll(_Z_SPENDER, true, _caller);
      token.setApprovalForAll(_Z_SPENDER, true, _caller);
      expect(token.isApprovedForAll(_Z_OWNER, _Z_SPENDER)).toBe(true);
    });

    it('should set approval for all after token transfer', () => {
      _caller = _OWNER;
      token._mint(_Z_OWNER, TOKENID);
      token._transfer(_Z_OWNER, _Z_SPENDER, TOKENID);
      _caller = _SPENDER;
      token.setApprovalForAll(_Z_OTHER, true, _caller);
      expect(token.isApprovedForAll(_Z_SPENDER, _Z_OTHER)).toBe(true);
    });

    it('should set approval for all with multiple operators', () => {
      _caller = _OWNER;
      token._mint(_Z_OWNER, TOKENID);
      token.setApprovalForAll(_Z_SPENDER, true, _caller);
      token.setApprovalForAll(_Z_OTHER, true, _caller);
      expect(token.isApprovedForAll(_Z_OWNER, _Z_SPENDER)).toBe(true);
      expect(token.isApprovedForAll(_Z_OWNER, _Z_OTHER)).toBe(true);
    });

    it('should set approval for all with very long token IDs', () => {
      _caller = _OWNER;
      const longTokenId = BigInt('18446744073709551615');
      token._mint(_Z_OWNER, longTokenId);
      token.setApprovalForAll(_Z_SPENDER, true, _caller);
      expect(token.isApprovedForAll(_Z_OWNER, _Z_SPENDER)).toBe(true);
    });
  });

  describe('isApprovedForAll', () => {
    it('should return false if approval not set', () => {
      expect(token.isApprovedForAll(_Z_OWNER, _Z_SPENDER)).toBe(false);
    });

    it('should return true if approval set', () => {
      _caller = _OWNER;
      token._mint(_Z_OWNER, TOKENID);
      token.setApprovalForAll(_Z_SPENDER, true, _OWNER);
      expect(token.isApprovedForAll(_Z_OWNER, _Z_SPENDER)).toBe(true);
    });
  });

  describe('transferFrom', () => {
    it('should not transfer to ContractAddress', () => {
      token._mint(_Z_OWNER, TOKENID);
      expect(() => {
        token.transferFrom(_Z_OWNER, _SOME_CONTRACT, TOKENID);
      }).toThrow('ERC721: Unsafe Transfer');
    });

    it('should not transfer to zero address', () => {
      token._mint(_Z_OWNER, TOKENID);
      expect(() => {
        token.transferFrom(_Z_OWNER, ZERO_KEY, TOKENID);
      }).toThrow('ERC721: Invalid Receiver');
    });

    it('should not transfer from zero address', () => {
      token._mint(_Z_OWNER, TOKENID);
      expect(() => {
        token.transferFrom(ZERO_KEY, _Z_SPENDER, TOKENID);
      }).toThrow('ERC721: Incorrect Owner');
    });

    it('unapproved operator should not transfer', () => {
      _caller = _SPENDER;
      token._mint(_Z_OWNER, TOKENID);
      expect(() => {
        token.transferFrom(_Z_OWNER, _Z_SPENDER, TOKENID, _caller);
      }).toThrow('ERC721: Insufficient Approval');
    });

    it('should not transfer token that has not been minted', () => {
      _caller = _OWNER;
      expect(() => {
        token.transferFrom(_Z_OWNER, _Z_SPENDER, TOKENID, _caller);
      }).toThrow('ERC721: Nonexistent Token');
    });

    it('should transfer token via approved operator', () => {
      _caller = _OWNER;
      token._mint(_Z_OWNER, TOKENID);
      token.approve(_Z_SPENDER, TOKENID, _OWNER);

      _caller = _SPENDER;
      token.transferFrom(_Z_OWNER, _Z_SPENDER, TOKENID, _caller);
      expect(token.ownerOf(TOKENID)).toEqual(_Z_SPENDER);
    });

    it('should transfer token via approvedForAll operator', () => {
      _caller = _OWNER;
      token._mint(_Z_OWNER, TOKENID);
      token.setApprovalForAll(_Z_SPENDER, true, _OWNER);

      _caller = _SPENDER;
      token.transferFrom(_Z_OWNER, _Z_SPENDER, TOKENID, _caller);
      expect(token.ownerOf(TOKENID)).toEqual(_Z_SPENDER);
    });

    // TODO: is this a bug in the ERC721 spec?
    it('should allow transfer to same address', () => {
      _caller = _OWNER;
      token._mint(_Z_OWNER, TOKENID);
      expect(() => {
        token.transferFrom(_Z_OWNER, _Z_OWNER, TOKENID, _caller);
      }).not.toThrow();
      expect(token.ownerOf(TOKENID)).toEqual(_Z_OWNER);
      expect(token.balanceOf(_Z_OWNER)).toEqual(1n);
    });

    it('should not transfer after approval revocation', () => {
      _caller = _OWNER;
      token._mint(_Z_OWNER, TOKENID);
      token.approve(_Z_SPENDER, TOKENID, _caller);
      token.approve(ZERO_KEY, TOKENID, _caller);
      _caller = _SPENDER;
      expect(() => {
        token.transferFrom(_Z_OWNER, _Z_SPENDER, TOKENID, _caller);
      }).toThrow('ERC721: Insufficient Approval');
    });

    it('should not transfer after approval for all revocation', () => {
      _caller = _OWNER;
      token._mint(_Z_OWNER, TOKENID);
      token.setApprovalForAll(_Z_SPENDER, true, _caller);
      token.setApprovalForAll(_Z_SPENDER, false, _caller);
      _caller = _SPENDER;
      expect(() => {
        token.transferFrom(_Z_OWNER, _Z_SPENDER, TOKENID, _caller);
      }).toThrow('ERC721: Insufficient Approval');
    });

    it('should transfer multiple tokens in sequence', () => {
      _caller = _OWNER;
      token._mint(_Z_OWNER, TOKENID);
      token._mint(_Z_OWNER, TOKENID + 1n);
      token._mint(_Z_OWNER, TOKENID + 2n);
      token.approve(_Z_SPENDER, TOKENID, _caller);
      token.approve(_Z_SPENDER, TOKENID + 1n, _caller);
      token.approve(_Z_SPENDER, TOKENID + 2n, _caller);

      _caller = _SPENDER;
      token.transferFrom(_Z_OWNER, _Z_SPENDER, TOKENID, _caller);
      token.transferFrom(_Z_OWNER, _Z_SPENDER, TOKENID + 1n, _caller);
      token.transferFrom(_Z_OWNER, _Z_SPENDER, TOKENID + 2n, _caller);

      expect(token.ownerOf(TOKENID)).toEqual(_Z_SPENDER);
      expect(token.ownerOf(TOKENID + 1n)).toEqual(_Z_SPENDER);
      expect(token.ownerOf(TOKENID + 2n)).toEqual(_Z_SPENDER);
    });

    it('should transfer with very long token IDs', () => {
      _caller = _OWNER;
      const longTokenId = BigInt('18446744073709551615');
      token._mint(_Z_OWNER, longTokenId);
      token.approve(_Z_SPENDER, longTokenId, _caller);

      _caller = _SPENDER;
      token.transferFrom(_Z_OWNER, _Z_SPENDER, longTokenId, _caller);
      expect(token.ownerOf(longTokenId)).toEqual(_Z_SPENDER);
    });
  });

  describe('_requireOwned', () => {
    it('should throw if token has not been minted', () => {
      expect(() => {
        token._requireOwned(TOKENID);
      }).toThrow('ERC721: Nonexistent Token');
    });

    it('should throw if token has been burned', () => {
      token._mint(_Z_OWNER, TOKENID);
      token._burn(TOKENID);
      expect(() => {
        token._requireOwned(TOKENID);
      }).toThrow('ERC721: Nonexistent Token');
    });

    it('should return correct owner', () => {
      token._mint(_Z_OWNER, TOKENID);
      expect(token._requireOwned(TOKENID)).toEqual(_Z_OWNER);
    });
  });

  describe('_ownerOf', () => {
    it('should return zero address if token does not exist', () => {
      expect(token._ownerOf(TOKENID)).toEqual(ZERO_KEY);
    });

    it('should return owner of token', () => {
      token._mint(_Z_OWNER, TOKENID);
      expect(token._ownerOf(TOKENID)).toEqual(_Z_OWNER);
    });
  });

  describe('_update', () => {
    it('should transfer token and clear approvals', () => {
      _caller = _OWNER;
      token._mint(_Z_OWNER, TOKENID);
      token.approve(_Z_OTHER, TOKENID, _caller);
      const prevOwner = token._update(_Z_SPENDER, TOKENID, ZERO_KEY);

      expect(prevOwner).toEqual(_Z_OWNER);
      expect(token.ownerOf(TOKENID)).toEqual(_Z_SPENDER);
      expect(token.balanceOf(_Z_OWNER)).toEqual(0n);
      expect(token.balanceOf(_Z_SPENDER)).toEqual(1n);
      expect(token.getApproved(TOKENID)).toEqual(ZERO_KEY);
    });

    it('should mint a token', () => {
      const prevOwner = token._update(_Z_OWNER, TOKENID, ZERO_KEY);
      expect(prevOwner).toEqual(ZERO_KEY);
      expect(token.ownerOf(TOKENID)).toEqual(_Z_OWNER);
      expect(token.balanceOf(_Z_OWNER)).toEqual(1n);
    });

    it('should burn a token', () => {
      token._mint(_Z_OWNER, TOKENID);
      const prevOwner = token._update(ZERO_KEY, TOKENID, _Z_OWNER);
      expect(prevOwner).toEqual(_Z_OWNER);
      expect(token.balanceOf(_Z_OWNER)).toEqual(0n);
      expect(token._ownerOf(TOKENID)).toEqual(ZERO_KEY);
    });

    it('should transfer if auth is authorized', () => {
      _caller = _OWNER;
      token._mint(_Z_OWNER, TOKENID);
      token.approve(_Z_SPENDER, TOKENID, _caller);
      const prevOwner = token._update(_Z_SPENDER, TOKENID, _Z_SPENDER);

      expect(prevOwner).toEqual(_Z_OWNER);
      expect(token.ownerOf(TOKENID)).toEqual(_Z_SPENDER);
      expect(token.balanceOf(_Z_OWNER)).toEqual(0n);
      expect(token.balanceOf(_Z_SPENDER)).toEqual(1n);
    });

    it('should transfer if auth is authorized for all', () => {
      _caller = _OWNER;
      token._mint(_Z_OWNER, TOKENID);
      token.setApprovalForAll(_Z_SPENDER, true, _caller);
      const prevOwner = token._update(_Z_SPENDER, TOKENID, _Z_SPENDER);

      expect(prevOwner).toEqual(_Z_OWNER);
      expect(token.ownerOf(TOKENID)).toEqual(_Z_SPENDER);
      expect(token.balanceOf(_Z_OWNER)).toEqual(0n);
      expect(token.balanceOf(_Z_SPENDER)).toEqual(1n);
    });

    it('should throw if auth is not authorized', () => {
      _caller = _OWNER;
      token._mint(_Z_OWNER, TOKENID);
      expect(() => {
        token._update(_Z_SPENDER, TOKENID, _Z_SPENDER);
      }).toThrow('ERC721: Insufficient Approval');
    });

    it('should update multiple tokens in sequence', () => {
      _caller = _OWNER;
      token._mint(_Z_OWNER, TOKENID);
      token._mint(_Z_OWNER, TOKENID + 1n);
      token._mint(_Z_OWNER, TOKENID + 2n);
      token.approve(_Z_SPENDER, TOKENID, _caller);
      token.approve(_Z_SPENDER, TOKENID + 1n, _caller);
      token.approve(_Z_SPENDER, TOKENID + 2n, _caller);

      token._update(_Z_SPENDER, TOKENID, _Z_SPENDER);
      token._update(_Z_SPENDER, TOKENID + 1n, _Z_SPENDER);
      token._update(_Z_SPENDER, TOKENID + 2n, _Z_SPENDER);

      expect(token.ownerOf(TOKENID)).toEqual(_Z_SPENDER);
      expect(token.ownerOf(TOKENID + 1n)).toEqual(_Z_SPENDER);
      expect(token.ownerOf(TOKENID + 2n)).toEqual(_Z_SPENDER);
    });

    it('should update with very long token IDs', () => {
      _caller = _OWNER;
      const longTokenId = BigInt('18446744073709551615');
      token._mint(_Z_OWNER, longTokenId);
      token.approve(_Z_SPENDER, longTokenId, _caller);
      token._update(_Z_SPENDER, longTokenId, _Z_SPENDER);
      expect(token.ownerOf(longTokenId)).toEqual(_Z_SPENDER);
    });

    it('should update after multiple transfers', () => {
      _caller = _OWNER;
      token._mint(_Z_OWNER, TOKENID);
      token._transfer(_Z_OWNER, _Z_SPENDER, TOKENID);
      _caller = _SPENDER;
      token.approve(_Z_OTHER, TOKENID, _caller);
      token._update(_Z_OTHER, TOKENID, _Z_OTHER);
      expect(token.ownerOf(TOKENID)).toEqual(_Z_OTHER);
    });

    it('should update after multiple burns', () => {
      _caller = _OWNER;
      token._mint(_Z_OWNER, TOKENID);
      token._burn(TOKENID);
      token._mint(_Z_OWNER, TOKENID);
      token.approve(_Z_SPENDER, TOKENID, _caller);
      token._update(_Z_SPENDER, TOKENID, _Z_SPENDER);
      expect(token.ownerOf(TOKENID)).toEqual(_Z_SPENDER);
    });
  });

  describe('_approve', () => {
    it('should approve if auth is owner', () => {
      token._mint(_Z_OWNER, TOKENID);
      token._approve(_Z_SPENDER, TOKENID, _Z_OWNER);
      expect(token.getApproved(TOKENID)).toEqual(_Z_SPENDER);
    });

    it('should approve if auth is approved for all', () => {
      _caller = _OWNER;
      token._mint(_Z_OWNER, TOKENID);
      token.setApprovalForAll(_Z_SPENDER, true, _caller);
      token._approve(_Z_SPENDER, TOKENID, _Z_SPENDER);
      expect(token.getApproved(TOKENID)).toEqual(_Z_SPENDER);
    });

    it('should throw if auth is unauthorized', () => {
      token._mint(_Z_OWNER, TOKENID);
      expect(() => {
        token._approve(_Z_SPENDER, TOKENID, _Z_SPENDER);
      }).toThrow('ERC721: Invalid Approver');
    });

    it('should approve if auth is zero address', () => {
      token._mint(_Z_OWNER, TOKENID);
      token._approve(_Z_SPENDER, TOKENID, ZERO_KEY);
      expect(token.getApproved(TOKENID)).toEqual(_Z_SPENDER);
    });
  });

  describe('_checkAuthorized', () => {
    it('should throw if token not minted', () => {
      expect(() => {
        token._checkAuthorized(ZERO_KEY, _Z_OWNER, TOKENID);
      }).toThrow('ERC721: Nonexistent Token');
    });

    it('should throw if spender does not have approval', () => {
      token._mint(_Z_OWNER, TOKENID);
      expect(() => {
        token._checkAuthorized(_Z_OWNER, _Z_SPENDER, TOKENID);
      }).toThrow('ERC721: Insufficient Approval');
    });
  });

  describe('_isAuthorized', () => {
    it('should return true if spender is authorized', () => {
      _caller = _OWNER;
      token._mint(_Z_OWNER, TOKENID);
      token.approve(_Z_SPENDER, TOKENID, _caller);
      expect(token._isAuthorized(_Z_OWNER, _Z_SPENDER, TOKENID)).toBe(true);
    });

    it('should return true if spender is authorized for all', () => {
      _caller = _OWNER;
      token._mint(_Z_OWNER, TOKENID);
      token.setApprovalForAll(_Z_SPENDER, true, _caller);
      expect(token._isAuthorized(_Z_OWNER, _Z_SPENDER, TOKENID)).toBe(true);
    });

    it('should return true if spender is owner', () => {
      token._mint(_Z_OWNER, TOKENID);
      expect(token._isAuthorized(_Z_OWNER, _Z_OWNER, TOKENID)).toBe(true);
    });

    it('should return false if spender is zero address', () => {
      expect(token._isAuthorized(_Z_OWNER, ZERO_KEY, TOKENID)).toBe(false);
    });
  });

  describe('_getApproved', () => {
    it('should return zero address if token is not minted', () => {
      expect(token._getApproved(TOKENID)).toEqual(ZERO_KEY);
    });

    it('should return approved address', () => {
      _caller = _OWNER;
      token._mint(_Z_OWNER, TOKENID);
      token.approve(_Z_SPENDER, TOKENID, _caller);
      expect(token._getApproved(TOKENID)).toEqual(_Z_SPENDER);
    });
  });

  describe('_setApprovalForAll', () => {
    it('should approve operator', () => {
      token._mint(_Z_OWNER, TOKENID);
      token._setApprovalForAll(_Z_OWNER, _Z_SPENDER, true);
      expect(token.isApprovedForAll(_Z_OWNER, _Z_SPENDER)).toBe(true);
    });

    it('should revoke operator approval', () => {
      _caller = _OWNER;
      token._mint(_Z_OWNER, TOKENID);
      token.setApprovalForAll(_Z_SPENDER, true, _caller);
      expect(token.isApprovedForAll(_Z_OWNER, _Z_SPENDER)).toBe(true);

      token._setApprovalForAll(_Z_OWNER, _Z_SPENDER, false);
      expect(token.isApprovedForAll(_Z_OWNER, _Z_SPENDER)).toBe(false);
    });

    it('should throw if operator is zero address', () => {
      expect(() => {
        token._setApprovalForAll(_Z_OWNER, ZERO_KEY, true);
      }).toThrow('ERC721: Invalid Operator');
    });
  });

  describe('_mint', () => {
    it('should not mint to ContractAddress', () => {
      expect(() => {
        token._mint(_SOME_CONTRACT, TOKENID);
      }).toThrow('ERC721: Unsafe Transfer');
    });

    it('should not mint to zero address', () => {
      expect(() => {
        token._mint(ZERO_KEY, TOKENID);
      }).toThrow('ERC721: Invalid Receiver');
    });

    it('should not mint a token that already exists', () => {
      token._mint(_Z_OWNER, TOKENID);
      expect(() => {
        token._mint(_Z_OWNER, TOKENID);
      }).toThrow('ERC721: Invalid Sender');
    });

    it('should mint token', () => {
      token._mint(_Z_OWNER, TOKENID);
      expect(token.ownerOf(TOKENID)).toEqual(_Z_OWNER);
      expect(token.balanceOf(_Z_OWNER)).toEqual(1n);

      token._mint(_Z_OWNER, TOKENID + 1n);
      token._mint(_Z_OWNER, TOKENID + 2n);
      expect(token.balanceOf(_Z_OWNER)).toEqual(3n);
    });

    it('should mint multiple tokens in sequence', () => {
      for (let i = 0; i < 10; i++) {
        token._mint(_Z_OWNER, TOKENID + BigInt(i));
      }
      expect(token.balanceOf(_Z_OWNER)).toEqual(10n);
    });

    it('should mint with very long token IDs', () => {
      const longTokenId = BigInt('18446744073709551615');
      token._mint(_Z_OWNER, longTokenId);
      expect(token.ownerOf(longTokenId)).toEqual(_Z_OWNER);
    });

    it('should mint after burning', () => {
      token._mint(_Z_OWNER, TOKENID);
      token._burn(TOKENID);
      token._mint(_Z_OWNER, TOKENID);
      expect(token.ownerOf(TOKENID)).toEqual(_Z_OWNER);
    });

    it('should mint with special characters in metadata', () => {
      token._mint(_Z_OWNER, TOKENID);
      token._setTokenURI(TOKENID, { is_some: true, value: '!@#$%^&*()_+' });
      expect(token.tokenURI(TOKENID)).toEqual({ is_some: true, value: '!@#$%^&*()_+' });
    });
  });

  describe('_burn', () => {
    it('should burn token', () => {
      token._mint(_Z_OWNER, TOKENID);
      expect(token.balanceOf(_Z_OWNER)).toEqual(1n);

      token._burn(TOKENID);
      expect(token._ownerOf(TOKENID)).toEqual(ZERO_KEY);
      expect(token.balanceOf(_Z_OWNER)).toEqual(0n);
    });

    it('should not burn a token that does not exist', () => {
      expect(() => {
        token._burn(TOKENID);
      }).toThrow('ERC721: Invalid Sender');
    });

    it('should clear approval when token is burned', () => {
      _caller = _OWNER;
      token._mint(_Z_OWNER, TOKENID);
      token.approve(_Z_SPENDER, TOKENID, _caller);
      expect(token.getApproved(TOKENID)).toEqual(_Z_SPENDER);

      token._burn(TOKENID);
      expect(token._getApproved(TOKENID)).toEqual(ZERO_KEY);
    });

    it('should burn multiple tokens in sequence', () => {
      token._mint(_Z_OWNER, TOKENID);
      token._mint(_Z_OWNER, TOKENID + 1n);
      token._mint(_Z_OWNER, TOKENID + 2n);
      token._burn(TOKENID);
      token._burn(TOKENID + 1n);
      token._burn(TOKENID + 2n);
      expect(token.balanceOf(_Z_OWNER)).toEqual(0n);
    });

    it('should burn with very long token IDs', () => {
      const longTokenId = BigInt('18446744073709551615');
      token._mint(_Z_OWNER, longTokenId);
      token._burn(longTokenId);
      expect(token._ownerOf(longTokenId)).toEqual(ZERO_KEY);
    });

    it('should burn after transfer', () => {
      token._mint(_Z_OWNER, TOKENID);
      token._transfer(_Z_OWNER, _Z_SPENDER, TOKENID);
      token._burn(TOKENID);
      expect(token._ownerOf(TOKENID)).toEqual(ZERO_KEY);
    });

    it('should burn after approval', () => {
      _caller = _OWNER;
      token._mint(_Z_OWNER, TOKENID);
      token.approve(_Z_SPENDER, TOKENID, _caller);
      token._burn(TOKENID);
      expect(token._ownerOf(TOKENID)).toEqual(ZERO_KEY);
      expect(token._getApproved(TOKENID)).toEqual(ZERO_KEY);
    });
  });

  describe('_transfer', () => {
    it('should not transfer to ContractAddress', () => {
      token._mint(_Z_OWNER, TOKENID);
      expect(() => {
        token._transfer(_Z_OWNER, _SOME_CONTRACT, TOKENID);
      }).toThrow('ERC721: Unsafe Transfer');
    });

    it('should transfer token', () => {
      token._mint(_Z_OWNER, TOKENID);
      expect(token.balanceOf(_Z_OWNER)).toEqual(1n);
      expect(token.balanceOf(_Z_SPENDER)).toEqual(0n);
      expect(token.ownerOf(TOKENID)).toEqual(_Z_OWNER);

      token._transfer(_Z_OWNER, _Z_SPENDER, TOKENID);
      expect(token.balanceOf(_Z_OWNER)).toEqual(0n);
      expect(token.balanceOf(_Z_SPENDER)).toEqual(1n);
      expect(token.ownerOf(TOKENID)).toEqual(_Z_SPENDER);
    });

    it('should not transfer to zero address', () => {
      expect(() => {
        token._transfer(_Z_OWNER, ZERO_KEY, TOKENID);
      }).toThrow('ERC721: Invalid Receiver');
    });

    it('should throw if from does not own token', () => {
      token._mint(_Z_OWNER, TOKENID);
      expect(() => {
        token._transfer(_Z_SPENDER, _Z_SPENDER, TOKENID);
      }).toThrow('ERC721: Incorrect Owner');
    });

    it('should throw if token does not exist', () => {
      expect(() => {
        token._transfer(_Z_OWNER, _Z_SPENDER, TOKENID);
      }).toThrow('ERC721: Nonexistent Token');
    });
  });

  describe('_setTokenURI', () => {
    it('should throw if token does not exist', () => {
      expect(() => {
        token._setTokenURI(TOKENID, NONE_STRING);
      }).toThrow('ERC721: Nonexistent Token');
    });

    it('should set tokenURI', () => {
      token._mint(_Z_OWNER, TOKENID);
      token._setTokenURI(TOKENID, SOME_STRING);
      expect(token.tokenURI(TOKENID)).toEqual(SOME_STRING);
    });
  });

  describe('_unsafe_mint', () => {
    it('should mint to ContractAddress', () => {
      expect(() => {
        token._unsafe_mint(_SOME_CONTRACT, TOKENID);
      }).not.toThrow();
    });

    it('should not mint to zero address', () => {
      expect(() => {
        token._unsafe_mint(ZERO_KEY, TOKENID);
      }).toThrow('ERC721: Invalid Receiver');
    });

    it('should not mint a token that already exists', () => {
      token._unsafe_mint(_Z_OWNER, TOKENID);
      expect(() => {
        token._unsafe_mint(_Z_OWNER, TOKENID);
      }).toThrow('ERC721: Invalid Sender');
    });

    it('should mint token', () => {
      token._unsafe_mint(_Z_OWNER, TOKENID);
      expect(token.ownerOf(TOKENID)).toEqual(_Z_OWNER);
      expect(token.balanceOf(_Z_OWNER)).toEqual(1n);

      token._unsafe_mint(_Z_OWNER, TOKENID + 1n);
      token._unsafe_mint(_Z_OWNER, TOKENID + 2n);
      expect(token.balanceOf(_Z_OWNER)).toEqual(3n);
    });
  });

  describe('_unsafe_transfer', () => {
    it('should transfer to ContractAddress', () => {
      token._mint(_Z_OWNER, TOKENID);
      expect(() => {
        token._unsafe_transfer(_Z_OWNER, _SOME_CONTRACT, TOKENID);
      }).not.toThrow();
    });

    it('should transfer token', () => {
      token._mint(_Z_OWNER, TOKENID);
      expect(token.balanceOf(_Z_OWNER)).toEqual(1n);
      expect(token.balanceOf(_Z_SPENDER)).toEqual(0n);
      expect(token.ownerOf(TOKENID)).toEqual(_Z_OWNER);

      token._unsafe_transfer(_Z_OWNER, _Z_SPENDER, TOKENID);
      expect(token.balanceOf(_Z_OWNER)).toEqual(0n);
      expect(token.balanceOf(_Z_SPENDER)).toEqual(1n);
      expect(token.ownerOf(TOKENID)).toEqual(_Z_SPENDER);
    });

    it('should not transfer to zero address', () => {
      expect(() => {
        token._unsafe_transfer(_Z_OWNER, ZERO_KEY, TOKENID);
      }).toThrow('ERC721: Invalid Receiver');
    });

    it('should throw if from does not own token', () => {
      token._mint(_Z_OWNER, TOKENID);
      expect(() => {
        token._unsafe_transfer(_Z_SPENDER, _Z_SPENDER, TOKENID);
      }).toThrow('ERC721: Incorrect Owner');
    });

    it('should throw if token does not exist', () => {
      expect(() => {
        token._unsafe_transfer(_Z_OWNER, _Z_SPENDER, TOKENID);
      }).toThrow('ERC721: Nonexistent Token');
    });
  });

  describe('_unsafeTransferFrom', () => {
    it('should transfer to ContractAddress', () => {
      token._mint(_Z_OWNER, TOKENID);
      expect(() => {
        token._unsafeTransferFrom(_Z_OWNER, _SOME_CONTRACT, TOKENID);
      }).not.toThrow();
    });

    it('should not transfer to zero address', () => {
      token._mint(_Z_OWNER, TOKENID);
      expect(() => {
        token._unsafeTransferFrom(_Z_OWNER, ZERO_KEY, TOKENID);
      }).toThrow('ERC721: Invalid Receiver');
    });

    it('should not transfer from zero address', () => {
      token._mint(_Z_OWNER, TOKENID);
      expect(() => {
        token._unsafeTransferFrom(ZERO_KEY, _Z_SPENDER, TOKENID);
      }).toThrow('ERC721: Incorrect Owner');
    });

    it('unapproved operator should not transfer', () => {
      _caller = _SPENDER;
      token._mint(_Z_OWNER, TOKENID);
      expect(() => {
        token._unsafeTransferFrom(_Z_OWNER, _Z_SPENDER, TOKENID, _caller);
      }).toThrow('ERC721: Insufficient Approval');
    });

    it('should not transfer token that has not been minted', () => {
      _caller = _OWNER;
      expect(() => {
        token._unsafeTransferFrom(_Z_OWNER, _Z_SPENDER, TOKENID, _caller);
      }).toThrow('ERC721: Nonexistent Token');
    });

    it('should transfer token via approved operator', () => {
      _caller = _OWNER;
      token._mint(_Z_OWNER, TOKENID);
      token.approve(_Z_SPENDER, TOKENID, _OWNER);

      _caller = _SPENDER;
      token._unsafeTransferFrom(_Z_OWNER, _Z_SPENDER, TOKENID, _caller);
      expect(token.ownerOf(TOKENID)).toEqual(_Z_SPENDER);
    });

    it('should transfer token via approvedForAll operator', () => {
      _caller = _OWNER;
      token._mint(_Z_OWNER, TOKENID);
      token.setApprovalForAll(_Z_SPENDER, true, _OWNER);

      _caller = _SPENDER;
      token._unsafeTransferFrom(_Z_OWNER, _Z_SPENDER, TOKENID, _caller);
      expect(token.ownerOf(TOKENID)).toEqual(_Z_SPENDER);
    });
  });
});
