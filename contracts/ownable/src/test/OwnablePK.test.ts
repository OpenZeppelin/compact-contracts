import {
  CoinPublicKey,
  convert_bigint_to_Uint8Array,
  convert_Uint8Array_to_bigint,
} from '@midnight-ntwrk/compact-runtime';
import { OwnablePKSimulator } from './simulators/OwnablePKSimulator';
import * as utils from './utils/address';

const OWNER = String(Buffer.from('OWNER', 'ascii').toString('hex')).padStart(
  64,
  '0',
);
const NEW_OWNER = String(
  Buffer.from('NEW_OWNER', 'ascii').toString('hex'),
).padStart(64, '0');
const UNAUTHORIZED = String(
  Buffer.from('UNAUTHORIZED', 'ascii').toString('hex'),
).padStart(64, '0');
const Z_ZERO = utils.encodeToPK('');
const Z_OWNER = utils.encodeToPK('OWNER');
const Z_NEW_OWNER = utils.encodeToPK('NEW_OWNER');
const Z_NEW_NEW_OWNER = utils.encodeToPK('Z_NEW_NEW_OWNER');
const EMPTY_BYTES = utils.ZERO_KEY.left.bytes;

let ownable: OwnablePKSimulator;
let caller: CoinPublicKey;
let ownerSK: Uint8Array;

