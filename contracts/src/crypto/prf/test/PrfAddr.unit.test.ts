import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { PrfAddrSimulator } from './simulators/PrfAddrSimulator.js';
import { PrfCoreSimulator } from './simulators/PrfCoreSimulator.js';

/** Deterministic 32 bytes from a label. */
const bytes32 = (label: string): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(label));
  return bytes;
};

const DOMAIN = bytes32('Prf:unit');
const SALT = bytes32('salt');
const SALT_TAIL = bytes32('salt:tail');
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
      expect(await addr.derivePk(DOMAIN, SALT, SK)).toStrictEqual(
        await addr.derivePk(DOMAIN, SALT, SK),
      );
    });

    // No guard: an all-zero tag, salt and secret still hash.
    it('should return for an all-zero tag, salt and secret', async () => {
      expect((await addr.derivePk(ZERO, ZERO, ZERO)).length).toBe(32);
    });

    it('should equal PrfCore over { domain, salt }', async () => {
      const digest = await prfCore.evaluateOfBytes(DOMAIN, SALT, SK);

      expect(await addr.derivePk(DOMAIN, SALT, SK)).toStrictEqual(digest);
    });

    it('should equal the reference', async () => {
      expect(await addr.derivePk(DOMAIN, SALT, SK)).toStrictEqual(
        await addr.refDerivePk(DOMAIN, SALT, SK),
      );
    });

    it("should equal PrfCore's reference digest", async () => {
      expect(await prfCore.refEvaluateOfBytes(DOMAIN, SALT, SK)).toStrictEqual(
        await addr.refDerivePk(DOMAIN, SALT, SK),
      );
    });

    it('should hash a tuple salt as its flat fields', async () => {
      expect(
        await addr.derivePkOfTuple(DOMAIN, [SALT, SALT_TAIL], SK),
      ).toStrictEqual(
        await addr.refDerivePkOfTuple(DOMAIN, [SALT, SALT_TAIL], SK),
      );
    });
  });

  describe('purity', () => {
    it('should declare one pure circuit and hold no ledger, witness or assert', () => {
      const code = codeLines(PRF_ADDR_SOURCE);

      expect(
        code
          .filter((line) => /\bcircuit\b/.test(line))
          .map((line) => line.slice(0, line.indexOf('('))),
      ).toStrictEqual(['export pure circuit derivePk<S>']);
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
