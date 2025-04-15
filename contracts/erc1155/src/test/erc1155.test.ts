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

      it('should fail with insufficient balance', () => {
        expect(() => {
          token.safeTransferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, AMOUNT + 1n, caller);
        }).toThrow('ERC1155: insufficient balance');
      });

    //it('should fail with transfer from zero', () => {
    //  caller = ZERO;
//
    //  expect(() => {
    //    token.safeTransferFrom(utils.ZERO_KEY, Z_RECIPIENT, TOKEN_ID, AMOUNT, caller);
    //  }).toThrow('ERC1155: invalid sender');
    //});

      it('should fail with transfer to zero', () => {
        expect(() => {
          token.safeTransferFrom(Z_OWNER, utils.ZERO_ADDRESS, TOKEN_ID, AMOUNT, caller);
        }).toThrow('ERC1155: invalid receiver');
      });

      it('should allow transfer of 0 tokens', () => {
        token.safeTransferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, 0n, caller);

        expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(AMOUNT);
        expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(0n);
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
  });

    //it('should handle transfer with empty _balances', () => {
    //  caller = SPENDER;
//
    //  expect(() => {
    //    token.safeTransferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, 1n, caller);
    //  }).toThrow('ERC1155: insufficient balance');
    //});
  });