describe('OwnablePK', () => {
  describe('initializer', () => {
    it('should initialize and set the shielded owner', () => {
      ownable = new OwnablePKSimulator(Z_OWNER, OWNER);

      // Check instance
      const instance = ownable.getCurrentPublicState().ownablePK_Instance;
      expect(instance).toEqual(1n);

      // Check shielded owner
      const expOwner = ownable.shieldOwner(
        Z_OWNER,
        convert_bigint_to_Uint8Array(32, instance),
      );
      expect(ownable.owner()).toEqual(expOwner);

      // Check pending owner
      const pendingOwner =
        ownable.getCurrentPublicState().ownablePK_PendingOwner;
      expect(pendingOwner).toEqual(EMPTY_BYTES);
    });

    it('should fail when initializing owner as zero', () => {
      expect(() => {
        ownable = new OwnablePKSimulator(utils.ZERO_KEY.left, OWNER);
      }).toThrow('OwnablePK: new owner cannot be zero');
    });
  });

  describe('with owner set', () => {
    beforeEach(() => {
      ownable = new OwnablePKSimulator(Z_OWNER, OWNER);
    });

    describe('owner', () => {
      it('should return correct owner', () => {
        expect(ownable.owner()).toEqual(
          ownable.getCurrentPublicState().ownablePK_Owner,
        );
      });

      it('should return no owner', () => {
        // Set owner to zero
        ownable._transferOwnership(EMPTY_BYTES);
        expect(ownable.owner()).toEqual(EMPTY_BYTES);
      });
    });

    describe('pendingOwner', () => {
      it('should return pending owner', () => {
        const nextInstance =
          ownable.getCurrentPublicState().ownablePK_Instance + 1n;
        const expPending = ownable.shieldOwner(
          Z_NEW_OWNER,
          convert_bigint_to_Uint8Array(32, nextInstance),
        );
        ownable._proposeOwner(Z_NEW_OWNER);
        expect(ownable.pendingOwner()).toEqual(expPending);
      });

      it('should return no pending owner', () => {
        expect(ownable.pendingOwner()).toEqual(EMPTY_BYTES);
      });
    });

    describe('transferOwnership', () => {
      it('should start two-step transfer', () => {
        caller = OWNER;

        ownable.transferOwnership(Z_NEW_OWNER, caller);

        // Check pending owner
        const nextInstance =
          ownable.getCurrentPublicState().ownablePK_Instance + 1n;
        const expPending = ownable.shieldOwner(
          Z_NEW_OWNER,
          convert_bigint_to_Uint8Array(32, nextInstance),
        );
        expect(ownable.pendingOwner()).toEqual(expPending);

        // Check current owner
        const thisInstance = ownable.getCurrentPublicState().ownablePK_Instance;
        const expOwner = ownable.shieldOwner(
          Z_OWNER,
          convert_bigint_to_Uint8Array(32, thisInstance),
        );
        expect(ownable.owner()).toEqual(expOwner);
      });

      it('should not transfer zero as owner', () => {
        caller = OWNER;

        expect(() => {
          ownable.transferOwnership(Z_ZERO, caller);
        }).toThrow('OwnablePK: new owner cannot be zero');
      });

      it('should not transfer owner from unauthorized caller', () => {
        caller = UNAUTHORIZED;

        expect(() => {
          ownable.transferOwnership(Z_NEW_OWNER, caller);
        }).toThrow('OwnablePK: not owner');
      });

      it('should overwrite pending owner with new owner', () => {
        caller = OWNER;

        ownable.transferOwnership(Z_NEW_OWNER, caller);
        ownable.transferOwnership(Z_NEW_NEW_OWNER, caller);

        // Check new pending owner
        const nextInstance =
          ownable.getCurrentPublicState().ownablePK_Instance + 1n;
        const expPending = ownable.shieldOwner(
          Z_NEW_NEW_OWNER,
          convert_bigint_to_Uint8Array(32, nextInstance),
        );
        expect(ownable.pendingOwner()).toEqual(expPending);
      });
    });

    describe('acceptOwnership', () => {
      describe('when owner is pending', () => {
        beforeEach(() => {
          ownable._proposeOwner(Z_NEW_OWNER);
        });

        it('should accept ownership from pending owner', () => {
          caller = NEW_OWNER;
          const beforeInstance =
            ownable.getCurrentPublicState().ownablePK_Instance;

          ownable.acceptOwnership(caller);

          // Check instance is bumped
          const afterInstance =
            ownable.getCurrentPublicState().ownablePK_Instance;
          expect(afterInstance).toEqual(beforeInstance + 1n);

          // Check new owner
          const expOwner = ownable.shieldOwner(
            Z_NEW_OWNER,
            convert_bigint_to_Uint8Array(32, afterInstance),
          );
          expect(ownable.owner()).toEqual(expOwner);

          // Check pending owner is reset
          expect(ownable.pendingOwner()).toEqual(EMPTY_BYTES);
        });

        it('should not accept ownership from unauthorized', () => {
          caller = UNAUTHORIZED;

          expect(() => {
            ownable.acceptOwnership(caller);
          }).toThrow('OwnablePK: caller is not pending owner');
        });

        it('should not accept ownership from current owner', () => {
          caller = OWNER;

          expect(() => {
            ownable.acceptOwnership(caller);
          }).toThrow('OwnablePK: caller is not pending owner');
        });

        it('should not accept ownership from previous owner', () => {
          caller = NEW_OWNER;
          // Sets new owner
          ownable.acceptOwnership(caller);

          // New owner proposes another new owner
          ownable.transferOwnership(Z_NEW_NEW_OWNER, caller);

          // Initial owner tries to accept
          caller = OWNER;
          expect(() => {
            ownable.acceptOwnership(caller);
          }).toThrow('OwnablePK: caller is not pending owner');
        });
      });
    });

    describe('renounceOwnership', () => {
      it('should renounce ownership', () => {
        caller = OWNER;
        const beforeInstance =
          ownable.getCurrentPublicState().ownablePK_Instance;
        ownable.renounceOwnership(caller);

        expect(ownable.owner()).toEqual(EMPTY_BYTES);
        expect(ownable.pendingOwner()).toEqual(EMPTY_BYTES);
        expect(ownable.getCurrentPublicState().ownablePK_Instance).toEqual(
          beforeInstance + 1n,
        );
      });

      it('should not renounce from unauthorized', () => {
        caller = UNAUTHORIZED;
        expect(() => {
          ownable.renounceOwnership(caller);
        }).toThrow('OwnablePK: not owner');
      });
    });

    describe('assertOnlyOwner', () => {
      it('should allow owner to call', () => {
        caller = OWNER;

        ownable.assertOnlyOwner(caller);
      });

      it('should not allow unauthorized to call', () => {
        caller = UNAUTHORIZED;
        expect(() => {
          ownable.assertOnlyOwner(caller);
        }).toThrow('OwnablePK: not owner');
      });

      it('should update who can and cannot call', () => {
        caller = OWNER;
        ownable.assertOnlyOwner(caller);

        caller = NEW_OWNER;
        expect(() => {
          ownable.assertOnlyOwner(caller);
        }).toThrow('OwnablePK: not owner');

        // Transfer to new owner
        const nextInstance =
          ownable.getCurrentPublicState().ownablePK_Instance + 1n;
        const newOwner = ownable.shieldOwner(
          Z_NEW_OWNER,
          convert_bigint_to_Uint8Array(32, nextInstance),
        );
        ownable._transferOwnership(newOwner);

        caller = NEW_OWNER;
        ownable.assertOnlyOwner(caller);

        caller = OWNER;
        expect(() => {
          ownable.assertOnlyOwner(caller);
        }).toThrow('OwnablePK: not owner');
      });
    });

    describe('shieldOwner', () => {
      it.skip('should hash owner correctly', () => {
        const instance = convert_bigint_to_Uint8Array(32, 123n);
        const expHash = ownable.shieldOwner(Z_OWNER, instance);
        // TODO add matching algo in js
      });
    });

    describe('_transferOwnership', () => {
      it('should transfer ownership', () => {
        const beforeInstance =
          ownable.getCurrentPublicState().ownablePK_Instance;
        ownable._proposeOwner(Z_NEW_NEW_OWNER);

        ownable._transferOwnership(Z_NEW_OWNER.bytes);

        // _transferownership does not shield the input so it should be a == a
        expect(ownable.owner()).toEqual(Z_NEW_OWNER.bytes);
        // Check instance is bumped
        expect(ownable.getCurrentPublicState().ownablePK_Instance).toEqual(
          beforeInstance + 1n,
        );
        // Check pending owner is reset
        expect(ownable.pendingOwner()).toEqual(EMPTY_BYTES);
      });

      it('should transfer ownership to zero', () => {
        // _transfer does not shield the input so it should be a == a
        ownable._transferOwnership(EMPTY_BYTES);
        expect(ownable.owner()).toEqual(EMPTY_BYTES);
      });
    });

    describe('proposeOwner', () => {
      it('should propose owner', () => {
        ownable._proposeOwner(Z_NEW_OWNER);

        const nextInstance =
          ownable.getCurrentPublicState().ownablePK_Instance + 1n;
        const expOwner = ownable.shieldOwner(
          Z_NEW_OWNER,
          convert_bigint_to_Uint8Array(32, nextInstance),
        );
        expect(ownable.pendingOwner()).toEqual(expOwner);
      });

      it('should not propose zero as owner', () => {
        expect(() => {
          ownable._proposeOwner(utils.ZERO_KEY.left);
        }).toThrow('OwnablePK: new owner cannot be zero');
      });
    });
  });
});
