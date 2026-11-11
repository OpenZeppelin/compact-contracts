import { readFileSync } from 'node:fs';
import { degradeToTransient } from '@midnight-ntwrk/compact-runtime';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  circuitSurface,
  readContractInfo,
} from '#test-utils/compiler/contractInfo.js';
import { pureCircuits as issuer } from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenIssuer/contract/index.js';
import { pureCircuits as core } from '../../../../artifacts/token/test/mocks/MockConfidentialNoteFungibleToken/contract/index.js';
import { PrfAddrSimulator } from './simulators/PrfAddrSimulator.js';
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
const SALT = bytes32('salt');
const SK = bytes32('key');
const ZERO = new Uint8Array(32);

const PRF_ADDR_SOURCE = readFileSync(
  new URL('../PrfAddr.compact', import.meta.url),
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

let addr: PrfAddrSimulator;
let prfCore: PrfCoreSimulator;

describe('PrfAddr', () => {
  beforeAll(async () => {
    addr = await PrfAddrSimulator.create();
    prfCore = await PrfCoreSimulator.create();
  });

  describe('derivePk', () => {
    it('should return the same key for the same inputs', async () => {
      expect(await addr.derivePk(DOMAIN, SALT, SK)).toBe(
        await addr.derivePk(DOMAIN, SALT, SK),
      );
    });

    // No guard: an all-zero tag, salt and secret still hash.
    it('should return for an all-zero tag, salt and secret', async () => {
      expect(await addr.derivePk(ZERO, ZERO, ZERO)).toBeLessThan(P);
    });

    it('should equal the runtime reduction of PrfCore over { domain, salt }', async () => {
      const digest = await prfCore.evaluateOfBytes(DOMAIN, SALT, SK);

      expect(await addr.derivePk(DOMAIN, SALT, SK)).toBe(
        degradeToTransient(digest),
      );
    });

    it('should equal the reference reduction', async () => {
      expect(await addr.derivePk(DOMAIN, SALT, SK)).toBe(
        await addr.refDerivePk(DOMAIN, SALT, SK),
      );
    });

    it("should reduce PrfCore's reference digest the same way", async () => {
      expect(
        degradeToTransient(await prfCore.refEvaluateOfBytes(DOMAIN, SALT, SK)),
      ).toBe(await addr.refDerivePk(DOMAIN, SALT, SK));
    });

    it('should return a Field below the modulus', async () => {
      expect(await addr.derivePk(DOMAIN, SALT, SK)).toBeLessThan(P);
    });
  });

  // `PrfAddr` itself is never on a contract's surface. Its two callers are,
  // and a pure circuit compiles only while everything it calls is pure.
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
    it('should run both derivePk wrappers off-chain to their PrfAddr outputs', async () => {
      expect(core.derivePk(SK, SALT)).toBe(
        await addr.derivePk(core.DOMAIN_PK(), SALT, SK),
      );
      expect(issuer.derivePk(SK, SALT)).toBe(
        await addr.derivePk(issuer.DOMAIN(), SALT, SK),
      );
    });

    it('should declare one pure circuit and hold no ledger, witness or assert', () => {
      const code = codeLines(PRF_ADDR_SOURCE);

      expect(
        code
          .filter((line) => /\bcircuit\b/.test(line))
          .map((line) => line.slice(0, line.indexOf('('))),
      ).toStrictEqual(['export pure circuit derivePk']);
      expect(
        code.filter((line) => /\b(ledger|witness)\b/.test(line)),
      ).toStrictEqual([]);
      expect(code.join('\n')).not.toMatch(/\bassert\(/);
    });

    // The mock's call counter is unexported, so a reader sees no state.
    it('should leave the mock with no exported ledger state', async () => {
      await addr.derivePk(DOMAIN, SALT, SK);

      expect(await addr.getPublicState()).toStrictEqual({});
    });
  });
});
