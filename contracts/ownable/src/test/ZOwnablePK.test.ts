import {
  CompactTypeBytes,
  CompactTypeVector,
  convert_bigint_to_Uint8Array,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ZswapCoinPublicKey } from '../artifacts/MockOwnable/contract/index.cjs';
import { ZOwnablePKPrivateState } from '../witnesses/ZOwnablePKWitnesses.js';
import { ZOwnablePKSimulator } from './simulators/ZOwnablePKSimulator.js';
import * as utils from './utils/address.js';

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
const Z_OWNER = utils.encodeToPK('OWNER');
const Z_NEW_OWNER = utils.encodeToPK('NEW_OWNER');
const INSTANCE_SALT = new Uint8Array(32).fill(8675309);
const BAD_NONCE = Buffer.from(Buffer.alloc(32, 'BAD_NONCE'));

const DOMAIN = 'ZOwnablePK:shield:';
const INIT_COUNTER = 1n;

let secretNonce: Uint8Array;
let ownable: ZOwnablePKSimulator;

/** Helpers */
const createIdHash = (
  pk: ZswapCoinPublicKey,
  nonce: Uint8Array,
): Uint8Array => {
  const rt_type = new CompactTypeVector(2, new CompactTypeBytes(32));

  const bPK = pk.bytes;
  return persistentHash(rt_type, [bPK, nonce]);
};

const buildCommitmentFromId = (
  id: Uint8Array,
  instanceSalt: Uint8Array,
  counter: bigint,
): Uint8Array => {
  const rt_type = new CompactTypeVector(4, new CompactTypeBytes(32));
  const bCounter = convert_bigint_to_Uint8Array(32, counter);
  const bDomain = new TextEncoder().encode(DOMAIN);

  const commitment = persistentHash(rt_type, [
    id,
    instanceSalt,
    bCounter,
    bDomain,
  ]);
  return commitment;
};

const buildCommitment = (
  pk: ZswapCoinPublicKey,
  nonce: Uint8Array,
  instanceSalt: Uint8Array,
  counter: bigint,
  domain: string,
): Uint8Array => {
  const id = createIdHash(pk, nonce);

  const rt_type = new CompactTypeVector(4, new CompactTypeBytes(32));
  const bCounter = convert_bigint_to_Uint8Array(32, counter);
  const bDomain = new TextEncoder().encode(domain);

  const commitment = persistentHash(rt_type, [
    id,
    instanceSalt,
    bCounter,
    bDomain,
  ]);
  return commitment;
};

