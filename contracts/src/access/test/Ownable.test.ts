import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import { OwnableSimulator } from './simulators/OwnableSimulator.js';

// PKs
const [OWNER, Z_OWNER] = utils.generateEitherPubKeyPair('OWNER');
const [NEW_OWNER, Z_NEW_OWNER] = utils.generateEitherPubKeyPair('NEW_OWNER');
const [UNAUTHORIZED, _] = utils.generateEitherPubKeyPair('UNAUTHORIZED');

// Encoded contract addresses
const Z_OWNER_CONTRACT =
  utils.createEitherTestContractAddress('OWNER_CONTRACT');
const Z_RECIPIENT_CONTRACT =
  utils.createEitherTestContractAddress('RECIPIENT_CONTRACT');

const isInit = true;
const isBadInit = false;

let ownable: OwnableSimulator;

const zeroTypes = [
  ['contract', utils.ZERO_ADDRESS],
  ['pubkey', utils.ZERO_KEY],
] as const;

const newOwnerTypes = [
  ['contract', Z_OWNER_CONTRACT],
  ['pubkey', Z_NEW_OWNER],
] as const;

describe('Ownable', () => {
  describe('before initialized', () => {
    it('should initialize', () => {
      ownable = new OwnableSimulator(Z_OWNER, isInit);
      expect(ownable.owner()).toEqual(Z_OWNER);
    });

    it('should fail to initialize when owner is a contract address', () => {
      expect(() => {
        new OwnableSimulator(Z_OWNER_CONTRACT, isInit);
      }).toThrow('Ownable: unsafe ownership transfer');
    });

    it.each(
      zeroTypes,
    )('should fail to initialize when owner is zero (%s)', (_, _zero) => {
      expect(() => {
        ownable = new OwnableSimulator(_zero, isInit);
      }).toThrow('Ownable: invalid initial owner');
    });

    type FailingCircuits = [method: keyof OwnableSimulator, args: unknown[]];
    // Circuit calls should fail before the args are used
    const circuitsToFail: FailingCircuits[] = [
      ['owner', []],
      ['assertOnlyOwner', []],
      ['transferOwnership', [Z_OWNER]],
      ['_unsafeTransferOwnership', [Z_OWNER]],
      ['renounceOwnership', []],
      ['_transferOwnership', [Z_OWNER]],
      ['_unsafeUncheckedTransferOwnership', [Z_OWNER]],
    ];
    it.each(
      circuitsToFail,
    )('should fail when calling circuit "%s"', (circuitName, args) => {
      ownable = new OwnableSimulator(Z_OWNER, isBadInit);
      expect(() => {
        (ownable[circuitName] as (...args: unknown[]) => unknown)(...args);
      }).toThrow('Initializable: contract not initialized');
    });
  });

  describe('when initialized', () => {
    beforeEach(() => {
      ownable = new OwnableSimulator(Z_OWNER, isInit);
    });

    describe('owner', () => {
      it('should return owner', () => {
        expect(ownable.owner()).toEqual(Z_OWNER);
      });

      it('should return zero address when unowned', () => {
        ownable._transferOwnership(utils.ZERO_KEY);
        expect(ownable.owner()).toEqual(utils.ZERO_KEY);
      });
    });

    describe('assertOnlyOwner', () => {
      it('should allow owner to call', () => {
        expect(() => {
          ownable.as(OWNER).assertOnlyOwner();
        }).not.toThrow();
      });

      it('should fail when called by unauthorized', () => {
        expect(() => {
          ownable.as(UNAUTHORIZED).assertOnlyOwner();
        }).toThrow('Ownable: caller is not the owner');
      });

      it('should fail when owner is a contract address', () => {
        ownable._unsafeUncheckedTransferOwnership(Z_OWNER_CONTRACT);
        expect(() => {
          ownable.as(OWNER).assertOnlyOwner();
        }).toThrow(
          'Ownable: contract address owner authentication is not yet supported',
        );
      });
    });

    describe('transferOwnership', () => {
      it('should transfer ownership', () => {
        ownable.as(OWNER).transferOwnership(Z_NEW_OWNER);
        expect(ownable.owner()).toEqual(Z_NEW_OWNER);

        // Original owner
        expect(() => {
          ownable.as(OWNER).assertOnlyOwner();
        }).toThrow('Ownable: caller is not the owner');

        expect(() => {
          ownable.as(UNAUTHORIZED).assertOnlyOwner();
        }).toThrow('Ownable: caller is not the owner');

        expect(() => {
          ownable.as(NEW_OWNER).assertOnlyOwner();
        }).not.toThrow();
      });

      it('should fail when unauthorized transfers ownership', () => {
        expect(() => {
          ownable.as(UNAUTHORIZED).transferOwnership(Z_NEW_OWNER);
        }).toThrow('Ownable: caller is not the owner');
      });

      it('should fail when transferring to a contract address', () => {
        expect(() => {
          ownable.as(OWNER).transferOwnership(Z_RECIPIENT_CONTRACT);
        }).toThrow('Ownable: unsafe ownership transfer');
      });

      it('should fail when transferring to zero (pk)', () => {
        expect(() => {
          ownable.as(OWNER).transferOwnership(utils.ZERO_KEY);
        }).toThrow('Ownable: invalid new owner');
      });

      it('should fail when transferring to zero (contract)', () => {
        expect(() => {
          ownable.as(OWNER).transferOwnership(utils.ZERO_ADDRESS);
        }).toThrow('Ownable: unsafe ownership transfer');
      });

      it('should transfer multiple times', () => {
        ownable.as(OWNER).transferOwnership(Z_NEW_OWNER);

        ownable.as(NEW_OWNER).transferOwnership(Z_OWNER);

        ownable.as(OWNER).transferOwnership(Z_NEW_OWNER);

        expect(ownable.owner()).toEqual(Z_NEW_OWNER);
      });
    });

    describe('_unsafeTransferOwnership', () => {
      describe.each(
        newOwnerTypes,
      )('when the new owner is a %s', (type, newOwner) => {
        it('should transfer ownership', () => {
          ownable.as(OWNER)._unsafeTransferOwnership(newOwner);
          expect(ownable.owner()).toEqual(newOwner);

          if (type === 'pubkey') {
            expect(() => {
              ownable.as(NEW_OWNER).assertOnlyOwner();
            }).not.toThrow();
          } else {
            expect(() => {
              ownable.as(OWNER).assertOnlyOwner();
            }).toThrow(
              'Ownable: contract address owner authentication is not yet supported',
            );
          }
        });
      });

      it('should fail when unauthorized transfers ownership', () => {
        expect(() => {
          ownable.as(UNAUTHORIZED)._unsafeTransferOwnership(Z_NEW_OWNER);
        }).toThrow('Ownable: caller is not the owner');
      });

      it('should fail when transferring to zero (pk)', () => {
        expect(() => {
          ownable.as(OWNER)._unsafeTransferOwnership(utils.ZERO_KEY);
        }).toThrow('Ownable: invalid new owner');
      });

      it('should fail when transferring to zero (contract)', () => {
        expect(() => {
          ownable.as(OWNER)._unsafeTransferOwnership(utils.ZERO_ADDRESS);
        }).toThrow('Ownable: invalid new owner');
      });

      it('should canonicalize crafted Either inputs (contract side)', () => {
        const crafted = {
          is_left: false,
          left: Z_NEW_OWNER.left,
          right: Z_OWNER_CONTRACT.right,
        };
        ownable.as(OWNER)._unsafeTransferOwnership(crafted);
        const stored = ownable.owner();
        // left must be zeroed after canonicalization
        expect(stored.left).toEqual(utils.ZERO_KEY.left);
        expect(stored.right).toEqual(Z_OWNER_CONTRACT.right);
      });
    });

    describe('renounceOwnership', () => {
      it('should renounce ownership', () => {
        expect(ownable.owner()).toEqual(Z_OWNER);

        ownable.as(OWNER).renounceOwnership();

        // Check owner
        expect(ownable.owner()).toEqual(utils.ZERO_KEY);

        // Confirm revoked permissions
        expect(() => {
          ownable.as(OWNER).assertOnlyOwner();
        }).toThrow('Ownable: caller is not the owner');
      });

      it('should fail when renouncing from unauthorized', () => {
        expect(() => {
          ownable.as(UNAUTHORIZED).renounceOwnership();
        }).toThrow('Ownable: caller is not the owner');
      });
    });

    describe('_transferOwnership', () => {
      it('should transfer ownership', () => {
        ownable._transferOwnership(Z_NEW_OWNER);
        expect(ownable.owner()).toEqual(Z_NEW_OWNER);

        // Original owner
        expect(() => {
          ownable.as(OWNER).assertOnlyOwner();
        }).toThrow('Ownable: caller is not the owner');

        expect(() => {
          ownable.as(UNAUTHORIZED).assertOnlyOwner();
        }).toThrow('Ownable: caller is not the owner');

        expect(() => {
          ownable.as(NEW_OWNER).assertOnlyOwner();
        }).not.toThrow();
      });

      it('should allow transfers to zero', () => {
        ownable._transferOwnership(utils.ZERO_KEY);
        expect(ownable.owner()).toEqual(utils.ZERO_KEY);
      });

      it('should fail when transferring ownership to contract address zero', () => {
        expect(() => {
          ownable._transferOwnership(utils.ZERO_ADDRESS);
        }).toThrow('Ownable: unsafe ownership transfer');
      });

      it('should fail when transferring ownership to non-zero contract address', () => {
        expect(() => {
          ownable._transferOwnership(Z_OWNER_CONTRACT);
        }).toThrow('Ownable: unsafe ownership transfer');
      });

      it('should transfer multiple times', () => {
        ownable.as(OWNER)._transferOwnership(Z_NEW_OWNER);

        ownable.as(NEW_OWNER)._transferOwnership(Z_OWNER);

        ownable.as(OWNER)._transferOwnership(Z_NEW_OWNER);

        expect(ownable.owner()).toEqual(Z_NEW_OWNER);
      });
    });

    describe('_unsafeUncheckedTransferOwnership', () => {
      describe.each(
        newOwnerTypes,
      )('when the new owner is a %s', (_, newOwner) => {
        it('should transfer ownership without caller check', () => {
          ownable._unsafeUncheckedTransferOwnership(newOwner);
          expect(ownable.owner()).toEqual(newOwner);
        });
      });

      it('should canonicalize crafted Either inputs (contract side)', () => {
        const crafted = {
          is_left: false,
          left: Z_NEW_OWNER.left,
          right: Z_OWNER_CONTRACT.right,
        };
        ownable._unsafeUncheckedTransferOwnership(crafted);
        const stored = ownable.owner();
        expect(stored.left).toEqual(utils.ZERO_KEY.left);
        expect(stored.right).toEqual(Z_OWNER_CONTRACT.right);
      });

      it('should canonicalize crafted Either inputs (pubkey side)', () => {
        const crafted = {
          is_left: true,
          left: Z_NEW_OWNER.left,
          right: Z_OWNER_CONTRACT.right,
        };
        ownable._unsafeUncheckedTransferOwnership(crafted);
        const stored = ownable.owner();
        expect(stored.left).toEqual(Z_NEW_OWNER.left);
        expect(stored.right).toEqual(utils.ZERO_ADDRESS.right);
      });
    });
  });
});
