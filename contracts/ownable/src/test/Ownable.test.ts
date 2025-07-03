import type { CoinPublicKey } from '@midnight-ntwrk/compact-runtime';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OwnableSimulator } from './simulators/OwnableSimulator';
import * as utils from './utils/address';

// Callers
const OWNER = utils.toHexPadded('OWNER');
const NEW_OWNER = utils.toHexPadded('NEW_OWNER');
const UNAUTHORIZED = utils.toHexPadded('UNAUTHORIZED');
const ZERO = utils.toHexPadded('');

// Encoded PK/Addresses
const Z_OWNER = utils.createEitherTestUser('OWNER');
const Z_NEW_OWNER = utils.createEitherTestUser('NEW_OWNER');
const Z_OTHER = utils.createEitherTestUser('OTHER');
const Z_OWNER_CONTRACT =
  utils.createEitherTestContractAddress('OWNER_CONTRACT');
const Z_RECIPIENT_CONTRACT =
  utils.createEitherTestContractAddress('RECIPIENT_CONTRACT');

const unsafeOwnerInit = true;
const ownerInit = false;

let ownable: OwnableSimulator;
let caller: CoinPublicKey;

const ownerTypes = [
  ['contract', Z_OWNER_CONTRACT],
  ['pubkey', Z_OWNER],
] as const;

describe('Ownable', () => {
  describe.each(ownerTypes)('unsafe initialization when the owner is a %s', (_, _owner) => {
    it('should initialize', () => {
      ownable = new OwnableSimulator(_owner, unsafeOwnerInit);

      expect(ownable.owner()).toEqual(_owner);
    });
  });

  describe('when initialized', () => {
    beforeEach(() => {
      ownable = new OwnableSimulator(Z_OWNER, ownerInit);
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

    describe('pendingOwner', () => {
      it('should return pending owner when zero', () => {
        expect(ownable.pendingOwner()).toEqual(utils.ZERO_KEY);
      });

      it('should return pending owner when not zero', () => {
        ownable._proposeOwner(Z_NEW_OWNER);
        expect(ownable.pendingOwner()).toEqual(Z_NEW_OWNER);
      });
    });

    describe('assertOnlyOwner', () => {
      it('should allow owner to call', () => {
        caller = OWNER;

        expect(() => {
          ownable.assertOnlyOwner(caller)
        }).not.toThrow();
      });

      it('should fail when called by unauthorized', () => {
        caller = UNAUTHORIZED;

        expect(() => {
          ownable.assertOnlyOwner(caller)
        }).toThrow('Ownable: caller is not the owner');
      });
    });

    describe('transferOwnership', () => {
      it('should begin two-step transfer process', () => {
        caller = OWNER;

        ownable.transferOwnership(Z_NEW_OWNER, caller);
        expect(ownable.pendingOwner()).toEqual(Z_NEW_OWNER);
        expect(ownable.owner()).toEqual(Z_OWNER);
      });

      it('should fail when caller is unauthorized', () => {
        caller = UNAUTHORIZED;

        expect(() => {
          ownable.transferOwnership(Z_NEW_OWNER, caller)
        }).toThrow('Ownable: caller is not the owner');
      });
    });

    describe('acceptOwnership', () => {
      describe('when ownership is not pending', () => {
        it('should fail when there is no pending owner', () => {
          expect(() => {
            caller = OWNER;
            ownable.acceptOwnership(caller);
          }).toThrow('Ownable: not pending owner');
        });
      });

      describe('when ownership is pending', () => {
        beforeEach(() => {
          caller = OWNER;
          ownable.transferOwnership(Z_NEW_OWNER, caller);
        });

        it('should accept ownership from pending owner', () => {
          caller = NEW_OWNER;
          ownable.acceptOwnership(caller);

          // Check new owner
          expect(ownable.owner()).toEqual(Z_NEW_OWNER);
          // Check pending owner reset
          expect(ownable.pendingOwner()).toEqual(utils.ZERO_KEY);
          // Confirm new owner permissions
          expect(() => {
            caller = NEW_OWNER;
            ownable.assertOnlyOwner(caller)
          }).not.toThrow();
          // Confirm revoked permissions from old owner
          expect(() => {
            caller = OWNER;
            ownable.assertOnlyOwner(caller);
          }).toThrow('Ownable: caller is not the owner');
        });

        it('should fail when unauthorized accepts ownership', () => {
          caller = UNAUTHORIZED;

          expect(() => {
            ownable.acceptOwnership(caller)
          }).toThrow('Ownable: not pending owner');
        });
      });
    });

    describe('renounceOwnership', () => {
      it('should renounce ownership', () => {
        expect(ownable.owner()).toEqual(Z_OWNER);

        caller = OWNER;
        ownable.renounceOwnership(caller);

        // Check owner
        expect(ownable.owner()).toEqual(utils.ZERO_KEY);
        // Check pending owner
        expect(ownable.pendingOwner()).toEqual(utils.ZERO_KEY);
        // Confirm old owner permissions have been revoked
        expect(() => {
          caller = OWNER;
          ownable.assertOnlyOwner()
        }).toThrow('Ownable: caller is not the owner');
      });

      it('should clear pending owner when renouncing ownership', () => {
        caller = OWNER;
        ownable.transferOwnership(Z_NEW_OWNER, caller);
        expect(ownable.pendingOwner()).toEqual(Z_NEW_OWNER);

        ownable.renounceOwnership(caller);

        // Check owner
        expect(ownable.owner()).toEqual(utils.ZERO_KEY);
        // Check pending owner
        expect(ownable.pendingOwner()).toEqual(utils.ZERO_KEY);
        // Confirm pending owner permissions have not escalated
        expect(() => {
          caller = NEW_OWNER;
          ownable.assertOnlyOwner()
        }).toThrow('Ownable: caller is not the owner');
        // Confirm old owner permissions have been revoked
        expect(() => {
          caller = OWNER;
          ownable.assertOnlyOwner()
        }).toThrow('Ownable: caller is not the owner');
      });
    });

    describe('_transferOwnership', () => {
      describe.each(ownerTypes)('when the new owner is a %s', (_, newOwner) => {
        it('should transfer ownership', () => {
          ownable._transferOwnership(newOwner)
          expect(ownable.owner()).toEqual(newOwner);
        });
      });
    });

    describe('_proposeOwnership', () => {
      describe.each(ownerTypes)('when the proposed owner is a %s', (_, newOwner) => {
        it('should propose owner', () => {
          ownable._proposeOwner(newOwner)
          expect(ownable.pendingOwner()).toEqual(newOwner);
        });
      });
    });
  });
});