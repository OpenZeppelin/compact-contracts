import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type Identifier,
  IdentifierSimulator,
} from './simulators/IdentifierSimulator.js';

/** Deterministic 32 bytes from a label. */
const bytes32 = (label: string): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(label));
  return bytes;
};

const PK = bytes32('pk');
const ADDRESS = bytes32('address');
const ZERO = new Uint8Array(32);

const keyAccount = (pk: Uint8Array, unused: Uint8Array = ZERO): Identifier => ({
  is_left: true,
  left: pk,
  right: { bytes: unused },
});

const contractAccount = (
  address: Uint8Array,
  unused: Uint8Array = ZERO,
): Identifier => ({
  is_left: false,
  left: unused,
  right: { bytes: address },
});

const ACCOUNT_SOURCE = readFileSync(
  new URL('../Identifier.compact', import.meta.url),
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

let account: IdentifierSimulator;

describe('Identifier', () => {
  beforeAll(async () => {
    account = await IdentifierSimulator.create();
  });

  describe('publicKeyOf', () => {
    it('should return the key of a key identifier', async () => {
      expect(await account.publicKeyOf(keyAccount(PK))).toStrictEqual(PK);
    });

    // No guard: the all-zero key is still a key.
    it('should return the all-zero key', async () => {
      expect(await account.publicKeyOf(keyAccount(ZERO))).toStrictEqual(ZERO);
    });

    it('should ignore the contract arm of a key identifier', async () => {
      expect(await account.publicKeyOf(keyAccount(PK, ADDRESS))).toStrictEqual(
        PK,
      );
    });

    it('should reject a contract identifier', async () => {
      await expect(
        account.publicKeyOf(contractAccount(ADDRESS)),
      ).rejects.toThrow('Identifier: contract identifier');
    });

    it('should reject a contract identifier whose key arm is set', async () => {
      await expect(
        account.publicKeyOf(contractAccount(ADDRESS, PK)),
      ).rejects.toThrow('Identifier: contract identifier');
    });
  });

  describe('purity', () => {
    it('should declare one pure circuit and hold no ledger or witness', () => {
      const code = codeLines(ACCOUNT_SOURCE);

      expect(
        code
          .filter((line) => /\bcircuit\b/.test(line))
          .map((line) => line.slice(0, line.indexOf('('))),
      ).toStrictEqual(['export pure circuit publicKeyOf']);
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
