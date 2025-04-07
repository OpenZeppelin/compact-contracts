import { it, describe, expect } from '@jest/globals';
import { ERC20Mock } from './erc721-setup.js';
import { NetworkId, setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { MaybeString } from './types.js';
import * as utils from './utils.js';

//
// Test vals
//

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
const MAX_UINT64 = BigInt(2 ** 64) - BigInt(1);
const MAX_UINT256 = BigInt(2 ** 256) - BigInt(1);

const OWNER = utils.createEitherTestUser('OWNER');
const RECIPIENT = utils.createEitherTestUser('RECIPIENT');
const SPENDER = utils.createEitherTestUser('SPENDER');
const SOME_CONTRACT = utils.createEitherTestContractAddress('SOME_CONTRACT');

//
// Test
//

setNetworkId(NetworkId.Undeployed);
let token: any;

describe('ERC20', () => {
  beforeEach(() => {
    token = new ERC20Mock(NAME, SYMBOL, DECIMALS);
  });

  describe('initialize', () => {
    it('initializes the correct state', () => {
      const state = token.getLedger();

      expect(state.totalSupply).toEqual(0n);
      expect(state.name).toEqual(NAME);
      expect(state.symbol).toEqual(SYMBOL);
      expect(state.decimals).toEqual(DECIMALS);
    });

    it('initializes no metadata state', () => {
      const noDecimals: bigint = 0n;

      const token = new ERC20Mock(NO_STRING, NO_STRING, noDecimals);
      const state = token.getLedger();

      expect(state.totalSupply).toEqual(0n);
      expect(state.name).toEqual(NO_STRING);
      expect(state.symbol).toEqual(NO_STRING);
      expect(state.decimals).toEqual(0n);
    });
  });

  describe('approve', () => {
    // TODO: change caller context to test IERC20 interface
    it.skip('should approve', () => {
      const initAllowance = token.allowance(OWNER, SPENDER);
      expect(initAllowance).toEqual(0n);

      token._mint(OWNER, AMOUNT);
      token.approve(SPENDER, AMOUNT);
    });
  })

  describe('_approve', () => {
    it('should _approve', () => {
      const initAllowance = token.allowance(OWNER, SPENDER);
      expect(initAllowance).toEqual(0n);

      token._approve(OWNER, SPENDER, AMOUNT);

      expect(token.allowance(OWNER, SPENDER)).toEqual(initAllowance + AMOUNT);
    });

    it('should approve to a new spender address', () => {
      token._approve(OWNER, SPENDER, AMOUNT);
      expect(token.allowance(OWNER, SPENDER)).toEqual(AMOUNT);

      const NEW_SPENDER = utils.createEitherTestUser('NEW_SPENDER');
      const newAmount = AMOUNT + 200n;
      expect(token.allowance(OWNER, NEW_SPENDER)).toEqual(0n);
      token._approve(OWNER, NEW_SPENDER, newAmount);

      expect(token.allowance(OWNER, NEW_SPENDER)).toEqual(newAmount);
      expect(token.allowance(OWNER, SPENDER)).toEqual(AMOUNT);
    });

    it('should throw when owner is zero', () => {
      expect(() => {
        token._approve(utils.ZERO_KEY, SPENDER, AMOUNT);
      }).toThrow('ERC20: invalid owner');
    });

    it('should throw when spender is zero', () => {
      expect(() => {
        token._approve(OWNER, utils.ZERO_KEY, AMOUNT);
      }).toThrow('ERC20: invalid spender');
    });
  });

  describe('_spendAllowance', () => {
    describe('spend allowance when not infinite', () => {
      beforeEach(() => {
        token._approve(OWNER, SPENDER, AMOUNT);
        expect(token.allowance(OWNER, SPENDER)).toEqual(AMOUNT);
      })

      it('spends allowance', () => {
        token._spendAllowance(OWNER, SPENDER, AMOUNT);
        expect(token.allowance(OWNER, SPENDER)).toEqual(0n);
      });

      it('spends partial allowance', () => {
        const partialAllowance = AMOUNT - 1n;
        token._spendAllowance(OWNER, SPENDER, partialAllowance);
        expect(token.allowance(OWNER, SPENDER)).toEqual(1n);
      });

      it('throws when not enough allowance', () => {
        expect(() => {
          token._spendAllowance(OWNER, SPENDER, AMOUNT + 1n);
        }).toThrow('ERC20: insufficient allowance');
      });
    });

    describe('infinite allowance', () => {
      beforeEach(() => {
        token._approve(OWNER, SPENDER, MAX_UINT256);
        expect(token.allowance(OWNER, SPENDER)).toEqual(MAX_UINT256);
      });

      it('should not subtract from infinite allowance', () => {
        token._spendAllowance(OWNER, SPENDER, MAX_UINT256 - 1n);

        expect(token.allowance(OWNER, SPENDER)).toEqual(MAX_UINT256);
      });
    });
  });

  describe('transferFrom', () => {
    beforeEach(() => {
      token._mint(OWNER, AMOUNT);
    });

    it.skip('should transfer from owner to recipient', () => {
      const ownerBal = token.balanceOf(OWNER);
      const recipientBal = token.balanceOf(RECIPIENT);

      token.transferFrom(OWNER, RECIPIENT, AMOUNT);
    })
  })

  describe('transfer', () => {
    beforeEach(() => {
      token._mint(OWNER, AMOUNT);
    });

    describe('internal _transfer', () => {
      it('should _transfer', () => {
        const ownerBal = token.balanceOf(OWNER);
        const recipientBal = token.balanceOf(RECIPIENT);

        token._transfer(OWNER, RECIPIENT, AMOUNT);

        expect(token.balanceOf(OWNER)).toEqual(ownerBal - AMOUNT);
        expect(token.balanceOf(RECIPIENT)).toEqual(recipientBal + AMOUNT);

        // Confirm totalSupply doesn't change
        expect(token.getLedger().totalSupply).toEqual(AMOUNT);
      });

      it('throws when _transfer with not enough balance', () => {
        expect(() => {
          token._transfer(OWNER, RECIPIENT, AMOUNT + 1n);
        }).toThrow('ERC20: insufficient balance');
      });
    });
  });

  describe('mint', () => {
    it('should mint and update supply', () => {
      const initSupply = token.getLedger().totalSupply;
      expect(initSupply).toEqual(0n);

      token._mint(RECIPIENT, AMOUNT);
      expect(token.getLedger().totalSupply).toEqual(AMOUNT);
      expect(token.balanceOf(RECIPIENT)).toEqual(AMOUNT);
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
  });

  describe('burn', () => {
    beforeEach(() => {
      token._mint(OWNER, AMOUNT);
    });

    it('should burn tokens', () => {
      token._burn(OWNER, 1n);

      const afterBurn = AMOUNT - 1n;
      expect(token.balanceOf(OWNER)).toEqual(afterBurn);
      expect(token.getLedger().totalSupply).toEqual(afterBurn)
    });

    it('should throw when burning from zero', () => {
      expect(() => {
        token._burn(utils.ZERO_KEY, AMOUNT);
      }).toThrow('ERC20: invalid sender');
    });

    it('should throw when burn amount is greater than balance', () => {
      expect(() => {
        token._burn(OWNER, AMOUNT + 1n);
      }).toThrow('ERC20: insufficient balance');
    });
  });

  describe('_update', () => {
    it('should update from zero to non-zero (mint)', () => {
      expect(token.getLedger().totalSupply).toEqual(0n);
      expect(token.balanceOf(OWNER)).toEqual(0n);

      token._update(utils.ZERO_KEY, OWNER, AMOUNT);

      expect(token.getLedger().totalSupply).toEqual(AMOUNT);
      expect(token.balanceOf(OWNER)).toEqual(AMOUNT);
    });

    describe('with minted tokens', () => {
      beforeEach(() => {
        token._update(utils.ZERO_ADDRESS, OWNER, AMOUNT);

        expect(token.getLedger().totalSupply).toEqual(AMOUNT);
        expect(token.balanceOf(OWNER)).toEqual(AMOUNT);
      });

      it('should update from non-zero to zero (burn)', () => {
        token._update(OWNER, utils.ZERO_ADDRESS, AMOUNT);

        expect(token.getLedger().totalSupply).toEqual(0n);
        expect(token.balanceOf(OWNER)).toEqual(0n);
      });

      it('should update from non-zero to non-zero (transfer)', () => {
        token._update(OWNER, RECIPIENT, AMOUNT - 1n);

        expect(token.getLedger().totalSupply).toEqual(AMOUNT);
        expect(token.balanceOf(OWNER)).toEqual(1n);
        expect(token.balanceOf(RECIPIENT)).toEqual(AMOUNT - 1n);
      });
    });
  });
});
