import {
  CompactTypeBytes,
  CompactTypeVector,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import { OwnableSimulator } from './simulators/OwnableSimulator.js';

// Helpers
const buildAccountIdHash = (sk: Uint8Array): Uint8Array => {
  const rt_type = new CompactTypeVector(1, new CompactTypeBytes(32));
  return persistentHash(rt_type, [sk]);
};

const zeroBytes = utils.zeroUint8Array();

const eitherAccountId = (accountId: Uint8Array) => {
  return {
    is_left: true,
    left: accountId,
    right: { bytes: zeroBytes },
  };
};

const eitherContract = (address: string) => {
  return {
    is_left: false,
    left: zeroBytes,
    right: utils.encodeToAddress(address),
  };
};

const createTestSK = (label: string): Uint8Array => {
  const sk = new Uint8Array(32);
  const encoded = new TextEncoder().encode(label);
  sk.set(encoded.slice(0, 32));
  return sk;
};

const makeUser = (label: string) => {
  const secretKey = createTestSK(label);
  const accountId = buildAccountIdHash(secretKey);
  const either = eitherAccountId(accountId);
  return { secretKey, accountId, either };
};

// Users
const OWNER = makeUser('OWNER');
const NEW_OWNER = makeUser('NEW_OWNER');
const UNAUTHORIZED = makeUser('UNAUTHORIZED');

// Contract addresses
const OWNER_CONTRACT = eitherContract('OWNER_CONTRACT');
const RECIPIENT_CONTRACT = eitherContract('RECIPIENT_CONTRACT');

// Zero values
const ZERO_ACCOUNT = eitherAccountId(zeroBytes);
const ZERO_CONTRACT = {
  is_left: false,
  left: zeroBytes,
  right: { bytes: zeroBytes },
};

// Init flags
const isInit = true;
const isBadInit = false;

let ownable: OwnableSimulator;

const zeroTypes = [
  ['contract', ZERO_CONTRACT],
  ['accountId', ZERO_ACCOUNT],
] as const;

describe('Ownable', () => {
  describe('before initialized', () => {
    it('should initialize', async () => {
      ownable = await OwnableSimulator.create(OWNER.either, isInit, {
        privateState: { secretKey: OWNER.secretKey },
      });
      expect(await ownable.owner()).toEqual(OWNER.either);
    });

    it('should fail to initialize when owner is a contract address', async () => {
      await expect(
        OwnableSimulator.create(OWNER_CONTRACT, isInit, {
          privateState: { secretKey: OWNER.secretKey },
        }),
      ).rejects.toThrow('Ownable: unsafe ownership transfer');
    });

    it.each(
      zeroTypes,
    )('should fail to initialize when owner is zero (%s)', async (_, _zero) => {
      await expect(
        OwnableSimulator.create(_zero, isInit, {
          privateState: { secretKey: OWNER.secretKey },
        }),
      ).rejects.toThrow('Ownable: invalid initial owner');
    });

    type FailingCircuits = [method: keyof OwnableSimulator, args: unknown[]];
    const circuitsToFail: FailingCircuits[] = [
      ['owner', []],
      ['assertOnlyOwner', []],
      ['transferOwnership', [OWNER.either]],
      ['_unsafeTransferOwnership', [OWNER.either]],
      ['renounceOwnership', []],
      ['_transferOwnership', [OWNER.either]],
      ['_unsafeUncheckedTransferOwnership', [OWNER.either]],
    ];
    it.each(
      circuitsToFail,
    )('should fail when calling circuit "%s"', async (circuitName, args) => {
      ownable = await OwnableSimulator.create(OWNER.either, isBadInit, {
        privateState: { secretKey: OWNER.secretKey },
      });
      await expect(
        (ownable[circuitName] as (...args: unknown[]) => Promise<unknown>)(
          ...args,
        ),
      ).rejects.toThrow('Ownable: contract not initialized');
    });

    it('should canonicalize initial owner', async () => {
      const nonCanonical = {
        is_left: true,
        left: OWNER.accountId,
        right: utils.encodeToAddress('JUNK_DATA'),
      };

      ownable = await OwnableSimulator.create(nonCanonical, isInit, {
        privateState: { secretKey: OWNER.secretKey },
      });

      const stored = await ownable.owner();
      expect(stored.is_left).toBe(true);
      expect(stored.left).toEqual(OWNER.accountId);
      expect(stored.right).toEqual({ bytes: zeroBytes });
    });
  });

  describe('when initialized', () => {
    beforeEach(async () => {
      ownable = await OwnableSimulator.create(OWNER.either, isInit, {
        privateState: { secretKey: OWNER.secretKey },
      });
    });

    describe('owner', () => {
      it('should return owner', async () => {
        expect(await ownable.owner()).toEqual(OWNER.either);
      });

      it('should return zero when unowned', async () => {
        await ownable._transferOwnership(ZERO_ACCOUNT);
        expect(await ownable.owner()).toEqual(ZERO_ACCOUNT);
      });
    });

    describe('assertOnlyOwner', () => {
      it('should allow owner to call', async () => {
        await ownable.assertOnlyOwner();
      });

      it('should fail when called by unauthorized', async () => {
        await ownable.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
        await expect(ownable.assertOnlyOwner()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );
      });

      it('should reject all accountId callers when owner is a contract', async () => {
        await ownable._unsafeTransferOwnership(OWNER_CONTRACT);

        // Original owner rejected
        await expect(ownable.assertOnlyOwner()).rejects.toThrow(
          'Ownable: contract address owner authentication is not yet supported',
        );

        // Sample other keys
        for (const label of ['SAMPLE_1', 'SAMPLE_2', 'SAMPLE_3']) {
          const sampleUser = makeUser(label);
          await ownable.privateState.injectSecretKey(sampleUser.secretKey);
          await expect(ownable.assertOnlyOwner()).rejects.toThrow(
            'Ownable: contract address owner authentication is not yet supported',
          );
        }
      });
    });

    describe('transferOwnership', () => {
      it('should transfer ownership', async () => {
        await ownable.transferOwnership(NEW_OWNER.either);
        expect(await ownable.owner()).toEqual(NEW_OWNER.either);

        // Original owner can no longer call
        await expect(ownable.assertOnlyOwner()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );

        // Unauthorized still can't call
        await ownable.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
        await expect(ownable.assertOnlyOwner()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );

        // New owner can call
        await ownable.privateState.injectSecretKey(NEW_OWNER.secretKey);
        await ownable.assertOnlyOwner();
      });

      it('should fail when unauthorized transfers ownership', async () => {
        await ownable.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
        await expect(
          ownable.transferOwnership(NEW_OWNER.either),
        ).rejects.toThrow('Ownable: caller is not the owner');
      });

      it('should fail when transferring to a contract address', async () => {
        await expect(
          ownable.transferOwnership(RECIPIENT_CONTRACT),
        ).rejects.toThrow('Ownable: unsafe ownership transfer');
      });

      it('should fail when transferring to zero (accountId)', async () => {
        await expect(ownable.transferOwnership(ZERO_ACCOUNT)).rejects.toThrow(
          'Ownable: invalid new owner',
        );
      });

      it('should fail when transferring to zero (contract)', async () => {
        await expect(ownable.transferOwnership(ZERO_CONTRACT)).rejects.toThrow(
          'Ownable: unsafe ownership transfer',
        );
      });

      it('should transfer multiple times', async () => {
        await ownable.transferOwnership(NEW_OWNER.either);

        await ownable.privateState.injectSecretKey(NEW_OWNER.secretKey);
        await ownable.transferOwnership(OWNER.either);

        await ownable.privateState.injectSecretKey(OWNER.secretKey);
        await ownable.transferOwnership(NEW_OWNER.either);

        expect(await ownable.owner()).toEqual(NEW_OWNER.either);
      });
    });

    describe('_unsafeTransferOwnership', () => {
      it('should transfer ownership to accountId', async () => {
        await ownable._unsafeTransferOwnership(NEW_OWNER.either);
        expect(await ownable.owner()).toEqual(NEW_OWNER.either);

        // Original owner rejected
        await expect(ownable.assertOnlyOwner()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );

        // New owner can call
        await ownable.privateState.injectSecretKey(NEW_OWNER.secretKey);
        await ownable.assertOnlyOwner();
      });

      it('should transfer ownership to contract', async () => {
        await ownable._unsafeTransferOwnership(OWNER_CONTRACT);
        expect(await ownable.owner()).toEqual(OWNER_CONTRACT);

        // No one can authenticate, c2c not supported
        await expect(ownable.assertOnlyOwner()).rejects.toThrow(
          'Ownable: contract address owner authentication is not yet supported',
        );
      });

      it('should fail when unauthorized transfers ownership', async () => {
        await ownable.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
        await expect(
          ownable._unsafeTransferOwnership(NEW_OWNER.either),
        ).rejects.toThrow('Ownable: caller is not the owner');
      });

      it('should fail when transferring to zero (accountId)', async () => {
        await expect(
          ownable._unsafeTransferOwnership(ZERO_ACCOUNT),
        ).rejects.toThrow('Ownable: invalid new owner');
      });

      it('should fail when transferring to zero (contract)', async () => {
        await expect(
          ownable._unsafeTransferOwnership(ZERO_CONTRACT),
        ).rejects.toThrow('Ownable: invalid new owner');
      });

      it('should enforce permissions after transfer (accountId)', async () => {
        await ownable._unsafeTransferOwnership(NEW_OWNER.either);

        // Original owner can no longer call
        await expect(ownable.assertOnlyOwner()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );

        // Unauthorized still can't call
        await ownable.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
        await expect(ownable.assertOnlyOwner()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );

        // New owner can call
        await ownable.privateState.injectSecretKey(NEW_OWNER.secretKey);
        await ownable.assertOnlyOwner();
      });

      it('should transfer multiple times', async () => {
        await ownable._unsafeTransferOwnership(NEW_OWNER.either);

        await ownable.privateState.injectSecretKey(NEW_OWNER.secretKey);
        await ownable._unsafeTransferOwnership(OWNER.either);

        await ownable.privateState.injectSecretKey(OWNER.secretKey);
        await ownable._unsafeTransferOwnership(OWNER_CONTRACT);

        expect(await ownable.owner()).toEqual(OWNER_CONTRACT);
      });
    });

    describe('renounceOwnership', () => {
      it('should renounce ownership', async () => {
        expect(await ownable.owner()).toEqual(OWNER.either);

        await ownable.renounceOwnership();

        expect(await ownable.owner()).toEqual(ZERO_ACCOUNT);

        // Confirm revoked permissions
        await expect(ownable.assertOnlyOwner()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );
      });

      it('should fail when renouncing from unauthorized', async () => {
        await ownable.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
        await expect(ownable.renounceOwnership()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );
      });

      it('should store canonical zero after renouncing', async () => {
        await ownable.renounceOwnership();

        const stored = await ownable.owner();
        expect(stored.is_left).toBe(true);
        expect(stored.left).toEqual(zeroBytes);
        expect(stored.right).toEqual({ bytes: zeroBytes });
      });
    });

    describe('_transferOwnership', () => {
      it('should transfer ownership', async () => {
        await ownable._transferOwnership(NEW_OWNER.either);
        expect(await ownable.owner()).toEqual(NEW_OWNER.either);

        // Original owner can no longer call
        await expect(ownable.assertOnlyOwner()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );

        // Unauthorized still can't call
        await ownable.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
        await expect(ownable.assertOnlyOwner()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );

        // New owner can call
        await ownable.privateState.injectSecretKey(NEW_OWNER.secretKey);
        await ownable.assertOnlyOwner();
      });

      it('should fail when transferring to contract address zero', async () => {
        await expect(ownable._transferOwnership(ZERO_CONTRACT)).rejects.toThrow(
          'Ownable: unsafe ownership transfer',
        );
      });

      it('should fail when transferring to non-zero contract address', async () => {
        await expect(
          ownable._transferOwnership(OWNER_CONTRACT),
        ).rejects.toThrow('Ownable: unsafe ownership transfer');
      });

      it('should transfer multiple times', async () => {
        await ownable._transferOwnership(NEW_OWNER.either);

        await ownable.privateState.injectSecretKey(NEW_OWNER.secretKey);
        await ownable._transferOwnership(OWNER.either);

        await ownable.privateState.injectSecretKey(OWNER.secretKey);
        await ownable._transferOwnership(NEW_OWNER.either);

        expect(await ownable.owner()).toEqual(NEW_OWNER.either);
      });

      it('should allow transfers to zero', async () => {
        await ownable._transferOwnership(ZERO_ACCOUNT);
        expect(await ownable.owner()).toEqual(ZERO_ACCOUNT);

        // No one can authenticate after zeroing
        await expect(ownable.assertOnlyOwner()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );
      });
    });

    describe('_unsafeUncheckedTransferOwnership', () => {
      it('should transfer ownership to accountId', async () => {
        await ownable._unsafeUncheckedTransferOwnership(NEW_OWNER.either);
        expect(await ownable.owner()).toEqual(NEW_OWNER.either);

        // Original owner rejected
        await expect(ownable.assertOnlyOwner()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );

        // New owner can call
        await ownable.privateState.injectSecretKey(NEW_OWNER.secretKey);
        await ownable.assertOnlyOwner();
      });

      it('should transfer ownership to contract', async () => {
        await ownable._unsafeUncheckedTransferOwnership(OWNER_CONTRACT);
        expect(await ownable.owner()).toEqual(OWNER_CONTRACT);

        // No one can authenticate, c2c not supported
        await expect(ownable.assertOnlyOwner()).rejects.toThrow(
          'Ownable: contract address owner authentication is not yet supported',
        );
      });

      it('should enforce permissions after transfer (accountId)', async () => {
        await ownable._unsafeUncheckedTransferOwnership(NEW_OWNER.either);

        // Original owner can no longer call
        await expect(ownable.assertOnlyOwner()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );

        // Unauthorized still can't call
        await ownable.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
        await expect(ownable.assertOnlyOwner()).rejects.toThrow(
          'Ownable: caller is not the owner',
        );

        // New owner can call
        await ownable.privateState.injectSecretKey(NEW_OWNER.secretKey);
        await ownable.assertOnlyOwner();
      });

      it('should transfer multiple times', async () => {
        await ownable._unsafeUncheckedTransferOwnership(NEW_OWNER.either);

        await ownable.privateState.injectSecretKey(NEW_OWNER.secretKey);
        await ownable._unsafeUncheckedTransferOwnership(OWNER.either);

        await ownable.privateState.injectSecretKey(OWNER.secretKey);
        await ownable._unsafeUncheckedTransferOwnership(OWNER_CONTRACT);

        expect(await ownable.owner()).toEqual(OWNER_CONTRACT);
      });

      it('should canonicalize accountId (zero out inactive right side)', async () => {
        // Craft a non-canonical Either: is_left=true but right side has data
        const nonCanonical = {
          is_left: true,
          left: NEW_OWNER.accountId,
          right: utils.encodeToAddress('JUNK_DATA'),
        };

        await ownable._unsafeUncheckedTransferOwnership(nonCanonical);

        const stored = await ownable.owner();
        expect(stored.is_left).toBe(true);
        expect(stored.left).toEqual(NEW_OWNER.accountId);
        expect(stored.right).toEqual({ bytes: zeroBytes });
      });

      it('should canonicalize contract address (zero out inactive left side)', async () => {
        // Craft a non-canonical Either: is_left=false but left side has data
        const nonCanonical = {
          is_left: false,
          left: NEW_OWNER.accountId,
          right: utils.encodeToAddress('OWNER_CONTRACT'),
        };

        await ownable._unsafeUncheckedTransferOwnership(nonCanonical);

        const stored = await ownable.owner();
        expect(stored.is_left).toBe(false);
        expect(stored.left).toEqual(zeroBytes);
        expect(stored.right).toEqual(utils.encodeToAddress('OWNER_CONTRACT'));
      });
    });
  });

  describe('simulator wiring', () => {
    it('should construct with a generated private state when none is supplied', async () => {
      const sim = await OwnableSimulator.create(OWNER.either, isInit);
      const sk = await sim.privateState.getCurrentSecretKey();

      expect(sk).toBeInstanceOf(Uint8Array);
      expect(sk.length).toBe(32);
    });

    it('should expose an empty public ledger via getPublicState', async () => {
      const sim = await OwnableSimulator.create(OWNER.either, isInit, {
        privateState: { secretKey: OWNER.secretKey },
      });

      expect(await sim.getPublicState()).toStrictEqual({});
    });
  });

  describe('privateState helpers', () => {
    describe('getCurrentSecretKey', () => {
      it('should return the injected secret key', async () => {
        ownable = await OwnableSimulator.create(OWNER.either, isInit, {
          privateState: { secretKey: OWNER.secretKey },
        });
        await ownable.privateState.injectSecretKey(NEW_OWNER.secretKey);

        expect(await ownable.privateState.getCurrentSecretKey()).toEqual(
          NEW_OWNER.secretKey,
        );
      });

      it('should throw when the secret key is undefined', async () => {
        const sim = await OwnableSimulator.create(OWNER.either, isInit, {
          privateState: { secretKey: undefined as unknown as Uint8Array },
        });

        await expect(sim.privateState.getCurrentSecretKey()).rejects.toThrow(
          'Missing secret key',
        );
      });
    });
  });
});
