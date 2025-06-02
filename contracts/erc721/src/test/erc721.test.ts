import type { CoinPublicKey } from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { ERC721Simulator } from './simulators/ERC721Simulator';
import type { MaybeString } from './types/string';
import {
  encodeToPK,
  ZERO_KEY,
} from './utils/address';

const NO_STRING: MaybeString = {
  is_some: false,
  value: '',
};
const SOME_STRING: MaybeString = {
  is_some: true,
  value: 'https://openzeppelin.example',
};
const NAME: MaybeString = {
  is_some: true,
  value: 'NAME',
};
const SYMBOL: MaybeString = {
  is_some: true,
  value: 'SYMBOL',
};

const TOKENID: bigint = BigInt(1);

const _AMOUNT: bigint = BigInt(1);
const _MAX_UINT128 = BigInt(2 ** 128) - BigInt(1);

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
const _ZERO = String().padStart(64, '0');
const _Z_OWNER = encodeToPK('OWNER');
const _Z_SPENDER = encodeToPK('SPENDER');
const _Z_OTHER = encodeToPK('OTHER');

let token: ERC721Simulator;
let _caller: CoinPublicKey;

describe('ERC721', () => {
  describe('initializer and metadata', () => {
    it('should initialize metadata', () => {
      token = new ERC721Simulator(NAME, SYMBOL);

      expect(token.name()).toEqual(NAME);
      expect(token.symbol()).toEqual(SYMBOL);
    });

    it('should initialize empty metadata', () => {
      token = new ERC721Simulator(NO_STRING, NO_STRING);

      expect(token.name()).toEqual(NO_STRING);
      expect(token.symbol()).toEqual(NO_STRING);
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
  });

  describe('tokenURI', () => {
    it('should throw if does not exist', () => {
      expect(() => {
        token.tokenURI(TOKENID);
      }).toThrow('ERC721: Nonexistent Token');
    });

    it('should return none if tokenURI set as default value', () => {
      token._mint(_Z_OWNER, TOKENID);
      token._setTokenURI(TOKENID, NO_STRING);
      expect(token.tokenURI(TOKENID)).toEqual(NO_STRING);
    });

    it('should return some string if tokenURI is set', () => {
      token._mint(_Z_OWNER, TOKENID);
      token._setTokenURI(TOKENID, SOME_STRING);
      expect(token.tokenURI(TOKENID)).toEqual(SOME_STRING);
    });
  });

  describe('approve', () => {

    beforeEach(() => {
      token._mint(_Z_OWNER, TOKENID);
      expect(token.getApproved(TOKENID)).toEqual(ZERO_KEY.left);
    })

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
  });
});