//
//  describe('approve', () => {
//    beforeEach(() => {
//      expect(token.allowance(Z_OWNER, Z_SPENDER)).toEqual(0n);
//    });
//
//    it('should approve and update allowance', () => {
//      caller = OWNER;
//
//      token.approve(Z_SPENDER, AMOUNT, caller);
//      expect(token.allowance(Z_OWNER, Z_SPENDER)).toEqual(AMOUNT);
//    });
//
//    it('should approve and update allowance for multiple spenders', () => {
//      caller = OWNER;
//
//      token.approve(Z_SPENDER, AMOUNT, caller);
//      expect(token.allowance(Z_OWNER, Z_SPENDER)).toEqual(AMOUNT);
//
//      token.approve(Z_OTHER, AMOUNT, caller);
//      expect(token.allowance(Z_OWNER, Z_OTHER)).toEqual(AMOUNT);
//
//      expect(token.allowance(Z_OWNER, Z_RECIPIENT)).toEqual(0n);
//    });
//
//    it('should fail when approve from zero', () => {
//      caller = ZERO;
//
//      expect(() => {
//        token.approve(Z_SPENDER, AMOUNT, caller);
//      }).toThrow('ERC1155: invalid owner');
//    });
//
//    it('should fail when approve to zero', () => {
//      caller = OWNER;
//
//      expect(() => {
//        token.approve(utils.ZERO_ADDRESS, AMOUNT, caller);
//      }).toThrow('ERC1155: invalid spender');
//    });
//
//    it('should transfer exact allowance and fail subsequent transfer', () => {
//      token._mint(Z_OWNER, AMOUNT);
//      caller = OWNER;
//      token.approve(Z_SPENDER, AMOUNT, caller);
//
//      caller = SPENDER;
//      token.transferFrom(Z_OWNER, Z_RECIPIENT, AMOUNT, caller);
//      expect(token.allowance(Z_OWNER, Z_SPENDER)).toEqual(0n);
//
//      expect(() => {
//        token.transferFrom(Z_OWNER, Z_RECIPIENT, 1n, caller);
//      }).toThrow('ERC1155: insufficient allowance');
//    });
//
//    it('should allow approve of 0 tokens', () => {
//      caller = OWNER;
//      token.approve(Z_SPENDER, 0n, caller);
//      expect(token.allowance(Z_OWNER, Z_SPENDER)).toEqual(0n);
//    });
//
//    it('should handle allowance with empty _allowances', () => {
//      expect(token.allowance(Z_OWNER, Z_SPENDER)).toEqual(0n);
//    });
//  });
//
//  describe('transferFrom', () => {
//    beforeEach(() => {
//      caller = OWNER;
//
//      token.approve(Z_SPENDER, AMOUNT, caller);
//      token._mint(Z_OWNER, AMOUNT);
//    });
//
//    afterEach(() => {
//      expect(token.totalSupply()).toEqual(AMOUNT);
//    });
//
//    it('should transferFrom spender (partial)', () => {
//      caller = SPENDER;
//      const partialAmt = AMOUNT - 1n;
//
//      const txSuccess = token.transferFrom(Z_OWNER, Z_RECIPIENT, partialAmt, caller);
//      expect(txSuccess).toBeTruthy();
//
//      // Check balances
//      expect(token.balanceOf(Z_OWNER)).toEqual(1n);
//      expect(token.balanceOf(Z_RECIPIENT)).toEqual(partialAmt);
//      // Check leftover allowance
//      expect(token.allowance(Z_OWNER, Z_SPENDER)).toEqual(1n);
//    });
//
//    it('should transferFrom spender (full)', () => {
//      caller = SPENDER;
//
//      const txSuccess = token.transferFrom(Z_OWNER, Z_RECIPIENT, AMOUNT, caller);
//      expect(txSuccess).toBeTruthy();
//
//      // Check balances
//      expect(token.balanceOf(Z_OWNER)).toEqual(0n);
//      expect(token.balanceOf(Z_RECIPIENT)).toEqual(AMOUNT);
//      // Check no allowance
//      expect(token.allowance(Z_OWNER, Z_SPENDER)).toEqual(0n);
//    });
//
//    it('should transferFrom and not consume infinite allowance', () => {
//      caller = OWNER;
//      token.approve(Z_SPENDER, MAX_UINT128, caller);
//
//      caller = SPENDER;
//      const txSuccess = token.transferFrom(Z_OWNER, Z_RECIPIENT, AMOUNT, caller);
//      expect(txSuccess).toBeTruthy();
//
//      // Check balances
//      expect(token.balanceOf(Z_OWNER)).toEqual(0n);
//      expect(token.balanceOf(Z_RECIPIENT)).toEqual(AMOUNT);
//      // Check infinite allowance
//      expect(token.allowance(Z_OWNER, Z_SPENDER)).toEqual(MAX_UINT128);
//    });
//
//    it ('should fail when transfer amount exceeds allowance', () => {
//      caller = SPENDER;
//
//      expect(() => {
//        token.transferFrom(Z_OWNER, Z_RECIPIENT, AMOUNT + 1n);
//      }).toThrow('ERC1155: insufficient allowance');
//    });
//
//    it ('should fail when transfer amount exceeds balance', () => {
//      caller = OWNER;
//      // Increase allowance > balance
//      token.approve(Z_SPENDER, AMOUNT + 1n, caller);
//
//      caller = SPENDER;
//      expect(() => {
//        token.transferFrom(Z_OWNER, Z_RECIPIENT, AMOUNT + 1n, caller);
//      }).toThrow('ERC1155: insufficient balance');
//    });
//
//    it('should fail when spender does not have allowance', () => {
//      caller = UNAUTHORIZED;
//
//      expect(() => {
//        token.transferFrom(Z_OWNER, Z_RECIPIENT, AMOUNT, caller);
//      }).toThrow("ERC1155: insufficient allowance");
//    });
//
//    it('should fail to transferFrom zero address', () => {
//      caller = ZERO;
//
//      expect(() => {
//        token.transferFrom(Z_OWNER, Z_RECIPIENT, AMOUNT, caller);
//      }).toThrow("ERC1155: insufficient allowance");
//    });
//
//    it('should fail to transferFrom to the zero address', () => {
//      caller = SPENDER;
//
//      expect(() => {
//        token.transferFrom(Z_OWNER, utils.ZERO_ADDRESS, AMOUNT, caller);
//      }).toThrow("ERC1155: invalid receiver");
//    });
//  });
//
//  describe('_transfer', () => {
//    beforeEach(() => {
//      token._mint(Z_OWNER, AMOUNT);
//    });
//
//    afterEach(() => {
//      expect(token.totalSupply()).toEqual(AMOUNT);
//    });
//
//    it('should update balances (partial)', () => {
//      const partialAmt = AMOUNT - 1n;
//      token._transfer(Z_OWNER, Z_RECIPIENT, partialAmt);
//
//      expect(token.balanceOf(Z_OWNER)).toEqual(1n);
//      expect(token.balanceOf(Z_RECIPIENT)).toEqual(partialAmt);
//    });
//  })
//
//  describe('_mint', () => {
//    it('should mint and update supply', () => {
//      expect(token.totalSupply()).toEqual(0n);
//
//      token._mint(Z_RECIPIENT, AMOUNT);
//      expect(token.totalSupply()).toEqual(AMOUNT);
//      expect(token.balanceOf(Z_RECIPIENT)).toEqual(AMOUNT);
//    });
//
//    it('should catch mint overflow', () => {
//      token._mint(Z_RECIPIENT, MAX_UINT128);
//
//      expect(() => {
//        token._mint(Z_RECIPIENT, 1n);
//      }).toThrow('ERC1155: arithmetic overflow');
//    });
//
//    it('should not mint to zero pubkey', () => {
//      expect(() => {
//        token._mint(utils.ZERO_KEY, AMOUNT);
//      }).toThrow('ERC1155: invalid receiver');
//    });
//
//    it('should not mint to zero contract address', () => {
//      expect(() => {
//        token._mint(utils.ZERO_ADDRESS, AMOUNT);
//      }).toThrow('ERC1155: invalid receiver');
//    });
//
//    it('should allow mint of 0 tokens', () => {
//      token._mint(Z_OWNER, 0n);
//      expect(token.totalSupply()).toEqual(0n);
//      expect(token.balanceOf(Z_OWNER)).toEqual(0n);
//    });
//  });
//
//  describe('_burn', () => {
//    beforeEach(() => {
//      token._mint(Z_OWNER, AMOUNT);
//    });
//
//    it('should burn tokens', () => {
//      token._burn(Z_OWNER, 1n);
//
//      const afterBurn = AMOUNT - 1n;
//      expect(token.balanceOf(Z_OWNER)).toEqual(afterBurn);
//      expect(token.totalSupply()).toEqual(afterBurn);
//    });
//
//    it('should throw when burning from zero', () => {
//      expect(() => {
//        token._burn(utils.ZERO_KEY, AMOUNT);
//      }).toThrow('ERC1155: invalid sender');
//    });
//
//    it('should throw when burn amount is greater than balance', () => {
//      expect(() => {
//        token._burn(Z_OWNER, AMOUNT + 1n);
//      }).toThrow('ERC1155: insufficient balance');
//    });
//
//    it('should allow burn of 0 tokens', () => {
//      token._burn(Z_OWNER, 0n);
//      expect(token.totalSupply()).toEqual(AMOUNT);
//      expect(token.balanceOf(Z_OWNER)).toEqual(AMOUNT);
//    });
//  });
//
//  describe('_update', () => {
//    it('should update from zero to non-zero (mint)', () => {
//      expect(token.totalSupply()).toEqual(0n);
//      expect(token.balanceOf(Z_OWNER)).toEqual(0n);
//
//      token._update(utils.ZERO_KEY, Z_OWNER, AMOUNT);
//
//      expect(token.totalSupply()).toEqual(AMOUNT);
//      expect(token.balanceOf(Z_OWNER)).toEqual(AMOUNT);
//    });
//
//    it('should catch overflow from zero to non-zero (mint)', () => {
//      token._update(utils.ZERO_KEY, Z_OWNER, MAX_UINT128);
//
//      expect(() => {
//        token._update(utils.ZERO_KEY, Z_OWNER, 1n);
//      }).toThrow('ERC1155: arithmetic overflow');
//    });
//
//    describe('with minted tokens', () => {
//      beforeEach(() => {
//        token._update(utils.ZERO_ADDRESS, Z_OWNER, AMOUNT);
//
//        expect(token.totalSupply()).toEqual(AMOUNT);
//        expect(token.balanceOf(Z_OWNER)).toEqual(AMOUNT);
//      });
//
//      it('should update from non-zero to zero (burn)', () => {
//        token._update(Z_OWNER, utils.ZERO_ADDRESS, AMOUNT);
//
//        expect(token.totalSupply()).toEqual(0n);
//        expect(token.balanceOf(Z_OWNER)).toEqual(0n);
//      });
//
//      it('should catch overflow from non-zero to zero (burn)', () => {
//        token._update(Z_OWNER, utils.ZERO_ADDRESS, AMOUNT);
//
//        expect(() => {
//          token._update(Z_OWNER, utils.ZERO_ADDRESS, 1n);
//        }).toThrow('ERC1155: insufficient balance');
//      });
//
//      it('should update from non-zero to non-zero (transfer)', () => {
//        token._update(Z_OWNER, Z_RECIPIENT, AMOUNT - 1n);
//
//        expect(token.totalSupply()).toEqual(AMOUNT);
//        expect(token.balanceOf(Z_OWNER)).toEqual(1n);
//        expect(token.balanceOf(Z_RECIPIENT)).toEqual(AMOUNT - 1n);
//      });
//    });
//  });
//
//  describe('Multiple Operations', () => {
//    it('should handle mint → transfer → burn sequence', () => {
//      token._mint(Z_OWNER, AMOUNT);
//      expect(token.totalSupply()).toEqual(AMOUNT);
//      expect(token.balanceOf(Z_OWNER)).toEqual(AMOUNT);
//
//      caller = OWNER;
//      token.transfer(Z_RECIPIENT, AMOUNT - 1n, caller);
//      expect(token.balanceOf(Z_OWNER)).toEqual(1n);
//      expect(token.balanceOf(Z_RECIPIENT)).toEqual(AMOUNT - 1n);
//
//      token._burn(Z_OWNER, 1n);
//      expect(token.totalSupply()).toEqual(AMOUNT - 1n);
//      expect(token.balanceOf(Z_OWNER)).toEqual(0n);
//    });
//  });
});
