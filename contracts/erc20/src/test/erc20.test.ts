import { CoinPublicKey } from '@midnight-ntwrk/compact-runtime';
import { ERC20Simulator } from './simulators/ERC20Simulator';
import { MaybeString } from './types/string';
import * as utils from './utils';

const NO_STRING: MaybeString = {
  is_some: false,
  value: ''
};
const NAME: MaybeString = {
  is_some: true,
  value: "NAME"
};
const SYMBOL: MaybeString = {
  is_some: true,
  value: "SYMBOL"
};
const DECIMALS: bigint = 18n;

const AMOUNT: bigint = BigInt(250);
const MAX_UINT128 = BigInt(2**128) - BigInt(1);

const OWNER = String(Buffer.from("OWNER", 'ascii').toString('hex')).padStart(64, '0');
const SPENDER = String(Buffer.from("SPENDER", 'ascii').toString('hex')).padStart(64, '0');
const UNAUTHORIZED = String(Buffer.from("UNAUTHORIZED", 'ascii').toString('hex')).padStart(64, '0');
const ZERO = String().padStart(64, '0');
const Z_OWNER = utils.createEitherTestUser('OWNER');
const Z_RECIPIENT = utils.createEitherTestUser('RECIPIENT');
const Z_SPENDER = utils.createEitherTestUser('SPENDER');
const Z_OTHER = utils.createEitherTestUser('OTHER');
const SOME_CONTRACT = utils.createEitherTestContractAddress('SOME_CONTRACT');

let token: ERC20Simulator;
let caller: CoinPublicKey;

