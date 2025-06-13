import type { CoinPublicKey } from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { MultiTokenSimulator } from './simulators/MultiTokenSimulator';
import type { MaybeString } from './types/string';
import * as utils from './utils/address';

// URIs
const NO_STRING = '';
const URI = 'https://uri.com/mock_v1';
const NEW_URI = 'https://uri.com/mock_v2';

// Amounts
const AMOUNT: bigint = BigInt(250);
const AMOUNT2: bigint = BigInt(9999);
const AMOUNT3: bigint = BigInt(987654321);
const MAX_UINT128 = BigInt(2 ** 128) - BigInt(1);

// IDs
const TOKEN_ID: bigint = BigInt(1);
const TOKEN_ID2: bigint = BigInt(22);
const TOKEN_ID3: bigint = BigInt(333);
const NONEXISTENT_ID: bigint = BigInt(987654321);

// PubKeys/addresses
const OWNER = String(Buffer.from('OWNER', 'ascii').toString('hex')).padStart(
  64,
  '0',
);
const SPENDER = String(
  Buffer.from('SPENDER', 'ascii').toString('hex'),
).padStart(64, '0');
const UNAUTHORIZED = String(
  Buffer.from('UNAUTHORIZED', 'ascii').toString('hex'),
).padStart(64, '0');
const ZERO = String().padStart(64, '0');
const Z_OWNER = utils.createEitherTestUser('OWNER');
const Z_RECIPIENT = utils.createEitherTestUser('RECIPIENT');
const Z_SPENDER = utils.createEitherTestUser('SPENDER');
const Z_OTHER = utils.createEitherTestUser('OTHER');
//const Z_OWNER_CONTRACT =
//  utils.createEitherTestContractAddress('OWNER_CONTRACT');
const Z_RECIPIENT_CONTRACT =
  utils.createEitherTestContractAddress('RECIPIENT_CONTRACT');
//const Z_SPENDER_CONTRACT =
//  utils.createEitherTestContractAddress('SPENDER_CONTRACT');
//const Z_OTHER_CONTRACT =
//  utils.createEitherTestContractAddress('OTHER_CONTRACT');

// Init
const initWithURI: MaybeString = {
  is_some: true,
  value: URI,
};

const initWithEmptyURI: MaybeString = {
  is_some: true,
  value: '',
};

const badInit: MaybeString = {
  is_some: false,
  value: '',
};

