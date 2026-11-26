import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { HashCommitmentSimulator } from './simulators/HashCommitmentSimulator.js';

/** Deterministic 32 bytes from a label. */
const bytes32 = (label: string): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(label));
  return bytes;
};

// Compact `Field` modulus (BLS12-381 scalar field).
const P =
  52435875175126190479447740508185965837690552500527637822603658699938581184513n;

const DOMAIN = bytes32('Commitment:unit');
const OTHER_DOMAIN = bytes32('Commitment:other');
const BYTES_MESSAGE = bytes32('message');
const FIELD_MESSAGE = 123456789n;
const RANDOMNESS = bytes32('randomness');
const OTHER_RANDOMNESS = bytes32('other randomness');
const ZERO = new Uint8Array(32);

const HASH_COMMITMENT_SOURCE = readFileSync(
  new URL('../HashCommitment.compact', import.meta.url),
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

let commitment: HashCommitmentSimulator;

describe('HashCommitment', () => {
  beforeAll(async () => {
    commitment = await HashCommitmentSimulator.create();
  });

  describe('commit', () => {
    it('should return 32 bytes for a Bytes<32> message', async () => {
      const digest = await commitment.commitOfBytes(
        DOMAIN,
        BYTES_MESSAGE,
        RANDOMNESS,
      );

      expect(digest).toBeInstanceOf(Uint8Array);
      expect(digest.length).toBe(32);
    });

    it('should return 32 bytes for a Field message', async () => {
      const digest = await commitment.commitOfField(
        DOMAIN,
        FIELD_MESSAGE,
        RANDOMNESS,
      );

      expect(digest).toBeInstanceOf(Uint8Array);
      expect(digest.length).toBe(32);
    });

    it('should return the same commitment for the same message and randomness', async () => {
      expect(
        await commitment.commitOfBytes(DOMAIN, BYTES_MESSAGE, RANDOMNESS),
      ).toStrictEqual(
        await commitment.commitOfBytes(DOMAIN, BYTES_MESSAGE, RANDOMNESS),
      );
      expect(
        await commitment.commitOfField(DOMAIN, FIELD_MESSAGE, RANDOMNESS),
      ).toStrictEqual(
        await commitment.commitOfField(DOMAIN, FIELD_MESSAGE, RANDOMNESS),
      );
    });

    it('should return distinct commitments for one message under distinct randomness', async () => {
      expect(
        await commitment.commitOfBytes(DOMAIN, BYTES_MESSAGE, RANDOMNESS),
      ).not.toStrictEqual(
        await commitment.commitOfBytes(DOMAIN, BYTES_MESSAGE, OTHER_RANDOMNESS),
      );
    });

    it('should return distinct commitments for one message under distinct tags', async () => {
      expect(
        await commitment.commitOfBytes(DOMAIN, BYTES_MESSAGE, RANDOMNESS),
      ).not.toStrictEqual(
        await commitment.commitOfBytes(OTHER_DOMAIN, BYTES_MESSAGE, RANDOMNESS),
      );
    });

    // No guard: an all-zero tag, message and randomness still commit.
    it('should return for all-zero inputs', async () => {
      expect((await commitment.commitOfBytes(ZERO, ZERO, ZERO)).length).toBe(
        32,
      );
      expect((await commitment.commitOfField(ZERO, 0n, ZERO)).length).toBe(32);
    });

    it('should accept the largest Field as message', async () => {
      expect(
        await commitment.commitOfField(DOMAIN, P - 1n, RANDOMNESS),
      ).toStrictEqual(
        await commitment.refCommitOfField(DOMAIN, P - 1n, RANDOMNESS),
      );
    });
  });

  describe('purity', () => {
    it('should declare one pure circuit and hold no ledger, witness or assert', () => {
      const code = codeLines(HASH_COMMITMENT_SOURCE);

      expect(
        code
          .filter((line) => /\bcircuit\b/.test(line))
          .map((line) => line.slice(0, line.indexOf('('))),
      ).toStrictEqual(['export pure circuit commit<M>']);
      expect(
        code.filter((line) => /\b(ledger|witness)\b/.test(line)),
      ).toStrictEqual([]);
      expect(code.join('\n')).not.toMatch(/\bassert\(/);
    });

    // The mock's call counter is unexported, so a reader sees no state.
    it('should leave the mock with no exported ledger state', async () => {
      await commitment.commitOfBytes(DOMAIN, BYTES_MESSAGE, RANDOMNESS);

      expect(await commitment.getPublicState()).toStrictEqual({});
    });
  });
});
