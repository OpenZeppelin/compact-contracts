import {
  CompactTypeBytes,
  CompactTypeVector,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import { FungibleTokenSimulator } from './simulators/FungibleTokenSimulator.js';

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
const OWNER_CONTRACT = eitherContract('OWNER_CONTRACT');
const RECIPIENT_CONTRACT = eitherContract('RECIPIENT_CONTRACT');

// Zero values
const ZERO_ACCOUNT = eitherAccountId(zeroBytes);
const ZERO_CONTRACT = {
  is_left: false,
  left: zeroBytes,
  right: { bytes: zeroBytes },
};

// Metadata
const EMPTY_STRING = '';
const NAME = 'NAME';
const SYMBOL = 'SYMBOL';
const DECIMALS = 18n;
const NO_DECIMALS = 0n;
const INIT = true;
const BAD_INIT = false;

// Amounts
const AMOUNT = 250n;
const MAX_UINT128 = (1n << 128n) - 1n;

let token: FungibleTokenSimulator;

const ownerTypes = [
  ['contract', OWNER_CONTRACT],
  ['accountId', OWNER.either],
] as const;

const recipientTypes = [
  ['contract', RECIPIENT_CONTRACT],
  ['accountId', RECIPIENT.either],
] as const;

describe('FungibleToken', () => {
  describe('before initialization', () => {
    it('should initialize metadata', () => {
      token = new FungibleTokenSimulator(NAME, SYMBOL, DECIMALS, INIT);
      expect(token.name()).toEqual(NAME);
      expect(token.symbol()).toEqual(SYMBOL);
      expect(token.decimals()).toEqual(DECIMALS);
    });

    it('should initialize empty metadata', () => {
      token = new FungibleTokenSimulator(
        EMPTY_STRING,
        EMPTY_STRING,
        NO_DECIMALS,
        INIT,
      );
      expect(token.name()).toEqual(EMPTY_STRING);
      expect(token.symbol()).toEqual(EMPTY_STRING);
      expect(token.decimals()).toEqual(NO_DECIMALS);
    });
  });

  describe('when not initialized correctly', () => {
    beforeEach(() => {
      token = new FungibleTokenSimulator(
        EMPTY_STRING,
        EMPTY_STRING,
        NO_DECIMALS,
        BAD_INIT,
      );
    });

    type FailingCircuits = [
      method: keyof FungibleTokenSimulator,
      args: unknown[],
    ];
    const circuitsToFail: FailingCircuits[] = [
      ['name', []],
      ['symbol', []],
      ['decimals', []],
      ['totalSupply', []],
      ['balanceOf', [OWNER.either]],
      ['allowance', [OWNER.either, SPENDER.either]],
      ['transfer', [RECIPIENT.either, AMOUNT]],
      ['_unsafeTransfer', [RECIPIENT.either, AMOUNT]],
      ['transferFrom', [OWNER.either, RECIPIENT.either, AMOUNT]],
      ['_unsafeTransferFrom', [OWNER.either, RECIPIENT.either, AMOUNT]],
      ['approve', [OWNER.either, AMOUNT]],
      ['_approve', [OWNER.either, SPENDER.either, AMOUNT]],
      ['_spendAllowance', [OWNER.either, SPENDER.either, AMOUNT]],
      ['_transfer', [OWNER.either, RECIPIENT.either, AMOUNT]],
      ['_unsafeUncheckedTransfer', [OWNER.either, RECIPIENT.either, AMOUNT]],
      ['_mint', [OWNER.either, AMOUNT]],
      ['_unsafeMint', [OWNER.either, AMOUNT]],
      ['_burn', [OWNER.either, AMOUNT]],
    ];

    it.each(circuitsToFail)('%s should fail', (circuitName, args) => {
      expect(() => {
        (token[circuitName] as (...args: unknown[]) => unknown)(...args);
      }).toThrow('FungibleToken: contract not initialized');
    });
  });

  describe('when initialized correctly', () => {
    beforeEach(() => {
      token = new FungibleTokenSimulator(NAME, SYMBOL, DECIMALS, INIT);
    });

    describe('totalSupply', () => {
      it('returns 0 when there is no supply', () => {
        expect(token.totalSupply()).toEqual(0n);
      });

      it('returns the amount of existing tokens when there is a supply', () => {
        token._mint(OWNER.either, AMOUNT);
        expect(token.totalSupply()).toEqual(AMOUNT);
      });
    });

    describe('balanceOf', () => {
      describe.each(ownerTypes)('when the owner is a %s', (_, owner) => {
        it('should return zero when requested account has no balance', () => {
          expect(token.balanceOf(owner)).toEqual(0n);
        });

        it('should return balance when requested account has tokens', () => {
          token._unsafeMint(owner, AMOUNT);
          expect(token.balanceOf(owner)).toEqual(AMOUNT);
        });
      });

      it('should return correct balance with non-canonical lookup (left)', () => {
        token._mint(OWNER.either, AMOUNT);

        const nonCanonical = {
          is_left: true,
          left: OWNER.accountId,
          right: utils.encodeToAddress('JUNK_DATA'),
        };

        expect(token.balanceOf(nonCanonical)).toEqual(AMOUNT);
      });

      it('should return correct balance with non-canonical lookup (right)', () => {
        token._unsafeMint(OWNER_CONTRACT, AMOUNT);

        const nonCanonical = {
          is_left: false,
          left: new Uint8Array(32).fill(1),
          right: OWNER_CONTRACT.right,
        };

        expect(token.balanceOf(nonCanonical)).toEqual(AMOUNT);
      });
    });

    describe('allowance', () => {
      it('should return correct allowance with non-canonical owner lookup (left)', () => {
        token._approve(OWNER.either, SPENDER.either, AMOUNT);

        const nonCanonicalOwner = {
          is_left: true,
          left: OWNER.accountId,
          right: utils.encodeToAddress('JUNK_DATA'),
        };

        expect(token.allowance(nonCanonicalOwner, SPENDER.either)).toEqual(
          AMOUNT,
        );
      });

      it('should return correct allowance with non-canonical spender lookup (left)', () => {
        token._approve(OWNER.either, SPENDER.either, AMOUNT);

        const nonCanonicalSpender = {
          is_left: true,
          left: SPENDER.accountId,
          right: utils.encodeToAddress('JUNK_DATA'),
        };

        expect(token.allowance(OWNER.either, nonCanonicalSpender)).toEqual(
          AMOUNT,
        );
      });

      it('should return correct allowance with non-canonical owner lookup (right)', () => {
        token._approve(OWNER_CONTRACT, SPENDER.either, AMOUNT);

        const nonCanonicalOwner = {
          is_left: false,
          left: new Uint8Array(32).fill(1),
          right: OWNER_CONTRACT.right,
        };

        expect(token.allowance(nonCanonicalOwner, SPENDER.either)).toEqual(
          AMOUNT,
        );
      });

      it('should return correct allowance with non-canonical spender lookup (right)', () => {
        token._approve(OWNER.either, RECIPIENT_CONTRACT, AMOUNT);

        const nonCanonicalSpender = {
          is_left: false,
          left: new Uint8Array(32).fill(1),
          right: RECIPIENT_CONTRACT.right,
        };

        expect(token.allowance(OWNER.either, nonCanonicalSpender)).toEqual(
          AMOUNT,
        );
      });
    });

    describe('transfer', () => {
      beforeEach(() => {
        token._mint(OWNER.either, AMOUNT);
        expect(token.balanceOf(OWNER.either)).toEqual(AMOUNT);
        expect(token.balanceOf(RECIPIENT.either)).toEqual(0n);
      });

      afterEach(() => {
        expect(token.totalSupply()).toEqual(AMOUNT);
      });

      it('should transfer partial', () => {
        token.privateState.injectSecretKey(OWNER.secretKey);

        const partialAmt = AMOUNT - 1n;
        const txSuccess = token.transfer(RECIPIENT.either, partialAmt);

        expect(txSuccess).toBe(true);
        expect(token.balanceOf(OWNER.either)).toEqual(1n);
        expect(token.balanceOf(RECIPIENT.either)).toEqual(partialAmt);
      });

      it('should transfer full', () => {
        token.privateState.injectSecretKey(OWNER.secretKey);

        const txSuccess = token.transfer(RECIPIENT.either, AMOUNT);

        expect(txSuccess).toBe(true);
        expect(token.balanceOf(OWNER.either)).toEqual(0n);
        expect(token.balanceOf(RECIPIENT.either)).toEqual(AMOUNT);
      });

      it('should fail with insufficient balance', () => {
        token.privateState.injectSecretKey(OWNER.secretKey);

        expect(() => {
          token.transfer(RECIPIENT.either, AMOUNT + 1n);
        }).toThrow('FungibleToken: insufficient balance');
      });

      it('should fail with transfer from zero identity', () => {
        // Inject a key that produces zero accountId — infeasible in practice,
        // but we can test the zero check by using _unsafeUncheckedTransfer directly
        expect(() => {
          token._unsafeUncheckedTransfer(
            ZERO_ACCOUNT,
            RECIPIENT.either,
            AMOUNT,
          );
        }).toThrow('FungibleToken: invalid sender');
      });

      it('should fail with transfer to zero', () => {
        token.privateState.injectSecretKey(OWNER.secretKey);

        expect(() => {
          token.transfer(ZERO_ACCOUNT, AMOUNT);
        }).toThrow('FungibleToken: invalid receiver');
      });

      it('should allow transfer of 0 tokens', () => {
        token.privateState.injectSecretKey(OWNER.secretKey);

        const txSuccess = token.transfer(RECIPIENT.either, 0n);

        expect(txSuccess).toBe(true);
        expect(token.balanceOf(OWNER.either)).toEqual(AMOUNT);
        expect(token.balanceOf(RECIPIENT.either)).toEqual(0n);
      });

      it('should handle transfer with empty _balances', () => {
        token.privateState.injectSecretKey(SPENDER.secretKey);

        expect(() => {
          token.transfer(RECIPIENT.either, 1n);
        }).toThrow('FungibleToken: insufficient balance');
      });

      it('should fail when transferring to a contract', () => {
        token.privateState.injectSecretKey(OWNER.secretKey);

        expect(() => {
          token.transfer(OWNER_CONTRACT, AMOUNT);
        }).toThrow('FungibleToken: unsafe transfer');
      });
    });

    describe('_unsafeTransfer', () => {
      describe.each(
        recipientTypes,
      )('when the recipient is a %s', (_, recipient) => {
        beforeEach(() => {
          token._mint(OWNER.either, AMOUNT);
          expect(token.balanceOf(OWNER.either)).toEqual(AMOUNT);
          expect(token.balanceOf(recipient)).toEqual(0n);
        });

        afterEach(() => {
          expect(token.totalSupply()).toEqual(AMOUNT);
        });

        it('should transfer partial', () => {
          token.privateState.injectSecretKey(OWNER.secretKey);

          const partialAmt = AMOUNT - 1n;
          const txSuccess = token._unsafeTransfer(recipient, partialAmt);

          expect(txSuccess).toBe(true);
          expect(token.balanceOf(OWNER.either)).toEqual(1n);
          expect(token.balanceOf(recipient)).toEqual(partialAmt);
        });

        it('should transfer full', () => {
          token.privateState.injectSecretKey(OWNER.secretKey);

          const txSuccess = token._unsafeTransfer(recipient, AMOUNT);

          expect(txSuccess).toBe(true);
          expect(token.balanceOf(OWNER.either)).toEqual(0n);
          expect(token.balanceOf(recipient)).toEqual(AMOUNT);
        });

        it('should fail with insufficient balance', () => {
          token.privateState.injectSecretKey(OWNER.secretKey);

          expect(() => {
            token._unsafeTransfer(recipient, AMOUNT + 1n);
          }).toThrow('FungibleToken: insufficient balance');
        });

        it('should allow transfer of 0 tokens', () => {
          token.privateState.injectSecretKey(OWNER.secretKey);

          const txSuccess = token._unsafeTransfer(recipient, 0n);

          expect(txSuccess).toBe(true);
          expect(token.balanceOf(OWNER.either)).toEqual(AMOUNT);
          expect(token.balanceOf(recipient)).toEqual(0n);
        });

        it('should handle transfer with empty _balances', () => {
          token.privateState.injectSecretKey(SPENDER.secretKey);

          expect(() => {
            token._unsafeTransfer(recipient, 1n);
          }).toThrow('FungibleToken: insufficient balance');
        });
      });

      it('should fail with transfer to zero (accountId)', () => {
        token._mint(OWNER.either, AMOUNT);
        token.privateState.injectSecretKey(OWNER.secretKey);

        expect(() => {
          token._unsafeTransfer(ZERO_ACCOUNT, AMOUNT);
        }).toThrow('FungibleToken: invalid receiver');
      });

      it('should fail with transfer to zero (contract)', () => {
        token._mint(OWNER.either, AMOUNT);
        token.privateState.injectSecretKey(OWNER.secretKey);

        expect(() => {
          token._unsafeTransfer(ZERO_CONTRACT, AMOUNT);
        }).toThrow('FungibleToken: invalid receiver');
      });
    });

    describe('approve', () => {
      beforeEach(() => {
        expect(token.allowance(OWNER.either, SPENDER.either)).toEqual(0n);
      });

      it('should approve and update allowance', () => {
        token.privateState.injectSecretKey(OWNER.secretKey);

        token.approve(SPENDER.either, AMOUNT);
        expect(token.allowance(OWNER.either, SPENDER.either)).toEqual(AMOUNT);
      });

      it('should approve and update allowance for multiple spenders', () => {
        token.privateState.injectSecretKey(OWNER.secretKey);

        token.approve(SPENDER.either, AMOUNT);
        expect(token.allowance(OWNER.either, SPENDER.either)).toEqual(AMOUNT);

        token.approve(OTHER.either, AMOUNT);
        expect(token.allowance(OWNER.either, OTHER.either)).toEqual(AMOUNT);

        expect(token.allowance(OWNER.either, RECIPIENT.either)).toEqual(0n);
      });

      it('should fail when approve to zero', () => {
        token.privateState.injectSecretKey(OWNER.secretKey);

        expect(() => {
          token.approve(ZERO_ACCOUNT, AMOUNT);
        }).toThrow('FungibleToken: invalid spender');
      });

      it('should transfer exact allowance and fail subsequent transfer', () => {
        token._mint(OWNER.either, AMOUNT);

        token.privateState.injectSecretKey(OWNER.secretKey);
        token.approve(SPENDER.either, AMOUNT);

        token.privateState.injectSecretKey(SPENDER.secretKey);
        token.transferFrom(OWNER.either, RECIPIENT.either, AMOUNT);
        expect(token.allowance(OWNER.either, SPENDER.either)).toEqual(0n);

        expect(() => {
          token.transferFrom(OWNER.either, RECIPIENT.either, 1n);
        }).toThrow('FungibleToken: insufficient allowance');
      });

      it('should allow approve of 0 tokens', () => {
        token.privateState.injectSecretKey(OWNER.secretKey);

        token.approve(SPENDER.either, 0n);
        expect(token.allowance(OWNER.either, SPENDER.either)).toEqual(0n);
      });

      it('should handle allowance with empty _allowances', () => {
        expect(token.allowance(OWNER.either, SPENDER.either)).toEqual(0n);
      });
    });

    describe('transferFrom', () => {
      beforeEach(() => {
        token.privateState.injectSecretKey(OWNER.secretKey);
        token.approve(SPENDER.either, AMOUNT);
        token._mint(OWNER.either, AMOUNT);
      });

      afterEach(() => {
        expect(token.totalSupply()).toEqual(AMOUNT);
      });

      it('should transferFrom spender (partial)', () => {
        token.privateState.injectSecretKey(SPENDER.secretKey);

        const partialAmt = AMOUNT - 1n;
        const txSuccess = token.transferFrom(
          OWNER.either,
          RECIPIENT.either,
          partialAmt,
        );
        expect(txSuccess).toBe(true);

        expect(token.balanceOf(OWNER.either)).toEqual(1n);
        expect(token.balanceOf(RECIPIENT.either)).toEqual(partialAmt);
        expect(token.allowance(OWNER.either, SPENDER.either)).toEqual(1n);
      });

      it('should transferFrom spender (full)', () => {
        token.privateState.injectSecretKey(SPENDER.secretKey);

        const txSuccess = token.transferFrom(
          OWNER.either,
          RECIPIENT.either,
          AMOUNT,
        );
        expect(txSuccess).toBe(true);

        expect(token.balanceOf(OWNER.either)).toEqual(0n);
        expect(token.balanceOf(RECIPIENT.either)).toEqual(AMOUNT);
        expect(token.allowance(OWNER.either, SPENDER.either)).toEqual(0n);
      });

      it('should transferFrom and not consume infinite allowance', () => {
        token.privateState.injectSecretKey(OWNER.secretKey);
        token.approve(SPENDER.either, MAX_UINT128);

        token.privateState.injectSecretKey(SPENDER.secretKey);
        const txSuccess = token.transferFrom(
          OWNER.either,
          RECIPIENT.either,
          AMOUNT,
        );
        expect(txSuccess).toBe(true);

        expect(token.balanceOf(OWNER.either)).toEqual(0n);
        expect(token.balanceOf(RECIPIENT.either)).toEqual(AMOUNT);
        expect(token.allowance(OWNER.either, SPENDER.either)).toEqual(
          MAX_UINT128,
        );
      });

      it('should fail when transfer amount exceeds allowance', () => {
        token.privateState.injectSecretKey(SPENDER.secretKey);

        expect(() => {
          token.transferFrom(OWNER.either, RECIPIENT.either, AMOUNT + 1n);
        }).toThrow('FungibleToken: insufficient allowance');
      });

      it('should fail when transfer amount exceeds balance', () => {
        token.privateState.injectSecretKey(OWNER.secretKey);
        token.approve(SPENDER.either, AMOUNT + 1n);

        token.privateState.injectSecretKey(SPENDER.secretKey);
        expect(() => {
          token.transferFrom(OWNER.either, RECIPIENT.either, AMOUNT + 1n);
        }).toThrow('FungibleToken: insufficient balance');
      });

      it('should fail when spender does not have allowance', () => {
        token.privateState.injectSecretKey(UNAUTHORIZED.secretKey);

        expect(() => {
          token.transferFrom(OWNER.either, RECIPIENT.either, AMOUNT);
        }).toThrow('FungibleToken: insufficient allowance');
      });

      it('should fail to transferFrom to the zero address', () => {
        token.privateState.injectSecretKey(SPENDER.secretKey);

        expect(() => {
          token.transferFrom(OWNER.either, ZERO_ACCOUNT, AMOUNT);
        }).toThrow('FungibleToken: invalid receiver');
      });

      it('should fail when transferring to a contract', () => {
        token.privateState.injectSecretKey(SPENDER.secretKey);

        expect(() => {
          token.transferFrom(OWNER.either, OWNER_CONTRACT, AMOUNT);
        }).toThrow('FungibleToken: unsafe transfer');
      });
    });

    describe('_unsafeTransferFrom', () => {
      beforeEach(() => {
        token.privateState.injectSecretKey(OWNER.secretKey);
        token.approve(SPENDER.either, AMOUNT);
        token._mint(OWNER.either, AMOUNT);
      });

      afterEach(() => {
        expect(token.totalSupply()).toEqual(AMOUNT);
      });

      describe.each(
        recipientTypes,
      )('when the recipient is a %s', (_, recipient) => {
        it('should transferFrom spender (partial)', () => {
          token.privateState.injectSecretKey(SPENDER.secretKey);

          const partialAmt = AMOUNT - 1n;
          const txSuccess = token._unsafeTransferFrom(
            OWNER.either,
            recipient,
            partialAmt,
          );
          expect(txSuccess).toBe(true);

          expect(token.balanceOf(OWNER.either)).toEqual(1n);
          expect(token.balanceOf(recipient)).toEqual(partialAmt);
          expect(token.allowance(OWNER.either, SPENDER.either)).toEqual(1n);
        });

        it('should transferFrom spender (full)', () => {
          token.privateState.injectSecretKey(SPENDER.secretKey);

          const txSuccess = token._unsafeTransferFrom(
            OWNER.either,
            recipient,
            AMOUNT,
          );
          expect(txSuccess).toBe(true);

          expect(token.balanceOf(OWNER.either)).toEqual(0n);
          expect(token.balanceOf(recipient)).toEqual(AMOUNT);
          expect(token.allowance(OWNER.either, SPENDER.either)).toEqual(0n);
        });

        it('should transferFrom and not consume infinite allowance', () => {
          token.privateState.injectSecretKey(OWNER.secretKey);
          token.approve(SPENDER.either, MAX_UINT128);

          token.privateState.injectSecretKey(SPENDER.secretKey);
          const txSuccess = token._unsafeTransferFrom(
            OWNER.either,
            recipient,
            AMOUNT,
          );
          expect(txSuccess).toBe(true);

          expect(token.balanceOf(OWNER.either)).toEqual(0n);
          expect(token.balanceOf(recipient)).toEqual(AMOUNT);
          expect(token.allowance(OWNER.either, SPENDER.either)).toEqual(
            MAX_UINT128,
          );
        });

        it('should fail when transfer amount exceeds allowance', () => {
          token.privateState.injectSecretKey(SPENDER.secretKey);

          expect(() => {
            token._unsafeTransferFrom(OWNER.either, recipient, AMOUNT + 1n);
          }).toThrow('FungibleToken: insufficient allowance');
        });

        it('should fail when transfer amount exceeds balance', () => {
          token.privateState.injectSecretKey(OWNER.secretKey);
          token.approve(SPENDER.either, AMOUNT + 1n);

          token.privateState.injectSecretKey(SPENDER.secretKey);
          expect(() => {
            token._unsafeTransferFrom(OWNER.either, recipient, AMOUNT + 1n);
          }).toThrow('FungibleToken: insufficient balance');
        });

        it('should fail when spender does not have allowance', () => {
          token.privateState.injectSecretKey(UNAUTHORIZED.secretKey);

          expect(() => {
            token._unsafeTransferFrom(OWNER.either, recipient, AMOUNT);
          }).toThrow('FungibleToken: insufficient allowance');
        });
      });

      it('should fail to transfer to the zero address (accountId)', () => {
        token.privateState.injectSecretKey(SPENDER.secretKey);

        expect(() => {
          token._unsafeTransferFrom(OWNER.either, ZERO_ACCOUNT, AMOUNT);
        }).toThrow('FungibleToken: invalid receiver');
      });

      it('should fail to transfer to the zero address (contract)', () => {
        token.privateState.injectSecretKey(SPENDER.secretKey);

        expect(() => {
          token._unsafeTransferFrom(OWNER.either, ZERO_CONTRACT, AMOUNT);
        }).toThrow('FungibleToken: invalid receiver');
      });
    });

    describe('_transfer', () => {
      beforeEach(() => {
        token._mint(OWNER.either, AMOUNT);
      });

      afterEach(() => {
        expect(token.totalSupply()).toEqual(AMOUNT);
      });

      it('should update balances (partial)', () => {
        const partialAmt = AMOUNT - 1n;
        token._transfer(OWNER.either, RECIPIENT.either, partialAmt);

        expect(token.balanceOf(OWNER.either)).toEqual(1n);
        expect(token.balanceOf(RECIPIENT.either)).toEqual(partialAmt);
      });

      it('should fail when transferring to a contract', () => {
        expect(() => {
          token._transfer(OWNER.either, OWNER_CONTRACT, AMOUNT);
        }).toThrow('FungibleToken: unsafe transfer');
      });
    });

    describe('_unsafeUncheckedTransfer', () => {
      beforeEach(() => {
        token._mint(OWNER.either, AMOUNT);
      });

      afterEach(() => {
        expect(token.totalSupply()).toEqual(AMOUNT);
      });

      describe.each(
        recipientTypes,
      )('when the recipient is a %s', (_, recipient) => {
        it('should update balances (partial)', () => {
          const partialAmt = AMOUNT - 1n;
          token._unsafeUncheckedTransfer(OWNER.either, recipient, partialAmt);

          expect(token.balanceOf(OWNER.either)).toEqual(1n);
          expect(token.balanceOf(recipient)).toEqual(partialAmt);
        });

        it('should update balances (full)', () => {
          token._unsafeUncheckedTransfer(OWNER.either, recipient, AMOUNT);

          expect(token.balanceOf(OWNER.either)).toEqual(0n);
          expect(token.balanceOf(recipient)).toEqual(AMOUNT);
        });

        it('should fail when transfer amount exceeds balance', () => {
          expect(() => {
            token._unsafeUncheckedTransfer(
              OWNER.either,
              recipient,
              AMOUNT + 1n,
            );
          }).toThrow('FungibleToken: insufficient balance');
        });

        it('should fail when transfer from zero', () => {
          expect(() => {
            token._unsafeUncheckedTransfer(ZERO_CONTRACT, recipient, AMOUNT);
          }).toThrow('FungibleToken: invalid sender');
        });
      });

      it('should fail when transfer to zero (accountId)', () => {
        expect(() => {
          token._unsafeUncheckedTransfer(OWNER.either, ZERO_ACCOUNT, AMOUNT);
        }).toThrow('FungibleToken: invalid receiver');
      });

      it('should fail when transfer to zero (contract)', () => {
        expect(() => {
          token._unsafeUncheckedTransfer(OWNER.either, ZERO_CONTRACT, AMOUNT);
        }).toThrow('FungibleToken: invalid receiver');
      });

      it('should canonicalize recipient (zero out inactive right side)', () => {
        // Check init amt for recipient is zero
        expect(token.balanceOf(RECIPIENT.either)).toEqual(0n);

        const nonCanonical = {
          is_left: true,
          left: RECIPIENT.accountId,
          right: utils.encodeToAddress('JUNK_DATA'),
        };

        token._unsafeUncheckedTransfer(OWNER.either, nonCanonical, AMOUNT);
        expect(token.balanceOf(RECIPIENT.either)).toEqual(AMOUNT);
      });

      it('should canonicalize recipient contract address (zero out inactive left side)', () => {
        const nonCanonical = {
          is_left: false,
          left: new Uint8Array(32).fill(1),
          right: RECIPIENT_CONTRACT.right,
        };

        token._unsafeUncheckedTransfer(OWNER.either, nonCanonical, AMOUNT);
        expect(token.balanceOf(RECIPIENT_CONTRACT)).toEqual(AMOUNT);
        expect(token.balanceOf(OWNER.either)).toEqual(0n);
      });

      it('should canonicalize fromAddress (zero out inactive right side)', () => {
        const nonCanonical = {
          is_left: true,
          left: OWNER.accountId,
          right: utils.encodeToAddress('JUNK_DATA'),
        };

        token._unsafeUncheckedTransfer(nonCanonical, RECIPIENT.either, AMOUNT);
        expect(token.balanceOf(OWNER.either)).toEqual(0n);
        expect(token.balanceOf(RECIPIENT.either)).toEqual(AMOUNT);
      });
    });

    describe('_mint', () => {
      it('should mint and update supply', () => {
        expect(token.totalSupply()).toEqual(0n);

        token._mint(RECIPIENT.either, AMOUNT);
        expect(token.totalSupply()).toEqual(AMOUNT);
        expect(token.balanceOf(RECIPIENT.either)).toEqual(AMOUNT);
      });

      it('should catch mint overflow', () => {
        token._mint(RECIPIENT.either, MAX_UINT128);

        expect(() => {
          token._mint(RECIPIENT.either, 1n);
        }).toThrow('FungibleToken: arithmetic overflow');
      });

      it('should not mint to zero (accountId)', () => {
        expect(() => {
          token._mint(ZERO_ACCOUNT, AMOUNT);
        }).toThrow('FungibleToken: invalid receiver');
      });

      it('should not mint to zero (contract)', () => {
        expect(() => {
          // caught by unsafe transfer guard first
          token._mint(ZERO_CONTRACT, AMOUNT);
        }).toThrow('FungibleToken: unsafe transfer');
      });

      it('should allow mint of 0 tokens', () => {
        token._mint(OWNER.either, 0n);
        expect(token.totalSupply()).toEqual(0n);
        expect(token.balanceOf(OWNER.either)).toEqual(0n);
      });

      it('should fail when minting to a contract', () => {
        expect(() => {
          token._mint(OWNER_CONTRACT, AMOUNT);
        }).toThrow('FungibleToken: unsafe transfer');
      });
    });

    describe('_unsafeMint', () => {
      describe.each(
        recipientTypes,
      )('when the recipient is a %s', (_, recipient) => {
        it('should mint and update supply', () => {
          expect(token.totalSupply()).toEqual(0n);

          token._unsafeMint(recipient, AMOUNT);
          expect(token.totalSupply()).toEqual(AMOUNT);
          expect(token.balanceOf(recipient)).toEqual(AMOUNT);
        });

        it('should catch mint overflow', () => {
          token._unsafeMint(recipient, MAX_UINT128);

          expect(() => {
            token._unsafeMint(recipient, 1n);
          }).toThrow('FungibleToken: arithmetic overflow');
        });

        it('should allow mint of 0 tokens', () => {
          token._unsafeMint(recipient, 0n);
          expect(token.totalSupply()).toEqual(0n);
          expect(token.balanceOf(recipient)).toEqual(0n);
        });
      });

      it('should not mint to zero (accountId)', () => {
        expect(() => {
          token._unsafeMint(ZERO_ACCOUNT, AMOUNT);
        }).toThrow('FungibleToken: invalid receiver');
      });

      it('should not mint to zero (contract)', () => {
        expect(() => {
          token._unsafeMint(ZERO_CONTRACT, AMOUNT);
        }).toThrow('FungibleToken: invalid receiver');
      });

      it('should canonicalize sender (zero out inactive right side)', () => {
        const nonCanonical = {
          is_left: true,
          left: OWNER.accountId,
          right: utils.encodeToAddress('JUNK_DATA'),
        };

        token._unsafeMint(nonCanonical, AMOUNT);
        expect(token.balanceOf(OWNER.either)).toEqual(AMOUNT);
      });
    });

    describe('_burn', () => {
      beforeEach(() => {
        token._mint(OWNER.either, AMOUNT);
      });

      it('should burn tokens', () => {
        token._burn(OWNER.either, 1n);

        const afterBurn = AMOUNT - 1n;
        expect(token.balanceOf(OWNER.either)).toEqual(afterBurn);
        expect(token.totalSupply()).toEqual(afterBurn);
      });

      it('should throw when burning from zero (accountId)', () => {
        expect(() => {
          token._burn(ZERO_ACCOUNT, AMOUNT);
        }).toThrow('FungibleToken: invalid sender');
      });

      it('should throw when burning from zero (contract)', () => {
        expect(() => {
          token._burn(ZERO_CONTRACT, AMOUNT);
        }).toThrow('FungibleToken: invalid sender');
      });

      it('should throw when burn amount is greater than balance', () => {
        expect(() => {
          token._burn(OWNER.either, AMOUNT + 1n);
        }).toThrow('FungibleToken: insufficient balance');
      });

      it('should allow burn of 0 tokens', () => {
        token._burn(OWNER.either, 0n);
        expect(token.totalSupply()).toEqual(AMOUNT);
        expect(token.balanceOf(OWNER.either)).toEqual(AMOUNT);
      });

      it('should burn with non-canonical account (left)', () => {
        const nonCanonical = {
          is_left: true,
          left: OWNER.accountId,
          right: utils.encodeToAddress('JUNK_DATA'),
        };

        token._burn(nonCanonical, 1n);
        expect(token.balanceOf(OWNER.either)).toEqual(AMOUNT - 1n);
        expect(token.totalSupply()).toEqual(AMOUNT - 1n);
      });
    });

    describe('_approve', () => {
      beforeEach(() => {
        expect(token.allowance(OWNER.either, SPENDER.either)).toEqual(0n);
      });

      it('should approve and update allowance', () => {
        token._approve(OWNER.either, SPENDER.either, AMOUNT);
        expect(token.allowance(OWNER.either, SPENDER.either)).toEqual(AMOUNT);
      });

      it('should approve and update allowance for multiple spenders', () => {
        token._approve(OWNER.either, SPENDER.either, AMOUNT);
        expect(token.allowance(OWNER.either, SPENDER.either)).toEqual(AMOUNT);

        token._approve(OWNER.either, OTHER.either, AMOUNT);
        expect(token.allowance(OWNER.either, OTHER.either)).toEqual(AMOUNT);

        expect(token.allowance(OWNER.either, RECIPIENT.either)).toEqual(0n);
      });

      it('should fail when approve from zero (accountId)', () => {
        expect(() => {
          token._approve(ZERO_ACCOUNT, SPENDER.either, AMOUNT);
        }).toThrow('FungibleToken: invalid owner');
      });

      it('should fail when approve from zero (contract)', () => {
        expect(() => {
          token._approve(ZERO_CONTRACT, SPENDER.either, AMOUNT);
        }).toThrow('FungibleToken: invalid owner');
      });

      it('should fail when approve to zero (accountId)', () => {
        expect(() => {
          token._approve(OWNER.either, ZERO_ACCOUNT, AMOUNT);
        }).toThrow('FungibleToken: invalid spender');
      });

      it('should fail when approve to zero (contract)', () => {
        expect(() => {
          token._approve(OWNER.either, ZERO_CONTRACT, AMOUNT);
        }).toThrow('FungibleToken: invalid spender');
      });

      it('should allow approve of 0 tokens', () => {
        token._approve(OWNER.either, SPENDER.either, 0n);
        expect(token.allowance(OWNER.either, SPENDER.either)).toEqual(0n);
      });

      it('should canonicalize owner in allowance (zero out inactive right side)', () => {
        const nonCanonicalOwner = {
          is_left: true,
          left: OWNER.accountId,
          right: utils.encodeToAddress('JUNK_DATA'),
        };

        token._approve(nonCanonicalOwner, SPENDER.either, AMOUNT);
        expect(token.allowance(OWNER.either, SPENDER.either)).toEqual(AMOUNT);
      });

      it('should canonicalize spender in allowance (zero out inactive right side)', () => {
        const nonCanonicalSpender = {
          is_left: true,
          left: SPENDER.accountId,
          right: utils.encodeToAddress('JUNK_DATA'),
        };

        token._approve(OWNER.either, nonCanonicalSpender, AMOUNT);
        expect(token.allowance(OWNER.either, SPENDER.either)).toEqual(AMOUNT);
      });

      it('should canonicalize contract address owner (zero out inactive left side)', () => {
        const nonCanonicalOwner = {
          is_left: false,
          left: new Uint8Array(32).fill(1),
          right: OWNER_CONTRACT.right,
        };

        token._approve(nonCanonicalOwner, SPENDER.either, AMOUNT);
        expect(token.allowance(OWNER_CONTRACT, SPENDER.either)).toEqual(AMOUNT);
      });
    });

    describe('_spendAllowance', () => {
      beforeEach(() => {
        token._mint(OWNER.either, AMOUNT);
      });

      it('should update allowance when not unlimited', () => {
        token._approve(OWNER.either, SPENDER.either, MAX_UINT128 - 1n);
        token._spendAllowance(OWNER.either, SPENDER.either, AMOUNT);
        expect(token.allowance(OWNER.either, SPENDER.either)).toEqual(
          MAX_UINT128 - 1n - AMOUNT,
        );
      });

      it('should not update allowance when unlimited', () => {
        token._approve(OWNER.either, SPENDER.either, MAX_UINT128);
        token._spendAllowance(OWNER.either, SPENDER.either, MAX_UINT128 - 1n);
        expect(token.allowance(OWNER.either, SPENDER.either)).toEqual(
          MAX_UINT128,
        );
      });

      it('should fail when owner allowance is not initialized', () => {
        expect(() => {
          token._spendAllowance(OTHER.either, SPENDER.either, AMOUNT);
        }).toThrow('FungibleToken: insufficient allowance');
      });

      it('should fail when spender is not initialized', () => {
        token._approve(OWNER.either, SPENDER.either, AMOUNT);
        expect(() => {
          token._spendAllowance(OWNER.either, OTHER.either, AMOUNT);
        }).toThrow('FungibleToken: insufficient allowance');
      });

      it('should fail when spender has insufficient allowance', () => {
        token._approve(OWNER.either, SPENDER.either, AMOUNT);
        expect(() => {
          token._spendAllowance(OWNER.either, SPENDER.either, AMOUNT + 1n);
        }).toThrow('FungibleToken: insufficient allowance');
      });

      it('should canonicalize when spending allowance', () => {
        token._approve(OWNER.either, SPENDER.either, AMOUNT);

        const nonCanonicalOwner = {
          is_left: true,
          left: OWNER.accountId,
          right: utils.encodeToAddress('JUNK_DATA'),
        };
        const nonCanonicalSpender = {
          is_left: true,
          left: SPENDER.accountId,
          right: utils.encodeToAddress('JUNK_DATA'),
        };

        token._spendAllowance(nonCanonicalOwner, nonCanonicalSpender, AMOUNT);
        expect(token.allowance(OWNER.either, SPENDER.either)).toEqual(0n);
      });
    });

    describe('Multiple Operations', () => {
      it('should handle mint → transfer → burn sequence', () => {
        token._mint(OWNER.either, AMOUNT);
        expect(token.totalSupply()).toEqual(AMOUNT);
        expect(token.balanceOf(OWNER.either)).toEqual(AMOUNT);

        token.privateState.injectSecretKey(OWNER.secretKey);
        token.transfer(RECIPIENT.either, AMOUNT - 1n);
        expect(token.balanceOf(OWNER.either)).toEqual(1n);
        expect(token.balanceOf(RECIPIENT.either)).toEqual(AMOUNT - 1n);

        token._burn(OWNER.either, 1n);
        expect(token.totalSupply()).toEqual(AMOUNT - 1n);
        expect(token.balanceOf(OWNER.either)).toEqual(0n);
      });
    });
  });

  describe('simulator wiring', () => {
    it('should expose an empty public ledger via getPublicState', () => {
      const sim = new FungibleTokenSimulator(NAME, SYMBOL, DECIMALS, INIT);

      expect(sim.getPublicState()).toStrictEqual({});
    });
  });

  describe('privateState helpers', () => {
    describe('getCurrentSecretKey', () => {
      it('should return the injected secret key', () => {
        const sim = new FungibleTokenSimulator(NAME, SYMBOL, DECIMALS, INIT);
        sim.privateState.injectSecretKey(OWNER.secretKey);

        expect(sim.privateState.getCurrentSecretKey()).toEqual(OWNER.secretKey);
      });

      it('should throw when the secret key is undefined', () => {
        const sim = new FungibleTokenSimulator(NAME, SYMBOL, DECIMALS, INIT, {
          privateState: { secretKey: undefined as unknown as Uint8Array },
        });

        expect(() => sim.privateState.getCurrentSecretKey()).toThrow(
          'Missing secret key',
        );
      });
    });
  });
});