let token: MultiTokenSimulator;
let caller: CoinPublicKey;

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
    const circuitsToFail: FailingCircuits[] = [
      ['uri', [TOKEN_ID]],
      ['balanceOf', [Z_OWNER, TOKEN_ID]],
      [
        'balanceOfBatch_10',
        [new Array(10).fill(Z_OWNER, 0, 10), new Array(10).fill(0n, 0, 10)],
      ],
      ['setApprovalForAll', [Z_OWNER, true]],
      ['isApprovedForAll', [Z_OWNER, Z_SPENDER]],
      ['transferFrom', [Z_OWNER, Z_RECIPIENT, TOKEN_ID, AMOUNT]],
      ['_transferFrom', [Z_OWNER, Z_RECIPIENT, TOKEN_ID, AMOUNT]],
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

      it('should handle token ID 0', () => {
        const ZERO_ID = 0n;
        token._mint(Z_OWNER, ZERO_ID, AMOUNT);
        expect(token.balanceOf(Z_OWNER, ZERO_ID)).toEqual(AMOUNT);
      });

      it('should handle MAX_UINT128 token ID', () => {
        const MAX_ID = MAX_UINT128;
        token._mint(Z_OWNER, MAX_ID, AMOUNT);
        expect(token.balanceOf(Z_OWNER, MAX_ID)).toEqual(AMOUNT);
      });
    });

    describe('balanceOfBatch_10', () => {
      it('should return zero when requested account has no balance', () => {
        // pks
        const pks = [Z_OWNER, Z_OTHER];
        const pk_padding = utils.ZERO_KEY;
        for (let i = pks.length; i < 10; i++) {
          pks.push(pk_padding);
        }

        // ids
        const ids = [1n, 2n, 3n];
        const id_padding = 0n;
        for (let i = ids.length; i < 10; i++) {
          ids.push(id_padding);
        }

        const noBalances10 = new Array(10).fill(0n, 0, 10);
        expect(token.balanceOfBatch_10(pks, ids)).toEqual(noBalances10);
      });

      it('should return balance when requested accounts have tokens (no padding)', () => {
        const owner1 = Z_OWNER;
        const owner2 = Z_RECIPIENT;
        const ownerNoBal = Z_OTHER;

        // pks
        const pks = [
          owner1,
          owner1,
          owner1,
          ownerNoBal,
          ownerNoBal,
          ownerNoBal,
          owner2,
          owner2,
          owner2,
          owner1,
        ];

        // ids
        const ids = [
          TOKEN_ID,
          TOKEN_ID2,
          TOKEN_ID3,
          TOKEN_ID,
          TOKEN_ID2,
          TOKEN_ID3,
          TOKEN_ID,
          TOKEN_ID2,
          TOKEN_ID3,
          NONEXISTENT_ID,
        ];

        // amounts
        const amounts = [
          AMOUNT,
          AMOUNT2,
          AMOUNT3,
          0n,
          0n,
          0n,
          AMOUNT,
          AMOUNT2,
          AMOUNT3,
          0n,
        ];

        for (let i = 0; i < ids.length; i++) {
          token._mint(pks[i], ids[i], amounts[i]);
        }

        expect(token.balanceOfBatch_10(pks, ids)).toEqual(amounts);
      });

      it('should return balance when requested accounts have tokens (with padding)', () => {
        const owner1 = Z_OWNER;
        const owner2 = Z_RECIPIENT;
        const ownerNoBal = Z_OTHER;

        // pks - add padding
        const pks = [owner1, ownerNoBal, owner2];
        const pk_padding = utils.ZERO_KEY;
        for (let i = pks.length; i < 10; i++) {
          pks.push(pk_padding);
        }

        // ids - add padding
        const ids = [TOKEN_ID, TOKEN_ID2, TOKEN_ID3];
        const id_padding = 0n;
        for (let i = ids.length; i < 10; i++) {
          ids.push(id_padding);
        }

        // amounts - add padding
        const amounts = [AMOUNT, 0n, AMOUNT2];
        const amt_padding = 0n;
        for (let i = amounts.length; i < 10; i++) {
          amounts.push(amt_padding);
        }

        // mint
        token._mint(pks[0], ids[0], amounts[0]); // owner1 => TOKEN_ID => AMOUNT
        token._mint(pks[1], ids[1], amounts[1]); // ownerNoBal => TOKEN_ID2 => 0n
        token._mint(pks[2], ids[2], amounts[2]); // owner2 => TOKEN_ID3 => AMOUNT2

        expect(token.balanceOfBatch_10(pks, ids)).toEqual(amounts);
      });

      it('should handle duplicate token IDs in balanceOfBatch_10', () => {
        const pks = Array(10).fill(Z_OWNER);
        const ids = Array(10).fill(TOKEN_ID);
        const amounts = Array(10).fill(AMOUNT);

        // Mint AMOUNT tokens total, not AMOUNT * 10
        token._mint(Z_OWNER, TOKEN_ID, AMOUNT);
        expect(token.balanceOfBatch_10(pks, ids)).toEqual(amounts);
      });

      it('should handle all zero addresses in balanceOfBatch_10', () => {
        const pks = Array(10).fill(utils.ZERO_KEY);
        const ids = Array(10).fill(0n);
        const amounts = Array(10).fill(0n);

        expect(token.balanceOfBatch_10(pks, ids)).toEqual(amounts);
      });
    });

    describe('isApprovedForAll', () => {
      it('should return false when not set', () => {
        expect(token.isApprovedForAll(Z_OWNER, Z_SPENDER)).toBe(false);
      });

      it('should handle approving owner as operator', () => {
        token.setApprovalForAll(Z_OWNER, true, OWNER);
        expect(token.isApprovedForAll(Z_OWNER, Z_OWNER)).toBe(true);
      });

      it('should handle multiple approvals of same operator', () => {
        token.setApprovalForAll(Z_SPENDER, true, OWNER);
        token.setApprovalForAll(Z_SPENDER, true, OWNER);
        expect(token.isApprovedForAll(Z_OWNER, Z_SPENDER)).toBe(true);
      });

      it('should handle revoking non-existent approval', () => {
        token.setApprovalForAll(Z_SPENDER, false, OWNER);
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
        }).toThrow('MultiToken: invalid operator');
      });

      describe('when spender is approved as an operator', () => {
        beforeEach(() => {
          caller = OWNER;
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

    describe('transferFrom', () => {
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
          token.transferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, AMOUNT, caller);

          expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(0n);
          expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(AMOUNT);
        });

        it('should transfer partial', () => {
          const partialAmt = AMOUNT - 1n;
          token.transferFrom(
            Z_OWNER,
            Z_RECIPIENT,
            TOKEN_ID,
            partialAmt,
            caller,
          );

          expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(
            AMOUNT - partialAmt,
          );
          expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(partialAmt);
        });

        it('should allow transfer of 0 tokens', () => {
          token.transferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, 0n, caller);

          expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(AMOUNT);
          expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(0n);
        });

        it('should handle self-transfer', () => {
          token.transferFrom(Z_OWNER, Z_OWNER, TOKEN_ID, AMOUNT, caller);
          expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(AMOUNT);
        });

        it('should handle MAX_UINT128 transfer amount', () => {
          // Mint rest of tokens to == MAX_UINT128
          token._mint(Z_OWNER, TOKEN_ID, MAX_UINT128 - AMOUNT);

          token.transferFrom(
            Z_OWNER,
            Z_RECIPIENT,
            TOKEN_ID,
            MAX_UINT128,
            caller,
          );
          expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(MAX_UINT128);
        });

        it('should handle rapid state changes', () => {
          // Approve -> Transfer -> Revoke -> Approve
          token.setApprovalForAll(Z_SPENDER, true, caller);

          token.transferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, AMOUNT, SPENDER);
          expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(AMOUNT);

          token.setApprovalForAll(Z_SPENDER, false, caller);
          expect(token.isApprovedForAll(Z_OWNER, Z_SPENDER)).toBe(false);

          token.setApprovalForAll(Z_SPENDER, true, caller);
          expect(token.isApprovedForAll(Z_OWNER, Z_SPENDER)).toBe(true);
        });

        it('should handle concurrent operations on same token ID', () => {
          token._mint(Z_OWNER, TOKEN_ID, AMOUNT * 2n);

          // Set up two spenders
          token.setApprovalForAll(Z_SPENDER, true, caller);
          token.setApprovalForAll(Z_OTHER, true, caller);

          // First spender transfers half
          token.transferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, AMOUNT, SPENDER);
          expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(AMOUNT);

          // Second spender transfers remaining
          token.transferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, AMOUNT, SPENDER);
          expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(AMOUNT * 2n);
        });

        it('should fail with insufficient balance', () => {
          expect(() => {
            token.transferFrom(
              Z_OWNER,
              Z_RECIPIENT,
              TOKEN_ID,
              AMOUNT + 1n,
              caller,
            );
          }).toThrow('MultiToken: insufficient balance');
        });

        it('should fail with nonexistent id', () => {
          expect(() => {
            token.transferFrom(
              Z_OWNER,
              Z_RECIPIENT,
              NONEXISTENT_ID,
              AMOUNT,
              caller,
            );
          }).toThrow('MultiToken: insufficient balance');
        });

        it('should fail with transfer from zero', () => {
          expect(() => {
            token.transferFrom(
              utils.ZERO_KEY,
              Z_RECIPIENT,
              TOKEN_ID,
              AMOUNT,
              caller,
            );
          }).toThrow('MultiToken: unauthorized operator');
        });

        it('should fail with transfer to zero', () => {
          expect(() => {
            token.transferFrom(
              Z_OWNER,
              utils.ZERO_KEY,
              TOKEN_ID,
              AMOUNT,
              caller,
            );
          }).toThrow('MultiToken: invalid receiver');
        });

        it('should fail when transferring to a contract address', () => {
          expect(() => {
            token.transferFrom(
              Z_OWNER,
              Z_RECIPIENT_CONTRACT,
              TOKEN_ID,
              AMOUNT,
              caller,
            );
          }).toThrow('MultiToken: unsafe transfer');
        });
      });

      describe('when caller is spender', () => {
        beforeEach(() => {
          token._setApprovalForAll(Z_OWNER, Z_SPENDER, true);
          caller = SPENDER;

          expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(AMOUNT);
          expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(0n);
        });

        it('should transfer whole', () => {
          token.transferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, AMOUNT, caller);

          expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(0n);
          expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(AMOUNT);
        });

        it('should transfer partial', () => {
          const partialAmt = AMOUNT - 1n;
          token.transferFrom(
            Z_OWNER,
            Z_RECIPIENT,
            TOKEN_ID,
            partialAmt,
            caller,
          );

          expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(
            AMOUNT - partialAmt,
          );
          expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(partialAmt);
        });

        it('should allow transfer of 0 tokens', () => {
          token.transferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, 0n, caller);

          expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(AMOUNT);
          expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(0n);
        });

        it('should fail with insufficient balance', () => {
          expect(() => {
            token.transferFrom(
              Z_OWNER,
              Z_RECIPIENT,
              TOKEN_ID,
              AMOUNT + 1n,
              caller,
            );
          }).toThrow('MultiToken: insufficient balance');
        });

        it('should fail with nonexistent id', () => {
          expect(() => {
            token.transferFrom(
              Z_OWNER,
              Z_RECIPIENT,
              NONEXISTENT_ID,
              AMOUNT,
              caller,
            );
          }).toThrow('MultiToken: insufficient balance');
        });

        it('should fail with transfer from zero', () => {
          expect(() => {
            token.transferFrom(
              utils.ZERO_KEY,
              Z_RECIPIENT,
              TOKEN_ID,
              AMOUNT,
              caller,
            );
          }).toThrow('MultiToken: unauthorized operator');
        });

        it('should fail with transfer to zero', () => {
          expect(() => {
            token.transferFrom(
              Z_OWNER,
              utils.ZERO_KEY,
              TOKEN_ID,
              AMOUNT,
              caller,
            );
          }).toThrow('MultiToken: invalid receiver');
        });
      });

      describe('when caller is unauthorized', () => {
        beforeEach(() => {
          caller = UNAUTHORIZED;
        });

        it('should fail when transfer whole', () => {
          expect(() => {
            token.transferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, AMOUNT, caller);
          }).toThrow('MultiToken: unauthorized operator');
        });

        it('should fail when transfer partial', () => {
          expect(() => {
            const partialAmt = AMOUNT - 1n;
            token.transferFrom(
              Z_OWNER,
              Z_RECIPIENT,
              TOKEN_ID,
              partialAmt,
              caller,
            );
          }).toThrow('MultiToken: unauthorized operator');
        });

        it('should fail when transfer zero', () => {
          expect(() => {
            token.transferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, 0n, caller);
          }).toThrow('MultiToken: unauthorized operator');
        });

        it('should fail with insufficient balance', () => {
          expect(() => {
            token.transferFrom(
              Z_OWNER,
              Z_RECIPIENT,
              TOKEN_ID,
              AMOUNT + 1n,
              caller,
            );
          }).toThrow('MultiToken: unauthorized operator');
        });

        it('should fail with nonexistent id', () => {
          expect(() => {
            token.transferFrom(
              Z_OWNER,
              Z_RECIPIENT,
              NONEXISTENT_ID,
              AMOUNT,
              caller,
            );
          }).toThrow('MultiToken: unauthorized operator');
        });

        it('should fail with transfer from zero', () => {
          caller = ZERO;

          expect(() => {
            token.transferFrom(
              utils.ZERO_KEY,
              Z_RECIPIENT,
              TOKEN_ID,
              AMOUNT,
              caller,
            );
          }).toThrow('MultiToken: invalid sender');
        });
      });
    });

    describe('_transferFrom', () => {
      beforeEach(() => {
        token._mint(Z_OWNER, TOKEN_ID, AMOUNT);

        expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(AMOUNT);
        expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(0n);
      });

      it('should transfer whole', () => {
        token._transferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, AMOUNT);

        expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(0n);
        expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(AMOUNT);
      });

      it('should transfer partial', () => {
        const partialAmt = AMOUNT - 1n;
        token._transferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, partialAmt);

        expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(AMOUNT - partialAmt);
        expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(partialAmt);
      });

      it('should allow transfer of 0 tokens', () => {
        token._transferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, 0n);

        expect(token.balanceOf(Z_OWNER, TOKEN_ID)).toEqual(AMOUNT);
        expect(token.balanceOf(Z_RECIPIENT, TOKEN_ID)).toEqual(0n);
      });

      it('should fail with unsufficient balance', () => {
        expect(() => {
          token._transferFrom(Z_OWNER, Z_RECIPIENT, TOKEN_ID, AMOUNT + 1n);
        }).toThrow('MultiToken: insufficient balance');
      });

      it('should fail with nonexistent id', () => {
        expect(() => {
          token._transferFrom(Z_OWNER, Z_RECIPIENT, NONEXISTENT_ID, AMOUNT);
        }).toThrow('MultiToken: insufficient balance');
      });

      it('should fail when transfer from 0', () => {
        expect(() => {
          token._transferFrom(utils.ZERO_KEY, Z_RECIPIENT, TOKEN_ID, AMOUNT);
        }).toThrow('MultiToken: invalid sender');
      });

      it('should fail when transfer to 0', () => {
        expect(() => {
          token._transferFrom(Z_OWNER, utils.ZERO_KEY, TOKEN_ID, AMOUNT);
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
      describe('when the recipient is a pubkey', () => {
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

        it('should fail when minting to zero address', () => {
          expect(() => {
            token._mint(utils.ZERO_KEY, TOKEN_ID, AMOUNT);
          }).toThrow('MultiToken: invalid receiver');
        });
      });

      describe('when the recipient is a contract address', () => {
        it('should fail when minting to a contract address', () => {
          expect(() => {
            token._mint(Z_RECIPIENT_CONTRACT, TOKEN_ID, AMOUNT);
          }).toThrow('MultiToken: unsafe transfer');
        });
      });
    });

    describe('_unsafeMint', () => {
      const caseContractOrPK = [[Z_RECIPIENT_CONTRACT], [Z_RECIPIENT]];

      describe.each(caseContractOrPK)('%s', (recipient) => {
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
          token._unsafeMint(utils.ZERO_KEY, TOKEN_ID, AMOUNT);
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
