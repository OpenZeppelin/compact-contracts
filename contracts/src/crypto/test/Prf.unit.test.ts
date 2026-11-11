import { readFileSync } from 'node:fs';
import { degradeToTransient } from '@midnight-ntwrk/compact-runtime';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  circuitSurface,
  readContractInfo,
} from '#test-utils/compiler/contractInfo.js';
import { pureCircuits as issuer } from '../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenIssuer/contract/index.js';
import { pureCircuits as core } from '../../../artifacts/token/test/mocks/MockConfidentialNoteFungibleToken/contract/index.js';
import { PrfSimulator } from './simulators/PrfSimulator.js';

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
const ZERO = new Uint8Array(32);

const PRF_SOURCE = readFileSync(
  new URL('../Prf.compact', import.meta.url),
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

let prf: PrfSimulator;

describe('Prf', () => {
  beforeAll(async () => {
    prf = await PrfSimulator.create();
  });

  describe('prf', () => {
    it('should return 32 bytes for a Bytes<32> input', async () => {
      const digest = await prf.prfOfBytes(DOMAIN, BYTES_INPUT, KEY);

      expect(digest).toBeInstanceOf(Uint8Array);
      expect(digest.length).toBe(32);
    });

    it('should return 32 bytes for a Field input', async () => {
      const digest = await prf.prfOfField(DOMAIN, FIELD_INPUT, KEY);

      expect(digest).toBeInstanceOf(Uint8Array);
      expect(digest.length).toBe(32);
    });

    it('should return the same digest for the same inputs', async () => {
      expect(await prf.prfOfBytes(DOMAIN, BYTES_INPUT, KEY)).toStrictEqual(
        await prf.prfOfBytes(DOMAIN, BYTES_INPUT, KEY),
      );
      expect(await prf.prfOfField(DOMAIN, FIELD_INPUT, KEY)).toStrictEqual(
        await prf.prfOfField(DOMAIN, FIELD_INPUT, KEY),
      );
    });

    // No guard: an all-zero tag, input and key still hash.
    it('should return for all-zero inputs', async () => {
      expect((await prf.prfOfBytes(ZERO, ZERO, ZERO)).length).toBe(32);
      expect((await prf.prfOfField(ZERO, 0n, ZERO)).length).toBe(32);
    });

    it('should accept the largest Field as input', async () => {
      expect(await prf.prfOfField(DOMAIN, P - 1n, KEY)).toStrictEqual(
        await prf.refPrfOfField(DOMAIN, P - 1n, KEY),
      );
    });
  });

  describe('prfField', () => {
    it('should equal the runtime reduction of prf for a Bytes<32> input', async () => {
      const digest = await prf.prfOfBytes(DOMAIN, BYTES_INPUT, KEY);

      expect(await prf.prfFieldOfBytes(DOMAIN, BYTES_INPUT, KEY)).toBe(
        degradeToTransient(digest),
      );
    });

    it('should equal the runtime reduction of prf for a Field input', async () => {
      const digest = await prf.prfOfField(DOMAIN, FIELD_INPUT, KEY);

      expect(await prf.prfFieldOfField(DOMAIN, FIELD_INPUT, KEY)).toBe(
        degradeToTransient(digest),
      );
    });

    it('should equal the reference reduction for a Bytes<32> input', async () => {
      expect(await prf.prfFieldOfBytes(DOMAIN, BYTES_INPUT, KEY)).toBe(
        await prf.refPrfFieldOfBytes(DOMAIN, BYTES_INPUT, KEY),
      );
    });

    it('should equal the reference reduction for a Field input', async () => {
      expect(await prf.prfFieldOfField(DOMAIN, FIELD_INPUT, KEY)).toBe(
        await prf.refPrfFieldOfField(DOMAIN, FIELD_INPUT, KEY),
      );
    });

    it('should reduce the reference digests the same way', async () => {
      expect(
        degradeToTransient(await prf.refPrfOfBytes(DOMAIN, BYTES_INPUT, KEY)),
      ).toBe(await prf.refPrfFieldOfBytes(DOMAIN, BYTES_INPUT, KEY));
      expect(
        degradeToTransient(await prf.refPrfOfField(DOMAIN, FIELD_INPUT, KEY)),
      ).toBe(await prf.refPrfFieldOfField(DOMAIN, FIELD_INPUT, KEY));
    });

    it('should return a Field below the modulus', async () => {
      expect(await prf.prfFieldOfBytes(DOMAIN, BYTES_INPUT, KEY)).toBeLessThan(
        P,
      );
      expect(await prf.prfFieldOfField(DOMAIN, P - 1n, KEY)).toBeLessThan(P);
    });
  });

  // `Prf` itself is never on a contract's surface. Its two callers are, and a
  // pure circuit compiles only while everything it calls is pure.
  describe('purity', () => {
    it('should keep both derivePk wrappers pure on the published surface', () => {
      for (const artifact of [
        'token/test/mocks/MockConfidentialNoteFungibleToken',
        'token/extensions/test/mocks/MockConfidentialNoteFungibleTokenIssuer',
      ]) {
        const derivePk = circuitSurface(readContractInfo(artifact)).find(
          ({ name }) => name === 'derivePk',
        );

        expect(derivePk).toStrictEqual({
          name: 'derivePk',
          pure: true,
          proof: false,
        });
      }
    });

    // Called with no deployment and no contract state.
    it('should run both derivePk wrappers off-chain to their Prf outputs', async () => {
      const salt = bytes32('salt');

      expect(core.derivePk(KEY, salt)).toBe(
        await prf.prfFieldOfBytes(bytes32('CNFT:pk'), salt, KEY),
      );
      expect(issuer.derivePk(KEY, salt)).toBe(
        await prf.prfFieldOfBytes(bytes32('CNFT:issuer:pk'), salt, KEY),
      );
    });

    it('should declare both circuits pure and hold no ledger, witness or assert', () => {
      const code = codeLines(PRF_SOURCE);

      expect(
        code
          .filter((line) => /\bcircuit\b/.test(line))
          .map((line) => line.slice(0, line.indexOf('('))),
      ).toStrictEqual([
        'export pure circuit prf<T>',
        'export pure circuit prfField<T>',
      ]);
      expect(
        code.filter((line) => /\b(ledger|witness)\b/.test(line)),
      ).toStrictEqual([]);
      expect(code.join('\n')).not.toMatch(/\bassert\(/);
    });

    // The mock's call counter is unexported, so a reader sees no state.
    it('should leave the mock with no exported ledger state', async () => {
      await prf.prfOfBytes(DOMAIN, BYTES_INPUT, KEY);

      expect(await prf.getPublicState()).toStrictEqual({});
    });
  });
});
