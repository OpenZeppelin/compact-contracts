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
    it('should initialize metadata', () => {
      token = new MultiTokenSimulator(initWithURI);

      expect(token.uri(TOKEN_ID)).toEqual(URI);
    });

    it('should initialize empty metadata', () => {
      token = new MultiTokenSimulator(initWithEmptyURI);

      expect(token.uri(TOKEN_ID)).toEqual(NO_STRING);
    });

    it('should not be able to re-initialize', () => {
      token = new MultiTokenSimulator(initWithEmptyURI);

      expect(() => {
        token.initialize(URI);
      }).toThrow('MultiToken: contract already initialized');
    });
  });

  describe('when not initialized correctly', () => {
    beforeEach(() => {
      token = new MultiTokenSimulator(badInit);
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

    it.each(circuitsToFail)('%s should fail', (circuitName, args) => {
      expect(() => {
        (token[circuitName] as (...args: unknown[]) => unknown)(...args);
      }).toThrow('MultiToken: contract not initialized');
    });

    it('should allow initialization post deployment', () => {
      token.initialize(URI);

      expect(() => {
        token.balanceOf(OWNER.either, TOKEN_ID);
      }).not.toThrow();
    });
  });

  describe('when initialized correctly', () => {
    beforeEach(() => {
      token = new MultiTokenSimulator(initWithURI);
    });

    describe('balanceOf', () => {
      const ownerTypes = [
        ['contract', OWNER_CONTRACT],
        ['accountId', OWNER.either],
      ] as const;

      describe.each(ownerTypes)('when the owner is a %s', (_, owner) => {
        it('should return zero when requested account has no balance', () => {
          expect(token.balanceOf(owner, TOKEN_ID)).toEqual(0n);
          expect(token.balanceOf(owner, TOKEN_ID2)).toEqual(0n);
        });

        it('should return balance when requested account has tokens', () => {
          token._unsafeMint(owner, TOKEN_ID, AMOUNT);
          expect(token.balanceOf(owner, TOKEN_ID)).toEqual(AMOUNT);

          token._unsafeMint(owner, TOKEN_ID2, AMOUNT2);
          expect(token.balanceOf(owner, TOKEN_ID2)).toEqual(AMOUNT2);
        });

        it('should handle token ID 0', () => {
          const ZERO_ID = 0n;
          token._unsafeMint(owner, ZERO_ID, AMOUNT);
          expect(token.balanceOf(owner, ZERO_ID)).toEqual(AMOUNT);
        });

        it('should handle MAX_UINT128 token ID', () => {
          const MAX_ID = MAX_UINT128;
          token._unsafeMint(owner, MAX_ID, AMOUNT);
          expect(token.balanceOf(owner, MAX_ID)).toEqual(AMOUNT);
        });
      });

      it('should return correct balance with non-canonical lookup (left)', () => {
        token._unsafeMint(OWNER.either, TOKEN_ID, AMOUNT);
        const nonCanonical = nonCanonicalLeft(OWNER.accountId);

        expect(token.balanceOf(nonCanonical, TOKEN_ID)).toEqual(AMOUNT);
      });

      it('should return correct balance with non-canonical lookup (right)', () => {
        token._unsafeMint(OWNER_CONTRACT, TOKEN_ID, AMOUNT);
        const nonCanonical = nonCanonicalRight(OWNER_CONTRACT.right);

        expect(token.balanceOf(nonCanonical, TOKEN_ID)).toEqual(AMOUNT);
      });
    });

    describe('isApprovedForAll', () => {
      it('should return false when not set', () => {
        expect(token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
          false,
        );
      });

      it('should handle approving owner as operator', () => {
        token.privateState.injectSecretKey(OWNER.secretKey);
        token.setApprovalForAll(OWNER.either, true);
        expect(token.isApprovedForAll(OWNER.either, OWNER.either)).toBe(true);
      });

      it('should handle multiple approvals of same operator', () => {
        token.privateState.injectSecretKey(OWNER.secretKey);
        token.setApprovalForAll(SPENDER.either, true);
        token.setApprovalForAll(SPENDER.either, true);
        expect(token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(true);
      });

      it('should handle revoking non-existent approval', () => {
        token.privateState.injectSecretKey(OWNER.secretKey);
        token.setApprovalForAll(SPENDER.either, false);
        expect(token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
          false,
        );
      });

      it('should return correct result with non-canonical owner lookup', () => {
        token._setApprovalForAll(OWNER.either, SPENDER.either, true);
        const nonCanonical = nonCanonicalLeft(OWNER.accountId);

        expect(token.isApprovedForAll(nonCanonical, SPENDER.either)).toBe(true);
      });

      it('should return correct result with non-canonical operator lookup', () => {
        token._setApprovalForAll(OWNER.either, SPENDER.either, true);
        const nonCanonical = nonCanonicalLeft(SPENDER.accountId);

        expect(token.isApprovedForAll(OWNER.either, nonCanonical)).toBe(true);
      });
    });

    describe('setApprovalForAll', () => {
      it('should return false when set to false', () => {
        token.privateState.injectSecretKey(OWNER.secretKey);
        token.setApprovalForAll(SPENDER.either, false);
        expect(token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
          false,
        );
      });

      it('should fail when attempting to approve zero address as an operator', () => {
        token.privateState.injectSecretKey(OWNER.secretKey);
        expect(() => {
          token.setApprovalForAll(ZERO_ACCOUNT, true);
        }).toThrow('MultiToken: invalid operator');
      });

      describe('when spender is approved as an operator', () => {
        beforeEach(() => {
          token.privateState.injectSecretKey(OWNER.secretKey);
          token.setApprovalForAll(SPENDER.either, true);
        });

        it('should return true when set to true', () => {
          expect(token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
            true,
          );
        });

        it('should unset → set → unset operator', () => {
          token.setApprovalForAll(SPENDER.either, false);
          expect(token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
            false,
          );

          token.setApprovalForAll(SPENDER.either, true);
          expect(token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
            true,
          );

          token.setApprovalForAll(SPENDER.either, false);
          expect(token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
            false,
          );
        });
      });
    });

    describe('transferFrom', () => {
      beforeEach(() => {
        token._mint(OWNER.either, TOKEN_ID, AMOUNT);

        expect(token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(AMOUNT);
        expect(token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(0n);
      });

      describe.each(callerTypes)('when the caller is the %s', (_, caller) => {
        beforeEach(() => {
          if (caller === SPENDER) {
            token._setApprovalForAll(OWNER.either, SPENDER.either, true);
          }
          token.privateState.injectSecretKey(caller.secretKey);
        });

        it('should transfer whole', () => {
          token.transferFrom(OWNER.either, RECIPIENT.either, TOKEN_ID, AMOUNT);

          expect(token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(0n);
          expect(token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(AMOUNT);
        });

        it('should transfer partial', () => {
          const partialAmt = AMOUNT - 1n;
          token.transferFrom(
            OWNER.either,
            RECIPIENT.either,
            TOKEN_ID,
            partialAmt,
          );

          expect(token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(
            AMOUNT - partialAmt,
          );
          expect(token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(
            partialAmt,
          );
        });

        it('should allow transfer of 0 tokens', () => {
          token.transferFrom(OWNER.either, RECIPIENT.either, TOKEN_ID, 0n);

          expect(token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(AMOUNT);
          expect(token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(0n);
        });

        it('should handle self-transfer', () => {
          token.transferFrom(OWNER.either, OWNER.either, TOKEN_ID, AMOUNT);
          expect(token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(AMOUNT);
        });

        it('should handle MAX_UINT128 transfer amount', () => {
          token._mint(OWNER.either, TOKEN_ID, MAX_UINT128 - AMOUNT);

          token.transferFrom(
            OWNER.either,
            RECIPIENT.either,
            TOKEN_ID,
            MAX_UINT128,
          );
          expect(token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(
            MAX_UINT128,
          );
        });

        it('should handle rapid state changes', () => {
          token.privateState.injectSecretKey(OWNER.secretKey);
          token.setApprovalForAll(SPENDER.either, true);

          token.privateState.injectSecretKey(SPENDER.secretKey);
          token.transferFrom(OWNER.either, RECIPIENT.either, TOKEN_ID, AMOUNT);
          expect(token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(AMOUNT);

          token.privateState.injectSecretKey(OWNER.secretKey);
          token.setApprovalForAll(SPENDER.either, false);
          expect(token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
            false,
          );

          token.setApprovalForAll(SPENDER.either, true);
          expect(token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
            true,
          );
        });

        it('should fail with insufficient balance', () => {
          expect(() => {
            token.transferFrom(
              OWNER.either,
              RECIPIENT.either,
              TOKEN_ID,
              AMOUNT + 1n,
            );
          }).toThrow('MultiToken: insufficient balance');
        });

        it('should fail with nonexistent id', () => {
          expect(() => {
            token.transferFrom(
              OWNER.either,
              RECIPIENT.either,
              NONEXISTENT_ID,
              AMOUNT,
            );
          }).toThrow('MultiToken: insufficient balance');
        });

        it('should fail with transfer from zero', () => {
          expect(() => {
            token.transferFrom(
              ZERO_ACCOUNT,
              RECIPIENT.either,
              TOKEN_ID,
              AMOUNT,
            );
          }).toThrow('MultiToken: unauthorized operator');
        });

        it('should fail with transfer to zero (id)', () => {
          expect(() => {
            token.transferFrom(OWNER.either, ZERO_ACCOUNT, TOKEN_ID, AMOUNT);
          }).toThrow('MultiToken: invalid receiver');
        });

        it('should fail with transfer to zero (contract)', () => {
          expect(() => {
            token.transferFrom(OWNER.either, ZERO_CONTRACT, TOKEN_ID, AMOUNT);
          }).toThrow('MultiToken: unsafe transfer');
        });

        it('should fail when transferring to a contract address', () => {
          expect(() => {
            token.transferFrom(
              OWNER.either,
              RECIPIENT_CONTRACT,
              TOKEN_ID,
              AMOUNT,
            );
          }).toThrow('MultiToken: unsafe transfer');
        });
      });

      it('should handle concurrent operations on same token ID', () => {
        token._mint(OWNER.either, TOKEN_ID, AMOUNT * 2n);

        token.privateState.injectSecretKey(OWNER.secretKey);
        token.setApprovalForAll(SPENDER.either, true);
        token.setApprovalForAll(OTHER.either, true);

        // First spender transfers half
        token.privateState.injectSecretKey(SPENDER.secretKey);
        token.transferFrom(OWNER.either, RECIPIENT.either, TOKEN_ID, AMOUNT);
        expect(token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(AMOUNT);

        // Second spender transfers remaining
        token.privateState.injectSecretKey(OTHER.secretKey);
        token.transferFrom(OWNER.either, RECIPIENT.either, TOKEN_ID, AMOUNT);
        expect(token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(
          AMOUNT * 2n,
        );
      });

      it('should handle non-canonical fromAddress (id)', () => {
        token.privateState.injectSecretKey(OWNER.secretKey);

        const nonCanonical = nonCanonicalLeft(OWNER.accountId);
        token.transferFrom(nonCanonical, RECIPIENT.either, TOKEN_ID, AMOUNT);

        expect(token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(AMOUNT);
      });

      it('should handle non-canonical fromAddress (contract address)', () => {
        token._unsafeMint(OWNER_CONTRACT, TOKEN_ID, AMOUNT);
        token._setApprovalForAll(OWNER_CONTRACT, OWNER.either, true);

        token.privateState.injectSecretKey(OWNER.secretKey);

        const nonCanonical = nonCanonicalRight(OWNER_CONTRACT.right);
        token.transferFrom(nonCanonical, RECIPIENT.either, TOKEN_ID, AMOUNT);

        expect(token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(AMOUNT);
      });

      describe('when the caller is unauthorized', () => {
        beforeEach(() => {
          token.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
        });

        it('should fail when transfer whole', () => {
          expect(() => {
            token.transferFrom(
              OWNER.either,
              RECIPIENT.either,
              TOKEN_ID,
              AMOUNT,
            );
          }).toThrow('MultiToken: unauthorized operator');
        });

        it('should fail when transfer partial', () => {
          expect(() => {
            const partialAmt = AMOUNT - 1n;
            token.transferFrom(
              OWNER.either,
              RECIPIENT.either,
              TOKEN_ID,
              partialAmt,
            );
          }).toThrow('MultiToken: unauthorized operator');
        });

        it('should fail when transfer zero', () => {
          expect(() => {
            token.transferFrom(OWNER.either, RECIPIENT.either, TOKEN_ID, 0n);
          }).toThrow('MultiToken: unauthorized operator');
        });

        it('should fail with insufficient balance', () => {
          expect(() => {
            token.transferFrom(
              OWNER.either,
              RECIPIENT.either,
              TOKEN_ID,
              AMOUNT + 1n,
            );
          }).toThrow('MultiToken: unauthorized operator');
        });

        it('should fail with nonexistent id', () => {
          expect(() => {
            token.transferFrom(
              OWNER.either,
              RECIPIENT.either,
              NONEXISTENT_ID,
              AMOUNT,
            );
          }).toThrow('MultiToken: unauthorized operator');
        });

        it('should fail with transfer from zero', () => {
          expect(() => {
            token.transferFrom(
              ZERO_ACCOUNT,
              RECIPIENT.either,
              TOKEN_ID,
              AMOUNT,
            );
          }).toThrow('MultiToken: unauthorized operator');
        });
      });
    });

    describe('_unsafeTransferFrom', () => {
      beforeEach(() => {
        token._mint(OWNER.either, TOKEN_ID, AMOUNT);
      });

      describe.each(callerTypes)('when the caller is the %s', (_, caller) => {
        beforeEach(() => {
          if (caller === SPENDER) {
            token._setApprovalForAll(OWNER.either, SPENDER.either, true);
          }
          token.privateState.injectSecretKey(caller.secretKey);
        });

        describe.each(
          recipientTypes,
        )('when the recipient is a %s', (_, recipient) => {
          it('should transfer whole', () => {
            token._unsafeTransferFrom(
              OWNER.either,
              recipient,
              TOKEN_ID,
              AMOUNT,
            );

            expect(token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(0n);
            expect(token.balanceOf(recipient, TOKEN_ID)).toEqual(AMOUNT);
          });

          it('should transfer partial', () => {
            const partialAmt = AMOUNT - 1n;
            token._unsafeTransferFrom(
              OWNER.either,
              recipient,
              TOKEN_ID,
              partialAmt,
            );

            expect(token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(
              AMOUNT - partialAmt,
            );
            expect(token.balanceOf(recipient, TOKEN_ID)).toEqual(partialAmt);
          });

          it('should allow transfer of 0 tokens', () => {
            token._unsafeTransferFrom(OWNER.either, recipient, TOKEN_ID, 0n);

            expect(token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(AMOUNT);
            expect(token.balanceOf(recipient, TOKEN_ID)).toEqual(0n);
          });

          it('should handle self-transfer', () => {
            token._unsafeTransferFrom(
              OWNER.either,
              OWNER.either,
              TOKEN_ID,
              AMOUNT,
            );
            expect(token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(AMOUNT);
          });

          it('should handle MAX_UINT128 transfer amount', () => {
            token._mint(OWNER.either, TOKEN_ID, MAX_UINT128 - AMOUNT);

            token._unsafeTransferFrom(
              OWNER.either,
              recipient,
              TOKEN_ID,
              MAX_UINT128,
            );
            expect(token.balanceOf(recipient, TOKEN_ID)).toEqual(MAX_UINT128);
          });

          it('should handle rapid state changes', () => {
            token.privateState.injectSecretKey(OWNER.secretKey);
            token.setApprovalForAll(SPENDER.either, true);

            token._unsafeTransferFrom(
              OWNER.either,
              recipient,
              TOKEN_ID,
              AMOUNT,
            );
            expect(token.balanceOf(recipient, TOKEN_ID)).toEqual(AMOUNT);

            token.setApprovalForAll(SPENDER.either, false);
            expect(token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
              false,
            );

            token.setApprovalForAll(SPENDER.either, true);
            expect(token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
              true,
            );
          });

          it('should fail with insufficient balance', () => {
            expect(() => {
              token._unsafeTransferFrom(
                OWNER.either,
                recipient,
                TOKEN_ID,
                AMOUNT + 1n,
              );
            }).toThrow('MultiToken: insufficient balance');
          });

          it('should fail with nonexistent id', () => {
            expect(() => {
              token._unsafeTransferFrom(
                OWNER.either,
                recipient,
                NONEXISTENT_ID,
                AMOUNT,
              );
            }).toThrow('MultiToken: insufficient balance');
          });

          it('should fail with transfer from zero', () => {
            expect(() => {
              token._unsafeTransferFrom(
                ZERO_ACCOUNT,
                recipient,
                TOKEN_ID,
                AMOUNT,
              );
            }).toThrow('MultiToken: unauthorized operator');
          });
        });

        it('should fail with transfer to zero (id)', () => {
          expect(() => {
            token._unsafeTransferFrom(
              OWNER.either,
              ZERO_ACCOUNT,
              TOKEN_ID,
              AMOUNT,
            );
          }).toThrow('MultiToken: invalid receiver');
        });

        it('should fail with transfer to zero (contract)', () => {
          expect(() => {
            token._unsafeTransferFrom(
              OWNER.either,
              ZERO_CONTRACT,
              TOKEN_ID,
              AMOUNT,
            );
          }).toThrow('MultiToken: invalid receiver');
        });
      });

      it('should handle concurrent operations on same token ID', () => {
        token._mint(OWNER.either, TOKEN_ID, AMOUNT * 2n);

        token.privateState.injectSecretKey(OWNER.secretKey);
        token.setApprovalForAll(SPENDER.either, true);
        token.setApprovalForAll(OTHER.either, true);

        // First spender transfers half
        token.privateState.injectSecretKey(SPENDER.secretKey);
        token._unsafeTransferFrom(
          OWNER.either,
          RECIPIENT.either,
          TOKEN_ID,
          AMOUNT,
        );
        expect(token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(AMOUNT);

        // Second spender transfers remaining
        token.privateState.injectSecretKey(OTHER.secretKey);
        token._unsafeTransferFrom(
          OWNER.either,
          RECIPIENT.either,
          TOKEN_ID,
          AMOUNT,
        );
        expect(token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(
          AMOUNT * 2n,
        );
      });

      it('should handle non-canonical fromAddress (id)', () => {
        const nonCanonical = nonCanonicalLeft(OWNER.accountId);

        token.privateState.injectSecretKey(OWNER.secretKey);
        token._unsafeTransferFrom(
          nonCanonical,
          RECIPIENT.either,
          TOKEN_ID,
          AMOUNT,
        );
        expect(token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(AMOUNT);
      });

      it('should handle non-canonical fromAddress (contract address)', () => {
        // Mint to contract address to test the transfer of non-canonical `fromAddress`
        token._unsafeMint(OWNER_CONTRACT, TOKEN_ID, AMOUNT);
        // Approve owner (id) to move OWNER_CONTRACT's token
        token._setApprovalForAll(OWNER_CONTRACT, OWNER.either, true);

        token.privateState.injectSecretKey(OWNER.secretKey);
        const nonCanonical = nonCanonicalRight(OWNER_CONTRACT.right);
        token._unsafeTransferFrom(
          nonCanonical,
          RECIPIENT.either,
          TOKEN_ID,
          AMOUNT,
        );
        expect(token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(AMOUNT);
      });

      it('should canonicalize recipient (id)', () => {
        token.privateState.injectSecretKey(OWNER.secretKey);

        const nonCanonical = nonCanonicalLeft(RECIPIENT.accountId);
        token._unsafeTransferFrom(OWNER.either, nonCanonical, TOKEN_ID, AMOUNT);
        expect(token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(AMOUNT);
      });

      it('should canonicalize recipient (contract address)', () => {
        token.privateState.injectSecretKey(OWNER.secretKey);

        const nonCanonical = nonCanonicalRight(RECIPIENT_CONTRACT.right);
        token._unsafeTransferFrom(OWNER.either, nonCanonical, TOKEN_ID, AMOUNT);
        expect(token.balanceOf(RECIPIENT_CONTRACT, TOKEN_ID)).toEqual(AMOUNT);
      });

      describe('when the caller is unauthorized', () => {
        beforeEach(() => {
          token.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
        });

        describe.each(
          recipientTypes,
        )('when recipient is %s', (_, recipient) => {
          it('should fail when transfer whole', () => {
            expect(() => {
              token._unsafeTransferFrom(
                OWNER.either,
                recipient,
                TOKEN_ID,
                AMOUNT,
              );
            }).toThrow('MultiToken: unauthorized operator');
          });

          it('should fail when transfer partial', () => {
            expect(() => {
              const partialAmt = AMOUNT - 1n;
              token._unsafeTransferFrom(
                OWNER.either,
                recipient,
                TOKEN_ID,
                partialAmt,
              );
            }).toThrow('MultiToken: unauthorized operator');
          });

          it('should fail when transfer zero', () => {
            expect(() => {
              token._unsafeTransferFrom(OWNER.either, recipient, TOKEN_ID, 0n);
            }).toThrow('MultiToken: unauthorized operator');
          });

          it('should fail with insufficient balance', () => {
            expect(() => {
              token._unsafeTransferFrom(
                OWNER.either,
                recipient,
                TOKEN_ID,
                AMOUNT + 1n,
              );
            }).toThrow('MultiToken: unauthorized operator');
          });

          it('should fail with nonexistent id', () => {
            expect(() => {
              token._unsafeTransferFrom(
                OWNER.either,
                recipient,
                NONEXISTENT_ID,
                AMOUNT,
              );
            }).toThrow('MultiToken: unauthorized operator');
          });

          it('should fail with transfer from zero', () => {
            // With witness-based identity, the caller is H(sk) which is
            // always non-zero. Transferring from ZERO_ACCOUNT means
            // canonFrom != caller → isApprovedForAll(zeroAccount, caller) → false
            // → "unauthorized operator"
            expect(() => {
              token._unsafeTransferFrom(
                ZERO_ACCOUNT,
                recipient,
                TOKEN_ID,
                AMOUNT,
              );
            }).toThrow('MultiToken: unauthorized operator');
          });
        });
      });
    });

    describe('_transfer', () => {
      beforeEach(() => {
        token._mint(OWNER.either, TOKEN_ID, AMOUNT);

        expect(token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(AMOUNT);
        expect(token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(0n);
      });

      it('should transfer whole', () => {
        token._transfer(OWNER.either, RECIPIENT.either, TOKEN_ID, AMOUNT);

        expect(token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(0n);
        expect(token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(AMOUNT);
      });

      it('should transfer partial', () => {
        const partialAmt = AMOUNT - 1n;
        token._transfer(OWNER.either, RECIPIENT.either, TOKEN_ID, partialAmt);

        expect(token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(
          AMOUNT - partialAmt,
        );
        expect(token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(partialAmt);
      });

      it('should allow transfer of 0 tokens', () => {
        token._transfer(OWNER.either, RECIPIENT.either, TOKEN_ID, 0n);

        expect(token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(AMOUNT);
        expect(token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(0n);
      });

      it('should fail with insufficient balance', () => {
        expect(() => {
          token._transfer(
            OWNER.either,
            RECIPIENT.either,
            TOKEN_ID,
            AMOUNT + 1n,
          );
        }).toThrow('MultiToken: insufficient balance');
      });

      it('should fail with nonexistent id', () => {
        expect(() => {
          token._transfer(
            OWNER.either,
            RECIPIENT.either,
            NONEXISTENT_ID,
            AMOUNT,
          );
        }).toThrow('MultiToken: insufficient balance');
      });

      it('should fail when transfer from 0', () => {
        expect(() => {
          token._transfer(ZERO_ACCOUNT, RECIPIENT.either, TOKEN_ID, AMOUNT);
        }).toThrow('MultiToken: invalid sender');
      });

      it('should fail when transfer to 0', () => {
        expect(() => {
          token._transfer(OWNER.either, ZERO_ACCOUNT, TOKEN_ID, AMOUNT);
        }).toThrow('MultiToken: invalid receiver');
      });

      it('should fail when transfer to contract address', () => {
        expect(() => {
          token._transfer(OWNER.either, RECIPIENT_CONTRACT, TOKEN_ID, AMOUNT);
        }).toThrow('MultiToken: unsafe transfer');
      });

      it('should handle non-canonical fromAddress (id)', () => {
        const nonCanonical = nonCanonicalLeft(OWNER.accountId);

        token._transfer(nonCanonical, RECIPIENT.either, TOKEN_ID, AMOUNT);
        expect(token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(0n);
        expect(token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(AMOUNT);
      });

      it('should handle non-canonical fromAddress (contract address)', () => {
        token._unsafeMint(OWNER_CONTRACT, TOKEN_ID, AMOUNT);

        const nonCanonical = nonCanonicalRight(OWNER_CONTRACT.right);
        token._transfer(nonCanonical, RECIPIENT.either, TOKEN_ID, AMOUNT);

        expect(token.balanceOf(OWNER_CONTRACT, TOKEN_ID)).toEqual(0n);
        expect(token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(AMOUNT);
      });
    });

    describe('_unsafeTransfer', () => {
      beforeEach(() => {
        token._mint(OWNER.either, TOKEN_ID, AMOUNT);

        expect(token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(AMOUNT);
        expect(token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(0n);
      });

      describe.each(
        recipientTypes,
      )('when the recipient is a %s', (_, recipient) => {
        it('should transfer whole', () => {
          token._unsafeTransfer(OWNER.either, recipient, TOKEN_ID, AMOUNT);

          expect(token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(0n);
          expect(token.balanceOf(recipient, TOKEN_ID)).toEqual(AMOUNT);
        });

        it('should transfer partial', () => {
          const partialAmt = AMOUNT - 1n;
          token._unsafeTransfer(OWNER.either, recipient, TOKEN_ID, partialAmt);

          expect(token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(
            AMOUNT - partialAmt,
          );
          expect(token.balanceOf(recipient, TOKEN_ID)).toEqual(partialAmt);
        });

        it('should allow transfer of 0 tokens', () => {
          token._unsafeTransfer(OWNER.either, recipient, TOKEN_ID, 0n);

          expect(token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(AMOUNT);
          expect(token.balanceOf(recipient, TOKEN_ID)).toEqual(0n);
        });

        it('should fail with insufficient balance', () => {
          expect(() => {
            token._unsafeTransfer(
              OWNER.either,
              recipient,
              TOKEN_ID,
              AMOUNT + 1n,
            );
          }).toThrow('MultiToken: insufficient balance');
        });

        it('should fail with nonexistent id', () => {
          expect(() => {
            token._unsafeTransfer(
              OWNER.either,
              recipient,
              NONEXISTENT_ID,
              AMOUNT,
            );
          }).toThrow('MultiToken: insufficient balance');
        });

        it('should fail when transfer from 0 (id)', () => {
          expect(() => {
            token._unsafeTransfer(ZERO_ACCOUNT, recipient, TOKEN_ID, AMOUNT);
          }).toThrow('MultiToken: invalid sender');
        });

        it('should fail when transfer from 0 (contract address)', () => {
          expect(() => {
            token._unsafeTransfer(ZERO_CONTRACT, recipient, TOKEN_ID, AMOUNT);
          }).toThrow('MultiToken: invalid sender');
        });
      });

      it('should handle non-canonical fromAddress (id)', () => {
        const nonCanonical = nonCanonicalLeft(OWNER.accountId);
        token._unsafeTransfer(nonCanonical, RECIPIENT.either, TOKEN_ID, AMOUNT);

        expect(token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(0n);
        expect(token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(AMOUNT);
      });

      it('should handle non-canonical fromAddress (contract address)', () => {
        // Mint to contract address to test the transfer of non-canonical `fromAddress`
        token._unsafeMint(OWNER_CONTRACT, TOKEN_ID, AMOUNT);

        const nonCanonical = nonCanonicalRight(OWNER_CONTRACT.right);
        token._unsafeTransfer(nonCanonical, RECIPIENT.either, TOKEN_ID, AMOUNT);

        expect(token.balanceOf(OWNER_CONTRACT, TOKEN_ID)).toEqual(0n);
        expect(token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(AMOUNT);
      });

      it('should handle non-canonical to (id)', () => {
        const nonCanonical = nonCanonicalLeft(RECIPIENT.accountId);
        token._unsafeTransfer(OWNER.either, nonCanonical, TOKEN_ID, AMOUNT);

        expect(token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(0n);
        expect(token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(AMOUNT);
      });

      it('should handle non-canonical to (contract address)', () => {
        const nonCanonical = nonCanonicalRight(RECIPIENT_CONTRACT.right);
        token._unsafeTransfer(OWNER.either, nonCanonical, TOKEN_ID, AMOUNT);

        expect(token.balanceOf(RECIPIENT_CONTRACT, TOKEN_ID)).toEqual(AMOUNT);
      });

      it('should fail when transfer to 0 (id)', () => {
        expect(() => {
          token._unsafeTransfer(OWNER.either, ZERO_ACCOUNT, TOKEN_ID, AMOUNT);
        }).toThrow('MultiToken: invalid receiver');
      });

      it('should fail when transfer to 0 (contract address)', () => {
        expect(() => {
          token._unsafeTransfer(OWNER.either, ZERO_CONTRACT, TOKEN_ID, AMOUNT);
        }).toThrow('MultiToken: invalid receiver');
      });
    });

    describe('_setURI', () => {
      it('sets a new URI', () => {
        token._setURI(NEW_URI);

        expect(token.uri(TOKEN_ID)).toEqual(NEW_URI);
        expect(token.uri(TOKEN_ID2)).toEqual(NEW_URI);
      });

      it('sets an empty URI → newURI → empty URI → URI', () => {
        const URIS = [NO_STRING, NEW_URI, NO_STRING, URI];

        for (let i = 0; i < URIS.length; i++) {
          token._setURI(URIS[i]);

          expect(token.uri(TOKEN_ID)).toEqual(URIS[i]);
          expect(token.uri(TOKEN_ID2)).toEqual(URIS[i]);
        }
      });

      it('should handle long URI', () => {
        const LONG_URI = `https://example.com/${'a'.repeat(1000)}`;
        token._setURI(LONG_URI);
        expect(token.uri(TOKEN_ID)).toEqual(LONG_URI);
      });

      it('should handle URI with special characters', () => {
        const SPECIAL_URI = 'https://example.com/path?param=value#fragment';
        token._setURI(SPECIAL_URI);
        expect(token.uri(TOKEN_ID)).toEqual(SPECIAL_URI);
      });
    });

    describe('_mint', () => {
      it('should update balance when minting', () => {
        token._mint(RECIPIENT.either, TOKEN_ID, AMOUNT);
        expect(token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(AMOUNT);
      });

      it('should update balance with multiple mints', () => {
        for (let i = 0; i < 3; i++) {
          token._mint(RECIPIENT.either, TOKEN_ID, 1n);
        }

        expect(token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(3n);
      });

      it('should fail when overflowing uint128', () => {
        token._mint(RECIPIENT.either, TOKEN_ID, MAX_UINT128);

        expect(() => {
          token._mint(RECIPIENT.either, TOKEN_ID, 1n);
        }).toThrow('MultiToken: arithmetic overflow');
      });

      it('should fail when minting to zero address (id)', () => {
        expect(() => {
          token._mint(ZERO_ACCOUNT, TOKEN_ID, AMOUNT);
        }).toThrow('MultiToken: invalid receiver');
      });

      it('should fail when minting to zero address (contract)', () => {
        expect(() => {
          token._mint(ZERO_CONTRACT, TOKEN_ID, AMOUNT);
        }).toThrow('MultiToken: unsafe transfer');
      });

      it('should fail when minting to a contract address', () => {
        expect(() => {
          token._mint(RECIPIENT_CONTRACT, TOKEN_ID, AMOUNT);
        }).toThrow('MultiToken: unsafe transfer');
      });

      it('should canonicalize recipient', () => {
        const nonCanonical = nonCanonicalLeft(RECIPIENT.accountId);
        token._mint(nonCanonical, TOKEN_ID, AMOUNT);

        expect(token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(AMOUNT);
      });
    });

    describe('_unsafeMint', () => {
      describe.each(
        recipientTypes,
      )('when the recipient is a %s', (_, recipient) => {
        it('should update balance when minting', () => {
          token._unsafeMint(recipient, TOKEN_ID, AMOUNT);

          expect(token.balanceOf(recipient, TOKEN_ID)).toEqual(AMOUNT);
        });

        it('should update balance with multiple mints', () => {
          for (let i = 0; i < 3; i++) {
            token._unsafeMint(recipient, TOKEN_ID, 1n);
          }

          expect(token.balanceOf(recipient, TOKEN_ID)).toEqual(3n);
        });

        it('should fail when overflowing uint128', () => {
          token._unsafeMint(recipient, TOKEN_ID, MAX_UINT128);

          expect(() => {
            token._unsafeMint(recipient, TOKEN_ID, 1n);
          }).toThrow('MultiToken: arithmetic overflow');
        });
      });

      it('should fail when minting to zero address (id)', () => {
        expect(() => {
          token._unsafeMint(ZERO_ACCOUNT, TOKEN_ID, AMOUNT);
        }).toThrow('MultiToken: invalid receiver');
      });

      it('should fail when minting to zero address (contract)', () => {
        expect(() => {
          token._unsafeMint(ZERO_CONTRACT, TOKEN_ID, AMOUNT);
        }).toThrow('MultiToken: invalid receiver');
      });

      it('should canonicalize recipient', () => {
        const nonCanonical = nonCanonicalLeft(RECIPIENT.accountId);
        token._unsafeMint(nonCanonical, TOKEN_ID, AMOUNT);

        expect(token.balanceOf(RECIPIENT.either, TOKEN_ID)).toEqual(AMOUNT);
      });

      it('should canonicalize contract address recipient', () => {
        const nonCanonical = nonCanonicalRight(RECIPIENT_CONTRACT.right);
        token._unsafeMint(nonCanonical, TOKEN_ID, AMOUNT);

        expect(token.balanceOf(RECIPIENT_CONTRACT, TOKEN_ID)).toEqual(AMOUNT);
      });
    });

    describe('_burn', () => {
      beforeEach(() => {
        token._mint(OWNER.either, TOKEN_ID, AMOUNT);
        expect(token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(AMOUNT);
      });

      it('should burn tokens', () => {
        token._burn(OWNER.either, TOKEN_ID, AMOUNT);
        expect(token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(0n);
      });

      it('should burn partial', () => {
        const partialAmt = 1n;
        token._burn(OWNER.either, TOKEN_ID, partialAmt);
        expect(token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(
          AMOUNT - partialAmt,
        );
      });

      it('should update balance with multiple burns', () => {
        for (let i = 0; i < 3; i++) {
          token._burn(OWNER.either, TOKEN_ID, 1n);
        }

        expect(token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(AMOUNT - 3n);
      });

      it('should fail when not enough balance to burn', () => {
        expect(() => {
          token._burn(OWNER.either, TOKEN_ID, AMOUNT + 1n);
        }).toThrow('MultiToken: insufficient balance');
      });

      it('should fail when burning the zero address tokens', () => {
        expect(() => {
          token._burn(ZERO_ACCOUNT, TOKEN_ID, AMOUNT);
        }).toThrow('MultiToken: invalid sender');
      });

      it('should fail when burning tokens from nonexistent id', () => {
        expect(() => {
          token._burn(OWNER.either, NONEXISTENT_ID, AMOUNT);
        }).toThrow('MultiToken: insufficient balance');
      });

      it('should handle non-canonical fromAddress (id)', () => {
        const nonCanonical = nonCanonicalLeft(OWNER.accountId);
        token._burn(nonCanonical, TOKEN_ID, AMOUNT);

        expect(token.balanceOf(OWNER.either, TOKEN_ID)).toEqual(0n);
      });

      it('should handle non-canonical fromAddress (contract address)', () => {
        token._unsafeMint(OWNER_CONTRACT, TOKEN_ID, AMOUNT);
        expect(token.balanceOf(OWNER_CONTRACT, TOKEN_ID)).toEqual(AMOUNT);

        const nonCanonical = nonCanonicalRight(OWNER_CONTRACT.right);
        token._burn(nonCanonical, TOKEN_ID, AMOUNT);

        expect(token.balanceOf(OWNER_CONTRACT, TOKEN_ID)).toEqual(0n);
      });
    });

    describe('_setApprovalForAll', () => {
      it('should return false when set to false', () => {
        token._setApprovalForAll(OWNER.either, SPENDER.either, false);
        expect(token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
          false,
        );
      });

      it('should fail when attempting to approve zero address as an operator', () => {
        expect(() => {
          token._setApprovalForAll(OWNER.either, ZERO_ACCOUNT, true);
        }).toThrow('MultiToken: invalid operator');
      });

      it('should fail when owner is zero address', () => {
        expect(() => {
          token._setApprovalForAll(ZERO_ACCOUNT, SPENDER.either, true);
        }).toThrow('MultiToken: invalid owner');
      });

      it('should set → unset → set operator', () => {
        token._setApprovalForAll(OWNER.either, SPENDER.either, true);
        expect(token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(true);

        token._setApprovalForAll(OWNER.either, SPENDER.either, false);
        expect(token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(
          false,
        );

        token._setApprovalForAll(OWNER.either, SPENDER.either, true);
        expect(token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(true);
      });

      it('should canonicalize owner and operator', () => {
        const nonCanonicalOwner = nonCanonicalLeft(OWNER.accountId);
        const nonCanonicalOp = nonCanonicalLeft(SPENDER.accountId);

        token._setApprovalForAll(nonCanonicalOwner, nonCanonicalOp, true);
        expect(token.isApprovedForAll(OWNER.either, SPENDER.either)).toBe(true);
      });
    });
  });

  describe('simulator wiring', () => {
    it('should expose the balances map via getPublicState', () => {
      const sim = new MultiTokenSimulator(initWithURI);

      const ledgerState = sim.getPublicState();

      expect(ledgerState.MultiToken__balances.isEmpty()).toBe(true);
      expect(ledgerState.MultiToken__balances.size()).toBe(0n);
    });
  });

  describe('privateState helpers', () => {
    describe('getCurrentSecretKey', () => {
      it('should return the injected secret key', () => {
        const sim = new MultiTokenSimulator(initWithURI);
        sim.privateState.injectSecretKey(OWNER.secretKey);

        expect(sim.privateState.getCurrentSecretKey()).toEqual(OWNER.secretKey);
      });

      it('should throw when the secret key is undefined', () => {
        const sim = new MultiTokenSimulator(initWithURI, {
          privateState: { secretKey: undefined as unknown as Uint8Array },
        });

        expect(() => sim.privateState.getCurrentSecretKey()).toThrow(
          'Missing secret key',
        );
      });
    });
  });
});
