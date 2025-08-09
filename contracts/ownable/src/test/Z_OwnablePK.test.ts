import {
  type CoinPublicKey,
  convert_bigint_to_Uint8Array,
  persistentHash,
  CompactTypeVector,
  CompactTypeBytes
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { Z_OwnablePKSimulator } from './simulators/Z_OwnablePKSimulator.js';
import * as utils from './utils/address.js';
import { ZswapCoinPublicKey } from '../artifacts/MockOwnable/contract/index.cjs';
import { Z_OwnablePKPrivateState } from '../witnesses/Z_OwnablePKWitnesses.js';

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

const DOMAIN = "Z_OwnablePK:shield:";
const INIT_COUNTER = 1n;

let secretNonce: Uint8Array;
let ownable: Z_OwnablePKSimulator;

const createZPKCommitment = (
    domain: string,
    pk: ZswapCoinPublicKey,
    counter: bigint,
    nonce: Uint8Array
): Uint8Array => {
  const rt_type = new CompactTypeVector(4, new CompactTypeBytes(32));
  const encoder = new TextEncoder();

  const bDomain = encoder.encode(domain);
  const bPK = pk.bytes;
  const bCounter = convert_bigint_to_Uint8Array(32, counter);
  return persistentHash(rt_type, [bDomain, bPK, bCounter, nonce]);
}

describe('Z_OwnablePK', () => {
  describe('before initialize', () => {
    it('should fail when setting owner commitment as 0', () => {
      expect(() => {
        const badCommitment = new Uint8Array(32).fill(0);
        new Z_OwnablePKSimulator(badCommitment);
      }).toThrow('Invalid parameters');
    });

    it('should initialize with non-zero commitment', () => {
      const nonZeroCommitment = new Uint8Array(32).fill(1);
      ownable = new Z_OwnablePKSimulator(nonZeroCommitment);

      expect(ownable.owner()).toEqual(nonZeroCommitment);
    });
  });

  describe('after initialization', () => {
    beforeEach(() => {
      // Create private state object and generate nonce
      const PS = Z_OwnablePKPrivateState.generate();
      // Bind nonce for convenience
      secretNonce = PS.offchainNonce;
      // Prepare initial owner commitment with gen nonce
      const ownerCommitment = createZPKCommitment(DOMAIN, Z_OWNER, INIT_COUNTER, secretNonce);
      // Deploy contract with derived owner commitment and PS
      ownable = new Z_OwnablePKSimulator(ownerCommitment, {privateState: PS});
    });

    describe('owner', () => {
      it('should return the correct owner commitment', () => {
        const expCommitment = createZPKCommitment(DOMAIN, Z_OWNER, INIT_COUNTER, secretNonce);
        expect(ownable.owner()).toEqual(expCommitment);
      });
    });

    describe('assertOnlyOwner', () => {
      it('should allow authorized caller with correct nonce to call', () => {
        // Check nonce is correct
        expect(ownable.privateState.getCurrentSecretNonce()).toEqual(secretNonce);

        ownable.setCaller(OWNER);
        expect(ownable.assertOnlyOwner()).to.not.throw;
      });

      it('should fail when the authorized caller has the wrong nonce', () => {
        // Inject bad nonce
        const badNonce = Buffer.alloc(32, "badNonce");
        ownable.privateState.injectSecretNonce(badNonce);

        // Check nonce does not match
        expect(ownable.privateState.getCurrentSecretNonce()).not.toEqual(secretNonce);

        // Set caller and call circuit
        ownable.setCaller(OWNER);
        expect(() => {
          ownable.assertOnlyOwner();
        }).toThrow('Forbidden');
      });

      it('should fail when unauthorized caller has the correct nonce', () => {
        // Check nonce is correct
        expect(ownable.privateState.getCurrentSecretNonce()).toEqual(secretNonce);

        ownable.setCaller(UNAUTHORIZED);
        expect(() => {
          ownable.assertOnlyOwner()
        }).toThrow('Forbidden');
      });

      it('should fail when unauthorized caller has the wrong nonce', () => {
        // Inject bad nonce
        const badNonce = Buffer.alloc(32, "badNonce");
        ownable.privateState.injectSecretNonce(badNonce);

        // Check nonce does not match
        expect(ownable.privateState.getCurrentSecretNonce()).not.toEqual(secretNonce);

        // Set unauthorized caller and call circuit
        ownable.setCaller(UNAUTHORIZED);
        expect(() => {
          ownable.assertOnlyOwner()
        }).toThrow('Forbidden');
      });
    });

    describe('transferOwnership', () => {
      let newOwnerCommitment: Uint8Array;
      let newOwnerNonce: Uint8Array;

      beforeEach(() => {
        // Prepare new owner commitment
        newOwnerNonce = Z_OwnablePKPrivateState.generate().offchainNonce;
        const newOwnerCounter = INIT_COUNTER + 1n;
        newOwnerCommitment = createZPKCommitment(DOMAIN, Z_NEW_OWNER, newOwnerCounter, newOwnerNonce);
      });

      it('should transfer ownership', () => {
        ownable.setCaller(OWNER);
        ownable.transferOwnership(newOwnerCommitment);
        expect(ownable.owner()).toEqual(newOwnerCommitment);

        // Old owner
        ownable.setCaller(OWNER);
        expect(() => {
          ownable.assertOnlyOwner()
        }).toThrow('Forbidden');

        // Unauthorized
        ownable.setCaller(UNAUTHORIZED);
        expect(() => {
          ownable.assertOnlyOwner()
        }).toThrow('Forbidden');

        // New owner
        ownable.setCaller(NEW_OWNER);
        ownable.privateState.injectSecretNonce(Buffer.from(newOwnerNonce))
        expect(ownable.assertOnlyOwner()).not.to.throw;
      });

      it('should fail when transferring to zero', () => {
        ownable.setCaller(OWNER);
        const badCommitment = new Uint8Array(32).fill(0);
        expect(() => {
          ownable.transferOwnership(badCommitment);
        }).toThrow('Invalid parameters');
      });

      it('should fail when unauthorized transfers ownership', () => {
        ownable.setCaller(UNAUTHORIZED);
        expect(() => {
          ownable.transferOwnership(newOwnerCommitment);
        }).toThrow('Forbidden');
      });

      /**
       * @description More thoroughly tested in `_transferOwnership`
       * */
      it('should bump instance after transfer', () => {
        let beforeInstance = ownable.getPublicState().Z_OwnablePK__instance;

        // Transfer
        ownable.setCaller(OWNER);
        ownable.transferOwnership(newOwnerCommitment);

        // Check counter
        let afterInstance = ownable.getPublicState().Z_OwnablePK__instance;
        expect(afterInstance).toEqual(beforeInstance + 1n);
      });

      it('should change hash when transferring ownership to commitment with same pk and nonce', () => {
        // Confirm current commitment
        const initCommitment = ownable.owner();
        const calcInitCommitment = createZPKCommitment(DOMAIN, Z_OWNER, INIT_COUNTER, secretNonce);
        expect(initCommitment).toEqual(calcInitCommitment);

        // Create new commitment by bumping the counter
        const bumpedCounter = INIT_COUNTER + 1n;
        const newCommitment = createZPKCommitment(DOMAIN, Z_OWNER, bumpedCounter, secretNonce);

        // Transfer ownership to self
        ownable.setCaller(OWNER);
        ownable.transferOwnership(newCommitment);

        // Check owner and permissions
        const newOwner = ownable.owner();
        expect(newOwner).toEqual(newCommitment);
        ownable.assertOnlyOwner();
      })
    });
  });
});
