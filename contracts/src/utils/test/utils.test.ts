import {
  CompactTypeBytes,
  CompactTypeVector,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import * as contractUtils from '#test-utils/address.js';
import { UtilsSimulator } from './simulators/UtilsSimulator.js';

const Z_SOME_KEY = contractUtils.createEitherTestUser('SOME_KEY');
const Z_OTHER_KEY = contractUtils.createEitherTestUser('OTHER_KEY');
const SOME_CONTRACT =
  contractUtils.createEitherTestContractAddress('SOME_CONTRACT');
const OTHER_CONTRACT =
  contractUtils.createEitherTestContractAddress('OTHER_CONTRACT');

const EMPTY_STRING = '';

// Helpers for the `Either<Bytes<32>, ContractAddress>` account-identifier domain.
const zeroBytes = contractUtils.zeroUint8Array();

const buildAccountIdHash = (sk: Uint8Array): Uint8Array => {
  const rt_type = new CompactTypeVector(1, new CompactTypeBytes(32));
  return persistentHash(rt_type, [sk]);
};

const createTestSK = (label: string): Uint8Array => {
  const sk = new Uint8Array(32);
  sk.set(new TextEncoder().encode(label).slice(0, 32));
  return sk;
};

const eitherAccount = (accountId: Uint8Array) => ({
  is_left: true,
  left: accountId,
  right: { bytes: zeroBytes },
});

const eitherContract = (str: string) => ({
  is_left: false,
  left: zeroBytes,
  right: contractUtils.encodeToAddress(str),
});

let contract: UtilsSimulator;

describe('Utils', () => {
  beforeEach(async () => {
    contract = await UtilsSimulator.create();
  });

  describe('isKeyOrAddressZero', () => {
    it('should return zero for the zero address', async () => {
      expect(await contract.isKeyOrAddressZero(contractUtils.ZERO_KEY)).toBe(
        true,
      );
    });

    it('should not return zero for nonzero addresses', async () => {
      expect(await contract.isKeyOrAddressZero(Z_SOME_KEY)).toBe(false);
      expect(await contract.isKeyOrAddressZero(SOME_CONTRACT)).toBe(false);
    });

    it('should not return zero for a zero contract address', async () => {
      expect(
        await contract.isKeyOrAddressZero(contractUtils.ZERO_ADDRESS),
      ).toBe(true);
    });
  });

  describe('isKeyOrAddressEqual', () => {
    it('should return true for two matching pubkeys', async () => {
      expect(await contract.isKeyOrAddressEqual(Z_SOME_KEY, Z_SOME_KEY)).toBe(
        true,
      );
    });

    it('should return true for two matching contract addresses', async () => {
      expect(
        await contract.isKeyOrAddressEqual(SOME_CONTRACT, SOME_CONTRACT),
      ).toBe(true);
    });

    it('should return false for two different pubkeys', async () => {
      expect(await contract.isKeyOrAddressEqual(Z_SOME_KEY, Z_OTHER_KEY)).toBe(
        false,
      );
    });

    it('should return false for two different contract addresses', async () => {
      expect(
        await contract.isKeyOrAddressEqual(SOME_CONTRACT, OTHER_CONTRACT),
      ).toBe(false);
    });

    it('should return false for two different address types', async () => {
      expect(
        await contract.isKeyOrAddressEqual(Z_SOME_KEY, SOME_CONTRACT),
      ).toBe(false);
    });

    it('should return false for two different address types of equal value', async () => {
      expect(
        await contract.isKeyOrAddressEqual(
          contractUtils.ZERO_KEY,
          contractUtils.ZERO_ADDRESS,
        ),
      ).toBe(false);
    });
  });

  describe('isKeyZero', () => {
    it('should return zero for the zero address', async () => {
      expect(await contract.isKeyZero(contractUtils.ZERO_KEY.left)).toBe(true);
    });

    it('should not return zero for nonzero addresses', async () => {
      expect(await contract.isKeyZero(Z_SOME_KEY.left)).toBe(false);
    });
  });

  describe('isContractAddress', () => {
    it('should return true if ContractAddress', async () => {
      expect(await contract.isContractAddress(SOME_CONTRACT)).toBe(true);
    });

    it('should return false ZswapCoinPublicKey', async () => {
      expect(await contract.isContractAddress(Z_SOME_KEY)).toBe(false);
    });
  });

  describe('emptyString', () => {
    it('should return the empty string', async () => {
      expect(await contract.emptyString()).toBe(EMPTY_STRING);
    });
  });

  describe('canonicalizeKeyOrAddress', () => {
    it('should zero the right side when is_left is true', async () => {
      const crafted = {
        is_left: true,
        left: Z_SOME_KEY.left,
        right: SOME_CONTRACT.right,
      };
      const canonical = await contract.canonicalizeKeyOrAddress(crafted);
      expect(canonical.is_left).toBe(true);
      expect(canonical.left).toEqual(Z_SOME_KEY.left);
      expect(canonical.right).toEqual(contractUtils.ZERO_ADDRESS.right);
    });

    it('should zero the left side when is_left is false', async () => {
      const crafted = {
        is_left: false,
        left: Z_SOME_KEY.left,
        right: SOME_CONTRACT.right,
      };
      const canonical = await contract.canonicalizeKeyOrAddress(crafted);
      expect(canonical.is_left).toBe(false);
      expect(canonical.left).toEqual(contractUtils.ZERO_KEY.left);
      expect(canonical.right).toEqual(SOME_CONTRACT.right);
    });

    it('should be idempotent for canonical pubkey', async () => {
      const canonical = await contract.canonicalizeKeyOrAddress(Z_SOME_KEY);
      expect(canonical).toEqual(Z_SOME_KEY);
    });

    it('should be idempotent for canonical contract address', async () => {
      const canonical = await contract.canonicalizeKeyOrAddress(SOME_CONTRACT);
      expect(canonical).toEqual(SOME_CONTRACT);
    });

    it('should be idempotent for already-zero pubkey', async () => {
      const canonical = await contract.canonicalizeKeyOrAddress(
        contractUtils.ZERO_KEY,
      );
      expect(canonical).toEqual(contractUtils.ZERO_KEY);
    });

    it('should be idempotent for already-zero contract address', async () => {
      const canonical = await contract.canonicalizeKeyOrAddress(
        contractUtils.ZERO_ADDRESS,
      );
      expect(canonical).toEqual(contractUtils.ZERO_ADDRESS);
    });
  });

  describe('selfAsRecipient', () => {
    it('should return the contract address as a right-variant recipient', async () => {
      const result = await contract.selfAsRecipient();
      expect(result.is_left).toBe(false);
      expect(await contract.isContractAddress(result)).toBe(true);
    });

    it('should return a 32-byte contract address', async () => {
      const result = await contract.selfAsRecipient();
      expect(result.right.bytes).toBeInstanceOf(Uint8Array);
      expect(result.right.bytes.length).toBe(32);
    });

    it('should return the same address on repeated calls', async () => {
      const first = await contract.selfAsRecipient();
      const second = await contract.selfAsRecipient();
      expect(first.right.bytes).toEqual(second.right.bytes);
    });
  });

  describe('UINT128_MAX', () => {
    it('should return 2^128 - 1', async () => {
      expect(await contract.UINT128_MAX()).toBe((1n << 128n) - 1n);
    });
  });

  describe('zeroAccount', () => {
    it('should return a left variant', async () => {
      expect((await contract.zeroAccount()).is_left).toBe(true);
    });

    it('should have zero left and right branches', async () => {
      const zero = await contract.zeroAccount();
      expect(zero.left).toEqual(zeroBytes);
      expect(zero.right).toEqual({ bytes: zeroBytes });
    });
  });

  describe('isTargetZero', () => {
    it('should return true for the canonical zero account', async () => {
      expect(await contract.isTargetZero(await contract.zeroAccount())).toBe(
        true,
      );
    });

    it('should return true for a zero right-variant (contract)', async () => {
      expect(
        await contract.isTargetZero({
          is_left: false,
          left: zeroBytes,
          right: { bytes: zeroBytes },
        }),
      ).toBe(true);
    });

    it('should return false for a nonzero account (left variant)', async () => {
      const account = eitherAccount(buildAccountIdHash(createTestSK('ACCT')));
      expect(await contract.isTargetZero(account)).toBe(false);
    });

    it('should return false for a nonzero contract (right variant)', async () => {
      expect(await contract.isTargetZero(eitherContract('SOME_CONTRACT'))).toBe(
        false,
      );
    });
  });

  describe('computeAccountId', () => {
    it('should match the persistentHash derivation', async () => {
      const sk = createTestSK('SOME_SK');
      expect(await contract.computeAccountId(sk)).toEqual(
        buildAccountIdHash(sk),
      );
    });

    it('should produce distinct identifiers for distinct keys', async () => {
      const ids = await Promise.all(
        ['A', 'B', 'C'].map((label) =>
          contract.computeAccountId(createTestSK(label)),
        ),
      );
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          expect(ids[i]).not.toEqual(ids[j]);
        }
      }
    });
  });

  describe('simulator wiring', () => {
    it('should expose an empty public ledger via getPublicState', async () => {
      expect(await contract.getPublicState()).toStrictEqual({});
    });
  });
});
