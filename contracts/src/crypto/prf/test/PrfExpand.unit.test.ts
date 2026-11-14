import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { PrfExpandSimulator } from './simulators/PrfExpandSimulator.js';

/** Deterministic 32 bytes from a label. */
const bytes32 = (label: string): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(label));
  return bytes;
};

// Compact `Field` modulus (BLS12-381 scalar field).
const P =
  52435875175126190479447740508185965837690552500527637822603658699938581184513n;

const DOMAIN = bytes32('Prf:unit');
const SLOT = bytes32('slot');
const OTHER_SLOT = bytes32('other slot');
const BYTES_CONTEXT = bytes32('context');
const OTHER_BYTES_CONTEXT = bytes32('other context');
const FIELD_CONTEXT = 123456789n;
const SEED = bytes32('seed');
const ZERO = new Uint8Array(32);

const PRF_EXPAND_SOURCE = readFileSync(
  new URL('../PrfExpand.compact', import.meta.url),
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

let prf: PrfExpandSimulator;

describe('PrfExpand', () => {
  beforeAll(async () => {
    prf = await PrfExpandSimulator.create();
  });

  describe('expand', () => {
    it('should return 32 bytes for a Bytes<32> context', async () => {
      const value = await prf.expandOfBytes(DOMAIN, SLOT, BYTES_CONTEXT, SEED);

      expect(value).toBeInstanceOf(Uint8Array);
      expect(value.length).toBe(32);
    });

    it('should return 32 bytes for a Field context', async () => {
      const value = await prf.expandOfField(DOMAIN, SLOT, FIELD_CONTEXT, SEED);

      expect(value).toBeInstanceOf(Uint8Array);
      expect(value.length).toBe(32);
    });

    it('should return the same value for the same inputs', async () => {
      expect(
        await prf.expandOfBytes(DOMAIN, SLOT, BYTES_CONTEXT, SEED),
      ).toStrictEqual(
        await prf.expandOfBytes(DOMAIN, SLOT, BYTES_CONTEXT, SEED),
      );
      expect(
        await prf.expandOfField(DOMAIN, SLOT, FIELD_CONTEXT, SEED),
      ).toStrictEqual(
        await prf.expandOfField(DOMAIN, SLOT, FIELD_CONTEXT, SEED),
      );
    });

    it('should derive distinct values for distinct slots under one seed and context', async () => {
      expect(
        await prf.expandOfBytes(DOMAIN, SLOT, BYTES_CONTEXT, SEED),
      ).not.toStrictEqual(
        await prf.expandOfBytes(DOMAIN, OTHER_SLOT, BYTES_CONTEXT, SEED),
      );
    });

    it('should derive distinct values for distinct contexts under one seed and slot', async () => {
      expect(
        await prf.expandOfBytes(DOMAIN, SLOT, BYTES_CONTEXT, SEED),
      ).not.toStrictEqual(
        await prf.expandOfBytes(DOMAIN, SLOT, OTHER_BYTES_CONTEXT, SEED),
      );
    });

    // No guard: an all-zero tag, slot, context and seed still hash.
    it('should return for all-zero inputs', async () => {
      expect((await prf.expandOfBytes(ZERO, ZERO, ZERO, ZERO)).length).toBe(32);
      expect((await prf.expandOfField(ZERO, ZERO, 0n, ZERO)).length).toBe(32);
    });

    it('should accept the largest Field as context', async () => {
      expect(await prf.expandOfField(DOMAIN, SLOT, P - 1n, SEED)).toStrictEqual(
        await prf.refExpandOfField(DOMAIN, SLOT, P - 1n, SEED),
      );
    });
  });

  describe('purity', () => {
    it('should declare one pure circuit and hold no ledger, witness or assert', () => {
      const code = codeLines(PRF_EXPAND_SOURCE);

      expect(
        code
          .filter((line) => /\bcircuit\b/.test(line))
          .map((line) => line.slice(0, line.indexOf('('))),
      ).toStrictEqual(['export pure circuit expand<T>']);
      expect(
        code.filter((line) => /\b(ledger|witness)\b/.test(line)),
      ).toStrictEqual([]);
      expect(code.join('\n')).not.toMatch(/\bassert\(/);
    });

    // The mock's call counter is unexported, so a reader sees no state.
    it('should leave the mock with no exported ledger state', async () => {
      await prf.expandOfBytes(DOMAIN, SLOT, BYTES_CONTEXT, SEED);

      expect(await prf.getPublicState()).toStrictEqual({});
    });
  });
});
