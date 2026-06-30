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
    it('should initialize metadata', async () => {
      token = await FungibleTokenSimulator.create(NAME, SYMBOL, DECIMALS, INIT);
      expect(await token.name()).toEqual(NAME);
      expect(await token.symbol()).toEqual(SYMBOL);
      expect(await token.decimals()).toEqual(DECIMALS);
    });

    it('should initialize empty metadata', async () => {
      token = await FungibleTokenSimulator.create(
        EMPTY_STRING,
        EMPTY_STRING,
        NO_DECIMALS,
        INIT,
      );
      expect(await token.name()).toEqual(EMPTY_STRING);
      expect(await token.symbol()).toEqual(EMPTY_STRING);
      expect(await token.decimals()).toEqual(NO_DECIMALS);
    });
  });

  describe('when not initialized correctly', () => {
    beforeEach(async () => {
      token = await FungibleTokenSimulator.create(
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

    it.each(circuitsToFail)('%s should fail', async (circuitName, args) => {
      await expect(
        (token[circuitName] as (...args: unknown[]) => Promise<unknown>)(
          ...args,
        ),
      ).rejects.toThrow('FungibleToken: contract not initialized');
    });
  });

  describe('when initialized correctly', () => {
    beforeEach(async () => {
      token = await FungibleTokenSimulator.create(NAME, SYMBOL, DECIMALS, INIT);
    });

    describe('totalSupply', () => {
      it('returns 0 when there is no supply', async () => {
        expect(await token.totalSupply()).toEqual(0n);
      });

      it('returns the amount of existing tokens when there is a supply', async () => {
        await token._mint(OWNER.either, AMOUNT);
        expect(await token.totalSupply()).toEqual(AMOUNT);
      });
    });

    describe('balanceOf', () => {
      describe.each(ownerTypes)('when the owner is a %s', (_, owner) => {
        it('should return zero when requested account has no balance', async () => {
          expect(await token.balanceOf(owner)).toEqual(0n);
        });

        it('should return balance when requested account has tokens', async () => {
          await token._unsafeMint(owner, AMOUNT);
          expect(await token.balanceOf(owner)).toEqual(AMOUNT);
        });
      });

      it('should return correct balance with non-canonical lookup (left)', async () => {
        await token._mint(OWNER.either, AMOUNT);

        const nonCanonical = {
          is_left: true,
          left: OWNER.accountId,
          right: utils.encodeToAddress('JUNK_DATA'),
        };

        expect(await token.balanceOf(nonCanonical)).toEqual(AMOUNT);
      });

      it('should return correct balance with non-canonical lookup (right)', async () => {
        await token._unsafeMint(OWNER_CONTRACT, AMOUNT);

        const nonCanonical = {
          is_left: false,
          left: new Uint8Array(32).fill(1),
          right: OWNER_CONTRACT.right,
        };

        expect(await token.balanceOf(nonCanonical)).toEqual(AMOUNT);
      });
    });

    describe('allowance', () => {
      it('should return correct allowance with non-canonical owner lookup (left)', async () => {
        await token._approve(OWNER.either, SPENDER.either, AMOUNT);

        const nonCanonicalOwner = {
          is_left: true,
          left: OWNER.accountId,
          right: utils.encodeToAddress('JUNK_DATA'),
        };

        expect(
          await token.allowance(nonCanonicalOwner, SPENDER.either),
        ).toEqual(AMOUNT);
      });

      it('should return correct allowance with non-canonical spender lookup (left)', async () => {
        await token._approve(OWNER.either, SPENDER.either, AMOUNT);

        const nonCanonicalSpender = {
          is_left: true,
          left: SPENDER.accountId,
          right: utils.encodeToAddress('JUNK_DATA'),
        };

        expect(
          await token.allowance(OWNER.either, nonCanonicalSpender),
        ).toEqual(AMOUNT);
      });

      it('should return correct allowance with non-canonical owner lookup (right)', async () => {
        await token._approve(OWNER_CONTRACT, SPENDER.either, AMOUNT);

        const nonCanonicalOwner = {
          is_left: false,
          left: new Uint8Array(32).fill(1),
          right: OWNER_CONTRACT.right,
        };

        expect(
          await token.allowance(nonCanonicalOwner, SPENDER.either),
        ).toEqual(AMOUNT);
      });

      it('should return correct allowance with non-canonical spender lookup (right)', async () => {
        await token._approve(OWNER.either, RECIPIENT_CONTRACT, AMOUNT);

        const nonCanonicalSpender = {
          is_left: false,
          left: new Uint8Array(32).fill(1),
          right: RECIPIENT_CONTRACT.right,
        };

        expect(
          await token.allowance(OWNER.either, nonCanonicalSpender),
        ).toEqual(AMOUNT);
      });
    });

    describe('transfer', () => {
      beforeEach(async () => {
        await token._mint(OWNER.either, AMOUNT);
        expect(await token.balanceOf(OWNER.either)).toEqual(AMOUNT);
        expect(await token.balanceOf(RECIPIENT.either)).toEqual(0n);
      });

      afterEach(async () => {
        expect(await token.totalSupply()).toEqual(AMOUNT);
      });

      it('should transfer partial', async () => {
        await token.privateState.injectSecretKey(OWNER.secretKey);

        const partialAmt = AMOUNT - 1n;
        const txSuccess = await token.transfer(RECIPIENT.either, partialAmt);

        expect(txSuccess).toBe(true);
        expect(await token.balanceOf(OWNER.either)).toEqual(1n);
        expect(await token.balanceOf(RECIPIENT.either)).toEqual(partialAmt);
      });

      it('should transfer full', async () => {
        await token.privateState.injectSecretKey(OWNER.secretKey);

        const txSuccess = await token.transfer(RECIPIENT.either, AMOUNT);

        expect(txSuccess).toBe(true);
        expect(await token.balanceOf(OWNER.either)).toEqual(0n);
        expect(await token.balanceOf(RECIPIENT.either)).toEqual(AMOUNT);
      });

      it('should fail with insufficient balance', async () => {
        await token.privateState.injectSecretKey(OWNER.secretKey);

        await expect(
          token.transfer(RECIPIENT.either, AMOUNT + 1n),
        ).rejects.toThrow('FungibleToken: insufficient balance');
      });

      it('should fail with transfer from zero identity', async () => {
        // Inject a key that produces zero accountId — infeasible in practice,
        // but we can test the zero check by using _unsafeUncheckedTransfer directly
        await expect(
          token._unsafeUncheckedTransfer(
            ZERO_ACCOUNT,
            RECIPIENT.either,
            AMOUNT,
          ),
        ).rejects.toThrow('FungibleToken: invalid sender');
      });

      it('should fail with transfer to zero', async () => {
        await token.privateState.injectSecretKey(OWNER.secretKey);

        await expect(token.transfer(ZERO_ACCOUNT, AMOUNT)).rejects.toThrow(
          'FungibleToken: invalid receiver',
        );
      });

      it('should allow transfer of 0 tokens', async () => {
        await token.privateState.injectSecretKey(OWNER.secretKey);

        const txSuccess = await token.transfer(RECIPIENT.either, 0n);

        expect(txSuccess).toBe(true);
        expect(await token.balanceOf(OWNER.either)).toEqual(AMOUNT);
        expect(await token.balanceOf(RECIPIENT.either)).toEqual(0n);
      });

      it('should handle transfer with empty _balances', async () => {
        await token.privateState.injectSecretKey(SPENDER.secretKey);

        await expect(token.transfer(RECIPIENT.either, 1n)).rejects.toThrow(
          'FungibleToken: insufficient balance',
        );
      });

      it('should fail when transferring to a contract', async () => {
        await token.privateState.injectSecretKey(OWNER.secretKey);

        await expect(token.transfer(OWNER_CONTRACT, AMOUNT)).rejects.toThrow(
          'FungibleToken: unsafe transfer',
        );
      });
    });

    describe('_unsafeTransfer', () => {
      describe.each(
        recipientTypes,
      )('when the recipient is a %s', (_, recipient) => {
        beforeEach(async () => {
          await token._mint(OWNER.either, AMOUNT);
          expect(await token.balanceOf(OWNER.either)).toEqual(AMOUNT);
          expect(await token.balanceOf(recipient)).toEqual(0n);
        });

        afterEach(async () => {
          expect(await token.totalSupply()).toEqual(AMOUNT);
        });

        it('should transfer partial', async () => {
          await token.privateState.injectSecretKey(OWNER.secretKey);

          const partialAmt = AMOUNT - 1n;
          const txSuccess = await token._unsafeTransfer(recipient, partialAmt);

          expect(txSuccess).toBe(true);
          expect(await token.balanceOf(OWNER.either)).toEqual(1n);
          expect(await token.balanceOf(recipient)).toEqual(partialAmt);
        });

        it('should transfer full', async () => {
          await token.privateState.injectSecretKey(OWNER.secretKey);

          const txSuccess = await token._unsafeTransfer(recipient, AMOUNT);

          expect(txSuccess).toBe(true);
          expect(await token.balanceOf(OWNER.either)).toEqual(0n);
          expect(await token.balanceOf(recipient)).toEqual(AMOUNT);
        });

        it('should fail with insufficient balance', async () => {
          await token.privateState.injectSecretKey(OWNER.secretKey);

          await expect(
            token._unsafeTransfer(recipient, AMOUNT + 1n),
          ).rejects.toThrow('FungibleToken: insufficient balance');
        });

        it('should allow transfer of 0 tokens', async () => {
          await token.privateState.injectSecretKey(OWNER.secretKey);

          const txSuccess = await token._unsafeTransfer(recipient, 0n);

          expect(txSuccess).toBe(true);
          expect(await token.balanceOf(OWNER.either)).toEqual(AMOUNT);
          expect(await token.balanceOf(recipient)).toEqual(0n);
        });

        it('should handle transfer with empty _balances', async () => {
          await token.privateState.injectSecretKey(SPENDER.secretKey);

          await expect(token._unsafeTransfer(recipient, 1n)).rejects.toThrow(
            'FungibleToken: insufficient balance',
          );
        });
      });

      it('should fail with transfer to zero (accountId)', async () => {
        await token._mint(OWNER.either, AMOUNT);
        await token.privateState.injectSecretKey(OWNER.secretKey);

        await expect(
          token._unsafeTransfer(ZERO_ACCOUNT, AMOUNT),
        ).rejects.toThrow('FungibleToken: invalid receiver');
      });

      it('should fail with transfer to zero (contract)', async () => {
        await token._mint(OWNER.either, AMOUNT);
        await token.privateState.injectSecretKey(OWNER.secretKey);

        await expect(
          token._unsafeTransfer(ZERO_CONTRACT, AMOUNT),
        ).rejects.toThrow('FungibleToken: invalid receiver');
      });
    });

    describe('approve', () => {
      beforeEach(async () => {
        expect(await token.allowance(OWNER.either, SPENDER.either)).toEqual(0n);
      });

      it('should approve and update allowance', async () => {
        await token.privateState.injectSecretKey(OWNER.secretKey);

        await token.approve(SPENDER.either, AMOUNT);
        expect(await token.allowance(OWNER.either, SPENDER.either)).toEqual(
          AMOUNT,
        );
      });

      it('should approve and update allowance for multiple spenders', async () => {
        await token.privateState.injectSecretKey(OWNER.secretKey);

        await token.approve(SPENDER.either, AMOUNT);
        expect(await token.allowance(OWNER.either, SPENDER.either)).toEqual(
          AMOUNT,
        );

        await token.approve(OTHER.either, AMOUNT);
        expect(await token.allowance(OWNER.either, OTHER.either)).toEqual(
          AMOUNT,
        );

        expect(await token.allowance(OWNER.either, RECIPIENT.either)).toEqual(
          0n,
        );
      });

      it('should fail when approve to zero', async () => {
        await token.privateState.injectSecretKey(OWNER.secretKey);

        await expect(token.approve(ZERO_ACCOUNT, AMOUNT)).rejects.toThrow(
          'FungibleToken: invalid spender',
        );
      });

      it('should transfer exact allowance and fail subsequent transfer', async () => {
        await token._mint(OWNER.either, AMOUNT);

        await token.privateState.injectSecretKey(OWNER.secretKey);
        await token.approve(SPENDER.either, AMOUNT);

        await token.privateState.injectSecretKey(SPENDER.secretKey);
        await token.transferFrom(OWNER.either, RECIPIENT.either, AMOUNT);
        expect(await token.allowance(OWNER.either, SPENDER.either)).toEqual(0n);

        await expect(
          token.transferFrom(OWNER.either, RECIPIENT.either, 1n),
        ).rejects.toThrow('FungibleToken: insufficient allowance');
      });

      it('should allow approve of 0 tokens', async () => {
        await token.privateState.injectSecretKey(OWNER.secretKey);

        await token.approve(SPENDER.either, 0n);
        expect(await token.allowance(OWNER.either, SPENDER.either)).toEqual(0n);
      });

      it('should handle allowance with empty _allowances', async () => {
        expect(await token.allowance(OWNER.either, SPENDER.either)).toEqual(0n);
      });
    });

    describe('transferFrom', () => {
      beforeEach(async () => {
        await token.privateState.injectSecretKey(OWNER.secretKey);
        await token.approve(SPENDER.either, AMOUNT);
        await token._mint(OWNER.either, AMOUNT);
      });

      afterEach(async () => {
        expect(await token.totalSupply()).toEqual(AMOUNT);
      });

      it('should transferFrom spender (partial)', async () => {
        await token.privateState.injectSecretKey(SPENDER.secretKey);

        const partialAmt = AMOUNT - 1n;
        const txSuccess = await token.transferFrom(
          OWNER.either,
          RECIPIENT.either,
          partialAmt,
        );
        expect(txSuccess).toBe(true);

        expect(await token.balanceOf(OWNER.either)).toEqual(1n);
        expect(await token.balanceOf(RECIPIENT.either)).toEqual(partialAmt);
        expect(await token.allowance(OWNER.either, SPENDER.either)).toEqual(1n);
      });

      it('should transferFrom spender (full)', async () => {
        await token.privateState.injectSecretKey(SPENDER.secretKey);

        const txSuccess = await token.transferFrom(
          OWNER.either,
          RECIPIENT.either,
          AMOUNT,
        );
        expect(txSuccess).toBe(true);

        expect(await token.balanceOf(OWNER.either)).toEqual(0n);
        expect(await token.balanceOf(RECIPIENT.either)).toEqual(AMOUNT);
        expect(await token.allowance(OWNER.either, SPENDER.either)).toEqual(0n);
      });

      it('should transferFrom and not consume infinite allowance', async () => {
        await token.privateState.injectSecretKey(OWNER.secretKey);
        await token.approve(SPENDER.either, MAX_UINT128);

        await token.privateState.injectSecretKey(SPENDER.secretKey);
        const txSuccess = await token.transferFrom(
          OWNER.either,
          RECIPIENT.either,
          AMOUNT,
        );
        expect(txSuccess).toBe(true);

        expect(await token.balanceOf(OWNER.either)).toEqual(0n);
        expect(await token.balanceOf(RECIPIENT.either)).toEqual(AMOUNT);
        expect(await token.allowance(OWNER.either, SPENDER.either)).toEqual(
          MAX_UINT128,
        );
      });

      it('should fail when transfer amount exceeds allowance', async () => {
        await token.privateState.injectSecretKey(SPENDER.secretKey);

        await expect(
          token.transferFrom(OWNER.either, RECIPIENT.either, AMOUNT + 1n),
        ).rejects.toThrow('FungibleToken: insufficient allowance');
      });

      it('should fail when transfer amount exceeds balance', async () => {
        await token.privateState.injectSecretKey(OWNER.secretKey);
        await token.approve(SPENDER.either, AMOUNT + 1n);

        await token.privateState.injectSecretKey(SPENDER.secretKey);
        await expect(
          token.transferFrom(OWNER.either, RECIPIENT.either, AMOUNT + 1n),
        ).rejects.toThrow('FungibleToken: insufficient balance');
      });

      it('should fail when spender does not have allowance', async () => {
        await token.privateState.injectSecretKey(UNAUTHORIZED.secretKey);

        await expect(
          token.transferFrom(OWNER.either, RECIPIENT.either, AMOUNT),
        ).rejects.toThrow('FungibleToken: insufficient allowance');
      });

      it('should allow zero-value transferFrom without a pre-existing allowance', async () => {
        // A missing allowance entry is treated as zero, and a zero-value spend
        // is a no-op, so this must not revert.
        await token.privateState.injectSecretKey(UNAUTHORIZED.secretKey);

        const txSuccess = await token.transferFrom(
          OWNER.either,
          RECIPIENT.either,
          0n,
        );
        expect(txSuccess).toBe(true);

        // No allowance entry is created for the spender, matching `allowance`.
        expect(
          await token.allowance(OWNER.either, UNAUTHORIZED.either),
        ).toEqual(0n);
        // Balances are unchanged.
        expect(await token.balanceOf(OWNER.either)).toEqual(AMOUNT);
        expect(await token.balanceOf(RECIPIENT.either)).toEqual(0n);
      });

      it('should fail to transferFrom to the zero address', async () => {
        await token.privateState.injectSecretKey(SPENDER.secretKey);

        await expect(
          token.transferFrom(OWNER.either, ZERO_ACCOUNT, AMOUNT),
        ).rejects.toThrow('FungibleToken: invalid receiver');
      });

      it('should fail when transferring to a contract', async () => {
        await token.privateState.injectSecretKey(SPENDER.secretKey);

        await expect(
          token.transferFrom(OWNER.either, OWNER_CONTRACT, AMOUNT),
        ).rejects.toThrow('FungibleToken: unsafe transfer');
      });
    });

    describe('_unsafeTransferFrom', () => {
      beforeEach(async () => {
        await token.privateState.injectSecretKey(OWNER.secretKey);
        await token.approve(SPENDER.either, AMOUNT);
        await token._mint(OWNER.either, AMOUNT);
      });

      afterEach(async () => {
        expect(await token.totalSupply()).toEqual(AMOUNT);
      });

      describe.each(
        recipientTypes,
      )('when the recipient is a %s', (_, recipient) => {
        it('should transferFrom spender (partial)', async () => {
          await token.privateState.injectSecretKey(SPENDER.secretKey);

          const partialAmt = AMOUNT - 1n;
          const txSuccess = await token._unsafeTransferFrom(
            OWNER.either,
            recipient,
            partialAmt,
          );
          expect(txSuccess).toBe(true);

          expect(await token.balanceOf(OWNER.either)).toEqual(1n);
          expect(await token.balanceOf(recipient)).toEqual(partialAmt);
          expect(await token.allowance(OWNER.either, SPENDER.either)).toEqual(
            1n,
          );
        });

        it('should transferFrom spender (full)', async () => {
          await token.privateState.injectSecretKey(SPENDER.secretKey);

          const txSuccess = await token._unsafeTransferFrom(
            OWNER.either,
            recipient,
            AMOUNT,
          );
          expect(txSuccess).toBe(true);

          expect(await token.balanceOf(OWNER.either)).toEqual(0n);
          expect(await token.balanceOf(recipient)).toEqual(AMOUNT);
          expect(await token.allowance(OWNER.either, SPENDER.either)).toEqual(
            0n,
          );
        });

        it('should transferFrom and not consume infinite allowance', async () => {
          await token.privateState.injectSecretKey(OWNER.secretKey);
          await token.approve(SPENDER.either, MAX_UINT128);

          await token.privateState.injectSecretKey(SPENDER.secretKey);
          const txSuccess = await token._unsafeTransferFrom(
            OWNER.either,
            recipient,
            AMOUNT,
          );
          expect(txSuccess).toBe(true);

          expect(await token.balanceOf(OWNER.either)).toEqual(0n);
          expect(await token.balanceOf(recipient)).toEqual(AMOUNT);
          expect(await token.allowance(OWNER.either, SPENDER.either)).toEqual(
            MAX_UINT128,
          );
        });

        it('should fail when transfer amount exceeds allowance', async () => {
          await token.privateState.injectSecretKey(SPENDER.secretKey);

          await expect(
            token._unsafeTransferFrom(OWNER.either, recipient, AMOUNT + 1n),
          ).rejects.toThrow('FungibleToken: insufficient allowance');
        });

        it('should fail when transfer amount exceeds balance', async () => {
          await token.privateState.injectSecretKey(OWNER.secretKey);
          await token.approve(SPENDER.either, AMOUNT + 1n);

          await token.privateState.injectSecretKey(SPENDER.secretKey);
          await expect(
            token._unsafeTransferFrom(OWNER.either, recipient, AMOUNT + 1n),
          ).rejects.toThrow('FungibleToken: insufficient balance');
        });

        it('should fail when spender does not have allowance', async () => {
          await token.privateState.injectSecretKey(UNAUTHORIZED.secretKey);

          await expect(
            token._unsafeTransferFrom(OWNER.either, recipient, AMOUNT),
          ).rejects.toThrow('FungibleToken: insufficient allowance');
        });
      });

      it('should fail to transfer to the zero address (accountId)', async () => {
        await token.privateState.injectSecretKey(SPENDER.secretKey);

        await expect(
          token._unsafeTransferFrom(OWNER.either, ZERO_ACCOUNT, AMOUNT),
        ).rejects.toThrow('FungibleToken: invalid receiver');
      });

      it('should fail to transfer to the zero address (contract)', async () => {
        await token.privateState.injectSecretKey(SPENDER.secretKey);

        await expect(
          token._unsafeTransferFrom(OWNER.either, ZERO_CONTRACT, AMOUNT),
        ).rejects.toThrow('FungibleToken: invalid receiver');
      });
    });

    describe('_transfer', () => {
      beforeEach(async () => {
        await token._mint(OWNER.either, AMOUNT);
      });

      afterEach(async () => {
        expect(await token.totalSupply()).toEqual(AMOUNT);
      });

      it('should update balances (partial)', async () => {
        const partialAmt = AMOUNT - 1n;
        await token._transfer(OWNER.either, RECIPIENT.either, partialAmt);

        expect(await token.balanceOf(OWNER.either)).toEqual(1n);
        expect(await token.balanceOf(RECIPIENT.either)).toEqual(partialAmt);
      });

      it('should fail when transferring to a contract', async () => {
        await expect(
          token._transfer(OWNER.either, OWNER_CONTRACT, AMOUNT),
        ).rejects.toThrow('FungibleToken: unsafe transfer');
      });
    });

    describe('_unsafeUncheckedTransfer', () => {
      beforeEach(async () => {
        await token._mint(OWNER.either, AMOUNT);
      });

      afterEach(async () => {
        expect(await token.totalSupply()).toEqual(AMOUNT);
      });

      describe.each(
        recipientTypes,
      )('when the recipient is a %s', (_, recipient) => {
        it('should update balances (partial)', async () => {
          const partialAmt = AMOUNT - 1n;
          await token._unsafeUncheckedTransfer(
            OWNER.either,
            recipient,
            partialAmt,
          );

          expect(await token.balanceOf(OWNER.either)).toEqual(1n);
          expect(await token.balanceOf(recipient)).toEqual(partialAmt);
        });

        it('should update balances (full)', async () => {
          await token._unsafeUncheckedTransfer(OWNER.either, recipient, AMOUNT);

          expect(await token.balanceOf(OWNER.either)).toEqual(0n);
          expect(await token.balanceOf(recipient)).toEqual(AMOUNT);
        });

        it('should fail when transfer amount exceeds balance', async () => {
          await expect(
            token._unsafeUncheckedTransfer(
              OWNER.either,
              recipient,
              AMOUNT + 1n,
            ),
          ).rejects.toThrow('FungibleToken: insufficient balance');
        });

        it('should fail when transfer from zero', async () => {
          await expect(
            token._unsafeUncheckedTransfer(ZERO_CONTRACT, recipient, AMOUNT),
          ).rejects.toThrow('FungibleToken: invalid sender');
        });
      });

      it('should fail when transfer to zero (accountId)', async () => {
        await expect(
          token._unsafeUncheckedTransfer(OWNER.either, ZERO_ACCOUNT, AMOUNT),
        ).rejects.toThrow('FungibleToken: invalid receiver');
      });

      it('should fail when transfer to zero (contract)', async () => {
        await expect(
          token._unsafeUncheckedTransfer(OWNER.either, ZERO_CONTRACT, AMOUNT),
        ).rejects.toThrow('FungibleToken: invalid receiver');
      });

      it('should canonicalize recipient (zero out inactive right side)', async () => {
        // Check init amt for recipient is zero
        expect(await token.balanceOf(RECIPIENT.either)).toEqual(0n);

        const nonCanonical = {
          is_left: true,
          left: RECIPIENT.accountId,
          right: utils.encodeToAddress('JUNK_DATA'),
        };

        await token._unsafeUncheckedTransfer(
          OWNER.either,
          nonCanonical,
          AMOUNT,
        );
        expect(await token.balanceOf(RECIPIENT.either)).toEqual(AMOUNT);
      });

      it('should canonicalize recipient contract address (zero out inactive left side)', async () => {
        const nonCanonical = {
          is_left: false,
          left: new Uint8Array(32).fill(1),
          right: RECIPIENT_CONTRACT.right,
        };

        await token._unsafeUncheckedTransfer(
          OWNER.either,
          nonCanonical,
          AMOUNT,
        );
        expect(await token.balanceOf(RECIPIENT_CONTRACT)).toEqual(AMOUNT);
        expect(await token.balanceOf(OWNER.either)).toEqual(0n);
      });

      it('should canonicalize fromAddress (zero out inactive right side)', async () => {
        const nonCanonical = {
          is_left: true,
          left: OWNER.accountId,
          right: utils.encodeToAddress('JUNK_DATA'),
        };

        await token._unsafeUncheckedTransfer(
          nonCanonical,
          RECIPIENT.either,
          AMOUNT,
        );
        expect(await token.balanceOf(OWNER.either)).toEqual(0n);
        expect(await token.balanceOf(RECIPIENT.either)).toEqual(AMOUNT);
      });
    });

    describe('_mint', () => {
      it('should mint and update supply', async () => {
        expect(await token.totalSupply()).toEqual(0n);

        await token._mint(RECIPIENT.either, AMOUNT);
        expect(await token.totalSupply()).toEqual(AMOUNT);
        expect(await token.balanceOf(RECIPIENT.either)).toEqual(AMOUNT);
      });

      it('should catch mint overflow', async () => {
        await token._mint(RECIPIENT.either, MAX_UINT128);

        await expect(token._mint(RECIPIENT.either, 1n)).rejects.toThrow(
          'FungibleToken: arithmetic overflow',
        );
      });

      it('should not mint to zero (accountId)', async () => {
        await expect(token._mint(ZERO_ACCOUNT, AMOUNT)).rejects.toThrow(
          'FungibleToken: invalid receiver',
        );
      });

      it('should not mint to zero (contract)', async () => {
        // caught by unsafe transfer guard first
        await expect(token._mint(ZERO_CONTRACT, AMOUNT)).rejects.toThrow(
          'FungibleToken: unsafe transfer',
        );
      });

      it('should allow mint of 0 tokens', async () => {
        await token._mint(OWNER.either, 0n);
        expect(await token.totalSupply()).toEqual(0n);
        expect(await token.balanceOf(OWNER.either)).toEqual(0n);
      });

      it('should fail when minting to a contract', async () => {
        await expect(token._mint(OWNER_CONTRACT, AMOUNT)).rejects.toThrow(
          'FungibleToken: unsafe transfer',
        );
      });
    });

    describe('_unsafeMint', () => {
      describe.each(
        recipientTypes,
      )('when the recipient is a %s', (_, recipient) => {
        it('should mint and update supply', async () => {
          expect(await token.totalSupply()).toEqual(0n);

          await token._unsafeMint(recipient, AMOUNT);
          expect(await token.totalSupply()).toEqual(AMOUNT);
          expect(await token.balanceOf(recipient)).toEqual(AMOUNT);
        });

        it('should catch mint overflow', async () => {
          await token._unsafeMint(recipient, MAX_UINT128);

          await expect(token._unsafeMint(recipient, 1n)).rejects.toThrow(
            'FungibleToken: arithmetic overflow',
          );
        });

        it('should allow mint of 0 tokens', async () => {
          await token._unsafeMint(recipient, 0n);
          expect(await token.totalSupply()).toEqual(0n);
          expect(await token.balanceOf(recipient)).toEqual(0n);
        });
      });

      it('should not mint to zero (accountId)', async () => {
        await expect(token._unsafeMint(ZERO_ACCOUNT, AMOUNT)).rejects.toThrow(
          'FungibleToken: invalid receiver',
        );
      });

      it('should not mint to zero (contract)', async () => {
        await expect(token._unsafeMint(ZERO_CONTRACT, AMOUNT)).rejects.toThrow(
          'FungibleToken: invalid receiver',
        );
      });

      it('should canonicalize sender (zero out inactive right side)', async () => {
        const nonCanonical = {
          is_left: true,
          left: OWNER.accountId,
          right: utils.encodeToAddress('JUNK_DATA'),
        };

        await token._unsafeMint(nonCanonical, AMOUNT);
        expect(await token.balanceOf(OWNER.either)).toEqual(AMOUNT);
      });
    });

    describe('_burn', () => {
      beforeEach(async () => {
        await token._mint(OWNER.either, AMOUNT);
      });

      it('should burn tokens', async () => {
        await token._burn(OWNER.either, 1n);

        const afterBurn = AMOUNT - 1n;
        expect(await token.balanceOf(OWNER.either)).toEqual(afterBurn);
        expect(await token.totalSupply()).toEqual(afterBurn);
      });

      it('should throw when burning from zero (accountId)', async () => {
        await expect(token._burn(ZERO_ACCOUNT, AMOUNT)).rejects.toThrow(
          'FungibleToken: invalid sender',
        );
      });

      it('should throw when burning from zero (contract)', async () => {
        await expect(token._burn(ZERO_CONTRACT, AMOUNT)).rejects.toThrow(
          'FungibleToken: invalid sender',
        );
      });

      it('should throw when burn amount is greater than balance', async () => {
        await expect(token._burn(OWNER.either, AMOUNT + 1n)).rejects.toThrow(
          'FungibleToken: insufficient balance',
        );
      });

      it('should allow burn of 0 tokens', async () => {
        await token._burn(OWNER.either, 0n);
        expect(await token.totalSupply()).toEqual(AMOUNT);
        expect(await token.balanceOf(OWNER.either)).toEqual(AMOUNT);
      });

      it('should burn with non-canonical account (left)', async () => {
        const nonCanonical = {
          is_left: true,
          left: OWNER.accountId,
          right: utils.encodeToAddress('JUNK_DATA'),
        };

        await token._burn(nonCanonical, 1n);
        expect(await token.balanceOf(OWNER.either)).toEqual(AMOUNT - 1n);
        expect(await token.totalSupply()).toEqual(AMOUNT - 1n);
      });
    });

    describe('_approve', () => {
      beforeEach(async () => {
        expect(await token.allowance(OWNER.either, SPENDER.either)).toEqual(0n);
      });

      it('should approve and update allowance', async () => {
        await token._approve(OWNER.either, SPENDER.either, AMOUNT);
        expect(await token.allowance(OWNER.either, SPENDER.either)).toEqual(
          AMOUNT,
        );
      });

      it('should approve and update allowance for multiple spenders', async () => {
        await token._approve(OWNER.either, SPENDER.either, AMOUNT);
        expect(await token.allowance(OWNER.either, SPENDER.either)).toEqual(
          AMOUNT,
        );

        await token._approve(OWNER.either, OTHER.either, AMOUNT);
        expect(await token.allowance(OWNER.either, OTHER.either)).toEqual(
          AMOUNT,
        );

        expect(await token.allowance(OWNER.either, RECIPIENT.either)).toEqual(
          0n,
        );
      });

      it('should fail when approve from zero (accountId)', async () => {
        await expect(
          token._approve(ZERO_ACCOUNT, SPENDER.either, AMOUNT),
        ).rejects.toThrow('FungibleToken: invalid owner');
      });

      it('should fail when approve from zero (contract)', async () => {
        await expect(
          token._approve(ZERO_CONTRACT, SPENDER.either, AMOUNT),
        ).rejects.toThrow('FungibleToken: invalid owner');
      });

      it('should fail when approve to zero (accountId)', async () => {
        await expect(
          token._approve(OWNER.either, ZERO_ACCOUNT, AMOUNT),
        ).rejects.toThrow('FungibleToken: invalid spender');
      });

      it('should fail when approve to zero (contract)', async () => {
        await expect(
          token._approve(OWNER.either, ZERO_CONTRACT, AMOUNT),
        ).rejects.toThrow('FungibleToken: invalid spender');
      });

      it('should allow approve of 0 tokens', async () => {
        await token._approve(OWNER.either, SPENDER.either, 0n);
        expect(await token.allowance(OWNER.either, SPENDER.either)).toEqual(0n);
      });

      it('should canonicalize owner in allowance (zero out inactive right side)', async () => {
        const nonCanonicalOwner = {
          is_left: true,
          left: OWNER.accountId,
          right: utils.encodeToAddress('JUNK_DATA'),
        };

        await token._approve(nonCanonicalOwner, SPENDER.either, AMOUNT);
        expect(await token.allowance(OWNER.either, SPENDER.either)).toEqual(
          AMOUNT,
        );
      });

      it('should canonicalize spender in allowance (zero out inactive right side)', async () => {
        const nonCanonicalSpender = {
          is_left: true,
          left: SPENDER.accountId,
          right: utils.encodeToAddress('JUNK_DATA'),
        };

        await token._approve(OWNER.either, nonCanonicalSpender, AMOUNT);
        expect(await token.allowance(OWNER.either, SPENDER.either)).toEqual(
          AMOUNT,
        );
      });

      it('should canonicalize contract address owner (zero out inactive left side)', async () => {
        const nonCanonicalOwner = {
          is_left: false,
          left: new Uint8Array(32).fill(1),
          right: OWNER_CONTRACT.right,
        };

        await token._approve(nonCanonicalOwner, SPENDER.either, AMOUNT);
        expect(await token.allowance(OWNER_CONTRACT, SPENDER.either)).toEqual(
          AMOUNT,
        );
      });
    });

    describe('_spendAllowance', () => {
      beforeEach(async () => {
        await token._mint(OWNER.either, AMOUNT);
      });

      it('should update allowance when not unlimited', async () => {
        await token._approve(OWNER.either, SPENDER.either, MAX_UINT128 - 1n);
        await token._spendAllowance(OWNER.either, SPENDER.either, AMOUNT);
        expect(await token.allowance(OWNER.either, SPENDER.either)).toEqual(
          MAX_UINT128 - 1n - AMOUNT,
        );
      });

      it('should not update allowance when unlimited', async () => {
        await token._approve(OWNER.either, SPENDER.either, MAX_UINT128);
        await token._spendAllowance(
          OWNER.either,
          SPENDER.either,
          MAX_UINT128 - 1n,
        );
        expect(await token.allowance(OWNER.either, SPENDER.either)).toEqual(
          MAX_UINT128,
        );
      });

      it('should fail when owner allowance is not initialized', async () => {
        await expect(
          token._spendAllowance(OTHER.either, SPENDER.either, AMOUNT),
        ).rejects.toThrow('FungibleToken: insufficient allowance');
      });

      it('should fail when spender is not initialized', async () => {
        await token._approve(OWNER.either, SPENDER.either, AMOUNT);
        await expect(
          token._spendAllowance(OWNER.either, OTHER.either, AMOUNT),
        ).rejects.toThrow('FungibleToken: insufficient allowance');
      });

      it('should fail when spender has insufficient allowance', async () => {
        await token._approve(OWNER.either, SPENDER.either, AMOUNT);
        await expect(
          token._spendAllowance(OWNER.either, SPENDER.either, AMOUNT + 1n),
        ).rejects.toThrow('FungibleToken: insufficient allowance');
      });

      it('should allow a zero-value spend without a pre-existing allowance', async () => {
        // A missing entry is treated as zero and a zero-value spend is a no-op,
        // so this must not revert and must not create an entry.
        await token._spendAllowance(OWNER.either, OTHER.either, 0n);
        expect(await token.allowance(OWNER.either, OTHER.either)).toEqual(0n);
      });

      it('should leave an existing allowance unchanged on a zero-value spend', async () => {
        await token._approve(OWNER.either, SPENDER.either, AMOUNT);
        await token._spendAllowance(OWNER.either, SPENDER.either, 0n);
        expect(await token.allowance(OWNER.either, SPENDER.either)).toEqual(
          AMOUNT,
        );
      });

      it('should canonicalize when spending allowance', async () => {
        await token._approve(OWNER.either, SPENDER.either, AMOUNT);

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

        await token._spendAllowance(
          nonCanonicalOwner,
          nonCanonicalSpender,
          AMOUNT,
        );
        expect(await token.allowance(OWNER.either, SPENDER.either)).toEqual(0n);
      });
    });

    describe('Multiple Operations', () => {
      it('should handle mint → transfer → burn sequence', async () => {
        await token._mint(OWNER.either, AMOUNT);
        expect(await token.totalSupply()).toEqual(AMOUNT);
        expect(await token.balanceOf(OWNER.either)).toEqual(AMOUNT);

        await token.privateState.injectSecretKey(OWNER.secretKey);
        await token.transfer(RECIPIENT.either, AMOUNT - 1n);
        expect(await token.balanceOf(OWNER.either)).toEqual(1n);
        expect(await token.balanceOf(RECIPIENT.either)).toEqual(AMOUNT - 1n);

        await token._burn(OWNER.either, 1n);
        expect(await token.totalSupply()).toEqual(AMOUNT - 1n);
        expect(await token.balanceOf(OWNER.either)).toEqual(0n);
      });
    });
  });

  describe('simulator wiring', () => {
    it('should expose an empty public ledger via getPublicState', async () => {
      const sim = await FungibleTokenSimulator.create(
        NAME,
        SYMBOL,
        DECIMALS,
        INIT,
      );

      expect(await sim.getPublicState()).toStrictEqual({});
    });
  });

  describe('privateState helpers', () => {
    describe('getCurrentSecretKey', () => {
      it('should return the injected secret key', async () => {
        const sim = await FungibleTokenSimulator.create(
          NAME,
          SYMBOL,
          DECIMALS,
          INIT,
        );
        await sim.privateState.injectSecretKey(OWNER.secretKey);

        expect(await sim.privateState.getCurrentSecretKey()).toEqual(
          OWNER.secretKey,
        );
      });

      it('should throw when the secret key is undefined', async () => {
        const sim = await FungibleTokenSimulator.create(
          NAME,
          SYMBOL,
          DECIMALS,
          INIT,
          {
            privateState: { secretKey: undefined as unknown as Uint8Array },
          },
        );

        await expect(sim.privateState.getCurrentSecretKey()).rejects.toThrow(
          'Missing secret key',
        );
      });
    });
  });
});
