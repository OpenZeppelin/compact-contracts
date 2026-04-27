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
    it('should initialize', () => {
      ownable = new OwnableSimulator(OWNER.either, isInit, {
        privateState: { secretKey: OWNER.secretKey },
      });
      expect(ownable.owner()).toEqual(OWNER.either);
    });

    it('should fail to initialize when owner is a contract address', () => {
      expect(() => {
        new OwnableSimulator(OWNER_CONTRACT, isInit, {
          privateState: { secretKey: OWNER.secretKey },
        });
      }).toThrow('Ownable: unsafe ownership transfer');
    });

    it.each(
      zeroTypes,
    )('should fail to initialize when owner is zero (%s)', (_, _zero) => {
      expect(() => {
        ownable = new OwnableSimulator(_zero, isInit, {
          privateState: { secretKey: OWNER.secretKey },
        });
      }).toThrow('Ownable: invalid initial owner');
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
    )('should fail when calling circuit "%s"', (circuitName, args) => {
      ownable = new OwnableSimulator(OWNER.either, isBadInit, {
        privateState: { secretKey: OWNER.secretKey },
      });
      expect(() => {
        (ownable[circuitName] as (...args: unknown[]) => unknown)(...args);
      }).toThrow('Initializable: contract not initialized');
    });

    it('should canonicalize initial owner', () => {
      const nonCanonical = {
        is_left: true,
        left: OWNER.accountId,
        right: utils.encodeToAddress('JUNK_DATA'),
      };

      ownable = new OwnableSimulator(nonCanonical, isInit, {
        privateState: { secretKey: OWNER.secretKey },
      });

      const stored = ownable.owner();
      expect(stored.is_left).toBe(true);
      expect(stored.left).toEqual(OWNER.accountId);
      expect(stored.right).toEqual({ bytes: zeroBytes });
    });
  });

  describe('when initialized', () => {
    beforeEach(() => {
      ownable = new OwnableSimulator(OWNER.either, isInit, {
        privateState: { secretKey: OWNER.secretKey },
      });
    });

    describe('owner', () => {
      it('should return owner', () => {
        expect(ownable.owner()).toEqual(OWNER.either);
      });

      it('should return zero when unowned', () => {
        ownable._transferOwnership(ZERO_ACCOUNT);
        expect(ownable.owner()).toEqual(ZERO_ACCOUNT);
      });
    });

    describe('computeAccountId', () => {
      it('should match pre-computed accountId', () => {
        expect(ownable.computeAccountId(OWNER.secretKey)).toEqual(
          OWNER.accountId,
        );
      });

      it('should produce different accountId with different key', () => {
        expect(ownable.computeAccountId(UNAUTHORIZED.secretKey)).not.toEqual(
          OWNER.accountId,
        );
      });

      it('should match test helper derivation', () => {
        expect(ownable.computeAccountId(OWNER.secretKey)).toEqual(
          buildAccountIdHash(OWNER.secretKey),
        );
      });
    });

    describe('assertOnlyOwner', () => {
      it('should allow owner to call', () => {
        expect(() => ownable.assertOnlyOwner()).not.toThrow();
      });

      it('should fail when called by unauthorized', () => {
        ownable.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
        expect(() => ownable.assertOnlyOwner()).toThrow(
          'Ownable: caller is not the owner',
        );
      });

      it('should reject all accountId callers when owner is a contract', () => {
        ownable._unsafeTransferOwnership(OWNER_CONTRACT);

        // Original owner rejected
        expect(() => ownable.assertOnlyOwner()).toThrow(
          'Ownable: contract address owner authentication is not yet supported',
        );

        // Sample other keys
        for (const label of ['SAMPLE_1', 'SAMPLE_2', 'SAMPLE_3']) {
          const sampleUser = makeUser(label);
          ownable.privateState.injectSecretKey(sampleUser.secretKey);
          expect(() => ownable.assertOnlyOwner()).toThrow(
            'Ownable: contract address owner authentication is not yet supported',
          );
        }
      });
    });

    describe('transferOwnership', () => {
      it('should transfer ownership', () => {
        ownable.transferOwnership(NEW_OWNER.either);
        expect(ownable.owner()).toEqual(NEW_OWNER.either);

        // Original owner can no longer call
        expect(() => ownable.assertOnlyOwner()).toThrow(
          'Ownable: caller is not the owner',
        );

        // Unauthorized still can't call
        ownable.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
        expect(() => ownable.assertOnlyOwner()).toThrow(
          'Ownable: caller is not the owner',
        );

        // New owner can call
        ownable.privateState.injectSecretKey(NEW_OWNER.secretKey);
        expect(() => ownable.assertOnlyOwner()).not.toThrow();
      });

      it('should fail when unauthorized transfers ownership', () => {
        ownable.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
        expect(() => ownable.transferOwnership(NEW_OWNER.either)).toThrow(
          'Ownable: caller is not the owner',
        );
      });

      it('should fail when transferring to a contract address', () => {
        expect(() => ownable.transferOwnership(RECIPIENT_CONTRACT)).toThrow(
          'Ownable: unsafe ownership transfer',
        );
      });

      it('should fail when transferring to zero (accountId)', () => {
        expect(() => ownable.transferOwnership(ZERO_ACCOUNT)).toThrow(
          'Ownable: invalid new owner',
        );
      });

      it('should fail when transferring to zero (contract)', () => {
        expect(() => ownable.transferOwnership(ZERO_CONTRACT)).toThrow(
          'Ownable: unsafe ownership transfer',
        );
      });

      it('should transfer multiple times', () => {
        ownable.transferOwnership(NEW_OWNER.either);

        ownable.privateState.injectSecretKey(NEW_OWNER.secretKey);
        ownable.transferOwnership(OWNER.either);

        ownable.privateState.injectSecretKey(OWNER.secretKey);
        ownable.transferOwnership(NEW_OWNER.either);

        expect(ownable.owner()).toEqual(NEW_OWNER.either);
      });
    });

    describe('_unsafeTransferOwnership', () => {
      it('should transfer ownership to accountId', () => {
        ownable._unsafeTransferOwnership(NEW_OWNER.either);
        expect(ownable.owner()).toEqual(NEW_OWNER.either);

        // Original owner rejected
        expect(() => ownable.assertOnlyOwner()).toThrow(
          'Ownable: caller is not the owner',
        );

        // New owner can call
        ownable.privateState.injectSecretKey(NEW_OWNER.secretKey);
        expect(() => ownable.assertOnlyOwner()).not.toThrow();
      });

      it('should transfer ownership to contract', () => {
        ownable._unsafeTransferOwnership(OWNER_CONTRACT);
        expect(ownable.owner()).toEqual(OWNER_CONTRACT);

        // No one can authenticate, c2c not supported
        expect(() => ownable.assertOnlyOwner()).toThrow(
          'Ownable: contract address owner authentication is not yet supported',
        );
      });

      it('should fail when unauthorized transfers ownership', () => {
        ownable.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
        expect(() =>
          ownable._unsafeTransferOwnership(NEW_OWNER.either),
        ).toThrow('Ownable: caller is not the owner');
      });

      it('should fail when transferring to zero (accountId)', () => {
        expect(() => ownable._unsafeTransferOwnership(ZERO_ACCOUNT)).toThrow(
          'Ownable: invalid new owner',
        );
      });

      it('should fail when transferring to zero (contract)', () => {
        expect(() => ownable._unsafeTransferOwnership(ZERO_CONTRACT)).toThrow(
          'Ownable: invalid new owner',
        );
      });

      it('should enforce permissions after transfer (accountId)', () => {
        ownable._unsafeTransferOwnership(NEW_OWNER.either);

        // Original owner can no longer call
        expect(() => ownable.assertOnlyOwner()).toThrow(
          'Ownable: caller is not the owner',
        );

        // Unauthorized still can't call
        ownable.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
        expect(() => ownable.assertOnlyOwner()).toThrow(
          'Ownable: caller is not the owner',
        );

        // New owner can call
        ownable.privateState.injectSecretKey(NEW_OWNER.secretKey);
        expect(() => ownable.assertOnlyOwner()).not.toThrow();
      });

      it('should transfer multiple times', () => {
        ownable._unsafeTransferOwnership(NEW_OWNER.either);

        ownable.privateState.injectSecretKey(NEW_OWNER.secretKey);
        ownable._unsafeTransferOwnership(OWNER.either);

        ownable.privateState.injectSecretKey(OWNER.secretKey);
        ownable._unsafeTransferOwnership(OWNER_CONTRACT);

        expect(ownable.owner()).toEqual(OWNER_CONTRACT);
      });
    });

    describe('renounceOwnership', () => {
      it('should renounce ownership', () => {
        expect(ownable.owner()).toEqual(OWNER.either);

        ownable.renounceOwnership();

        expect(ownable.owner()).toEqual(ZERO_ACCOUNT);

        // Confirm revoked permissions
        expect(() => ownable.assertOnlyOwner()).toThrow(
          'Ownable: caller is not the owner',
        );
      });

      it('should fail when renouncing from unauthorized', () => {
        ownable.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
        expect(() => ownable.renounceOwnership()).toThrow(
          'Ownable: caller is not the owner',
        );
      });

      it('should store canonical zero after renouncing', () => {
        ownable.renounceOwnership();

        const stored = ownable.owner();
        expect(stored.is_left).toBe(true);
        expect(stored.left).toEqual(zeroBytes);
        expect(stored.right).toEqual({ bytes: zeroBytes });
      });
    });

    describe('_transferOwnership', () => {
      it('should transfer ownership', () => {
        ownable._transferOwnership(NEW_OWNER.either);
        expect(ownable.owner()).toEqual(NEW_OWNER.either);

        // Original owner can no longer call
        expect(() => ownable.assertOnlyOwner()).toThrow(
          'Ownable: caller is not the owner',
        );

        // Unauthorized still can't call
        ownable.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
        expect(() => ownable.assertOnlyOwner()).toThrow(
          'Ownable: caller is not the owner',
        );

        // New owner can call
        ownable.privateState.injectSecretKey(NEW_OWNER.secretKey);
        expect(() => ownable.assertOnlyOwner()).not.toThrow();
      });

      it('should allow transfers to zero', () => {
        ownable._transferOwnership(ZERO_ACCOUNT);
        expect(ownable.owner()).toEqual(ZERO_ACCOUNT);
      });

      it('should fail when transferring to contract address zero', () => {
        expect(() => ownable._transferOwnership(ZERO_CONTRACT)).toThrow(
          'Ownable: unsafe ownership transfer',
        );
      });

      it('should fail when transferring to non-zero contract address', () => {
        expect(() => ownable._transferOwnership(OWNER_CONTRACT)).toThrow(
          'Ownable: unsafe ownership transfer',
        );
      });

      it('should transfer multiple times', () => {
        ownable._transferOwnership(NEW_OWNER.either);

        ownable.privateState.injectSecretKey(NEW_OWNER.secretKey);
        ownable._transferOwnership(OWNER.either);

        ownable.privateState.injectSecretKey(OWNER.secretKey);
        ownable._transferOwnership(NEW_OWNER.either);

        expect(ownable.owner()).toEqual(NEW_OWNER.either);
      });

      it('should allow transfers to zero', () => {
        ownable._transferOwnership(ZERO_ACCOUNT);
        expect(ownable.owner()).toEqual(ZERO_ACCOUNT);

        // No one can authenticate after zeroing
        expect(() => ownable.assertOnlyOwner()).toThrow(
          'Ownable: caller is not the owner',
        );
      });
    });

    describe('_unsafeUncheckedTransferOwnership', () => {
      it('should transfer ownership to accountId', () => {
        ownable._unsafeUncheckedTransferOwnership(NEW_OWNER.either);
        expect(ownable.owner()).toEqual(NEW_OWNER.either);

        // Original owner rejected
        expect(() => ownable.assertOnlyOwner()).toThrow(
          'Ownable: caller is not the owner',
        );

        // New owner can call
        ownable.privateState.injectSecretKey(NEW_OWNER.secretKey);
        expect(() => ownable.assertOnlyOwner()).not.toThrow();
      });

      it('should transfer ownership to contract', () => {
        ownable._unsafeUncheckedTransferOwnership(OWNER_CONTRACT);
        expect(ownable.owner()).toEqual(OWNER_CONTRACT);

        // No one can authenticate, c2c not supported
        expect(() => ownable.assertOnlyOwner()).toThrow(
          'Ownable: contract address owner authentication is not yet supported',
        );
      });

      it('should enforce permissions after transfer (accountId)', () => {
        ownable._unsafeUncheckedTransferOwnership(NEW_OWNER.either);

        // Original owner can no longer call
        expect(() => ownable.assertOnlyOwner()).toThrow(
          'Ownable: caller is not the owner',
        );

        // Unauthorized still can't call
        ownable.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
        expect(() => ownable.assertOnlyOwner()).toThrow(
          'Ownable: caller is not the owner',
        );

        // New owner can call
        ownable.privateState.injectSecretKey(NEW_OWNER.secretKey);
        expect(() => ownable.assertOnlyOwner()).not.toThrow();
      });

      it('should transfer multiple times', () => {
        ownable._unsafeUncheckedTransferOwnership(NEW_OWNER.either);

        ownable.privateState.injectSecretKey(NEW_OWNER.secretKey);
        ownable._unsafeUncheckedTransferOwnership(OWNER.either);

        ownable.privateState.injectSecretKey(OWNER.secretKey);
        ownable._unsafeUncheckedTransferOwnership(OWNER_CONTRACT);

        expect(ownable.owner()).toEqual(OWNER_CONTRACT);
      });

      it('should canonicalize accountId (zero out inactive right side)', () => {
        // Craft a non-canonical Either: is_left=true but right side has data
        const nonCanonical = {
          is_left: true,
          left: NEW_OWNER.accountId,
          right: utils.encodeToAddress('JUNK_DATA'),
        };

        ownable._unsafeUncheckedTransferOwnership(nonCanonical);

        const stored = ownable.owner();
        expect(stored.is_left).toBe(true);
        expect(stored.left).toEqual(NEW_OWNER.accountId);
        expect(stored.right).toEqual({ bytes: zeroBytes });
      });

      it('should canonicalize contract address (zero out inactive left side)', () => {
        // Craft a non-canonical Either: is_left=false but left side has data
        const nonCanonical = {
          is_left: false,
          left: NEW_OWNER.accountId,
          right: utils.encodeToAddress('OWNER_CONTRACT'),
        };

        ownable._unsafeUncheckedTransferOwnership(nonCanonical);

        const stored = ownable.owner();
        expect(stored.is_left).toBe(false);
        expect(stored.left).toEqual(zeroBytes);
        expect(stored.right).toEqual(utils.encodeToAddress('OWNER_CONTRACT'));
      });
    });
  });
});
