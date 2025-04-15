import { CoinPublicKey } from '@midnight-ntwrk/compact-runtime';
import { ERC1155Simulator } from './simulators';
import { MaybeString } from './types';
import * as utils from './utils';

const NO_STRING: MaybeString = {
  is_some: false,
  value: ''
};
const URI: MaybeString = {
  is_some: true,
  value: "https://uri.com/mock_v1"
};
const NEW_URI: MaybeString = {
  is_some: true,
  value: "https://uri.com/mock_v2"
};

// Amounts
const AMOUNT: bigint = BigInt(250);
const AMOUNT2: bigint = BigInt(9999);
const MAX_UINT128 = BigInt(2**128) - BigInt(1);

// IDs
const TOKEN_ID: bigint = BigInt(1);
const TOKEN_ID2: bigint = BigInt(22);
const TOKEN_ID3: bigint = BigInt(333);
const MAX_UINT256 = BigInt(2**256) - BigInt(1);

// PubKeys/addresses
const OWNER = String(Buffer.from("OWNER", 'ascii').toString('hex')).padStart(64, '0');
const SPENDER = String(Buffer.from("SPENDER", 'ascii').toString('hex')).padStart(64, '0');
const UNAUTHORIZED = String(Buffer.from("UNAUTHORIZED", 'ascii').toString('hex')).padStart(64, '0');
const ZERO = String().padStart(64, '0');
const Z_OWNER = utils.createEitherTestUser('OWNER');
const Z_RECIPIENT = utils.createEitherTestUser('RECIPIENT');
const Z_SPENDER = utils.createEitherTestUser('SPENDER');
const Z_OTHER = utils.createEitherTestUser('OTHER');
const SOME_CONTRACT = utils.createEitherTestContractAddress('SOME_CONTRACT');

let token: ERC1155Simulator;
let caller: CoinPublicKey;