describe('ZOwnablePK', () => {
  describe('before initialize', () => {
    it('should fail when setting owner commitment as 0', () => {
      expect(() => {
        const badId = new Uint8Array(32).fill(0);
        new ZOwnablePKSimulator(badId, INSTANCE_SALT);
      }).toThrow('Invalid parameters');
    });

    it('should initialize with non-zero commitment', () => {
      const notZeroPK = utils.encodeToPK('NOT_ZERO');
      const notZeroNonce = new Uint8Array(32).fill(1);
      const nonZeroId = createIdHash(notZeroPK, notZeroNonce);
      ownable = new ZOwnablePKSimulator(nonZeroId, INSTANCE_SALT);

      const nonZeroCommitment = buildCommitmentFromId(
        nonZeroId,
        INSTANCE_SALT,
        INIT_COUNTER,
      );
      expect(ownable.owner()).toEqual(nonZeroCommitment);
    });
  });

  describe('after initialization', () => {
    beforeEach(() => {
      // Create private state object and generate nonce
      const PS = ZOwnablePKPrivateState.generate();
      // Bind nonce for convenience
      secretNonce = PS.offchainNonce;
      // Prepare owner ID with gen nonce
      const ownerId = createIdHash(Z_OWNER, secretNonce);
      // Deploy contract with derived owner commitment and PS
      ownable = new ZOwnablePKSimulator(ownerId, INSTANCE_SALT, {
        privateState: PS,
      });
    });

    /**
     * @TODO parameterize
     */
    describe('hashCommitment', () => {
      it('should match local and contract commitment algorithms', () => {
        const id = createIdHash(Z_OWNER, secretNonce);
        const counter = INIT_COUNTER;

        // Check buildCommitmentFromId
        const hashFromContract = ownable.hashCommitment(id, counter);
        const hashFromHelper1 = buildCommitmentFromId(
          id,
          INSTANCE_SALT,
          counter,
        );
        expect(hashFromContract).toEqual(hashFromHelper1);

        // Check buildCommitment
        const hashFromHelper2 = buildCommitment(
          Z_OWNER,
          secretNonce,
          INSTANCE_SALT,
          counter,
          DOMAIN,
        );
        expect(hashFromContract).toEqual(hashFromHelper1);
        expect(hashFromHelper1).toEqual(hashFromHelper2);
      });
    });

    describe('owner', () => {
      it('should return the correct owner commitment', () => {
        const expCommitment = buildCommitment(
          Z_OWNER,
          secretNonce,
          INSTANCE_SALT,
          INIT_COUNTER,
          DOMAIN,
        );
        expect(ownable.owner()).toEqual(expCommitment);
      });
    });

    describe('assertOnlyOwner', () => {
      it('should allow authorized caller with correct nonce to call', () => {
        // Check nonce is correct
        expect(ownable.privateState.getCurrentSecretNonce()).toEqual(
          secretNonce,
        );

        ownable.callerCtx.setCaller(OWNER);
        expect(ownable.assertOnlyOwner()).to.not.throw;
      });

      it('should fail when the authorized caller has the wrong nonce', () => {
        // Inject bad nonce
        ownable.privateState.injectSecretNonce(BAD_NONCE);

        // Check nonce does not match
        expect(ownable.privateState.getCurrentSecretNonce()).not.toEqual(
          secretNonce,
        );

        // Set caller and call circuit
        ownable.callerCtx.setCaller(OWNER);
        expect(() => {
          ownable.assertOnlyOwner();
        }).toThrow('Forbidden');
      });

      it('should fail when unauthorized caller has the correct nonce', () => {
        // Check nonce is correct
        expect(ownable.privateState.getCurrentSecretNonce()).toEqual(
          secretNonce,
        );

        ownable.callerCtx.setCaller(UNAUTHORIZED);
        expect(() => {
          ownable.assertOnlyOwner();
        }).toThrow('Forbidden');
      });

      it('should fail when unauthorized caller has the wrong nonce', () => {
        // Inject bad nonce
        ownable.privateState.injectSecretNonce(BAD_NONCE);

        // Check nonce does not match
        expect(ownable.privateState.getCurrentSecretNonce()).not.toEqual(
          secretNonce,
        );

        // Set unauthorized caller and call circuit
        ownable.callerCtx.setCaller(UNAUTHORIZED);
        expect(() => {
          ownable.assertOnlyOwner();
        }).toThrow('Forbidden');
      });
    });

    describe('transferOwnership', () => {
      let newOwnerCommitment: Uint8Array;
      let newOwnerNonce: Uint8Array;
      let newIdHash: Uint8Array;
      let newCounter: bigint;

      beforeEach(() => {
        // Prepare new owner commitment
        newOwnerNonce = ZOwnablePKPrivateState.generate().offchainNonce;
        newCounter = INIT_COUNTER + 1n;
        newIdHash = createIdHash(Z_NEW_OWNER, newOwnerNonce);
        newOwnerCommitment = buildCommitment(
          Z_NEW_OWNER,
          newOwnerNonce,
          INSTANCE_SALT,
          newCounter,
          DOMAIN,
        );
      });

      it('should transfer ownership', () => {
        ownable.callerCtx.setCaller(OWNER);
        ownable.transferOwnership(newIdHash);
        expect(ownable.owner()).toEqual(newOwnerCommitment);

        // Old owner
        ownable.callerCtx.setCaller(OWNER);
        expect(() => {
          ownable.assertOnlyOwner();
        }).toThrow('Forbidden');

        // Unauthorized
        ownable.callerCtx.setCaller(UNAUTHORIZED);
        expect(() => {
          ownable.assertOnlyOwner();
        }).toThrow('Forbidden');

        // New owner
        ownable.callerCtx.setCaller(NEW_OWNER);
        ownable.privateState.injectSecretNonce(Buffer.from(newOwnerNonce));
        expect(ownable.assertOnlyOwner()).not.to.throw;
      });

      it('should fail when transferring to id zero', () => {
        ownable.callerCtx.setCaller(OWNER);
        const badId = new Uint8Array(32).fill(0);
        expect(() => {
          ownable.transferOwnership(badId);
        }).toThrow('Invalid parameters');
      });

      it('should fail when unauthorized transfers ownership', () => {
        ownable.callerCtx.setCaller(UNAUTHORIZED);
        expect(() => {
          ownable.transferOwnership(newOwnerCommitment);
        }).toThrow('Forbidden');
      });

      /**
       * @description More thoroughly tested in `_transferOwnership`
       * */
      it('should bump instance after transfer', () => {
        const beforeInstance = ownable.getPublicState().ZOwnablePK__counter;

        // Transfer
        ownable.callerCtx.setCaller(OWNER);
        ownable.transferOwnership(newOwnerCommitment);

        // Check counter
        const afterInstance = ownable.getPublicState().ZOwnablePK__counter;
        expect(afterInstance).toEqual(beforeInstance + 1n);
      });

      it('should change commitment when transferring ownership to self with same pk + nonce)', () => {
        // Confirm current commitment
        const repeatedId = createIdHash(Z_OWNER, secretNonce);
        const initCommitment = ownable.owner();
        const expInitCommitment = buildCommitmentFromId(
          repeatedId,
          INSTANCE_SALT,
          INIT_COUNTER,
        );
        expect(initCommitment).toEqual(expInitCommitment);

        // Transfer ownership to self with the same id -> `H(pk, nonce)`
        ownable.callerCtx.setCaller(OWNER);
        ownable.transferOwnership(repeatedId);

        // Check commitments don't match
        const newCommitment = ownable.owner();
        expect(initCommitment).not.toEqual(newCommitment);

        // Build commitment locally and validate new commitment == expected
        const bumpedCounter = INIT_COUNTER + 1n;
        const expNewCommitment = buildCommitmentFromId(
          repeatedId,
          INSTANCE_SALT,
          bumpedCounter,
        );
        expect(newCommitment).toEqual(expNewCommitment);

        // Check same owner maintains permissions after transfer
        ownable.callerCtx.setCaller(OWNER);
        expect(ownable.assertOnlyOwner()).not.to.throw;
      });
    });

    describe('renounceOwnership', () => {
      it('should renounce ownership', () => {
        ownable.callerCtx.setCaller(OWNER);
        ownable.renounceOwnership();

        // Check owner is reset
        expect(ownable.owner()).toEqual(new Uint8Array(32).fill(0));

        // Check revoked permissions
        expect(() => {
          ownable.assertOnlyOwner()
        }).toThrow('Forbidden');
      });

      it('should fail when renouncing from unauthorized', () => {
        ownable.callerCtx.setCaller(UNAUTHORIZED);
        expect(() => {
          ownable.renounceOwnership();
        });
      });

      it('should fail when renouncing from authorized with bad nonce', () => {
        ownable.callerCtx.setCaller(OWNER);
        ownable.privateState.injectSecretNonce(BAD_NONCE);
        expect(() => {
          ownable.renounceOwnership();
        });
      });

      it('should fail when renouncing from unauthorized with bad nonce', () => {
        ownable.callerCtx.setCaller(UNAUTHORIZED);
        ownable.privateState.injectSecretNonce(BAD_NONCE);
        expect(() => {
          ownable.renounceOwnership();
        });
      });
    });
  });
});