describe('ERC20', () => {
  describe('initializer and metadata', () => {
    it('should initialize metadata', () => {
      token = new ERC20Simulator(NAME, SYMBOL, DECIMALS);

      expect(token.name()).toEqual(NAME);
      expect(token.symbol()).toEqual(SYMBOL);
      expect(token.decimals()).toEqual(DECIMALS);
    });

    it('should initialize empty metadata', () => {
      const NO_DECIMALS = 0n;
      token = new ERC20Simulator(NO_STRING, NO_STRING, NO_DECIMALS);

      expect(token.name()).toEqual(NO_STRING);
      expect(token.symbol()).toEqual(NO_STRING);
      expect(token.decimals()).toEqual(NO_DECIMALS);
    });
  });

  beforeEach(() => {
    token = new ERC20Simulator(NAME, SYMBOL, DECIMALS);
  });

  describe('totalSupply', () => {
    it('returns 0 when there is no supply', () => {
      expect(token.totalSupply()).toEqual(0n);
    });

    it('returns the amount of existing tokens when there is a supply', () => {
      token._mint(Z_OWNER, AMOUNT);
      expect(token.totalSupply()).toEqual(AMOUNT);
    })
  })

  describe('balanceOf', () => {
    it('should return zero when requested account has no balance', () => {
      expect(token.balanceOf(Z_OWNER)).toEqual(0n);
    });

    it('should return balance when requested account has tokens', () => {
      token._mint(Z_OWNER, AMOUNT);
      expect(token.balanceOf(Z_OWNER)).toEqual(AMOUNT);
    });
  });

  describe('transfer', () => {
    beforeEach(() => {
      token._mint(Z_OWNER, AMOUNT);

      expect(token.balanceOf(Z_OWNER)).toEqual(AMOUNT);
      expect(token.balanceOf(Z_RECIPIENT)).toEqual(0n);
    });

    afterEach(() => {
      expect(token.totalSupply()).toEqual(AMOUNT);
    });

    it('should transfer partial', () => {
      const partialAmt = AMOUNT - 1n;
      caller = OWNER;
      const txSuccess = token.transfer(Z_RECIPIENT, partialAmt, caller);

      expect(txSuccess).toBe(true);
      expect(token.balanceOf(Z_OWNER)).toEqual(1n);
      expect(token.balanceOf(Z_RECIPIENT)).toEqual(partialAmt);
    });

    it('should transfer full', () => {
      caller = OWNER;
      const txSuccess = token.transfer(Z_RECIPIENT, AMOUNT, caller);

      expect(txSuccess).toBe(true);
      expect(token.balanceOf(Z_OWNER)).toEqual(0n);
      expect(token.balanceOf(Z_RECIPIENT)).toEqual(AMOUNT);
    });

    it('should fail with insufficient balance', () => {
      caller = OWNER;

      expect(() => {
        token.transfer(Z_RECIPIENT, AMOUNT + 1n, caller);
      }).toThrow('ERC20: insufficient balance');
    });

    it('should fail with transfer from zero', () => {
      caller = ZERO;

      expect(() => {
        token.transfer(Z_RECIPIENT, AMOUNT, caller);
      }).toThrow('ERC20: invalid sender');
    });

    it('should fail with transfer to zero', () => {
      caller = OWNER;

      expect(() => {
        token.transfer(utils.ZERO_ADDRESS, AMOUNT, caller);
      }).toThrow('ERC20: invalid receiver');
    });

    it('should allow transfer of 0 tokens', () => {
      const txSuccess = token.transfer(Z_RECIPIENT, 0n, caller);

      expect(txSuccess).toBe(true);
      expect(token.balanceOf(Z_OWNER)).toEqual(AMOUNT);
      expect(token.balanceOf(Z_RECIPIENT)).toEqual(0n);
    });

    it('should handle transfer with empty _balances', () => {
      caller = SPENDER;

      expect(() => {
        token.transfer(Z_RECIPIENT, 1n, caller);
      }).toThrow('ERC20: insufficient balance');
    });
  });

  describe('approve', () => {
    beforeEach(() => {
      expect(token.allowance(Z_OWNER, Z_SPENDER)).toEqual(0n);
    });

    it('should approve and update allowance', () => {
      caller = OWNER;

      token.approve(Z_SPENDER, AMOUNT, caller);
      expect(token.allowance(Z_OWNER, Z_SPENDER)).toEqual(AMOUNT);
    });

    it('should approve and update allowance for multiple spenders', () => {
      caller = OWNER;

      token.approve(Z_SPENDER, AMOUNT, caller);
      expect(token.allowance(Z_OWNER, Z_SPENDER)).toEqual(AMOUNT);

      token.approve(Z_OTHER, AMOUNT, caller);
      expect(token.allowance(Z_OWNER, Z_OTHER)).toEqual(AMOUNT);

      expect(token.allowance(Z_OWNER, Z_RECIPIENT)).toEqual(0n);
    });

    it('should fail when approve from zero', () => {
      caller = ZERO;

      expect(() => {
        token.approve(Z_SPENDER, AMOUNT, caller);
      }).toThrow('ERC20: invalid owner');
    });

    it('should fail when approve to zero', () => {
      caller = OWNER;

      expect(() => {
        token.approve(utils.ZERO_ADDRESS, AMOUNT, caller);
      }).toThrow('ERC20: invalid spender');
    });

    it('should transfer exact allowance and fail subsequent transfer', () => {
      token._mint(Z_OWNER, AMOUNT);
      caller = OWNER;
      token.approve(Z_SPENDER, AMOUNT, caller);

      caller = SPENDER;
      token.transferFrom(Z_OWNER, Z_RECIPIENT, AMOUNT, caller);
      expect(token.allowance(Z_OWNER, Z_SPENDER)).toEqual(0n);

      expect(() => {
        token.transferFrom(Z_OWNER, Z_RECIPIENT, 1n, caller);
      }).toThrow('ERC20: insufficient allowance');
    });

    it('should allow approve of 0 tokens', () => {
      caller = OWNER;
      token.approve(Z_SPENDER, 0n, caller);
      expect(token.allowance(Z_OWNER, Z_SPENDER)).toEqual(0n);
    });

    it('should handle allowance with empty _allowances', () => {
      expect(token.allowance(Z_OWNER, Z_SPENDER)).toEqual(0n);
    });
  });

  describe('transferFrom', () => {
    beforeEach(() => {
      caller = OWNER;

      token.approve(Z_SPENDER, AMOUNT, caller);
      token._mint(Z_OWNER, AMOUNT);
    });

    afterEach(() => {
      expect(token.totalSupply()).toEqual(AMOUNT);
    });

    it('should transferFrom spender (partial)', () => {
      caller = SPENDER;
      const partialAmt = AMOUNT - 1n;

      const txSuccess = token.transferFrom(Z_OWNER, Z_RECIPIENT, partialAmt, caller);
      expect(txSuccess).toBe(true);

      // Check balances
      expect(token.balanceOf(Z_OWNER)).toEqual(1n);
      expect(token.balanceOf(Z_RECIPIENT)).toEqual(partialAmt);
      // Check leftover allowance
      expect(token.allowance(Z_OWNER, Z_SPENDER)).toEqual(1n);
    });

    it('should transferFrom spender (full)', () => {
      caller = SPENDER;

      const txSuccess = token.transferFrom(Z_OWNER, Z_RECIPIENT, AMOUNT, caller);
      expect(txSuccess).toBe(true);

      // Check balances
      expect(token.balanceOf(Z_OWNER)).toEqual(0n);
      expect(token.balanceOf(Z_RECIPIENT)).toEqual(AMOUNT);
      // Check no allowance
      expect(token.allowance(Z_OWNER, Z_SPENDER)).toEqual(0n);
    });

    it('should transferFrom and not consume infinite allowance', () => {
      caller = OWNER;
      token.approve(Z_SPENDER, MAX_UINT128, caller);

      caller = SPENDER;
      const txSuccess = token.transferFrom(Z_OWNER, Z_RECIPIENT, AMOUNT, caller);
      expect(txSuccess).toBe(true);

      // Check balances
      expect(token.balanceOf(Z_OWNER)).toEqual(0n);
      expect(token.balanceOf(Z_RECIPIENT)).toEqual(AMOUNT);
      // Check infinite allowance
      expect(token.allowance(Z_OWNER, Z_SPENDER)).toEqual(MAX_UINT128);
    });

    it ('should fail when transfer amount exceeds allowance', () => {
      caller = SPENDER;

      expect(() => {
        token.transferFrom(Z_OWNER, Z_RECIPIENT, AMOUNT + 1n);
      }).toThrow('ERC20: insufficient allowance');
    });

    it ('should fail when transfer amount exceeds balance', () => {
      caller = OWNER;
      // Increase allowance > balance
      token.approve(Z_SPENDER, AMOUNT + 1n, caller);

      caller = SPENDER;
      expect(() => {
        token.transferFrom(Z_OWNER, Z_RECIPIENT, AMOUNT + 1n, caller);
      }).toThrow('ERC20: insufficient balance');
    });

    it('should fail when spender does not have allowance', () => {
      caller = UNAUTHORIZED;

      expect(() => {
        token.transferFrom(Z_OWNER, Z_RECIPIENT, AMOUNT, caller);
      }).toThrow("ERC20: insufficient allowance");
    });

    it('should fail to transferFrom zero address', () => {
      caller = ZERO;

      expect(() => {
        token.transferFrom(Z_OWNER, Z_RECIPIENT, AMOUNT, caller);
      }).toThrow("ERC20: insufficient allowance");
    });

    it('should fail to transferFrom to the zero address', () => {
      caller = SPENDER;

      expect(() => {
        token.transferFrom(Z_OWNER, utils.ZERO_ADDRESS, AMOUNT, caller);
      }).toThrow("ERC20: invalid receiver");
    });
  });

  describe('_transfer', () => {
    beforeEach(() => {
      token._mint(Z_OWNER, AMOUNT);
    });

    afterEach(() => {
      expect(token.totalSupply()).toEqual(AMOUNT);
    });

    it('should update balances (partial)', () => {
      const partialAmt = AMOUNT - 1n;
      token._transfer(Z_OWNER, Z_RECIPIENT, partialAmt);

      expect(token.balanceOf(Z_OWNER)).toEqual(1n);
      expect(token.balanceOf(Z_RECIPIENT)).toEqual(partialAmt);
    });
  })

  describe('_mint', () => {
    it('should mint and update supply', () => {
      expect(token.totalSupply()).toEqual(0n);

      token._mint(Z_RECIPIENT, AMOUNT);
      expect(token.totalSupply()).toEqual(AMOUNT);
      expect(token.balanceOf(Z_RECIPIENT)).toEqual(AMOUNT);
    });

    it('should catch mint overflow', () => {
      token._mint(Z_RECIPIENT, MAX_UINT128);

      expect(() => {
        token._mint(Z_RECIPIENT, 1n);
      }).toThrow('ERC20: arithmetic overflow');
    });

    it('should not mint to zero pubkey', () => {
      expect(() => {
        token._mint(utils.ZERO_KEY, AMOUNT);
      }).toThrow('ERC20: invalid receiver');
    });

    it('should not mint to zero contract address', () => {
      expect(() => {
        token._mint(utils.ZERO_ADDRESS, AMOUNT);
      }).toThrow('ERC20: invalid receiver');
    });

    it('should allow mint of 0 tokens', () => {
      token._mint(Z_OWNER, 0n);
      expect(token.totalSupply()).toEqual(0n);
      expect(token.balanceOf(Z_OWNER)).toEqual(0n);
    });
  });

  describe('_burn', () => {
    beforeEach(() => {
      token._mint(Z_OWNER, AMOUNT);
    });

    it('should burn tokens', () => {
      token._burn(Z_OWNER, 1n);

      const afterBurn = AMOUNT - 1n;
      expect(token.balanceOf(Z_OWNER)).toEqual(afterBurn);
      expect(token.totalSupply()).toEqual(afterBurn);
    });

    it('should throw when burning from zero', () => {
      expect(() => {
        token._burn(utils.ZERO_KEY, AMOUNT);
      }).toThrow('ERC20: invalid sender');
    });

    it('should throw when burn amount is greater than balance', () => {
      expect(() => {
        token._burn(Z_OWNER, AMOUNT + 1n);
      }).toThrow('ERC20: insufficient balance');
    });

    it('should allow burn of 0 tokens', () => {
      token._burn(Z_OWNER, 0n);
      expect(token.totalSupply()).toEqual(AMOUNT);
      expect(token.balanceOf(Z_OWNER)).toEqual(AMOUNT);
    });
  });

  describe('_update', () => {
    it('should update from zero to non-zero (mint)', () => {
      expect(token.totalSupply()).toEqual(0n);
      expect(token.balanceOf(Z_OWNER)).toEqual(0n);

      token._update(utils.ZERO_KEY, Z_OWNER, AMOUNT);

      expect(token.totalSupply()).toEqual(AMOUNT);
      expect(token.balanceOf(Z_OWNER)).toEqual(AMOUNT);
    });

    it('should catch overflow from zero to non-zero (mint)', () => {
      token._update(utils.ZERO_KEY, Z_OWNER, MAX_UINT128);

      expect(() => {
        token._update(utils.ZERO_KEY, Z_OWNER, 1n);
      }).toThrow('ERC20: arithmetic overflow');
    });

    describe('with minted tokens', () => {
      beforeEach(() => {
        token._update(utils.ZERO_ADDRESS, Z_OWNER, AMOUNT);

        expect(token.totalSupply()).toEqual(AMOUNT);
        expect(token.balanceOf(Z_OWNER)).toEqual(AMOUNT);
      });

      it('should update from non-zero to zero (burn)', () => {
        token._update(Z_OWNER, utils.ZERO_ADDRESS, AMOUNT);

        expect(token.totalSupply()).toEqual(0n);
        expect(token.balanceOf(Z_OWNER)).toEqual(0n);
      });

      it('should catch overflow from non-zero to zero (burn)', () => {
        token._update(Z_OWNER, utils.ZERO_ADDRESS, AMOUNT);

        expect(() => {
          token._update(Z_OWNER, utils.ZERO_ADDRESS, 1n);
        }).toThrow('ERC20: insufficient balance');
      });

      it('should update from non-zero to non-zero (transfer)', () => {
        token._update(Z_OWNER, Z_RECIPIENT, AMOUNT - 1n);

        expect(token.totalSupply()).toEqual(AMOUNT);
        expect(token.balanceOf(Z_OWNER)).toEqual(1n);
        expect(token.balanceOf(Z_RECIPIENT)).toEqual(AMOUNT - 1n);
      });
    });
  });

  describe('Multiple Operations', () => {
    it('should handle mint → transfer → burn sequence', () => {
      token._mint(Z_OWNER, AMOUNT);
      expect(token.totalSupply()).toEqual(AMOUNT);
      expect(token.balanceOf(Z_OWNER)).toEqual(AMOUNT);

      caller = OWNER;
      token.transfer(Z_RECIPIENT, AMOUNT - 1n, caller);
      expect(token.balanceOf(Z_OWNER)).toEqual(1n);
      expect(token.balanceOf(Z_RECIPIENT)).toEqual(AMOUNT - 1n);

      token._burn(Z_OWNER, 1n);
      expect(token.totalSupply()).toEqual(AMOUNT - 1n);
      expect(token.balanceOf(Z_OWNER)).toEqual(0n);
    });
  });
});
