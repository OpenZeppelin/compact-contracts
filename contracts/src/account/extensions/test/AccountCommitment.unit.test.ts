import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { AccountCommitmentSimulator } from './simulators/AccountCommitmentSimulator.js';

/** Deterministic 32 bytes from a label; also Compact's `pad(32, label)`. */
const bytes32 = (label: string): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(label));
  return bytes;
};

const DOMAIN = bytes32('AccountCommitment:unit');
const OTHER_DOMAIN = bytes32('AccountCommitment:other');
const PUBLIC_KEY = bytes32('public key');
const OTHER_PUBLIC_KEY = bytes32('other public key');
const BLINDING = bytes32('blinding');
const OTHER_BLINDING = bytes32('other blinding');

const ACCOUNT_COMMITMENT_SOURCE = readFileSync(
  new URL('../AccountCommitment.compact', import.meta.url),
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

let accountCommitment: AccountCommitmentSimulator;

describe('AccountCommitment', () => {
  beforeAll(async () => {
    accountCommitment = await AccountCommitmentSimulator.create();
  });

  describe('commit', () => {
    it('should return 32 bytes', async () => {
      const commitment = await accountCommitment.commit(
        DOMAIN,
        PUBLIC_KEY,
        BLINDING,
      );

      expect(commitment).toBeInstanceOf(Uint8Array);
      expect(commitment.length).toBe(32);
    });

    it('should return the same commitment for the same inputs', async () => {
      expect(
        await accountCommitment.commit(DOMAIN, PUBLIC_KEY, BLINDING),
      ).toStrictEqual(
        await accountCommitment.commit(DOMAIN, PUBLIC_KEY, BLINDING),
      );
    });

    it('should differ per domain', async () => {
      expect(
        await accountCommitment.commit(DOMAIN, PUBLIC_KEY, BLINDING),
      ).not.toStrictEqual(
        await accountCommitment.commit(OTHER_DOMAIN, PUBLIC_KEY, BLINDING),
      );
    });

    it('should differ per key', async () => {
      expect(
        await accountCommitment.commit(DOMAIN, PUBLIC_KEY, BLINDING),
      ).not.toStrictEqual(
        await accountCommitment.commit(DOMAIN, OTHER_PUBLIC_KEY, BLINDING),
      );
    });

    it('should differ per blinding', async () => {
      expect(
        await accountCommitment.commit(DOMAIN, PUBLIC_KEY, BLINDING),
      ).not.toStrictEqual(
        await accountCommitment.commit(DOMAIN, PUBLIC_KEY, OTHER_BLINDING),
      );
    });
  });

  describe('purity', () => {
    it('should declare one pure circuit and hold no ledger, witness or assert', () => {
      const code = codeLines(ACCOUNT_COMMITMENT_SOURCE);

      expect(
        code
          .filter((line) => /\bcircuit\b/.test(line))
          .map((line) => line.slice(0, line.indexOf('('))),
      ).toStrictEqual(['export pure circuit commit']);
      expect(
        code.filter((line) => /\b(ledger|witness)\b/.test(line)),
      ).toStrictEqual([]);
      expect(code.join('\n')).not.toMatch(/\bassert\(/);
    });

    // The mock's call counter is unexported, so a reader sees no state.
    it('should leave the mock with no exported ledger state', async () => {
      await accountCommitment.commit(DOMAIN, PUBLIC_KEY, BLINDING);

      expect(await accountCommitment.getPublicState()).toStrictEqual({});
    });
  });
});
