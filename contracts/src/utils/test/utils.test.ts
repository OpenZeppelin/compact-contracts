import {
  CompactTypeBytes,
  CompactTypeVector,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { describe, expect, it } from 'vitest';
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
  contract = new UtilsSimulator();

  describe('isKeyOrAddressZero', () => {
    it('should return zero for the zero address', () => {
      expect(contract.isKeyOrAddressZero(contractUtils.ZERO_KEY)).toBe(true);
    });

    it('should not return zero for nonzero addresses', () => {
      expect(contract.isKeyOrAddressZero(Z_SOME_KEY)).toBe(false);
      expect(contract.isKeyOrAddressZero(SOME_CONTRACT)).toBe(false);
    });

    it('should not return zero for a zero contract address', () => {
      expect(contract.isKeyOrAddressZero(contractUtils.ZERO_ADDRESS)).toBe(
        true,
      );
    });
  });

  describe('isKeyOrAddressEqual', () => {
    it('should return true for two matching pubkeys', () => {
      expect(contract.isKeyOrAddressEqual(Z_SOME_KEY, Z_SOME_KEY)).toBe(true);
    });

    it('should return true for two matching contract addresses', () => {
      expect(contract.isKeyOrAddressEqual(SOME_CONTRACT, SOME_CONTRACT)).toBe(
        true,
      );
    });

    it('should return false for two different pubkeys', () => {
      expect(contract.isKeyOrAddressEqual(Z_SOME_KEY, Z_OTHER_KEY)).toBe(false);
    });

    it('should return false for two different contract addresses', () => {
      expect(contract.isKeyOrAddressEqual(SOME_CONTRACT, OTHER_CONTRACT)).toBe(
        false,
      );
    });

    it('should return false for two different address types', () => {
      expect(contract.isKeyOrAddressEqual(Z_SOME_KEY, SOME_CONTRACT)).toBe(
        false,
      );
    });

    it('should return false for two different address types of equal value', () => {
      expect(
        contract.isKeyOrAddressEqual(
          contractUtils.ZERO_KEY,
          contractUtils.ZERO_ADDRESS,
        ),
      ).toBe(false);
    });
  });

  describe('isKeyZero', () => {
    it('should return zero for the zero address', () => {
      expect(contract.isKeyZero(contractUtils.ZERO_KEY.left)).toBe(true);
    });

    it('should not return zero for nonzero addresses', () => {
      expect(contract.isKeyZero(Z_SOME_KEY.left)).toBe(false);
    });
  });

  describe('isContractAddress', () => {
    it('should return true if ContractAddress', () => {
      expect(contract.isContractAddress(SOME_CONTRACT)).toBe(true);
    });

    it('should return false ZswapCoinPublicKey', () => {
      expect(contract.isContractAddress(Z_SOME_KEY)).toBe(false);
    });
  });

  describe('emptyString', () => {
    it('should return the empty string', () => {
      expect(contract.emptyString()).toBe(EMPTY_STRING);
    });
  });

  describe('canonicalizeKeyOrAddress', () => {
    it('should zero the right side when is_left is true', () => {
      const crafted = {
        is_left: true,
        left: Z_SOME_KEY.left,
        right: SOME_CONTRACT.right,
      };
      const canonical = contract.canonicalizeKeyOrAddress(crafted);
      expect(canonical.is_left).toBe(true);
      expect(canonical.left).toEqual(Z_SOME_KEY.left);
      expect(canonical.right).toEqual(contractUtils.ZERO_ADDRESS.right);
    });

    it('should zero the left side when is_left is false', () => {
      const crafted = {
        is_left: false,
        left: Z_SOME_KEY.left,
        right: SOME_CONTRACT.right,
      };
      const canonical = contract.canonicalizeKeyOrAddress(crafted);
      expect(canonical.is_left).toBe(false);
      expect(canonical.left).toEqual(contractUtils.ZERO_KEY.left);
      expect(canonical.right).toEqual(SOME_CONTRACT.right);
    });

    it('should be idempotent for canonical pubkey', () => {
      const canonical = contract.canonicalizeKeyOrAddress(Z_SOME_KEY);
      expect(canonical).toEqual(Z_SOME_KEY);
    });

    it('should be idempotent for canonical contract address', () => {
      const canonical = contract.canonicalizeKeyOrAddress(SOME_CONTRACT);
      expect(canonical).toEqual(SOME_CONTRACT);
    });

    it('should be idempotent for already-zero pubkey', () => {
      const canonical = contract.canonicalizeKeyOrAddress(
        contractUtils.ZERO_KEY,
      );
      expect(canonical).toEqual(contractUtils.ZERO_KEY);
    });

    it('should be idempotent for already-zero contract address', () => {
      const canonical = contract.canonicalizeKeyOrAddress(
        contractUtils.ZERO_ADDRESS,
      );
      expect(canonical).toEqual(contractUtils.ZERO_ADDRESS);
    });
  });

  describe('selfAsRecipient', () => {
    it('should return the contract address as a right-variant recipient', () => {
      const result = contract.selfAsRecipient();
      expect(result.is_left).toBe(false);
      expect(contract.isContractAddress(result)).toBe(true);
    });

    it('should return a 32-byte contract address', () => {
      const result = contract.selfAsRecipient();
      expect(result.right.bytes).toBeInstanceOf(Uint8Array);
      expect(result.right.bytes.length).toBe(32);
    });

    it('should return the same address on repeated calls', () => {
      const first = contract.selfAsRecipient();
      const second = contract.selfAsRecipient();
      expect(first.right.bytes).toEqual(second.right.bytes);
    });
  });

  describe('UINT128_MAX', () => {
    it('should return 2^128 - 1', () => {
      expect(contract.UINT128_MAX()).toBe((1n << 128n) - 1n);
    });
  });

  describe('zeroAccount', () => {
    it('should return a left variant', () => {
      expect(contract.zeroAccount().is_left).toBe(true);
    });

    it('should have zero left and right branches', () => {
      const zero = contract.zeroAccount();
      expect(zero.left).toEqual(zeroBytes);
      expect(zero.right).toEqual({ bytes: zeroBytes });
    });
  });

  describe('isTargetZero', () => {
    it('should return true for the canonical zero account', () => {
      expect(contract.isTargetZero(contract.zeroAccount())).toBe(true);
    });

    it('should return true for a zero right-variant (contract)', () => {
      expect(
        contract.isTargetZero({
          is_left: false,
          left: zeroBytes,
          right: { bytes: zeroBytes },
        }),
      ).toBe(true);
    });

    it('should return false for a nonzero account (left variant)', () => {
      const account = eitherAccount(buildAccountIdHash(createTestSK('ACCT')));
      expect(contract.isTargetZero(account)).toBe(false);
    });

    it('should return false for a nonzero contract (right variant)', () => {
      expect(contract.isTargetZero(eitherContract('SOME_CONTRACT'))).toBe(
        false,
      );
    });
  });

  describe('computeAccountId', () => {
    it('should match the persistentHash derivation', () => {
      const sk = createTestSK('SOME_SK');
      expect(contract.computeAccountId(sk)).toEqual(buildAccountIdHash(sk));
    });

    it('should produce distinct identifiers for distinct keys', () => {
      const ids = ['A', 'B', 'C'].map((label) =>
        contract.computeAccountId(createTestSK(label)),
      );
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          expect(ids[i]).not.toEqual(ids[j]);
        }
      }
    });
  });

  describe('simulator wiring', () => {
    it('should expose an empty public ledger via getPublicState', () => {
      expect(contract.getPublicState()).toStrictEqual({});
    });
  });
});
