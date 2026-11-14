import { readFileSync } from 'node:fs';
import { degradeToTransient } from '@midnight-ntwrk/compact-runtime';
import { beforeAll, describe, expect, it } from 'vitest';
import { PrfCoreSimulator } from './simulators/PrfCoreSimulator.js';

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
const BYTES_INPUT = bytes32('input');
const FIELD_INPUT = 123456789n;
const KEY = bytes32('key');
const FIELD_KEY = 987654321n;
const ZERO = new Uint8Array(32);

const PRF_CORE_SOURCE = readFileSync(
  new URL('../PrfCore.compact', import.meta.url),
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

let prf: PrfCoreSimulator;

describe('PrfCore', () => {
  beforeAll(async () => {
    prf = await PrfCoreSimulator.create();
  });

  describe('evaluate', () => {
    it('should return 32 bytes for a Bytes<32> input', async () => {
      const digest = await prf.evaluateOfBytes(DOMAIN, BYTES_INPUT, KEY);

      expect(digest).toBeInstanceOf(Uint8Array);
      expect(digest.length).toBe(32);
    });

    it('should return 32 bytes for a Field input', async () => {
      const digest = await prf.evaluateOfField(DOMAIN, FIELD_INPUT, KEY);

      expect(digest).toBeInstanceOf(Uint8Array);
      expect(digest.length).toBe(32);
    });

    it('should return the same digest for the same inputs', async () => {
      expect(await prf.evaluateOfBytes(DOMAIN, BYTES_INPUT, KEY)).toStrictEqual(
        await prf.evaluateOfBytes(DOMAIN, BYTES_INPUT, KEY),
      );
      expect(await prf.evaluateOfField(DOMAIN, FIELD_INPUT, KEY)).toStrictEqual(
        await prf.evaluateOfField(DOMAIN, FIELD_INPUT, KEY),
      );
    });

    // No guard: an all-zero tag, input and key still hash.
    it('should return for all-zero inputs', async () => {
      expect((await prf.evaluateOfBytes(ZERO, ZERO, ZERO)).length).toBe(32);
      expect((await prf.evaluateOfField(ZERO, 0n, ZERO)).length).toBe(32);
    });

    it('should accept the largest Field as input', async () => {
      expect(await prf.evaluateOfField(DOMAIN, P - 1n, KEY)).toStrictEqual(
        await prf.refEvaluateOfField(DOMAIN, P - 1n, KEY),
      );
    });
  });

  describe('key type', () => {
    it('should hash a Field key as its Bytes<32> cast', async () => {
      expect(
        await prf.evaluateWithFieldKey(DOMAIN, BYTES_INPUT, FIELD_KEY),
      ).toStrictEqual(
        await prf.refEvaluateWithFieldKey(DOMAIN, BYTES_INPUT, FIELD_KEY),
      );
    });

    it('should accept the largest Field as key', async () => {
      expect(
        await prf.evaluateWithFieldKey(DOMAIN, BYTES_INPUT, P - 1n),
      ).toStrictEqual(
        await prf.refEvaluateWithFieldKey(DOMAIN, BYTES_INPUT, P - 1n),
      );
    });
  });

  // The mock reduces the digest the way a caller with a `Field` output does.
  describe('reduction', () => {
    it('should equal the runtime reduction of the digest for a Field input', async () => {
      const digest = await prf.evaluateOfField(DOMAIN, FIELD_INPUT, KEY);

      expect(await prf.evaluateReducedOfField(DOMAIN, FIELD_INPUT, KEY)).toBe(
        degradeToTransient(digest),
      );
    });

    it('should equal the reference reduction for a Field input', async () => {
      expect(await prf.evaluateReducedOfField(DOMAIN, FIELD_INPUT, KEY)).toBe(
        await prf.refEvaluateReducedOfField(DOMAIN, FIELD_INPUT, KEY),
      );
    });

    it('should reduce the reference digest the same way', async () => {
      expect(
        degradeToTransient(
          await prf.refEvaluateOfField(DOMAIN, FIELD_INPUT, KEY),
        ),
      ).toBe(await prf.refEvaluateReducedOfField(DOMAIN, FIELD_INPUT, KEY));
    });

    it('should return a Field below the modulus', async () => {
      expect(
        await prf.evaluateReducedOfField(DOMAIN, P - 1n, KEY),
      ).toBeLessThan(P);
    });
  });

  describe('purity', () => {
    it('should declare one pure circuit and hold no ledger, witness or assert', () => {
      const code = codeLines(PRF_CORE_SOURCE);

      expect(
        code
          .filter((line) => /\bcircuit\b/.test(line))
          .map((line) => line.slice(0, line.indexOf('('))),
      ).toStrictEqual(['export pure circuit evaluate<T, K>']);
      expect(
        code.filter((line) => /\b(ledger|witness)\b/.test(line)),
      ).toStrictEqual([]);
      expect(code.join('\n')).not.toMatch(/\bassert\(/);
    });

    // The mock's call counter is unexported, so a reader sees no state.
    it('should leave the mock with no exported ledger state', async () => {
      await prf.evaluateOfBytes(DOMAIN, BYTES_INPUT, KEY);

      expect(await prf.getPublicState()).toStrictEqual({});
    });
  });
});
