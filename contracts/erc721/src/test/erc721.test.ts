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
      expect(token.getApproved(TOKENID)).toEqual(ZERO_KEY.left);
    });
  });

  describe('setApprovalForAll', () => {
    it('should not approve zero address', () => {
      _caller = _OWNER;
      token._mint(_Z_OWNER, TOKENID);
      expect(() => {
        token.setApprovalForAll(ZERO_KEY.left, true, _caller);
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
    it('should not transfer to zero address', () => {
      token._mint(_Z_OWNER, TOKENID);
      expect(() => {
        token.transferFrom(_Z_OWNER, ZERO_KEY.left, TOKENID);
      }).toThrow('ERC721: Invalid Receiver');
    });

    it('should not transfer from zero address', () => {
      token._mint(_Z_OWNER, TOKENID);
      expect(() => {
        token.transferFrom(ZERO_KEY.left, _Z_SPENDER, TOKENID);
      }).toThrow('ERC721: Incorrect Owner');
    });

    it('unapproved operator should not transfer', () => {
      _caller = _SPENDER
      token._mint(_Z_OWNER, TOKENID);
      expect(() => {
        token.transferFrom(_Z_OWNER, _Z_SPENDER, TOKENID, _caller);
      }).toThrow('ERC721: Insufficient Approval');
    })
    
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
      expect(token._ownerOf(TOKENID)).toEqual(ZERO_KEY.left);
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
      const prevOwner = token._update(_Z_SPENDER, TOKENID, ZERO_KEY.left);

      expect(prevOwner).toEqual(_Z_OWNER);
      expect(token.ownerOf(TOKENID)).toEqual(_Z_SPENDER);
      expect(token.balanceOf(_Z_OWNER)).toEqual(0n);
      expect(token.balanceOf(_Z_SPENDER)).toEqual(1n);
      expect(token.getApproved(TOKENID)).toEqual(ZERO_KEY.left)
    });

    it('should mint a token', () => {
      const prevOwner = token._update(_Z_OWNER, TOKENID, ZERO_KEY.left);
      expect(prevOwner).toEqual(ZERO_KEY.left);
      expect(token.ownerOf(TOKENID)).toEqual(_Z_OWNER);
      expect(token.balanceOf(_Z_OWNER)).toEqual(1n);
    });

    it('should burn a token', () => {
      token._mint(_Z_OWNER, TOKENID);
      const prevOwner = token._update(ZERO_KEY.left, TOKENID, _Z_OWNER);
      expect(prevOwner).toEqual(_Z_OWNER);
      expect(token.balanceOf(_Z_OWNER)).toEqual(0n);
      expect(token._ownerOf(TOKENID)).toEqual(ZERO_KEY.left);
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
      token._approve(_Z_SPENDER, TOKENID, ZERO_KEY.left);
      expect(token.getApproved(TOKENID)).toEqual(_Z_SPENDER); 
    });
  });

  describe('_checkAuthorized', () => {
    it('should throw if token not minted', () => {
      expect(() => {
        token._checkAuthorized(ZERO_KEY.left, _Z_OWNER, TOKENID);
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
      expect(token._isAuthorized(_Z_OWNER, ZERO_KEY.left, TOKENID)).toBe(false);
    }); 
  });

  describe('_getApproved', () => {
    it('should return zero address if token is not minted', () => {
      expect(token._getApproved(TOKENID)).toEqual(ZERO_KEY.left);
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
        token._setApprovalForAll(_Z_OWNER, ZERO_KEY.left, true);
      }).toThrow('ERC721: Invalid Operator');
    });
  });
});