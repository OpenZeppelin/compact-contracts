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
import { ZswapCoinPublicKey, ContractAddress } from '../artifacts/MockOwnable/contract/index.cjs';
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
let bOwnableAddress: Uint8Array;

//const createZPKCommitment = (
//    domain: string,
//    pk: ZswapCoinPublicKey,
//    counter: bigint,
//    nonce: Uint8Array
//): Uint8Array => {
//  const rt_type = new CompactTypeVector(4, new CompactTypeBytes(32));
//  const encoder = new TextEncoder();
//
//  const bDomain = encoder.encode(domain);
//  const bPK = pk.bytes;
//  const bCounter = convert_bigint_to_Uint8Array(32, counter);
//  return persistentHash(rt_type, [bDomain, bPK, bCounter, nonce]);
//}

const createIdHash = (
    pk: ZswapCoinPublicKey,
    nonce: Uint8Array
): Uint8Array => {
  const rt_type = new CompactTypeVector(2, new CompactTypeBytes(32));

  const bPK = pk.bytes;
  return persistentHash(rt_type, [bPK, nonce]);
}

const buildCommitmentFromId = (
  id: Uint8Array,
  counter: bigint
): Uint8Array => {
  const rt_type = new CompactTypeVector(2, new CompactTypeBytes(32));
  const encoder = new TextEncoder();

  //const contextHash = persistentHash(rt_type, [address, id]);

  const bCounter = convert_bigint_to_Uint8Array(32, counter);
  const innerHash = persistentHash(rt_type, [bCounter, id]);

  const bDomain = encoder.encode(DOMAIN);
  const outerHash = persistentHash(rt_type, [bDomain, innerHash]);
  return outerHash;
}

const buildCommitment = (
    domain: string,
    pk: ZswapCoinPublicKey,
    counter: bigint,
    nonce: Uint8Array,
): Uint8Array => {
  const rt_type = new CompactTypeVector(2, new CompactTypeBytes(32));
  const encoder = new TextEncoder();

  const idHash = createIdHash(pk, nonce);
  //const contextHash = persistentHash(rt_type, [address, idHash]);

  const bCounter = convert_bigint_to_Uint8Array(32, counter);
  const counterHash = persistentHash(rt_type, [bCounter, idHash]);

  const bDomain = encoder.encode(domain);
  const outerHash = persistentHash(rt_type, [bDomain, counterHash]);
  return outerHash;
  //return innerHash;
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
      const notZeroPK = utils.encodeToPK('NOT_ZERO');
      const notZeroNonce = new Uint8Array(32).fill(1);
      const nonZeroId = createIdHash(notZeroPK, notZeroNonce);
      ownable = new Z_OwnablePKSimulator(nonZeroId);

      const nonZeroCommitment = buildCommitment(DOMAIN, notZeroPK, INIT_COUNTER, notZeroNonce);
      expect(ownable.owner()).toEqual(nonZeroCommitment);
    });
  });

  describe('after initialization', () => {
    beforeEach(() => {
      // Create private state object and generate nonce
      const PS = Z_OwnablePKPrivateState.generate();
      // Bind nonce for convenience
      secretNonce = PS.offchainNonce;
      // Prepare owner ID with gen nonce
      const ownerCommitment = createIdHash(Z_OWNER, secretNonce);
      // Deploy contract with derived owner commitment and PS
      ownable = new Z_OwnablePKSimulator(ownerCommitment, {privateState: PS});

      const encoder = new TextEncoder();
      bOwnableAddress = encoder.encode(ownable.contractAddress);
    });

    describe('owner', () => {
      it('should return the correct owner commitment', () => {
        const expCommitment = buildCommitment(DOMAIN, Z_OWNER, INIT_COUNTER, secretNonce);
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
      let newIdHash: Uint8Array;
      let newCounter: bigint;

      beforeEach(() => {
        // Prepare new owner commitment
        newOwnerNonce = Z_OwnablePKPrivateState.generate().offchainNonce;
        newCounter = INIT_COUNTER + 1n;
        newIdHash = createIdHash(Z_NEW_OWNER, newOwnerNonce);
        newOwnerCommitment = buildCommitment(DOMAIN, Z_NEW_OWNER, newCounter, newOwnerNonce);
      });

      it('should transfer ownership', () => {
        ownable.setCaller(OWNER);
        ownable.transferOwnership(newIdHash);
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
        let beforeInstance = ownable.getPublicState().Z_OwnablePK__counter;

        // Transfer
        ownable.setCaller(OWNER);
        ownable.transferOwnership(newOwnerCommitment);

        // Check counter
        let afterInstance = ownable.getPublicState().Z_OwnablePK__counter;
        expect(afterInstance).toEqual(beforeInstance + 1n);
      });

      it('should change commitment when transferring ownership to self with same pk + nonce)', () => {
        // Confirm current commitment
        const repeatedId = createIdHash(Z_OWNER, secretNonce);
        const initCommitment = ownable.owner();
        const expInitCommitment = buildCommitmentFromId(repeatedId, INIT_COUNTER);
        expect(initCommitment).toEqual(expInitCommitment);

        // Transfer ownership to self with the same id -> `H(pk, nonce)`
        ownable.setCaller(OWNER);
        ownable.transferOwnership(repeatedId);

        // Check commitments don't match
        const newCommitment = ownable.owner();
        expect(initCommitment).not.toEqual(newCommitment);

        // Build commitment locally and validate new commitment == expected
        const bumpedCounter = INIT_COUNTER + 1n;
        const expNewCommitment = buildCommitmentFromId(repeatedId, bumpedCounter);
        expect(newCommitment).toEqual(expNewCommitment);

        // Check same owner maintains permissions after transfer
        ownable.setCaller(OWNER);
        expect(ownable.assertOnlyOwner()).not.to.throw;
      });
    });
  });
});
