import {
  CompactTypeBytes,
  CompactTypeVector,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import type { Maybe } from '../../../artifacts/MockMultiToken/contract/index.js';
import { MultiTokenSimulator } from './simulators/MultiTokenSimulator.js';

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

const nonCanonicalLeft = (accountId: Uint8Array) => ({
  is_left: true as const,
  left: accountId,
  right: utils.encodeToAddress('JUNK_DATA'),
});

const nonCanonicalRight = (
  address: ReturnType<typeof utils.encodeToAddress>,
) => ({
  is_left: false as const,
  left: new Uint8Array(32).fill(1),
  right: address,
});

// Users
const OWNER = makeUser('OWNER');
const SPENDER = makeUser('SPENDER');
const RECIPIENT = makeUser('RECIPIENT');
const OTHER = makeUser('OTHER');
const UNAUTHORIZED = makeUser('UNAUTHORIZED');

// Contract Addresses
const OWNER_CONTRACT = eitherContract('OWNER_CONTRACT');
const RECIPIENT_CONTRACT = eitherContract('RECIPIENT_CONTRACT');

// Zero Values
const ZERO_ACCOUNT = eitherAccountId(zeroBytes);
const ZERO_CONTRACT = {
  is_left: false,
  left: zeroBytes,
  right: { bytes: zeroBytes },
};

// URIs
const NO_STRING = '';
const URI = 'https://uri.com/mock_v1';
const NEW_URI = 'https://uri.com/mock_v2';

// Amounts
const AMOUNT: bigint = BigInt(250);
const AMOUNT2: bigint = BigInt(9999);
const MAX_UINT128 = BigInt(2 ** 128) - BigInt(1);

// IDs
const TOKEN_ID: bigint = BigInt(1);
const TOKEN_ID2: bigint = BigInt(22);
const NONEXISTENT_ID: bigint = BigInt(987654321);

// Init
const initWithURI: Maybe<string> = {
  is_some: true,
  value: URI,
};

const initWithEmptyURI: Maybe<string> = {
  is_some: true,
  value: '',
};

const badInit: Maybe<string> = {
  is_some: false,
  value: '',
};

// Types
const recipientTypes = [
  ['contract', RECIPIENT_CONTRACT],
  ['accountId', RECIPIENT.either],
] as const;

const callerTypes = [
  ['owner', OWNER],
  ['spender', SPENDER],
] as const;

let token: MultiTokenSimulator;

describe('MultiToken', () => {
  describe('before initialization', () => {
    it('should initialize metadata', async () => {
      token = await MultiTokenSimulator.create(initWithURI);

      expect(await token.uri(TOKEN_ID)).toEqual(URI);
    });

    it('should initialize empty metadata', async () => {
      token = await MultiTokenSimulator.create(initWithEmptyURI);

      expect(await token.uri(TOKEN_ID)).toEqual(NO_STRING);
    });

    it('should not be able to re-initialize', async () => {
      token = await MultiTokenSimulator.create(initWithEmptyURI);

      await expect(token.initialize(URI)).rejects.toThrow(
        'MultiToken: contract already initialized',
      );
    });
  });

  describe('when not initialized correctly', () => {
    beforeEach(async () => {
      token = await MultiTokenSimulator.create(badInit);
    });

    type FailingCircuits = [method: keyof MultiTokenSimulator, args: unknown[]];
    const transferArgs = [OWNER.either, RECIPIENT.either, TOKEN_ID, AMOUNT];
    const circuitsToFail: FailingCircuits[] = [
      ['uri', [TOKEN_ID]],
      ['balanceOf', [OWNER.either, TOKEN_ID]],
      ['setApprovalForAll', [OWNER.either, true]],
      ['isApprovedForAll', [OWNER.either, SPENDER.either]],
      ['transferFrom', transferArgs],
      ['_unsafeTransferFrom', transferArgs],
      ['_transfer', transferArgs],
      ['_unsafeTransfer', transferArgs],
      ['_setURI', [URI]],
      ['_mint', [OWNER.either, TOKEN_ID, AMOUNT]],
      ['_unsafeMint', [OWNER.either, TOKEN_ID, AMOUNT]],
      ['_burn', [OWNER.either, TOKEN_ID, AMOUNT]],
      ['_setApprovalForAll', [OWNER.either, SPENDER.either, true]],
    ];

    it.each(circuitsToFail)('%s should fail', async (circuitName, args) => {
      await expect(
        (token[circuitName] as (...args: unknown[]) => Promise<unknown>)(
          ...args,
        ),
      ).rejects.toThrow('MultiToken: contract not initialized');
    });

    it('should allow initialization post deployment', async () => {
      await token.initialize(URI);

      expect(await token.balanceOf(OWNER.either, TOKEN_ID)).toBe(0n);
    });
  });

  describe('when initialized correctly', () => {
    beforeEach(async () => {
      token = await MultiTokenSimulator.create(initWithURI);
    });

    describe('balanceOf', () => {
      const ownerTypes = [
        ['contract', OWNER_CONTRACT],
        ['accountId', OWNER.either],
      ] as const;

      describe.each(ownerTypes)('when the owner is a %s', (_, owner) => {
        it('should return zero when requested account has no balance', async () => {
          expect(await token.balanceOf(owner, TOKEN_ID)).toEqual(0n);
          expect(await token.balanceOf(owner, TOKEN_ID2)).toEqual(0n);
        });

        it('should return balance when requested account has tokens', async () => {
          await token._unsafeMint(owner, TOKEN_ID, AMOUNT);
          expect(await token.balanceOf(owner, TOKEN_ID)).toEqual(AMOUNT);

          await token._unsafeMint(owner, TOKEN_ID2, AMOUNT2);
          expect(await token.balanceOf(owner, TOKEN_ID2)).toEqual(AMOUNT2);
        });

        it('should handle token ID 0', async () => {
          const ZERO_ID = 0n;
          await token._unsafeMint(owner, ZERO_ID, AMOUNT);
          expect(await token.balanceOf(owner, ZERO_ID)).toEqual(AMOUNT);
        });

        it('should handle MAX_UINT128 token ID', async () => {
          const MAX_ID = MAX_UINT128;
          await token._unsafeMint(owner, MAX_ID, AMOUNT);
          expect(await token.balanceOf(owner, MAX_ID)).toEqual(AMOUNT);
        });
      });

      it('should return correct balance with non-canonical lookup (left)', async () => {
        await token._unsafeMint(OWNER.either, TOKEN_ID, AMOUNT);
        const nonCanonical = nonCanonicalLeft(OWNER.accountId);

        expect(await token.balanceOf(nonCanonical, TOKEN_ID)).toEqual(AMOUNT);
      });

      it('should return correct balance with non-canonical lookup (right)', async () => {
        await token._unsafeMint(OWNER_CONTRACT, TOKEN_ID, AMOUNT);
        const nonCanonical = nonCanonicalRight(OWNER_CONTRACT.right);

        expect(await token.balanceOf(nonCanonical, TOKEN_ID)).toEqual(AMOUNT);
      });
    });

    describe('isApprovedForAll', () => {
      it('should return false when not set', async () => {
        expect(await token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
          false,
        );
      });

      it('should handle approving owner as operator', async () => {
        await token.privateState.injectSecretKey(OWNER.secretKey);
        await token.setApprovalForAll(OWNER.either, true);
        expect(await token.isApprovedForAll(OWNER.either, OWNER.either)).toBe(
          true,
        );
      });

      it('should handle multiple approvals of same operator', async () => {
        await token.privateState.injectSecretKey(OWNER.secretKey);
        await token.setApprovalForAll(SPENDER.either, true);
        await token.setApprovalForAll(SPENDER.either, true);
        expect(await token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
          true,
        );
      });

      it('should handle revoking non-existent approval', async () => {
        await token.privateState.injectSecretKey(OWNER.secretKey);
        await token.setApprovalForAll(SPENDER.either, false);
        expect(await token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
          false,
        );
      });

      it('should return correct result with non-canonical owner lookup', async () => {
        await token._setApprovalForAll(OWNER.either, SPENDER.either, true);
        const nonCanonical = nonCanonicalLeft(OWNER.accountId);

        expect(await token.isApprovedForAll(nonCanonical, SPENDER.either)).toBe(
          true,
        );
      });

      it('should return correct result with non-canonical operator lookup', async () => {
        await token._setApprovalForAll(OWNER.either, SPENDER.either, true);
        const nonCanonical = nonCanonicalLeft(SPENDER.accountId);

        expect(await token.isApprovedForAll(OWNER.either, nonCanonical)).toBe(
          true,
        );
      });
    });

    describe('setApprovalForAll', () => {
      it('should return false when set to false', async () => {
        await token.privateState.injectSecretKey(OWNER.secretKey);
        await token.setApprovalForAll(SPENDER.either, false);
        expect(await token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
          false,
        );
      });

      it('should fail when attempting to approve zero address as an operator', async () => {
        await token.privateState.injectSecretKey(OWNER.secretKey);
        await expect(
          token.setApprovalForAll(ZERO_ACCOUNT, true),
        ).rejects.toThrow('MultiToken: invalid operator');
      });

      describe('when spender is approved as an operator', () => {
        beforeEach(async () => {
          await token.privateState.injectSecretKey(OWNER.secretKey);
          await token.setApprovalForAll(SPENDER.either, true);
        });

        it('should return true when set to true', async () => {
          expect(
            await token.isApprovedForAll(OWNER.either, SPENDER.either),
          ).toBe(true);
        });

        it('should unset → set → unset operator', async () => {
          await token.setApprovalForAll(SPENDER.either, false);
          expect(
            await token.isApprovedForAll(OWNER.either, SPENDER.either),
          ).toBe(false);

          await token.setApprovalForAll(SPENDER.either, true);
          expect(
            await token.isApprovedForAll(OWNER.either, SPENDER.either),
          ).toBe(true);

          await token.setApprovalForAll(SPENDER.either, false);
          expect(
            await token.isApprovedForAll(OWNER.either, SPENDER.either),
          ).toBe(false);
        });
      });
    });

    describe('transferFrom', () => {
      beforeEach(async () => {
        await token._mint(OWNER.either, TOKEN_ID, AMOUNT);

        expect(await token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(AMOUNT);
        expect(await token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(0n);
      });

      describe.each(callerTypes)('when the caller is the %s', (_, caller) => {
        beforeEach(async () => {
          if (caller === SPENDER) {
            await token._setApprovalForAll(OWNER.either, SPENDER.either, true);
          }
          await token.privateState.injectSecretKey(caller.secretKey);
        });

        it('should transfer whole', async () => {
          await token.transferFrom(
            OWNER.either,
            RECIPIENT.either,
            TOKEN_ID,
            AMOUNT,
          );

          expect(await token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(0n);
          expect(await token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(
            AMOUNT,
          );
        });

        it('should transfer partial', async () => {
          const partialAmt = AMOUNT - 1n;
          await token.transferFrom(
            OWNER.either,
            RECIPIENT.either,
            TOKEN_ID,
            partialAmt,
          );

          expect(await token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(
            AMOUNT - partialAmt,
          );
          expect(await token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(
            partialAmt,
          );
        });

        it('should allow transfer of 0 tokens', async () => {
          await token.transferFrom(
            OWNER.either,
            RECIPIENT.either,
            TOKEN_ID,
            0n,
          );

          expect(await token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(AMOUNT);
          expect(await token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(0n);
        });

        it('should allow transfer of 0 tokens for an uninitialized id', async () => {
          // A zero-value update must not revert on an uninitialized id.
          await token.transferFrom(
            OWNER.either,
            RECIPIENT.either,
            NONEXISTENT_ID,
            0n,
          );

          expect(await token.balanceOf(OWNER.either, NONEXISTENT_ID)).toEqual(
            0n,
          );
          expect(
            await token.balanceOf(RECIPIENT.either, NONEXISTENT_ID),
          ).toEqual(0n);
        });

        it('should handle self-transfer', async () => {
          await token.transferFrom(
            OWNER.either,
            OWNER.either,
            TOKEN_ID,
            AMOUNT,
          );
          expect(await token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(AMOUNT);
        });

        it('should handle MAX_UINT128 transfer amount', async () => {
          await token._mint(OWNER.either, TOKEN_ID, MAX_UINT128 - AMOUNT);

          await token.transferFrom(
            OWNER.either,
            RECIPIENT.either,
            TOKEN_ID,
            MAX_UINT128,
          );
          expect(await token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(
            MAX_UINT128,
          );
        });

        it('should handle rapid state changes', async () => {
          await token.privateState.injectSecretKey(OWNER.secretKey);
          await token.setApprovalForAll(SPENDER.either, true);

          await token.privateState.injectSecretKey(SPENDER.secretKey);
          await token.transferFrom(
            OWNER.either,
            RECIPIENT.either,
            TOKEN_ID,
            AMOUNT,
          );
          expect(await token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(
            AMOUNT,
          );

          await token.privateState.injectSecretKey(OWNER.secretKey);
          await token.setApprovalForAll(SPENDER.either, false);
          expect(
            await token.isApprovedForAll(OWNER.either, SPENDER.either),
          ).toBe(false);

          await token.setApprovalForAll(SPENDER.either, true);
          expect(
            await token.isApprovedForAll(OWNER.either, SPENDER.either),
          ).toBe(true);
        });

        it('should fail with insufficient balance', async () => {
          await expect(
            token.transferFrom(
              OWNER.either,
              RECIPIENT.either,
              TOKEN_ID,
              AMOUNT + 1n,
            ),
          ).rejects.toThrow('MultiToken: insufficient balance');
        });

        it('should fail with nonexistent id', async () => {
          await expect(
            token.transferFrom(
              OWNER.either,
              RECIPIENT.either,
              NONEXISTENT_ID,
              AMOUNT,
            ),
          ).rejects.toThrow('MultiToken: insufficient balance');
        });

        it('should fail with transfer from zero', async () => {
          await expect(
            token.transferFrom(
              ZERO_ACCOUNT,
              RECIPIENT.either,
              TOKEN_ID,
              AMOUNT,
            ),
          ).rejects.toThrow('MultiToken: unauthorized operator');
        });

        it('should fail with transfer to zero (id)', async () => {
          await expect(
            token.transferFrom(OWNER.either, ZERO_ACCOUNT, TOKEN_ID, AMOUNT),
          ).rejects.toThrow('MultiToken: invalid receiver');
        });

        it('should fail with transfer to zero (contract)', async () => {
          await expect(
            token.transferFrom(OWNER.either, ZERO_CONTRACT, TOKEN_ID, AMOUNT),
          ).rejects.toThrow('MultiToken: unsafe transfer');
        });

        it('should fail when transferring to a contract address', async () => {
          await expect(
            token.transferFrom(
              OWNER.either,
              RECIPIENT_CONTRACT,
              TOKEN_ID,
              AMOUNT,
            ),
          ).rejects.toThrow('MultiToken: unsafe transfer');
        });
      });

      it('should handle concurrent operations on same token ID', async () => {
        await token._mint(OWNER.either, TOKEN_ID, AMOUNT * 2n);

        await token.privateState.injectSecretKey(OWNER.secretKey);
        await token.setApprovalForAll(SPENDER.either, true);
        await token.setApprovalForAll(OTHER.either, true);

        // First spender transfers half
        await token.privateState.injectSecretKey(SPENDER.secretKey);
        await token.transferFrom(
          OWNER.either,
          RECIPIENT.either,
          TOKEN_ID,
          AMOUNT,
        );
        expect(await token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(
          AMOUNT,
        );

        // Second spender transfers remaining
        await token.privateState.injectSecretKey(OTHER.secretKey);
        await token.transferFrom(
          OWNER.either,
          RECIPIENT.either,
          TOKEN_ID,
          AMOUNT,
        );
        expect(await token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(
          AMOUNT * 2n,
        );
      });

      it('should handle non-canonical fromAddress (id)', async () => {
        await token.privateState.injectSecretKey(OWNER.secretKey);

        const nonCanonical = nonCanonicalLeft(OWNER.accountId);
        await token.transferFrom(
          nonCanonical,
          RECIPIENT.either,
          TOKEN_ID,
          AMOUNT,
        );

        expect(await token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(
          AMOUNT,
        );
      });

      it('should handle non-canonical fromAddress (contract address)', async () => {
        await token._unsafeMint(OWNER_CONTRACT, TOKEN_ID, AMOUNT);
        await token._setApprovalForAll(OWNER_CONTRACT, OWNER.either, true);

        await token.privateState.injectSecretKey(OWNER.secretKey);

        const nonCanonical = nonCanonicalRight(OWNER_CONTRACT.right);
        await token.transferFrom(
          nonCanonical,
          RECIPIENT.either,
          TOKEN_ID,
          AMOUNT,
        );

        expect(await token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(
          AMOUNT,
        );
      });

      describe('when the caller is unauthorized', () => {
        beforeEach(async () => {
          await token.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
        });

        it('should fail when transfer whole', async () => {
          await expect(
            token.transferFrom(
              OWNER.either,
              RECIPIENT.either,
              TOKEN_ID,
              AMOUNT,
            ),
          ).rejects.toThrow('MultiToken: unauthorized operator');
        });

        it('should fail when transfer partial', async () => {
          const partialAmt = AMOUNT - 1n;
          await expect(
            token.transferFrom(
              OWNER.either,
              RECIPIENT.either,
              TOKEN_ID,
              partialAmt,
            ),
          ).rejects.toThrow('MultiToken: unauthorized operator');
        });

        it('should fail when transfer zero', async () => {
          await expect(
            token.transferFrom(OWNER.either, RECIPIENT.either, TOKEN_ID, 0n),
          ).rejects.toThrow('MultiToken: unauthorized operator');
        });

        it('should fail with insufficient balance', async () => {
          await expect(
            token.transferFrom(
              OWNER.either,
              RECIPIENT.either,
              TOKEN_ID,
              AMOUNT + 1n,
            ),
          ).rejects.toThrow('MultiToken: unauthorized operator');
        });

        it('should fail with nonexistent id', async () => {
          await expect(
            token.transferFrom(
              OWNER.either,
              RECIPIENT.either,
              NONEXISTENT_ID,
              AMOUNT,
            ),
          ).rejects.toThrow('MultiToken: unauthorized operator');
        });

        it('should fail with transfer from zero', async () => {
          await expect(
            token.transferFrom(
              ZERO_ACCOUNT,
              RECIPIENT.either,
              TOKEN_ID,
              AMOUNT,
            ),
          ).rejects.toThrow('MultiToken: unauthorized operator');
        });
      });
    });

    describe('_unsafeTransferFrom', () => {
      beforeEach(async () => {
        await token._mint(OWNER.either, TOKEN_ID, AMOUNT);
      });

      describe.each(callerTypes)('when the caller is the %s', (_, caller) => {
        beforeEach(async () => {
          if (caller === SPENDER) {
            await token._setApprovalForAll(OWNER.either, SPENDER.either, true);
          }
          await token.privateState.injectSecretKey(caller.secretKey);
        });

        describe.each(
          recipientTypes,
        )('when the recipient is a %s', (_, recipient) => {
          it('should transfer whole', async () => {
            await token._unsafeTransferFrom(
              OWNER.either,
              recipient,
              TOKEN_ID,
              AMOUNT,
            );

            expect(await token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(0n);
            expect(await token.balanceOf(recipient, TOKEN_ID)).toEqual(AMOUNT);
          });

          it('should transfer partial', async () => {
            const partialAmt = AMOUNT - 1n;
            await token._unsafeTransferFrom(
              OWNER.either,
              recipient,
              TOKEN_ID,
              partialAmt,
            );

            expect(await token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(
              AMOUNT - partialAmt,
            );
            expect(await token.balanceOf(recipient, TOKEN_ID)).toEqual(
              partialAmt,
            );
          });

          it('should allow transfer of 0 tokens', async () => {
            await token._unsafeTransferFrom(
              OWNER.either,
              recipient,
              TOKEN_ID,
              0n,
            );

            expect(await token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(
              AMOUNT,
            );
            expect(await token.balanceOf(recipient, TOKEN_ID)).toEqual(0n);
          });

          it('should handle self-transfer', async () => {
            await token._unsafeTransferFrom(
              OWNER.either,
              OWNER.either,
              TOKEN_ID,
              AMOUNT,
            );
            expect(await token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(
              AMOUNT,
            );
          });

          it('should handle MAX_UINT128 transfer amount', async () => {
            await token._mint(OWNER.either, TOKEN_ID, MAX_UINT128 - AMOUNT);

            await token._unsafeTransferFrom(
              OWNER.either,
              recipient,
              TOKEN_ID,
              MAX_UINT128,
            );
            expect(await token.balanceOf(recipient, TOKEN_ID)).toEqual(
              MAX_UINT128,
            );
          });

          it('should handle rapid state changes', async () => {
            await token.privateState.injectSecretKey(OWNER.secretKey);
            await token.setApprovalForAll(SPENDER.either, true);

            await token._unsafeTransferFrom(
              OWNER.either,
              recipient,
              TOKEN_ID,
              AMOUNT,
            );
            expect(await token.balanceOf(recipient, TOKEN_ID)).toEqual(AMOUNT);

            await token.setApprovalForAll(SPENDER.either, false);
            expect(
              await token.isApprovedForAll(OWNER.either, SPENDER.either),
            ).toBe(false);

            await token.setApprovalForAll(SPENDER.either, true);
            expect(
              await token.isApprovedForAll(OWNER.either, SPENDER.either),
            ).toBe(true);
          });

          it('should fail with insufficient balance', async () => {
            await expect(
              token._unsafeTransferFrom(
                OWNER.either,
                recipient,
                TOKEN_ID,
                AMOUNT + 1n,
              ),
            ).rejects.toThrow('MultiToken: insufficient balance');
          });

          it('should fail with nonexistent id', async () => {
            await expect(
              token._unsafeTransferFrom(
                OWNER.either,
                recipient,
                NONEXISTENT_ID,
                AMOUNT,
              ),
            ).rejects.toThrow('MultiToken: insufficient balance');
          });

          it('should fail with transfer from zero', async () => {
            await expect(
              token._unsafeTransferFrom(
                ZERO_ACCOUNT,
                recipient,
                TOKEN_ID,
                AMOUNT,
              ),
            ).rejects.toThrow('MultiToken: unauthorized operator');
          });
        });

        it('should fail with transfer to zero (id)', async () => {
          await expect(
            token._unsafeTransferFrom(
              OWNER.either,
              ZERO_ACCOUNT,
              TOKEN_ID,
              AMOUNT,
            ),
          ).rejects.toThrow('MultiToken: invalid receiver');
        });

        it('should fail with transfer to zero (contract)', async () => {
          await expect(
            token._unsafeTransferFrom(
              OWNER.either,
              ZERO_CONTRACT,
              TOKEN_ID,
              AMOUNT,
            ),
          ).rejects.toThrow('MultiToken: invalid receiver');
        });
      });

      it('should handle concurrent operations on same token ID', async () => {
        await token._mint(OWNER.either, TOKEN_ID, AMOUNT * 2n);

        await token.privateState.injectSecretKey(OWNER.secretKey);
        await token.setApprovalForAll(SPENDER.either, true);
        await token.setApprovalForAll(OTHER.either, true);

        // First spender transfers half
        await token.privateState.injectSecretKey(SPENDER.secretKey);
        await token._unsafeTransferFrom(
          OWNER.either,
          RECIPIENT.either,
          TOKEN_ID,
          AMOUNT,
        );
        expect(await token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(
          AMOUNT,
        );

        // Second spender transfers remaining
        await token.privateState.injectSecretKey(OTHER.secretKey);
        await token._unsafeTransferFrom(
          OWNER.either,
          RECIPIENT.either,
          TOKEN_ID,
          AMOUNT,
        );
        expect(await token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(
          AMOUNT * 2n,
        );
      });

      it('should handle non-canonical fromAddress (id)', async () => {
        const nonCanonical = nonCanonicalLeft(OWNER.accountId);

        await token.privateState.injectSecretKey(OWNER.secretKey);
        await token._unsafeTransferFrom(
          nonCanonical,
          RECIPIENT.either,
          TOKEN_ID,
          AMOUNT,
        );
        expect(await token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(
          AMOUNT,
        );
      });

      it('should handle non-canonical fromAddress (contract address)', async () => {
        // Mint to contract address to test the transfer of non-canonical `fromAddress`
        await token._unsafeMint(OWNER_CONTRACT, TOKEN_ID, AMOUNT);
        // Approve owner (id) to move OWNER_CONTRACT's token
        await token._setApprovalForAll(OWNER_CONTRACT, OWNER.either, true);

        await token.privateState.injectSecretKey(OWNER.secretKey);
        const nonCanonical = nonCanonicalRight(OWNER_CONTRACT.right);
        await token._unsafeTransferFrom(
          nonCanonical,
          RECIPIENT.either,
          TOKEN_ID,
          AMOUNT,
        );
        expect(await token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(
          AMOUNT,
        );
      });

      it('should canonicalize recipient (id)', async () => {
        await token.privateState.injectSecretKey(OWNER.secretKey);

        const nonCanonical = nonCanonicalLeft(RECIPIENT.accountId);
        await token._unsafeTransferFrom(
          OWNER.either,
          nonCanonical,
          TOKEN_ID,
          AMOUNT,
        );
        expect(await token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(
          AMOUNT,
        );
      });

      it('should canonicalize recipient (contract address)', async () => {
        await token.privateState.injectSecretKey(OWNER.secretKey);

        const nonCanonical = nonCanonicalRight(RECIPIENT_CONTRACT.right);
        await token._unsafeTransferFrom(
          OWNER.either,
          nonCanonical,
          TOKEN_ID,
          AMOUNT,
        );
        expect(await token.balanceOf(RECIPIENT_CONTRACT, TOKEN_ID)).toEqual(
          AMOUNT,
        );
      });

      describe('when the caller is unauthorized', () => {
        beforeEach(async () => {
          await token.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
        });

        describe.each(
          recipientTypes,
        )('when recipient is %s', (_, recipient) => {
          it('should fail when transfer whole', async () => {
            await expect(
              token._unsafeTransferFrom(
                OWNER.either,
                recipient,
                TOKEN_ID,
                AMOUNT,
              ),
            ).rejects.toThrow('MultiToken: unauthorized operator');
          });

          it('should fail when transfer partial', async () => {
            const partialAmt = AMOUNT - 1n;
            await expect(
              token._unsafeTransferFrom(
                OWNER.either,
                recipient,
                TOKEN_ID,
                partialAmt,
              ),
            ).rejects.toThrow('MultiToken: unauthorized operator');
          });

          it('should fail when transfer zero', async () => {
            await expect(
              token._unsafeTransferFrom(OWNER.either, recipient, TOKEN_ID, 0n),
            ).rejects.toThrow('MultiToken: unauthorized operator');
          });

          it('should fail with insufficient balance', async () => {
            await expect(
              token._unsafeTransferFrom(
                OWNER.either,
                recipient,
                TOKEN_ID,
                AMOUNT + 1n,
              ),
            ).rejects.toThrow('MultiToken: unauthorized operator');
          });

          it('should fail with nonexistent id', async () => {
            await expect(
              token._unsafeTransferFrom(
                OWNER.either,
                recipient,
                NONEXISTENT_ID,
                AMOUNT,
              ),
            ).rejects.toThrow('MultiToken: unauthorized operator');
          });

          it('should fail with transfer from zero', async () => {
            // With witness-based identity, the caller is H(sk) which is
            // always non-zero. Transferring from ZERO_ACCOUNT means
            // canonFrom != caller → isApprovedForAll(zeroAccount, caller) → false
            // → "unauthorized operator"
            await expect(
              token._unsafeTransferFrom(
                ZERO_ACCOUNT,
                recipient,
                TOKEN_ID,
                AMOUNT,
              ),
            ).rejects.toThrow('MultiToken: unauthorized operator');
          });
        });
      });
    });

    describe('_transfer', () => {
      beforeEach(async () => {
        await token._mint(OWNER.either, TOKEN_ID, AMOUNT);

        expect(await token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(AMOUNT);
        expect(await token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(0n);
      });

      it('should transfer whole', async () => {
        await token._transfer(OWNER.either, RECIPIENT.either, TOKEN_ID, AMOUNT);

        expect(await token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(0n);
        expect(await token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(
          AMOUNT,
        );
      });

      it('should transfer partial', async () => {
        const partialAmt = AMOUNT - 1n;
        await token._transfer(
          OWNER.either,
          RECIPIENT.either,
          TOKEN_ID,
          partialAmt,
        );

        expect(await token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(
          AMOUNT - partialAmt,
        );
        expect(await token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(
          partialAmt,
        );
      });

      it('should allow transfer of 0 tokens', async () => {
        await token._transfer(OWNER.either, RECIPIENT.either, TOKEN_ID, 0n);

        expect(await token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(AMOUNT);
        expect(await token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(0n);
      });

      it('should allow transfer of 0 tokens for an uninitialized id', async () => {
        // A zero-value update must not revert on an uninitialized id.
        await token._transfer(
          OWNER.either,
          RECIPIENT.either,
          NONEXISTENT_ID,
          0n,
        );

        expect(await token.balanceOf(OWNER.either, NONEXISTENT_ID)).toEqual(0n);
        expect(await token.balanceOf(RECIPIENT.either, NONEXISTENT_ID)).toEqual(
          0n,
        );
      });

      it('should fail with insufficient balance', async () => {
        await expect(
          token._transfer(
            OWNER.either,
            RECIPIENT.either,
            TOKEN_ID,
            AMOUNT + 1n,
          ),
        ).rejects.toThrow('MultiToken: insufficient balance');
      });

      it('should fail with nonexistent id', async () => {
        await expect(
          token._transfer(
            OWNER.either,
            RECIPIENT.either,
            NONEXISTENT_ID,
            AMOUNT,
          ),
        ).rejects.toThrow('MultiToken: insufficient balance');
      });

      it('should fail when transfer from 0', async () => {
        await expect(
          token._transfer(ZERO_ACCOUNT, RECIPIENT.either, TOKEN_ID, AMOUNT),
        ).rejects.toThrow('MultiToken: invalid sender');
      });

      it('should fail when transfer to 0', async () => {
        await expect(
          token._transfer(OWNER.either, ZERO_ACCOUNT, TOKEN_ID, AMOUNT),
        ).rejects.toThrow('MultiToken: invalid receiver');
      });

      it('should fail when transfer to contract address', async () => {
        await expect(
          token._transfer(OWNER.either, RECIPIENT_CONTRACT, TOKEN_ID, AMOUNT),
        ).rejects.toThrow('MultiToken: unsafe transfer');
      });

      it('should handle non-canonical fromAddress (id)', async () => {
        const nonCanonical = nonCanonicalLeft(OWNER.accountId);

        await token._transfer(nonCanonical, RECIPIENT.either, TOKEN_ID, AMOUNT);
        expect(await token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(0n);
        expect(await token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(
          AMOUNT,
        );
      });

      it('should handle non-canonical fromAddress (contract address)', async () => {
        await token._unsafeMint(OWNER_CONTRACT, TOKEN_ID, AMOUNT);

        const nonCanonical = nonCanonicalRight(OWNER_CONTRACT.right);
        await token._transfer(nonCanonical, RECIPIENT.either, TOKEN_ID, AMOUNT);

        expect(await token.balanceOf(OWNER_CONTRACT, TOKEN_ID)).toEqual(0n);
        expect(await token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(
          AMOUNT,
        );
      });
    });

    describe('_unsafeTransfer', () => {
      beforeEach(async () => {
        await token._mint(OWNER.either, TOKEN_ID, AMOUNT);

        expect(await token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(AMOUNT);
        expect(await token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(0n);
      });

      describe.each(
        recipientTypes,
      )('when the recipient is a %s', (_, recipient) => {
        it('should transfer whole', async () => {
          await token._unsafeTransfer(
            OWNER.either,
            recipient,
            TOKEN_ID,
            AMOUNT,
          );

          expect(await token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(0n);
          expect(await token.balanceOf(recipient, TOKEN_ID)).toEqual(AMOUNT);
        });

        it('should transfer partial', async () => {
          const partialAmt = AMOUNT - 1n;
          await token._unsafeTransfer(
            OWNER.either,
            recipient,
            TOKEN_ID,
            partialAmt,
          );

          expect(await token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(
            AMOUNT - partialAmt,
          );
          expect(await token.balanceOf(recipient, TOKEN_ID)).toEqual(
            partialAmt,
          );
        });

        it('should allow transfer of 0 tokens', async () => {
          await token._unsafeTransfer(OWNER.either, recipient, TOKEN_ID, 0n);

          expect(await token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(AMOUNT);
          expect(await token.balanceOf(recipient, TOKEN_ID)).toEqual(0n);
        });

        it('should fail with insufficient balance', async () => {
          await expect(
            token._unsafeTransfer(
              OWNER.either,
              recipient,
              TOKEN_ID,
              AMOUNT + 1n,
            ),
          ).rejects.toThrow('MultiToken: insufficient balance');
        });

        it('should fail with nonexistent id', async () => {
          await expect(
            token._unsafeTransfer(
              OWNER.either,
              recipient,
              NONEXISTENT_ID,
              AMOUNT,
            ),
          ).rejects.toThrow('MultiToken: insufficient balance');
        });

        it('should fail when transfer from 0 (id)', async () => {
          await expect(
            token._unsafeTransfer(ZERO_ACCOUNT, recipient, TOKEN_ID, AMOUNT),
          ).rejects.toThrow('MultiToken: invalid sender');
        });

        it('should fail when transfer from 0 (contract address)', async () => {
          await expect(
            token._unsafeTransfer(ZERO_CONTRACT, recipient, TOKEN_ID, AMOUNT),
          ).rejects.toThrow('MultiToken: invalid sender');
        });
      });

      it('should handle non-canonical fromAddress (id)', async () => {
        const nonCanonical = nonCanonicalLeft(OWNER.accountId);
        await token._unsafeTransfer(
          nonCanonical,
          RECIPIENT.either,
          TOKEN_ID,
          AMOUNT,
        );

        expect(await token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(0n);
        expect(await token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(
          AMOUNT,
        );
      });

      it('should handle non-canonical fromAddress (contract address)', async () => {
        // Mint to contract address to test the transfer of non-canonical `fromAddress`
        await token._unsafeMint(OWNER_CONTRACT, TOKEN_ID, AMOUNT);

        const nonCanonical = nonCanonicalRight(OWNER_CONTRACT.right);
        await token._unsafeTransfer(
          nonCanonical,
          RECIPIENT.either,
          TOKEN_ID,
          AMOUNT,
        );

        expect(await token.balanceOf(OWNER_CONTRACT, TOKEN_ID)).toEqual(0n);
        expect(await token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(
          AMOUNT,
        );
      });

      it('should handle non-canonical to (id)', async () => {
        const nonCanonical = nonCanonicalLeft(RECIPIENT.accountId);
        await token._unsafeTransfer(
          OWNER.either,
          nonCanonical,
          TOKEN_ID,
          AMOUNT,
        );

        expect(await token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(0n);
        expect(await token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(
          AMOUNT,
        );
      });

      it('should handle non-canonical to (contract address)', async () => {
        const nonCanonical = nonCanonicalRight(RECIPIENT_CONTRACT.right);
        await token._unsafeTransfer(
          OWNER.either,
          nonCanonical,
          TOKEN_ID,
          AMOUNT,
        );

        expect(await token.balanceOf(RECIPIENT_CONTRACT, TOKEN_ID)).toEqual(
          AMOUNT,
        );
      });

      it('should fail when transfer to 0 (id)', async () => {
        await expect(
          token._unsafeTransfer(OWNER.either, ZERO_ACCOUNT, TOKEN_ID, AMOUNT),
        ).rejects.toThrow('MultiToken: invalid receiver');
      });

      it('should fail when transfer to 0 (contract address)', async () => {
        await expect(
          token._unsafeTransfer(OWNER.either, ZERO_CONTRACT, TOKEN_ID, AMOUNT),
        ).rejects.toThrow('MultiToken: invalid receiver');
      });
    });

    describe('_setURI', () => {
      it('sets a new URI', async () => {
        await token._setURI(NEW_URI);

        expect(await token.uri(TOKEN_ID)).toEqual(NEW_URI);
        expect(await token.uri(TOKEN_ID2)).toEqual(NEW_URI);
      });

      it('sets an empty URI → newURI → empty URI → URI', async () => {
        const URIS = [NO_STRING, NEW_URI, NO_STRING, URI];

        for (let i = 0; i < URIS.length; i++) {
          await token._setURI(URIS[i]);

          expect(await token.uri(TOKEN_ID)).toEqual(URIS[i]);
          expect(await token.uri(TOKEN_ID2)).toEqual(URIS[i]);
        }
      });

      it('should handle long URI', async () => {
        const LONG_URI = `https://example.com/${'a'.repeat(1000)}`;
        await token._setURI(LONG_URI);
        expect(await token.uri(TOKEN_ID)).toEqual(LONG_URI);
      });

      it('should handle URI with special characters', async () => {
        const SPECIAL_URI = 'https://example.com/path?param=value#fragment';
        await token._setURI(SPECIAL_URI);
        expect(await token.uri(TOKEN_ID)).toEqual(SPECIAL_URI);
      });
    });

    describe('_mint', () => {
      it('should update balance when minting', async () => {
        await token._mint(RECIPIENT.either, TOKEN_ID, AMOUNT);
        expect(await token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(
          AMOUNT,
        );
      });

      it('should update balance with multiple mints', async () => {
        for (let i = 0; i < 3; i++) {
          await token._mint(RECIPIENT.either, TOKEN_ID, 1n);
        }

        expect(await token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(3n);
      });

      it('should fail when overflowing uint128', async () => {
        await token._mint(RECIPIENT.either, TOKEN_ID, MAX_UINT128);

        await expect(
          token._mint(RECIPIENT.either, TOKEN_ID, 1n),
        ).rejects.toThrow('MultiToken: arithmetic overflow');
      });

      it('should allow minting 0 tokens of an uninitialized id', async () => {
        // A zero-value mint is a no-op: it must not revert and must not
        // initialize the id.
        await token._mint(RECIPIENT.either, NONEXISTENT_ID, 0n);
        expect(await token.balanceOf(RECIPIENT.either, NONEXISTENT_ID)).toEqual(
          0n,
        );
      });

      it('should fail when minting to zero address (id)', async () => {
        await expect(
          token._mint(ZERO_ACCOUNT, TOKEN_ID, AMOUNT),
        ).rejects.toThrow('MultiToken: invalid receiver');
      });

      it('should fail when minting to zero address (contract)', async () => {
        await expect(
          token._mint(ZERO_CONTRACT, TOKEN_ID, AMOUNT),
        ).rejects.toThrow('MultiToken: unsafe transfer');
      });

      it('should fail when minting to a contract address', async () => {
        await expect(
          token._mint(RECIPIENT_CONTRACT, TOKEN_ID, AMOUNT),
        ).rejects.toThrow('MultiToken: unsafe transfer');
      });

      it('should canonicalize recipient', async () => {
        const nonCanonical = nonCanonicalLeft(RECIPIENT.accountId);
        await token._mint(nonCanonical, TOKEN_ID, AMOUNT);

        expect(await token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(
          AMOUNT,
        );
      });
    });

    describe('_unsafeMint', () => {
      describe.each(
        recipientTypes,
      )('when the recipient is a %s', (_, recipient) => {
        it('should update balance when minting', async () => {
          await token._unsafeMint(recipient, TOKEN_ID, AMOUNT);

          expect(await token.balanceOf(recipient, TOKEN_ID)).toEqual(AMOUNT);
        });

        it('should update balance with multiple mints', async () => {
          for (let i = 0; i < 3; i++) {
            await token._unsafeMint(recipient, TOKEN_ID, 1n);
          }

          expect(await token.balanceOf(recipient, TOKEN_ID)).toEqual(3n);
        });

        it('should fail when overflowing uint128', async () => {
          await token._unsafeMint(recipient, TOKEN_ID, MAX_UINT128);

          await expect(
            token._unsafeMint(recipient, TOKEN_ID, 1n),
          ).rejects.toThrow('MultiToken: arithmetic overflow');
        });
      });

      it('should fail when minting to zero address (id)', async () => {
        await expect(
          token._unsafeMint(ZERO_ACCOUNT, TOKEN_ID, AMOUNT),
        ).rejects.toThrow('MultiToken: invalid receiver');
      });

      it('should fail when minting to zero address (contract)', async () => {
        await expect(
          token._unsafeMint(ZERO_CONTRACT, TOKEN_ID, AMOUNT),
        ).rejects.toThrow('MultiToken: invalid receiver');
      });

      it('should canonicalize recipient', async () => {
        const nonCanonical = nonCanonicalLeft(RECIPIENT.accountId);
        await token._unsafeMint(nonCanonical, TOKEN_ID, AMOUNT);

        expect(await token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(
          AMOUNT,
        );
      });

      it('should canonicalize contract address recipient', async () => {
        const nonCanonical = nonCanonicalRight(RECIPIENT_CONTRACT.right);
        await token._unsafeMint(nonCanonical, TOKEN_ID, AMOUNT);

        expect(await token.balanceOf(RECIPIENT_CONTRACT, TOKEN_ID)).toEqual(
          AMOUNT,
        );
      });
    });

    describe('_burn', () => {
      beforeEach(async () => {
        await token._mint(OWNER.either, TOKEN_ID, AMOUNT);
        expect(await token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(AMOUNT);
      });

      it('should burn tokens', async () => {
        await token._burn(OWNER.either, TOKEN_ID, AMOUNT);
        expect(await token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(0n);
      });

      it('should burn partial', async () => {
        const partialAmt = 1n;
        await token._burn(OWNER.either, TOKEN_ID, partialAmt);
        expect(await token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(
          AMOUNT - partialAmt,
        );
      });

      it('should update balance with multiple burns', async () => {
        for (let i = 0; i < 3; i++) {
          await token._burn(OWNER.either, TOKEN_ID, 1n);
        }

        expect(await token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(
          AMOUNT - 3n,
        );
      });

      it('should fail when not enough balance to burn', async () => {
        await expect(
          token._burn(OWNER.either, TOKEN_ID, AMOUNT + 1n),
        ).rejects.toThrow('MultiToken: insufficient balance');
      });

      it('should fail when burning the zero address tokens', async () => {
        await expect(
          token._burn(ZERO_ACCOUNT, TOKEN_ID, AMOUNT),
        ).rejects.toThrow('MultiToken: invalid sender');
      });

      it('should fail when burning tokens from nonexistent id', async () => {
        await expect(
          token._burn(OWNER.either, NONEXISTENT_ID, AMOUNT),
        ).rejects.toThrow('MultiToken: insufficient balance');
      });

      it('should allow burning 0 tokens from an uninitialized id', async () => {
        // A zero-value burn must not revert on an uninitialized id.
        await token._burn(OWNER.either, NONEXISTENT_ID, 0n);
        expect(await token.balanceOf(OWNER.either, NONEXISTENT_ID)).toEqual(0n);
      });

      it('should handle non-canonical fromAddress (id)', async () => {
        const nonCanonical = nonCanonicalLeft(OWNER.accountId);
        await token._burn(nonCanonical, TOKEN_ID, AMOUNT);

        expect(await token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(0n);
      });

      it('should handle non-canonical fromAddress (contract address)', async () => {
        await token._unsafeMint(OWNER_CONTRACT, TOKEN_ID, AMOUNT);
        expect(await token.balanceOf(OWNER_CONTRACT, TOKEN_ID)).toEqual(AMOUNT);

        const nonCanonical = nonCanonicalRight(OWNER_CONTRACT.right);
        await token._burn(nonCanonical, TOKEN_ID, AMOUNT);

        expect(await token.balanceOf(OWNER_CONTRACT, TOKEN_ID)).toEqual(0n);
      });
    });

    describe('_setApprovalForAll', () => {
      it('should return false when set to false', async () => {
        await token._setApprovalForAll(OWNER.either, SPENDER.either, false);
        expect(await token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
          false,
        );
      });

      it('should fail when attempting to approve zero address as an operator', async () => {
        await expect(
          token._setApprovalForAll(OWNER.either, ZERO_ACCOUNT, true),
        ).rejects.toThrow('MultiToken: invalid operator');
      });

      it('should fail when owner is zero address', async () => {
        await expect(
          token._setApprovalForAll(ZERO_ACCOUNT, SPENDER.either, true),
        ).rejects.toThrow('MultiToken: invalid owner');
      });

      it('should set → unset → set operator', async () => {
        await token._setApprovalForAll(OWNER.either, SPENDER.either, true);
        expect(await token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
          true,
        );

        await token._setApprovalForAll(OWNER.either, SPENDER.either, false);
        expect(await token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
          false,
        );

        await token._setApprovalForAll(OWNER.either, SPENDER.either, true);
        expect(await token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
          true,
        );
      });

      it('should canonicalize owner and operator', async () => {
        const nonCanonicalOwner = nonCanonicalLeft(OWNER.accountId);
        const nonCanonicalOp = nonCanonicalLeft(SPENDER.accountId);

        await token._setApprovalForAll(nonCanonicalOwner, nonCanonicalOp, true);
        expect(await token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
          true,
        );
      });
    });
  });

  describe('simulator wiring', () => {
    it('should expose the balances map via getPublicState', async () => {
      const sim = await MultiTokenSimulator.create(initWithURI);

      const ledgerState = await sim.getPublicState();

      expect(ledgerState.MultiToken__balances.isEmpty()).toBe(true);
      expect(ledgerState.MultiToken__balances.size()).toBe(0n);
    });
  });

  describe('privateState helpers', () => {
    describe('getCurrentSecretKey', () => {
      it('should return the injected secret key', async () => {
        const sim = await MultiTokenSimulator.create(initWithURI);
        await sim.privateState.injectSecretKey(OWNER.secretKey);

        expect(await sim.privateState.getCurrentSecretKey()).toEqual(
          OWNER.secretKey,
        );
      });

      it('should throw when the secret key is undefined', async () => {
        const sim = await MultiTokenSimulator.create(initWithURI, {
          privateState: { secretKey: undefined as unknown as Uint8Array },
        });

        await expect(sim.privateState.getCurrentSecretKey()).rejects.toThrow(
          'Missing secret key',
        );
      });
    });
  });
});
