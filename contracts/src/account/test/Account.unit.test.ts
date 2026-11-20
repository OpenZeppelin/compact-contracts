import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type Account,
  AccountSimulator,
} from './simulators/AccountSimulator.js';

/** Deterministic 32 bytes from a label. */
const bytes32 = (label: string): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(label));
  return bytes;
};

const PK = bytes32('pk');
const ADDRESS = bytes32('address');
const ZERO = new Uint8Array(32);

const keyAccount = (pk: Uint8Array, unused: Uint8Array = ZERO): Account => ({
  is_left: true,
  left: pk,
  right: { bytes: unused },
});

const contractAccount = (
  address: Uint8Array,
  unused: Uint8Array = ZERO,
): Account => ({
  is_left: false,
  left: unused,
  right: { bytes: address },
});

const ACCOUNT_SOURCE = readFileSync(
  new URL('../Account.compact', import.meta.url),
  'utf8',
);

/** Source lines with doc and line comments dropped. */
const codeLines = (source: string): string[] =>
  source
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        !line.startsWith('*') &&
        !line.startsWith('/*') &&
        !line.startsWith('//'),
    );

let account: AccountSimulator;

describe('Account', () => {
  beforeAll(async () => {
    account = await AccountSimulator.create();
  });

  describe('publicKeyOf', () => {
    it('should return the key of a key account', async () => {
      expect(await account.publicKeyOf(keyAccount(PK))).toStrictEqual(PK);
    });

    // No guard: the all-zero key is still a key.
    it('should return the all-zero key', async () => {
      expect(await account.publicKeyOf(keyAccount(ZERO))).toStrictEqual(ZERO);
    });

    it('should ignore the contract arm of a key account', async () => {
      expect(await account.publicKeyOf(keyAccount(PK, ADDRESS))).toStrictEqual(
        PK,
      );
    });

    it('should reject a contract account', async () => {
      await expect(
        account.publicKeyOf(contractAccount(ADDRESS)),
      ).rejects.toThrow('Account: contract account');
    });

    it('should reject a contract account whose key arm is set', async () => {
      await expect(
        account.publicKeyOf(contractAccount(ADDRESS, PK)),
      ).rejects.toThrow('Account: contract account');
    });
  });

  describe('contractAddressOf', () => {
    it('should return the address of a contract account', async () => {
      expect(
        await account.contractAddressOf(contractAccount(ADDRESS)),
      ).toStrictEqual({ bytes: ADDRESS });
    });

    // No guard: the all-zero address is still an address.
    it('should return the all-zero address', async () => {
      expect(
        await account.contractAddressOf(contractAccount(ZERO)),
      ).toStrictEqual({ bytes: ZERO });
    });

    it('should ignore the key arm of a contract account', async () => {
      expect(
        await account.contractAddressOf(contractAccount(ADDRESS, PK)),
      ).toStrictEqual({ bytes: ADDRESS });
    });

    it('should reject a key account', async () => {
      await expect(account.contractAddressOf(keyAccount(PK))).rejects.toThrow(
        'Account: not a contract account',
      );
    });

    it('should reject a key account whose contract arm is set', async () => {
      await expect(
        account.contractAddressOf(keyAccount(PK, ADDRESS)),
      ).rejects.toThrow('Account: not a contract account');
    });
  });

  describe('purity', () => {
    it('should declare two pure circuits and hold no ledger or witness', () => {
      const code = codeLines(ACCOUNT_SOURCE);

      expect(
        code
          .filter((line) => /\bcircuit\b/.test(line))
          .map((line) => line.slice(0, line.indexOf('('))),
      ).toStrictEqual([
        'export pure circuit publicKeyOf',
        'export pure circuit contractAddressOf',
      ]);
      expect(
        code.filter((line) => /\b(ledger|witness)\b/.test(line)),
      ).toStrictEqual([]);
    });

    // The mock's call counter is unexported, so a reader sees no state.
    it('should leave the mock with no exported ledger state', async () => {
      await account.publicKeyOf(keyAccount(PK));

      expect(await account.getPublicState()).toStrictEqual({});
    });
  });
});
