import {
  CompactTypeBytes,
  CompactTypeVector,
  convertFieldToBytes,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { SampleZOwnablePrivateState } from '../fixtures/sample-contracts/witnesses/SampleZOwnableWitnesses.js';
import type { ZswapCoinPublicKey } from '../fixtures/test-artifacts/SampleZOwnable/contract/index.cjs';
import * as utils from '../fixtures/utils/address.js';
import { SampleZOwnableSimulator } from './SampleZOwnableSimulator.js';

// PKs
const [OWNER, Z_OWNER] = utils.generatePubKeyPair('OWNER');
const [NEW_OWNER, Z_NEW_OWNER] = utils.generatePubKeyPair('NEW_OWNER');
const [UNAUTHORIZED, _] = utils.generatePubKeyPair('UNAUTHORIZED');

const INSTANCE_SALT = new Uint8Array(32).fill(8675309);
const BAD_NONCE = Buffer.from(Buffer.alloc(32, 'BAD_NONCE'));
const DOMAIN = 'SampleZOwnable:shield:';
const INIT_COUNTER = 1n;

let secretNonce: Uint8Array;
let ownable: SampleZOwnableSimulator;

// Helpers
/**
 * Create the id hash.
 * @param pk User's public key.
 * @param nonce Unique secret nonce.
 * @returns id hash.
 */
const createIdHash = (
  pk: ZswapCoinPublicKey,
  nonce: Uint8Array,
): Uint8Array => {
  const rt_type = new CompactTypeVector(2, new CompactTypeBytes(32));

  const bPK = pk.bytes;
  return persistentHash(rt_type, [bPK, nonce]);
};

/**
 * Create the stored commitment.
 * @param id User's unique id.
 * @param instanceSalt Unique value generated for the contract instance.
 * @param counter Counter.
 * @returns Commitment.
 */
const buildCommitmentFromId = (
  id: Uint8Array,
  instanceSalt: Uint8Array,
  counter: bigint,
): Uint8Array => {
  const rt_type = new CompactTypeVector(4, new CompactTypeBytes(32));
  const bCounter = convertFieldToBytes(32, counter, "");
  const bDomain = new TextEncoder().encode(DOMAIN);

  const commitment = persistentHash(rt_type, [
    id,
    instanceSalt,
    bCounter,
    bDomain,
  ]);
  return commitment;
};

/**
 * Builds commitment.
 * @param pk User's public key.
 * @param nonce User's secret nonce.
 * @param instanceSalt Unique value generated for the contract instance.
 * @param counter Counter.
 * @param domain Contract domain.
 * @returns Commitment
 */
const buildCommitment = (
  pk: ZswapCoinPublicKey,
  nonce: Uint8Array,
  instanceSalt: Uint8Array,
  counter: bigint,
  domain: string,
): Uint8Array => {
  const id = createIdHash(pk, nonce);

  const rt_type = new CompactTypeVector(4, new CompactTypeBytes(32));
  const bCounter = convertFieldToBytes(32, counter, "");
  const bDomain = new TextEncoder().encode(domain);

  const commitment = persistentHash(rt_type, [
    id,
    instanceSalt,
    bCounter,
    bDomain,
  ]);
  return commitment;
};

describe('SampleZOwnable', () => {
  describe('before initialize', () => {
    it('should fail when setting owner commitment as 0', () => {
      expect(() => {
        const badId = new Uint8Array(32).fill(0);
        new SampleZOwnableSimulator(badId, INSTANCE_SALT);
      }).toThrow('SampleZOwnable: invalid id');
    });

    it('should initialize with non-zero commitment', () => {
      const notZeroPK = utils.encodeToPK('NOT_ZERO');
      const notZeroNonce = new Uint8Array(32).fill(1);
      const nonZeroId = createIdHash(notZeroPK, notZeroNonce);
      ownable = new SampleZOwnableSimulator(nonZeroId, INSTANCE_SALT);

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
      const PS = SampleZOwnablePrivateState.generate();
      // Bind nonce for convenience
      secretNonce = PS.secretNonce;
      // Prepare owner ID with gen nonce
      const ownerId = createIdHash(Z_OWNER, secretNonce);
      // Deploy contract with derived owner commitment and PS
      ownable = new SampleZOwnableSimulator(ownerId, INSTANCE_SALT, {
        privateState: PS,
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

    describe('transferOwnership', () => {
      let newOwnerCommitment: Uint8Array;
      let newOwnerNonce: Uint8Array;
      let newIdHash: Uint8Array;
      let newCounter: bigint;

      beforeEach(() => {
        // Prepare new owner commitment
        newOwnerNonce = SampleZOwnablePrivateState.generate().secretNonce;
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
        ownable.as(OWNER).transferOwnership(newIdHash);
        expect(ownable.owner()).toEqual(newOwnerCommitment);

        // Old owner
        expect(() => {
          ownable.as(OWNER).assertOnlyOwner();
        }).toThrow('SampleZOwnable: caller is not the owner');

        // Unauthorized
        expect(() => {
          ownable.as(UNAUTHORIZED).assertOnlyOwner();
        }).toThrow('SampleZOwnable: caller is not the owner');

        // New owner
        ownable.privateState.injectSecretNonce(Buffer.from(newOwnerNonce));
        expect(ownable.as(NEW_OWNER).assertOnlyOwner()).not.to.throw;
      });

      it('should fail when transferring to id zero', () => {
        const badId = new Uint8Array(32).fill(0);
        expect(() => {
          ownable.as(OWNER).transferOwnership(badId);
        }).toThrow('SampleZOwnable: invalid id');
      });

      it('should fail when unauthorized transfers ownership', () => {
        expect(() => {
          ownable.as(UNAUTHORIZED).transferOwnership(newOwnerCommitment);
        }).toThrow('SampleZOwnable: caller is not the owner');
      });

      /**
       * @description More thoroughly tested in `_transferOwnership`
       * */
      it('should bump instance after transfer', () => {
        const beforeInstance = ownable.getPublicState()._counter;

        // Transfer
        ownable.as(OWNER).transferOwnership(newOwnerCommitment);

        // Check counter
        const afterInstance = ownable.getPublicState()._counter;
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
        ownable.as(OWNER).transferOwnership(repeatedId);

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
        expect(ownable.as(OWNER).assertOnlyOwner()).not.to.throw;
      });
    });

    describe('renounceOwnership', () => {
      it('should renounce ownership', () => {
        ownable.as(OWNER).renounceOwnership();

        // Check owner is reset
        expect(ownable.owner()).toEqual(new Uint8Array(32).fill(0));

        // Check revoked permissions
        expect(() => {
          ownable.assertOnlyOwner();
        }).toThrow('SampleZOwnable: caller is not the owner');
      });

      it('should fail when renouncing from unauthorized', () => {
        expect(() => {
          ownable.as(UNAUTHORIZED).renounceOwnership();
        }).toThrow('SampleZOwnable: caller is not the owner');
      });

      it('should fail when renouncing from authorized with bad nonce', () => {
        ownable.privateState.injectSecretNonce(BAD_NONCE);
        expect(() => {
          ownable.as(OWNER).renounceOwnership();
        }).toThrow('SampleZOwnable: caller is not the owner');
      });

      it('should fail when renouncing from unauthorized with bad nonce', () => {
        ownable.privateState.injectSecretNonce(BAD_NONCE);
        expect(() => {
          ownable.as(UNAUTHORIZED).renounceOwnership();
        });
      });
    });

    describe('assertOnlyOwner', () => {
      it('should allow authorized caller with correct nonce to call', () => {
        // Check nonce is correct
        expect(ownable.privateState.getCurrentSecretNonce()).toEqual(
          secretNonce,
        );

        expect(ownable.as(OWNER).assertOnlyOwner()).to.not.throw;
      });

      it('should fail when the authorized caller has the wrong nonce', () => {
        // Inject bad nonce
        ownable.privateState.injectSecretNonce(BAD_NONCE);

        // Check nonce does not match
        expect(ownable.privateState.getCurrentSecretNonce()).not.toEqual(
          secretNonce,
        );

        // Set caller and call circuit
        expect(() => {
          ownable.as(OWNER).assertOnlyOwner();
        }).toThrow('SampleZOwnable: caller is not the owner');
      });

      it('should fail when unauthorized caller has the correct nonce', () => {
        // Check nonce is correct
        expect(ownable.privateState.getCurrentSecretNonce()).toEqual(
          secretNonce,
        );

        expect(() => {
          ownable.as(UNAUTHORIZED).assertOnlyOwner();
        }).toThrow('SampleZOwnable: caller is not the owner');
      });

      it('should fail when unauthorized caller has the wrong nonce', () => {
        // Inject bad nonce
        ownable.privateState.injectSecretNonce(BAD_NONCE);

        // Check nonce does not match
        expect(ownable.privateState.getCurrentSecretNonce()).not.toEqual(
          secretNonce,
        );

        // Set unauthorized caller and call circuit
        expect(() => {
          ownable.as(UNAUTHORIZED).assertOnlyOwner();
        }).toThrow('SampleZOwnable: caller is not the owner');
      });
    });

    describe('_computeOwnerCommitment', () => {
      const MAX_U64 = 2n ** 64n - 1n;
      const testCases = [
        ...Array.from({ length: 10 }, (_, i) => ({
          label: `User${i}`,
          ownerPK: utils.encodeToPK(`User${i}`),
          counter: BigInt(Math.floor(Math.random() * 2 ** 64 - 1)),
        })),
        {
          label: 'ZeroCounter',
          ownerPK: utils.encodeToPK('ZeroCounter'),
          counter: 0n,
        },
        {
          label: 'MaxCounter',
          ownerPK: utils.encodeToPK('MaxUser'),
          counter: MAX_U64,
        },
      ];
      it.each(testCases)(
        'should match commitment for $label with counter $counter',
        ({ ownerPK, counter }) => {
          const id = createIdHash(ownerPK, secretNonce);

          // Check buildCommitmentFromId
          const hashFromContract = ownable._computeOwnerCommitment(id, counter);
          const hashFromHelper1 = buildCommitmentFromId(
            id,
            INSTANCE_SALT,
            counter,
          );
          expect(hashFromContract).toEqual(hashFromHelper1);

          // Check buildCommitment
          const hashFromHelper2 = buildCommitment(
            ownerPK,
            secretNonce,
            INSTANCE_SALT,
            counter,
            DOMAIN,
          );
          expect(hashFromHelper1).toEqual(hashFromHelper2);
        },
      );
    });

    describe('_computeOwnerId', () => {
      const testCases = [
        ...Array.from({ length: 10 }, (_, i) => ({
          label: `User${i}`,
          eitherOwner: utils.createEitherTestUser(`User${i}`),
          nonce: new Uint8Array(32).fill(i),
        })),
        {
          label: 'All-zero nonce',
          eitherOwner: utils.createEitherTestUser('ZeroUser'),
          nonce: new Uint8Array(32).fill(0),
        },
        {
          label: 'Max nonce',
          eitherOwner: utils.createEitherTestUser('MaxUser'),
          nonce: new Uint8Array(32).fill(255),
        },
      ];

      it.each(testCases)(
        'should match local and contract owner id for $label',
        ({ eitherOwner, nonce }) => {
          const ownerId = ownable._computeOwnerId(eitherOwner, nonce);
          const expId = createIdHash(eitherOwner.left, nonce);
          expect(ownerId).toEqual(expId);
        },
      );

      it('should fail to compute ContractAddress id', () => {
        const eitherContract =
          utils.createEitherTestContractAddress('CONTRACT');
        expect(() => {
          ownable._computeOwnerId(eitherContract, secretNonce);
        }).toThrow(
          'SampleZOwnable: contract address owners are not yet supported',
        );
      });
    });
  });
});
