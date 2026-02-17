import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import type { Maybe } from '../../../artifacts/MockMultiToken/contract/index.js'; // Combined imports
import { MultiTokenSimulator } from './simulators/MultiTokenSimulator.js';

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

// PKs
const [OWNER, Z_OWNER] = utils.generateEitherPubKeyPair('OWNER');
const [SPENDER, Z_SPENDER] = utils.generateEitherPubKeyPair('SPENDER');
const [UNAUTHORIZED] = utils.generateEitherPubKeyPair('UNAUTHORIZED');
const [ZERO] = utils.generateEitherPubKeyPair('');
const [, Z_RECIPIENT] = utils.generateEitherPubKeyPair('RECIPIENT');
const [OTHER, Z_OTHER] = utils.generateEitherPubKeyPair('OTHER');

// Encoded contract addresses
const Z_OWNER_CONTRACT =
  utils.createEitherTestContractAddress('OWNER_CONTRACT');
const Z_RECIPIENT_CONTRACT =
  utils.createEitherTestContractAddress('RECIPIENT_CONTRACT');

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

// Helper types
const recipientTypes = [
  ['contract', Z_RECIPIENT_CONTRACT],
  ['pubkey', Z_RECIPIENT],
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
      }).toThrow('Initializable: contract already initialized');
    });
  });

  describe('when not initialized correctly', () => {
    beforeEach(() => {
      token = new MultiTokenSimulator(badInit);
    });

    type FailingCircuits = [method: keyof MultiTokenSimulator, args: unknown[]];
    // Circuit calls should fail before the args are used
    const transferArgs = [Z_OWNER, Z_RECIPIENT, TOKEN_ID, AMOUNT];
    const circuitsToFail: FailingCircuits[] = [
      ['uri', [TOKEN_ID]],
      ['balanceOf', [Z_OWNER, TOKEN_ID]],
      ['setApprovalForAll', [Z_OWNER, true]],
      ['isApprovedForAll', [Z_OWNER, Z_SPENDER]],
      ['transferFrom', transferArgs],
      ['_unsafeTransferFrom', transferArgs],
      ['_transfer', transferArgs],
      ['_unsafeTransfer', transferArgs],
      ['_setURI', [URI]],
      ['_mint', [Z_OWNER, TOKEN_ID, AMOUNT]],
      ['_burn', [Z_OWNER, TOKEN_ID, AMOUNT]],
      ['_setApprovalForAll', [Z_OWNER, Z_SPENDER, true]],
    ];

    it.each(circuitsToFail)('%s should fail', (circuitName, args) => {
      expect(() => {
        (token[circuitName] as (...args: unknown[]) => unknown)(...args);
      }).toThrow('Initializable: contract not initialized');
    });

    // Though, there is no restriction on initializing post deployment,
    // contracts should NOT be set up this way.
    // Always use the constructor to initialize the state.
    it('should allow initialization post deployment', () => {
      token.initialize(URI);

      expect(() => {
        token.balanceOf(Z_OWNER, TOKEN_ID);
      }).not.toThrow();
    });
  });

  describe('when initialized correctly', () => {
    beforeEach(() => {
      token = new MultiTokenSimulator(initWithURI);
    });

    describe('balanceOf', () => {
      const ownerTypes = [
        ['contract', Z_OWNER_CONTRACT],
        ['pubkey', Z_OWNER],
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
    });

    describe('isApprovedForAll', () => {
      it('should return false when not set', () => {
        expect(token.isApprovedForAll(Z_OWNER, Z_SPENDER)).toBe(false);
      });

      it('should handle approving owner as operator', () => {
        token.as(OWNER).setApprovalForAll(Z_OWNER, true);
        expect(token.isApprovedForAll(Z_OWNER, Z_OWNER)).toBe(true);
      });

      it('should handle multiple approvals of same operator', () => {
        token.as(OWNER).setApprovalForAll(Z_SPENDER, true);
        token.as(OWNER).setApprovalForAll(Z_SPENDER, true);
        expect(token.isApprovedForAll(Z_OWNER, Z_SPENDER)).toBe(true);
      });

      it('should handle revoking non-existent approval', () => {
        token.as(OWNER).setApprovalForAll(Z_SPENDER, false);
        expect(token.isApprovedForAll(Z_OWNER, Z_SPENDER)).toBe(false);
      });
    });

    describe('setApprovalForAll', () => {
      it('should return false when set to false', () => {
        token.as(OWNER).setApprovalForAll(Z_SPENDER, false);
        expect(token.isApprovedForAll(Z_OWNER, Z_SPENDER)).toBe(false);
      });

      it('should fail when attempting to approve zero address as an operator', () => {
        expect(() => {
          token.as(OWNER).setApprovalForAll(utils.ZERO_KEY, true);
        }).toThrow('MultiToken: invalid operator');
      });

      describe('when spender is approved as an operator', () => {
        beforeEach(() => {
          token.as(OWNER).setApprovalForAll(Z_SPENDER, true);
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

    describe('transferFrom', () => {
      beforeEach(() => {
        token._mint(Z_OWNER, TOKEN_ID, AMOUNT);

        expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(AMOUNT);
        expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(0n);
      });

      describe.each(callerTypes)('when the caller is the %s', (_, caller) => {
        beforeEach(() => {
          if (caller === SPENDER) {
            token._setApprovalForAll(Z_OWNER, Z_SPENDER, true);
          }
        });

        it('should transfer whole', () => {
          token.as(caller).transferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, AMOUNT);

          expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(0n);
          expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(AMOUNT);
        });

        it('should transfer partial', () => {
          const partialAmt = AMOUNT - 1n;
          token
            .as(caller)
            .transferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, partialAmt);

          expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(
            AMOUNT - partialAmt,
          );
          expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(partialAmt);
        });

        it('should allow transfer of 0 tokens', () => {
          token.as(caller).transferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, 0n);

          expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(AMOUNT);
          expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(0n);
        });

        it('should handle self-transfer', () => {
          token.as(caller).transferFrom(Z_OWNER, Z_OWNER, TOKEN_ID, AMOUNT);
          expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(AMOUNT);
        });

        it('should handle MAX_UINT128 transfer amount', () => {
          // Mint rest of tokens to == MAX_UINT128
          token._mint(Z_OWNER, TOKEN_ID, MAX_UINT128 - AMOUNT);

          token
            .as(caller)
            .transferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, MAX_UINT128);
          expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(MAX_UINT128);
        });

        it('should handle rapid state changes', () => {
          // Approve -> Transfer -> Revoke -> Approve
          token.as(OWNER).setApprovalForAll(Z_SPENDER, true);

          token
            .as(SPENDER)
            .transferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, AMOUNT);
          expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(AMOUNT);

          token.as(OWNER).setApprovalForAll(Z_SPENDER, false);
          expect(token.isApprovedForAll(Z_OWNER, Z_SPENDER)).toBe(false);

          token.as(OWNER).setApprovalForAll(Z_SPENDER, true);
          expect(token.isApprovedForAll(Z_OWNER, Z_SPENDER)).toBe(true);
        });

        it('should fail with insufficient balance', () => {
          expect(() => {
            token
              .as(caller)
              .transferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, AMOUNT + 1n);
          }).toThrow('MultiToken: insufficient balance');
        });

        it('should fail with nonexistent id', () => {
          expect(() => {
            token
              .as(caller)
              .transferFrom(Z_OWNER, Z_RECIPIENT, NONEXISTENT_ID, AMOUNT);
          }).toThrow('MultiToken: insufficient balance');
        });

        it('should fail with transfer from zero', () => {
          expect(() => {
            token
              .as(caller)
              .transferFrom(utils.ZERO_KEY, Z_RECIPIENT, TOKEN_ID, AMOUNT);
          }).toThrow('MultiToken: unauthorized operator');
        });

        it('should fail with transfer to zero (pk)', () => {
          expect(() => {
            token
              .as(caller)
              .transferFrom(Z_OWNER, utils.ZERO_KEY, TOKEN_ID, AMOUNT);
          }).toThrow('MultiToken: invalid receiver');
        });

        it('should fail with transfer to zero (contract)', () => {
          expect(() => {
            token
              .as(caller)
              .transferFrom(Z_OWNER, utils.ZERO_ADDRESS, TOKEN_ID, AMOUNT);
          }).toThrow('MultiToken: unsafe transfer');
        });

        it('should fail when transferring to a contract address', () => {
          expect(() => {
            token
              .as(caller)
              .transferFrom(Z_OWNER, Z_RECIPIENT_CONTRACT, TOKEN_ID, AMOUNT);
          }).toThrow('MultiToken: unsafe transfer');
        });
      });

      it('should handle concurrent operations on same token ID', () => {
        token._mint(Z_OWNER, TOKEN_ID, AMOUNT * 2n);

        // Set up two spenders
        token.as(OWNER).setApprovalForAll(Z_SPENDER, true);
        token.as(OWNER).setApprovalForAll(Z_OTHER, true);

        // First spender transfers half
        token.as(SPENDER).transferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, AMOUNT);
        expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(AMOUNT);

        // Second spender transfers remaining
        token.as(OTHER).transferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, AMOUNT);
        expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(AMOUNT * 2n);
      });

      describe('when the caller is unauthorized', () => {
        it('should fail when transfer whole', () => {
          expect(() => {
            token
              .as(UNAUTHORIZED)
              .transferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, AMOUNT);
          }).toThrow('MultiToken: unauthorized operator');
        });

        it('should fail when transfer partial', () => {
          expect(() => {
            const partialAmt = AMOUNT - 1n;
            token
              .as(UNAUTHORIZED)
              .transferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, partialAmt);
          }).toThrow('MultiToken: unauthorized operator');
        });

        it('should fail when transfer zero', () => {
          expect(() => {
            token
              .as(UNAUTHORIZED)
              .transferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, 0n);
          }).toThrow('MultiToken: unauthorized operator');
        });

        it('should fail with insufficient balance', () => {
          expect(() => {
            token
              .as(UNAUTHORIZED)
              .transferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, AMOUNT + 1n);
          }).toThrow('MultiToken: unauthorized operator');
        });

        it('should fail with nonexistent id', () => {
          expect(() => {
            token
              .as(UNAUTHORIZED)
              .transferFrom(Z_OWNER, Z_RECIPIENT, NONEXISTENT_ID, AMOUNT);
          }).toThrow('MultiToken: unauthorized operator');
        });

        it('should fail with transfer from zero', () => {
          expect(() => {
            token
              .as(ZERO)
              .transferFrom(utils.ZERO_KEY, Z_RECIPIENT, TOKEN_ID, AMOUNT);
          }).toThrow('MultiToken: invalid sender');
        });
      });
    });

    describe('_unsafeTransferFrom', () => {
      beforeEach(() => {
        token._mint(Z_OWNER, TOKEN_ID, AMOUNT);
      });

      describe.each(callerTypes)('when the caller is the %s', (_, caller) => {
        beforeEach(() => {
          if (caller === SPENDER) {
            token._setApprovalForAll(Z_OWNER, Z_SPENDER, true);
          }
        });

        describe.each(
          recipientTypes,
        )('when the recipient is a %s', (_, recipient) => {
          it('should transfer whole', () => {
            token
              .as(caller)
              ._unsafeTransferFrom(Z_OWNER, recipient, TOKEN_ID, AMOUNT);

            expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(0n);
            expect(token.balanceOf(recipient, TOKEN_ID)).toEqual(AMOUNT);
          });

          it('should transfer partial', () => {
            const partialAmt = AMOUNT - 1n;
            token
              .as(caller)
              ._unsafeTransferFrom(Z_OWNER, recipient, TOKEN_ID, partialAmt);

            expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(
              AMOUNT - partialAmt,
            );
            expect(token.balanceOf(recipient, TOKEN_ID)).toEqual(partialAmt);
          });

          it('should allow transfer of 0 tokens', () => {
            token
              .as(caller)
              ._unsafeTransferFrom(Z_OWNER, recipient, TOKEN_ID, 0n);

            expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(AMOUNT);
            expect(token.balanceOf(recipient, TOKEN_ID)).toEqual(0n);
          });

          it('should handle self-transfer', () => {
            token
              .as(caller)
              ._unsafeTransferFrom(Z_OWNER, Z_OWNER, TOKEN_ID, AMOUNT);
            expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(AMOUNT);
          });

          it('should handle MAX_UINT128 transfer amount', () => {
            // Mint rest of tokens to == MAX_UINT128
            token._mint(Z_OWNER, TOKEN_ID, MAX_UINT128 - AMOUNT);

            token
              .as(caller)
              ._unsafeTransferFrom(Z_OWNER, recipient, TOKEN_ID, MAX_UINT128);
            expect(token.balanceOf(recipient, TOKEN_ID)).toEqual(MAX_UINT128);
          });

          it('should handle rapid state changes', () => {
            // Approve -> Transfer -> Revoke -> Approve
            token.as(OWNER).setApprovalForAll(Z_SPENDER, true);

            token
              .as(OWNER)
              ._unsafeTransferFrom(Z_OWNER, recipient, TOKEN_ID, AMOUNT);
            expect(token.balanceOf(recipient, TOKEN_ID)).toEqual(AMOUNT);

            token.as(OWNER).setApprovalForAll(Z_SPENDER, false);
            expect(token.isApprovedForAll(Z_OWNER, Z_SPENDER)).toBe(false);

            token.as(OWNER).setApprovalForAll(Z_SPENDER, true);
            expect(token.isApprovedForAll(Z_OWNER, Z_SPENDER)).toBe(true);
          });

          it('should fail with insufficient balance', () => {
            expect(() => {
              token
                .as(caller)
                ._unsafeTransferFrom(Z_OWNER, recipient, TOKEN_ID, AMOUNT + 1n);
            }).toThrow('MultiToken: insufficient balance');
          });

          it('should fail with nonexistent id', () => {
            expect(() => {
              token
                .as(caller)
                ._unsafeTransferFrom(
                  Z_OWNER,
                  recipient,
                  NONEXISTENT_ID,
                  AMOUNT,
                );
            }).toThrow('MultiToken: insufficient balance');
          });

          it('should fail with transfer from zero', () => {
            expect(() => {
              token
                .as(caller)
                ._unsafeTransferFrom(
                  utils.ZERO_KEY,
                  recipient,
                  TOKEN_ID,
                  AMOUNT,
                );
            }).toThrow('MultiToken: unauthorized operator');
          });
        });

        it('should fail with transfer to zero (pk)', () => {
          expect(() => {
            token
              .as(caller)
              ._unsafeTransferFrom(Z_OWNER, utils.ZERO_KEY, TOKEN_ID, AMOUNT);
          }).toThrow('MultiToken: invalid receiver');
        });

        it('should fail with transfer to zero (contract)', () => {
          expect(() => {
            token
              .as(caller)
              ._unsafeTransferFrom(
                Z_OWNER,
                utils.ZERO_ADDRESS,
                TOKEN_ID,
                AMOUNT,
              );
          }).toThrow('MultiToken: invalid receiver');
        });
      });

      it('should handle concurrent operations on same token ID', () => {
        token._mint(Z_OWNER, TOKEN_ID, AMOUNT * 2n);

        // Set up two spenders
        token.as(OWNER).setApprovalForAll(Z_SPENDER, true);
        token.as(OWNER).setApprovalForAll(Z_OTHER, true);

        // First spender transfers half
        token
          .as(SPENDER)
          ._unsafeTransferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, AMOUNT);
        expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(AMOUNT);

        // Second spender transfers remaining
        token
          .as(OTHER)
          ._unsafeTransferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, AMOUNT);
        expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(AMOUNT * 2n);
      });

      describe('when the caller is unauthorized', () => {
        describe.each(
          recipientTypes,
        )('when recipient is %s', (_, recipient) => {
          it('should fail when transfer whole', () => {
            expect(() => {
              token
                .as(UNAUTHORIZED)
                ._unsafeTransferFrom(Z_OWNER, recipient, TOKEN_ID, AMOUNT);
            }).toThrow('MultiToken: unauthorized operator');
          });

          it('should fail when transfer partial', () => {
            expect(() => {
              const partialAmt = AMOUNT - 1n;
              token
                .as(UNAUTHORIZED)
                ._unsafeTransferFrom(Z_OWNER, recipient, TOKEN_ID, partialAmt);
            }).toThrow('MultiToken: unauthorized operator');
          });

          it('should fail when transfer zero', () => {
            expect(() => {
              token
                .as(UNAUTHORIZED)
                ._unsafeTransferFrom(Z_OWNER, recipient, TOKEN_ID, 0n);
            }).toThrow('MultiToken: unauthorized operator');
          });

          it('should fail with insufficient balance', () => {
            expect(() => {
              token
                .as(UNAUTHORIZED)
                ._unsafeTransferFrom(Z_OWNER, recipient, TOKEN_ID, AMOUNT + 1n);
            }).toThrow('MultiToken: unauthorized operator');
          });

          it('should fail with nonexistent id', () => {
            expect(() => {
              token
                .as(UNAUTHORIZED)
                ._unsafeTransferFrom(
                  Z_OWNER,
                  recipient,
                  NONEXISTENT_ID,
                  AMOUNT,
                );
            }).toThrow('MultiToken: unauthorized operator');
          });

          it('should fail with transfer from zero', () => {
            expect(() => {
              token
                .as(ZERO)
                ._unsafeTransferFrom(
                  utils.ZERO_KEY,
                  recipient,
                  TOKEN_ID,
                  AMOUNT,
                );
            }).toThrow('MultiToken: invalid sender');
          });
        });
      });
    });

    describe('_transfer', () => {
      beforeEach(() => {
        token._mint(Z_OWNER, TOKEN_ID, AMOUNT);

        expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(AMOUNT);
        expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(0n);
      });

      it('should transfer whole', () => {
        token._transfer(Z_OWNER, Z_RECIPIENT, TOKEN_ID, AMOUNT);

        expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(0n);
        expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(AMOUNT);
      });

      it('should transfer partial', () => {
        const partialAmt = AMOUNT - 1n;
        token._transfer(Z_OWNER, Z_RECIPIENT, TOKEN_ID, partialAmt);

        expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(AMOUNT - partialAmt);
        expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(partialAmt);
      });

      it('should allow transfer of 0 tokens', () => {
        token._transfer(Z_OWNER, Z_RECIPIENT, TOKEN_ID, 0n);

        expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(AMOUNT);
        expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(0n);
      });

      it('should fail with unsufficient balance', () => {
        expect(() => {
          token._transfer(Z_OWNER, Z_RECIPIENT, TOKEN_ID, AMOUNT + 1n);
        }).toThrow('MultiToken: insufficient balance');
      });

      it('should fail with nonexistent id', () => {
        expect(() => {
          token._transfer(Z_OWNER, Z_RECIPIENT, NONEXISTENT_ID, AMOUNT);
        }).toThrow('MultiToken: insufficient balance');
      });

      it('should fail when transfer from 0', () => {
        expect(() => {
          token._transfer(utils.ZERO_KEY, Z_RECIPIENT, TOKEN_ID, AMOUNT);
        }).toThrow('MultiToken: invalid sender');
      });

      it('should fail when transfer to 0', () => {
        expect(() => {
          token._transfer(Z_OWNER, utils.ZERO_KEY, TOKEN_ID, AMOUNT);
        }).toThrow('MultiToken: invalid receiver');
      });

      it('should fail when transfer to contract address', () => {
        expect(() => {
          token._transfer(Z_OWNER, Z_RECIPIENT_CONTRACT, TOKEN_ID, AMOUNT);
        }).toThrow('MultiToken: unsafe transfer');
      });
    });

    describe('_unsafeTransfer', () => {
      beforeEach(() => {
        token._mint(Z_OWNER, TOKEN_ID, AMOUNT);

        expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(AMOUNT);
        expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(0n);
      });

      describe.each(
        recipientTypes,
      )('when the recipient is a %s', (_, recipient) => {
        it('should transfer whole', () => {
          token._unsafeTransfer(Z_OWNER, recipient, TOKEN_ID, AMOUNT);

          expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(0n);
          expect(token.balanceOf(recipient, TOKEN_ID)).toEqual(AMOUNT);
        });

        it('should transfer partial', () => {
          const partialAmt = AMOUNT - 1n;
          token._unsafeTransfer(Z_OWNER, recipient, TOKEN_ID, partialAmt);

          expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(
            AMOUNT - partialAmt,
          );
          expect(token.balanceOf(recipient, TOKEN_ID)).toEqual(partialAmt);
        });

        it('should allow transfer of 0 tokens', () => {
          token._unsafeTransfer(Z_OWNER, recipient, TOKEN_ID, 0n);

          expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(AMOUNT);
          expect(token.balanceOf(recipient, TOKEN_ID)).toEqual(0n);
        });

        it('should fail with unsufficient balance', () => {
          expect(() => {
            token._unsafeTransfer(Z_OWNER, recipient, TOKEN_ID, AMOUNT + 1n);
          }).toThrow('MultiToken: insufficient balance');
        });

        it('should fail with nonexistent id', () => {
          expect(() => {
            token._unsafeTransfer(Z_OWNER, recipient, NONEXISTENT_ID, AMOUNT);
          }).toThrow('MultiToken: insufficient balance');
        });

        it('should fail when transfer from 0 (pk)', () => {
          expect(() => {
            token._unsafeTransfer(utils.ZERO_KEY, recipient, TOKEN_ID, AMOUNT);
          }).toThrow('MultiToken: invalid sender');
        });

        it('should fail when transfer from 0 (contract address)', () => {
          expect(() => {
            token._unsafeTransfer(
              utils.ZERO_ADDRESS,
              recipient,
              TOKEN_ID,
              AMOUNT,
            );
          }).toThrow('MultiToken: invalid sender');
        });
      });

      it('should fail when transfer to 0 (pk)', () => {
        expect(() => {
          token._unsafeTransfer(Z_OWNER, utils.ZERO_KEY, TOKEN_ID, AMOUNT);
        }).toThrow('MultiToken: invalid receiver');
      });

      it('should fail when transfer to 0 (contract address)', () => {
        expect(() => {
          token._unsafeTransfer(Z_OWNER, utils.ZERO_ADDRESS, TOKEN_ID, AMOUNT);
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
        token._mint(Z_RECIPIENT, TOKEN_ID, AMOUNT);
        expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(AMOUNT);
      });

      it('should update balance with multiple mints', () => {
        for (let i = 0; i < 3; i++) {
          token._mint(Z_RECIPIENT, TOKEN_ID, 1n);
        }

        expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(3n);
      });

      it('should fail when overflowing uin128', () => {
        token._mint(Z_RECIPIENT, TOKEN_ID, MAX_UINT128);

        expect(() => {
          token._mint(Z_RECIPIENT, TOKEN_ID, 1n);
        }).toThrow('MultiToken: arithmetic overflow');
      });

      it('should fail when minting to zero address (pk)', () => {
        expect(() => {
          token._mint(utils.ZERO_KEY, TOKEN_ID, AMOUNT);
        }).toThrow('MultiToken: invalid receiver');
      });

      it('should fail when minting to zero address (contract)', () => {
        expect(() => {
          token._mint(utils.ZERO_ADDRESS, TOKEN_ID, AMOUNT);
        }).toThrow('MultiToken: unsafe transfer');
      });

      it('should fail when minting to a contract address', () => {
        expect(() => {
          token._mint(Z_RECIPIENT_CONTRACT, TOKEN_ID, AMOUNT);
        }).toThrow('MultiToken: unsafe transfer');
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

      it('should fail when minting to zero address (pk)', () => {
        expect(() => {
          token._unsafeMint(utils.ZERO_KEY, TOKEN_ID, AMOUNT);
        }).toThrow('MultiToken: invalid receiver');
      });

      it('should fail when minting to zero address (contract)', () => {
        expect(() => {
          token._unsafeMint(utils.ZERO_ADDRESS, TOKEN_ID, AMOUNT);
        }).toThrow('MultiToken: invalid receiver');
      });
    });

    describe('_burn', () => {
      beforeEach(() => {
        token._mint(Z_OWNER, TOKEN_ID, AMOUNT);
        expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(AMOUNT);
      });

      it('should burn tokens', () => {
        token._burn(Z_OWNER, TOKEN_ID, AMOUNT);
        expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(0n);
      });

      it('should burn partial', () => {
        const partialAmt = 1n;
        token._burn(Z_OWNER, TOKEN_ID, partialAmt);
        expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(AMOUNT - partialAmt);
      });

      it('should update balance with multiple burns', () => {
        for (let i = 0; i < 3; i++) {
          token._burn(Z_OWNER, TOKEN_ID, 1n);
        }

        expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(AMOUNT - 3n);
      });

      it('should fail when not enough balance to burn', () => {
        expect(() => {
          token._burn(Z_OWNER, TOKEN_ID, AMOUNT + 1n);
        }).toThrow('MultiToken: insufficient balance');
      });

      it('should fail when burning the zero address tokens', () => {
        expect(() => {
          token._burn(utils.ZERO_KEY, TOKEN_ID, AMOUNT);
        }).toThrow('MultiToken: invalid sender');
      });

      it('should fail when burning tokens from nonexistent id', () => {
        expect(() => {
          token._burn(Z_OWNER, NONEXISTENT_ID, AMOUNT);
        }).toThrow('MultiToken: insufficient balance');
      });
    });

    describe('_setApprovalForAll', () => {
      it('should return false when set to false', () => {
        token._setApprovalForAll(Z_OWNER, Z_SPENDER, false);
        expect(token.isApprovedForAll(Z_OWNER, Z_SPENDER)).toBe(false);
      });

      it('should fail when attempting to approve zero address as an operator', () => {
        expect(() => {
          token._setApprovalForAll(Z_OWNER, utils.ZERO_KEY, true);
        }).toThrow('MultiToken: invalid operator');
      });

      it('should set → unset → set operator', () => {
        token._setApprovalForAll(Z_OWNER, Z_SPENDER, true);
        expect(token.isApprovedForAll(Z_OWNER, Z_SPENDER)).toBe(true);

        token._setApprovalForAll(Z_OWNER, Z_SPENDER, false);
        expect(token.isApprovedForAll(Z_OWNER, Z_SPENDER)).toBe(false);

        token._setApprovalForAll(Z_OWNER, Z_SPENDER, true);
        expect(token.isApprovedForAll(Z_OWNER, Z_SPENDER)).toBe(true);
      });
    });
  });
});
