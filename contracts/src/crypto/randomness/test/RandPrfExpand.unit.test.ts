import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrfExpandSimulator } from '../../prf/test/simulators/PrfExpandSimulator.js';
import { RandPrfExpandSimulator } from './simulators/RandPrfExpandSimulator.js';

/** Deterministic 32 bytes from a label. */
const bytes32 = (label: string): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(label));
  return bytes;
};

// Compact `Field` modulus (BLS12-381 scalar field).
const P =
  52435875175126190479447740508185965837690552500527637822603658699938581184513n;

const DOMAIN = bytes32('Rand:unit');
const SLOT = bytes32('slot');
const OTHER_SLOT = bytes32('other slot');
const BYTES_CONTEXT = bytes32('context');
const FIELD_CONTEXT = 123456789n;
const SEED = bytes32('seed');
const OTHER_SEED = bytes32('other seed');
const ZERO = new Uint8Array(32);

/** The smallest seed `derive` accepts: one nonzero bit. */
const ONE_BIT_SEED = (() => {
  const seed = new Uint8Array(32);
  seed[31] = 1;
  return seed;
})();

const RAND_PRF_EXPAND_SOURCE = readFileSync(
  new URL('../RandPrfExpand.compact', import.meta.url),
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

let rand: RandPrfExpandSimulator;
let expand: PrfExpandSimulator;

describe('RandPrfExpand', () => {
  beforeAll(async () => {
    rand = await RandPrfExpandSimulator.create();
    expand = await PrfExpandSimulator.create();
  });

  beforeEach(async () => {
    await rand.privateState.injectSeed(SEED);
  });

  describe('derive', () => {
    it('should return 32 bytes for a Bytes<32> context', async () => {
      const value = await rand.deriveOfBytes(DOMAIN, SLOT, BYTES_CONTEXT);

      expect(value).toBeInstanceOf(Uint8Array);
      expect(value.length).toBe(32);
    });

    it('should return 32 bytes for a Field context', async () => {
      const value = await rand.deriveOfField(DOMAIN, SLOT, FIELD_CONTEXT);

      expect(value).toBeInstanceOf(Uint8Array);
      expect(value.length).toBe(32);
    });

    it('should return the same value for the same inputs and seed', async () => {
      expect(
        await rand.deriveOfBytes(DOMAIN, SLOT, BYTES_CONTEXT),
      ).toStrictEqual(await rand.deriveOfBytes(DOMAIN, SLOT, BYTES_CONTEXT));
      expect(
        await rand.deriveOfField(DOMAIN, SLOT, FIELD_CONTEXT),
      ).toStrictEqual(await rand.deriveOfField(DOMAIN, SLOT, FIELD_CONTEXT));
    });

    it('should equal PrfExpand.expand under the witness seed', async () => {
      expect(
        await rand.deriveOfBytes(DOMAIN, SLOT, BYTES_CONTEXT),
      ).toStrictEqual(
        await expand.expandOfBytes(DOMAIN, SLOT, BYTES_CONTEXT, SEED),
      );
      expect(
        await rand.deriveOfField(DOMAIN, SLOT, FIELD_CONTEXT),
      ).toStrictEqual(
        await expand.expandOfField(DOMAIN, SLOT, FIELD_CONTEXT, SEED),
      );
    });

    it('should move the value when the seed changes', async () => {
      const before = await rand.deriveOfBytes(DOMAIN, SLOT, BYTES_CONTEXT);
      await rand.privateState.injectSeed(OTHER_SEED);

      expect(
        await rand.deriveOfBytes(DOMAIN, SLOT, BYTES_CONTEXT),
      ).not.toStrictEqual(before);
    });

    it('should derive distinct values for distinct slots under one seed and context', async () => {
      expect(
        await rand.deriveOfBytes(DOMAIN, SLOT, BYTES_CONTEXT),
      ).not.toStrictEqual(
        await rand.deriveOfBytes(DOMAIN, OTHER_SLOT, BYTES_CONTEXT),
      );
    });

    it('should accept the largest Field as context', async () => {
      expect(await rand.deriveOfField(DOMAIN, SLOT, P - 1n)).toStrictEqual(
        await rand.refDeriveOfField(DOMAIN, SLOT, P - 1n, SEED),
      );
    });

    it('should accept a seed with one nonzero bit', async () => {
      await rand.privateState.injectSeed(ONE_BIT_SEED);

      expect(
        await rand.deriveOfBytes(DOMAIN, SLOT, BYTES_CONTEXT),
      ).toStrictEqual(
        await rand.refDeriveOfBytes(DOMAIN, SLOT, BYTES_CONTEXT, ONE_BIT_SEED),
      );
    });

    it('should reject a zero seed', async () => {
      await rand.privateState.injectSeed(ZERO);

      await expect(
        rand.deriveOfBytes(DOMAIN, SLOT, BYTES_CONTEXT),
      ).rejects.toThrow('RandPrfExpand: zero seed');
      await expect(
        rand.deriveOfField(DOMAIN, SLOT, FIELD_CONTEXT),
      ).rejects.toThrow('RandPrfExpand: zero seed');
    });
  });

  describe('surface', () => {
    it('should declare one circuit and one witness and hold no ledger', () => {
      const code = codeLines(RAND_PRF_EXPAND_SOURCE);

      expect(
        code
          .filter((line) => /\bcircuit\b/.test(line))
          .map((line) => line.slice(0, line.indexOf('('))),
      ).toStrictEqual(['export circuit derive<T>']);
      expect(code.filter((line) => /\bwitness\b/.test(line))).toStrictEqual([
        'witness wit_RandPrfExpandSeed(): Bytes<32>;',
      ]);
      expect(code.filter((line) => /\bledger\b/.test(line))).toStrictEqual([]);
    });

    it('should assert only that the seed is not zero', () => {
      const code = codeLines(RAND_PRF_EXPAND_SOURCE);

      expect(code.filter((line) => /\bassert\(/.test(line))).toStrictEqual([
        'assert(seed != default<Bytes<32>>, "RandPrfExpand: zero seed");',
      ]);
    });

    // The mock's call counter is unexported, so a reader sees no state.
    it('should leave the mock with no exported ledger state', async () => {
      await rand.deriveOfBytes(DOMAIN, SLOT, BYTES_CONTEXT);

      expect(await rand.getPublicState()).toStrictEqual({});
    });
  });
});
