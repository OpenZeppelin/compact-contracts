import {
  CompactTypeBytes,
  CompactTypeVector,
  convertFieldToBytes,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import type { ZswapCoinPublicKey } from '../../../artifacts/MockOwnable/contract/index.js';
import { ZOwnablePKSimulator } from './simulators/ZOwnablePKSimulator.js';
import { ZOwnablePKPrivateState } from './witnesses/ZOwnablePKWitnesses.js';

// PKs
const [, Z_OWNER] = utils.generatePubKeyPair('OWNER');
const [, Z_NEW_OWNER] = utils.generatePubKeyPair('NEW_OWNER');

const INSTANCE_SALT = new Uint8Array(32).fill(8675309);
const BAD_NONCE = Buffer.from(Buffer.alloc(32, 'BAD_NONCE'));
const DOMAIN = 'ZOwnablePK:shield:';
const INIT_COUNTER = 1n;

const isInit = true;
let secretNonce: Uint8Array;
let ownable: ZOwnablePKSimulator;

// Helpers
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
  const bCounter = convertFieldToBytes(32, counter, '');
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
  const bCounter = convertFieldToBytes(32, counter, '');
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
    it('should fail when setting owner commitment as 0', async () => {
      const badId = new Uint8Array(32).fill(0);
      await expect(
        ZOwnablePKSimulator.create(badId, INSTANCE_SALT, isInit),
      ).rejects.toThrow('ZOwnablePK: invalid id');
    });

    it('should initialize with non-zero commitment', async () => {
      const notZeroPK = utils.encodeToPK('NOT_ZERO');
      const notZeroNonce = new Uint8Array(32).fill(1);
      const nonZeroId = createIdHash(notZeroPK, notZeroNonce);
      ownable = await ZOwnablePKSimulator.create(
        nonZeroId,
        INSTANCE_SALT,
        isInit,
      );

      const nonZeroCommitment = buildCommitmentFromId(
        nonZeroId,
        INSTANCE_SALT,
        INIT_COUNTER,
      );
      expect(await ownable.owner()).toEqual(nonZeroCommitment);
    });
  });

  describe('when not initialized correctly', () => {
    const isNotInit = false;

    beforeEach(async () => {
      ownable = await ZOwnablePKSimulator.create(
        randomByteArray,
        INSTANCE_SALT,
        isNotInit,
      );
    });
    type FailingCircuits = [method: keyof ZOwnablePKSimulator, args: unknown[]];
    const randomByteArray = new Uint8Array(32).fill(123);
    const randomCounter = 321n;
    // Circuit calls should fail before the args are used
    const circuitsToFail: FailingCircuits[] = [
      ['owner', []],
      ['assertOnlyOwner', []],
      ['transferOwnership', [randomByteArray]],
      ['renounceOwnership', []],
      ['_computeOwnerCommitment', [randomByteArray, randomCounter]],
      ['_transferOwnership', [randomByteArray]],
    ];
    it.each(circuitsToFail)('%s should fail', async (circuitName, args) => {
      await expect(
        (ownable[circuitName] as (...args: unknown[]) => Promise<unknown>)(
          ...args,
        ),
      ).rejects.toThrow('ZOwnablePK: contract not initialized');
    });

    it('should allow pure computeOwnerId', async () => {
      const eitherOwner = utils.createEitherTestUser('OWNER');

      const ownerId = await ownable._computeOwnerId(
        eitherOwner,
        randomByteArray,
      );
      expect(ownerId).toHaveLength(32);
    });
  });

  describe('after initialization', () => {
    beforeEach(async () => {
      // Create private state object and generate nonce
      const PS = ZOwnablePKPrivateState.generate();
      // Bind nonce for convenience
      secretNonce = PS.secretNonce;
      // Prepare owner ID with gen nonce
      const ownerId = createIdHash(Z_OWNER, secretNonce);
      // Deploy contract with derived owner commitment and PS
      ownable = await ZOwnablePKSimulator.create(
        ownerId,
        INSTANCE_SALT,
        isInit,
        {
          privateState: PS,
        },
      );
    });

    describe('owner', () => {
      it('should return the correct owner commitment', async () => {
        const expCommitment = buildCommitment(
          Z_OWNER,
          secretNonce,
          INSTANCE_SALT,
          INIT_COUNTER,
          DOMAIN,
        );
        expect(await ownable.owner()).toEqual(expCommitment);
      });
    });

    describe('transferOwnership', () => {
      let newOwnerCommitment: Uint8Array;
      let newOwnerNonce: Uint8Array;
      let newIdHash: Uint8Array;
      let newCounter: bigint;

      beforeEach(() => {
        // Prepare new owner commitment
        newOwnerNonce = ZOwnablePKPrivateState.generate().secretNonce;
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

      it('should transfer ownership', async () => {
        await ownable.as('OWNER').transferOwnership(newIdHash);
        expect(await ownable.owner()).toEqual(newOwnerCommitment);

        // Old owner
        await expect(ownable.as('OWNER').assertOnlyOwner()).rejects.toThrow(
          'ZOwnablePK: caller is not the owner',
        );

        // Unauthorized
        await expect(
          ownable.as('UNAUTHORIZED').assertOnlyOwner(),
        ).rejects.toThrow('ZOwnablePK: caller is not the owner');

        // New owner
        await ownable.privateState.injectSecretNonce(
          Buffer.from(newOwnerNonce),
        );
        await ownable.as('NEW_OWNER').assertOnlyOwner();
      });

      it('should fail when transferring to id zero', async () => {
        const badId = new Uint8Array(32).fill(0);
        await expect(
          ownable.as('OWNER').transferOwnership(badId),
        ).rejects.toThrow('ZOwnablePK: invalid id');
      });

      it('should fail when unauthorized transfers ownership', async () => {
        await expect(
          ownable.as('UNAUTHORIZED').transferOwnership(newIdHash),
        ).rejects.toThrow('ZOwnablePK: caller is not the owner');
      });

      /**
       * @description More thoroughly tested in `_transferOwnership`
       * */
      it('should bump instance after transfer', async () => {
        const beforeInstance = (await ownable.getPublicState())
          .ZOwnablePK__counter;

        // Transfer
        await ownable.as('OWNER').transferOwnership(newIdHash);

        // Check counter
        const afterInstance = (await ownable.getPublicState())
          .ZOwnablePK__counter;
        expect(afterInstance).toEqual(beforeInstance + 1n);
      });

      it('should change commitment when transferring ownership to self with same pk + nonce)', async () => {
        // Confirm current commitment
        const repeatedId = createIdHash(Z_OWNER, secretNonce);
        const initCommitment = await ownable.owner();
        const expInitCommitment = buildCommitmentFromId(
          repeatedId,
          INSTANCE_SALT,
          INIT_COUNTER,
        );
        expect(initCommitment).toEqual(expInitCommitment);

        // Transfer ownership to self with the same id -> `H(pk, nonce)`
        await ownable.as('OWNER').transferOwnership(repeatedId);

        // Check commitments don't match
        const newCommitment = await ownable.owner();
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
        await ownable.as('OWNER').assertOnlyOwner();
      });
    });

    describe('renounceOwnership', () => {
      it('should renounce ownership', async () => {
        await ownable.as('OWNER').renounceOwnership();

        // Check owner is reset
        expect(await ownable.owner()).toEqual(new Uint8Array(32).fill(0));

        // Check revoked permissions
        await expect(ownable.as('OWNER').assertOnlyOwner()).rejects.toThrow(
          'ZOwnablePK: caller is not the owner',
        );
      });

      it('should fail when renouncing from unauthorized', async () => {
        await expect(
          ownable.as('UNAUTHORIZED').renounceOwnership(),
        ).rejects.toThrow('ZOwnablePK: caller is not the owner');
      });

      it('should fail when renouncing from authorized with bad nonce', async () => {
        await ownable.privateState.injectSecretNonce(BAD_NONCE);
        await expect(ownable.as('OWNER').renounceOwnership()).rejects.toThrow(
          'ZOwnablePK: caller is not the owner',
        );
      });

      it('should fail when renouncing from unauthorized with bad nonce', async () => {
        await ownable.privateState.injectSecretNonce(BAD_NONCE);
        await expect(
          ownable.as('UNAUTHORIZED').renounceOwnership(),
        ).rejects.toThrow('ZOwnablePK: caller is not the owner');
      });
    });

    describe('assertOnlyOwner', () => {
      it('should allow authorized caller with correct nonce to call', async () => {
        // Check nonce is correct
        expect(await ownable.privateState.getCurrentSecretNonce()).toEqual(
          secretNonce,
        );

        await ownable.as('OWNER').assertOnlyOwner();
      });

      it('should fail when the authorized caller has the wrong nonce', async () => {
        // Inject bad nonce
        await ownable.privateState.injectSecretNonce(BAD_NONCE);

        // Check nonce does not match
        expect(await ownable.privateState.getCurrentSecretNonce()).not.toEqual(
          secretNonce,
        );

        // Set caller and call circuit
        await expect(ownable.as('OWNER').assertOnlyOwner()).rejects.toThrow(
          'ZOwnablePK: caller is not the owner',
        );
      });

      it('should fail when unauthorized caller has the correct nonce', async () => {
        // Check nonce is correct
        expect(await ownable.privateState.getCurrentSecretNonce()).toEqual(
          secretNonce,
        );

        await expect(
          ownable.as('UNAUTHORIZED').assertOnlyOwner(),
        ).rejects.toThrow('ZOwnablePK: caller is not the owner');
      });

      it('should fail when unauthorized caller has the wrong nonce', async () => {
        // Inject bad nonce
        await ownable.privateState.injectSecretNonce(BAD_NONCE);

        // Check nonce does not match
        expect(await ownable.privateState.getCurrentSecretNonce()).not.toEqual(
          secretNonce,
        );

        // Set unauthorized caller and call circuit
        await expect(
          ownable.as('UNAUTHORIZED').assertOnlyOwner(),
        ).rejects.toThrow('ZOwnablePK: caller is not the owner');
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
      it.each(
        testCases,
      )('should match commitment for $label with counter $counter', async ({
        ownerPK,
        counter,
      }) => {
        const id = createIdHash(ownerPK, secretNonce);

        // Check buildCommitmentFromId
        const hashFromContract = await ownable._computeOwnerCommitment(
          id,
          counter,
        );
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
      });
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

      it.each(
        testCases,
      )('should match local and contract owner id for $label', async ({
        eitherOwner,
        nonce,
      }) => {
        const ownerId = await ownable._computeOwnerId(eitherOwner, nonce);
        const expId = createIdHash(eitherOwner.left, nonce);
        expect(ownerId).toEqual(expId);
      });

      it('should fail to compute ContractAddress id', async () => {
        const eitherContract =
          utils.createEitherTestContractAddress('CONTRACT');
        await expect(
          ownable._computeOwnerId(eitherContract, secretNonce),
        ).rejects.toThrow(
          'ZOwnablePK: contract address owners are not yet supported',
        );
      });
    });

    describe('_transferOwnership', () => {
      it('should transfer ownership', async () => {
        const id = createIdHash(Z_OWNER, secretNonce);
        await ownable._transferOwnership(id);

        const nextCounter = INIT_COUNTER + 1n;
        const expCommitment = buildCommitmentFromId(
          id,
          INSTANCE_SALT,
          nextCounter,
        );
        expect(await ownable.owner()).toEqual(expCommitment);
      });

      it('should bump the counter with each transfer', async () => {
        const nTransfers = 10;
        const counterStart = 2; // count starts at 2 bc the constructor bumps the count to 1
        for (let i = counterStart; i <= nTransfers; i++) {
          const pk = utils.encodeToPK(`Id${i}`);
          const nonce = new Uint8Array(32).fill(i);
          const id = createIdHash(pk, nonce);
          await ownable._transferOwnership(id);

          expect((await ownable.getPublicState()).ZOwnablePK__counter).toEqual(
            BigInt(i),
          );
        }
      });

      it('should allow transfer to all zeroes id', async () => {
        const zeroId = utils.zeroUint8Array();
        await ownable._transferOwnership(zeroId);

        const nextCounter = INIT_COUNTER + 1n;
        const expCommitment = buildCommitmentFromId(
          zeroId,
          INSTANCE_SALT,
          nextCounter,
        );
        expect(await ownable.owner()).toEqual(expCommitment);
      });

      it('should allow anyone to transfer', async () => {
        const id = createIdHash(Z_OWNER, secretNonce);
        await ownable.as('OWNER')._transferOwnership(id);

        await ownable.as('UNAUTHORIZED')._transferOwnership(id);
      });
    });
  });
});
