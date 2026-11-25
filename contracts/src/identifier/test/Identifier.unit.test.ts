import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type Identifier,
  IdentifierKind,
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

  describe('unpack', () => {
    it('should return the key kind and the key of a key identifier', async () => {
      expect(await account.unpack(keyAccount(PK))).toStrictEqual({
        kind: IdentifierKind.Key,
        bytes: PK,
      });
    });

    // No guard: the all-zero key is still a key.
    it('should return the all-zero key', async () => {
      expect(await account.unpack(keyAccount(ZERO))).toStrictEqual({
        kind: IdentifierKind.Key,
        bytes: ZERO,
      });
    });

    it('should ignore the contract arm of a key identifier', async () => {
      expect(await account.unpack(keyAccount(PK, ADDRESS))).toStrictEqual({
        kind: IdentifierKind.Key,
        bytes: PK,
      });
    });

    it('should return the contract kind and the address of a contract identifier', async () => {
      expect(await account.unpack(contractAccount(ADDRESS))).toStrictEqual({
        kind: IdentifierKind.Contract,
        bytes: ADDRESS,
      });
    });

    it('should ignore the key arm of a contract identifier', async () => {
      expect(await account.unpack(contractAccount(ADDRESS, PK))).toStrictEqual({
        kind: IdentifierKind.Contract,
        bytes: ADDRESS,
      });
    });

    it('should tell a key and a contract with the same bytes apart', async () => {
      const key = await account.unpack(keyAccount(PK));
      const contract = await account.unpack(contractAccount(PK));

      expect(key.bytes).toStrictEqual(contract.bytes);
      expect(key.kind).not.toBe(contract.kind);
    });
  });

  describe('purity', () => {
    it('should declare one pure circuit and hold no ledger or witness', () => {
      const code = codeLines(ACCOUNT_SOURCE);

      expect(
        code
          .filter((line) => /\bcircuit\b/.test(line))
          .map((line) => line.slice(0, line.indexOf('('))),
      ).toStrictEqual(['export pure circuit unpack']);
      expect(
        code.filter((line) => /\b(ledger|witness)\b/.test(line)),
      ).toStrictEqual([]);
    });

    // The mock's call counter is unexported, so a reader sees no state.
    it('should leave the mock with no exported ledger state', async () => {
      await account.unpack(keyAccount(PK));

      expect(await account.getPublicState()).toStrictEqual({});
    });
  });
});