describe('ERC1155', () => {
  describe('initializer and metadata', () => {
    it('should initialize metadata', () => {
      expect(1).toEqual(1);
      token = new ERC1155Simulator(URI);

      expect(token.uri(TOKEN_ID)).toEqual(URI);
    });

    it('should initialize empty metadata', () => {
      const NO_DECIMALS = 0n;
      token = new ERC1155Simulator(NO_STRING);

      expect(token.uri(TOKEN_ID)).toEqual(NO_STRING);
    });
  });

  beforeEach(() => {
    token = new ERC1155Simulator(URI);
  });

  describe('balanceOf', () => {
    it('should return zero when requested account has no balance', () => {
      expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(0n);
      expect(token.balanceOf(Z_OWNER, TOKEN_ID2)).toEqual(0n);
    });

    it('should return balance when requested account has tokens', () => {
      token._mint(Z_OWNER, TOKEN_ID, AMOUNT);
      expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(AMOUNT);

      token._mint(Z_OWNER, TOKEN_ID2, AMOUNT2);
      expect(token.balanceOf(Z_OWNER, TOKEN_ID2)).toEqual(AMOUNT2);
    });
  });

  describe('isApprovedForAll', () => {
    it('should return false when not set', () => {
      expect(token.isApprovedForAll(Z_OWNER, Z_SPENDER)).toBe(false);
    });
  });

  describe('setApprovalForAll', () => {
    it('should return false when set to false', () => {
      caller = OWNER;

      token.setApprovalForAll(Z_SPENDER, false, caller);
      expect(token.isApprovedForAll(Z_OWNER, Z_SPENDER)).toBe(false);
    });

    it('should fail when attempting to approve zero address as an operator', () => {
      caller = OWNER;

      expect(() => {
        token.setApprovalForAll(utils.ZERO_KEY, true);
      }).toThrow('ERC1155: invalid operator');
    });

    describe('when spender is approved as an operator', () => {
      beforeEach(() => {
        caller = OWNER
        token.setApprovalForAll(Z_SPENDER, true, caller);
      });

      it('should return true when set to true', () => {
        expect(token.isApprovedForAll(Z_OWNER, Z_SPENDER)).toBe(true);
      });

      it('should unset → set → unset operator', () => {
        token.setApprovalForAll(Z_SPENDER, false);
        expect(token.isApprovedForAll(Z_OWNER, Z_SPENDER)).toBe(false);

        token.setApprovalForAll(Z_SPENDER, true);
        expect(token.isApprovedForAll(Z_OWNER, Z_SPENDER)).toBe(true);

        token.setApprovalForAll(Z_SPENDER, false);
        expect(token.isApprovedForAll(Z_OWNER, Z_SPENDER)).toBe(false);
      });
    });
  });

  describe('safeTransferFrom', () => {
    beforeEach(() => {
      token._mint(Z_OWNER, TOKEN_ID, AMOUNT);

      expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(AMOUNT);
      expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(0n);
    });

    describe('when caller is the owner', () => {
      beforeEach(() => {
        caller = OWNER;
      });

      it('should transfer whole', () => {
        token.safeTransferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, AMOUNT, caller);

        expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(0n);
        expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(AMOUNT);
      });

      it('should transfer partial', () => {
        const partialAmt = AMOUNT - 1n;
        token.safeTransferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, partialAmt, caller);

        expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(AMOUNT - partialAmt);
        expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(partialAmt);
      });

      it('should allow transfer of 0 tokens', () => {
        token.safeTransferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, 0n, caller);

        expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(AMOUNT);
        expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(0n);
      });

      it('should fail with insufficient balance', () => {
        expect(() => {
          token.safeTransferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, AMOUNT + 1n, caller);
        }).toThrow('ERC1155: insufficient balance');
      });

      it('should fail with transfer from zero', () => {
        expect(() => {
          token.safeTransferFrom(utils.ZERO_KEY, Z_RECIPIENT, TOKEN_ID, AMOUNT, caller);
        }).toThrow('ERC1155: unauthorized operator');
      });

      it('should fail with transfer to zero', () => {
        expect(() => {
          token.safeTransferFrom(Z_OWNER, utils.ZERO_ADDRESS, TOKEN_ID, AMOUNT, caller);
        }).toThrow('ERC1155: invalid receiver');
      });
    });

    describe('when caller is spender', () => {
      beforeEach(() => {
        caller = OWNER;
        token._setApprovalForAll(Z_OWNER, Z_SPENDER, true);
        caller = SPENDER;

        expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(AMOUNT);
        expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(0n);
      });

      it('should transfer whole', () => {
        token.safeTransferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, AMOUNT, caller);

        expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(0n);
        expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(AMOUNT);
      });

      it('should transfer partial', () => {
        const partialAmt = AMOUNT - 1n;
        token.safeTransferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, partialAmt, caller);

        expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(AMOUNT - partialAmt);
        expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(partialAmt);
      });

      it('should allow transfer of 0 tokens', () => {
        token.safeTransferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, 0n, caller);

        expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(AMOUNT);
        expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(0n);
      });

      it('should fail with insufficient balance', () => {
        expect(() => {
          token.safeTransferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, AMOUNT + 1n, caller);
        }).toThrow('ERC1155: insufficient balance');
      });

      it('should fail with transfer from zero', () => {
        expect(() => {
          token.safeTransferFrom(utils.ZERO_KEY, Z_RECIPIENT, TOKEN_ID, AMOUNT, caller);
        }).toThrow('ERC1155: unauthorized operator');
      });

      it('should fail with transfer to zero', () => {
        expect(() => {
          token.safeTransferFrom(Z_OWNER, utils.ZERO_ADDRESS, TOKEN_ID, AMOUNT, caller);
        }).toThrow('ERC1155: invalid receiver');
      });
    });

    describe('when caller is unauthorized', () => {
      beforeEach(() => {
        caller = UNAUTHORIZED;
      });

      it('should fail when transfer whole', () => {
        expect(() => {
          token.safeTransferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, AMOUNT, caller);
        }).toThrow('ERC1155: unauthorized operator')
      });

      it('should fail when transfer partial', () => {
        expect(() => {
          const partialAmt = AMOUNT - 1n;
          token.safeTransferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, partialAmt, caller);
        }).toThrow('ERC1155: unauthorized operator')
      });

      it('should fail when transfer zero', () => {
        expect(() => {
          token.safeTransferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, 0n, caller);
        }).toThrow('ERC1155: unauthorized operator')
      });

      it('should fail with insufficient balance', () => {
        expect(() => {
          token.safeTransferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, AMOUNT + 1n, caller);
        }).toThrow('ERC1155: unauthorized operator');
      });

      it('should fail with transfer from zero', () => {
        caller = ZERO;

        expect(() => {
          token.safeTransferFrom(utils.ZERO_KEY, Z_RECIPIENT, TOKEN_ID, AMOUNT, caller);
        }).toThrow('ERC1155: invalid sender');
      });
    });
  });
});
