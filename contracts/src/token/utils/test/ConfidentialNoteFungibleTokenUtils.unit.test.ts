import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type Account,
  ConfidentialNoteFungibleTokenUtilsSimulator,
  type Note,
} from './simulators/ConfidentialNoteFungibleTokenUtilsSimulator.js';

/** Deterministic 32 bytes from a label. */
const bytes32 = (label: string): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(label));
  return bytes;
};

// Compact `Field` modulus (BLS12-381 scalar field).
const P =
  52435875175126190479447740508185965837690552500527637822603658699938581184513n;

const MAX_UINT_128 = (1n << 128n) - 1n;

const NOTE: Note = { value: 100n, nonce: 7n };
const OTHER_VALUE: Note = { value: 101n, nonce: 7n };
const OTHER_NONCE: Note = { value: 100n, nonce: 8n };
const ZERO_NOTE: Note = { value: 0n, nonce: 0n };

const FIELD_KEY = 123456789n;
const OTHER_FIELD_KEY = 987654321n;

const account = (label: string): Account => ({
  is_left: true,
  left: bytes32(label),
  right: { bytes: new Uint8Array(32) },
});

const ACCOUNT = account('ALICE');
const OTHER_ACCOUNT = account('BOB');

const UTILS_SOURCE = readFileSync(
  new URL('../ConfidentialNoteFungibleTokenUtils.compact', import.meta.url),
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

let utils: ConfidentialNoteFungibleTokenUtilsSimulator;

describe('ConfidentialNoteFungibleTokenUtils', () => {
  beforeAll(async () => {
    utils = await ConfidentialNoteFungibleTokenUtilsSimulator.create();
  });

  describe('commitOf', () => {
    it('should return 32 bytes at a Field key', async () => {
      const digest = await utils.commitOfField(NOTE, FIELD_KEY);

      expect(digest).toBeInstanceOf(Uint8Array);
      expect(digest.length).toBe(32);
    });

    it('should return 32 bytes at an Either key', async () => {
      const digest = await utils.commitOfEither(NOTE, ACCOUNT);

      expect(digest).toBeInstanceOf(Uint8Array);
      expect(digest.length).toBe(32);
    });

    it('should return the same commitment for the same note and key', async () => {
      expect(await utils.commitOfField(NOTE, FIELD_KEY)).toStrictEqual(
        await utils.commitOfField(NOTE, FIELD_KEY),
      );
      expect(await utils.commitOfEither(NOTE, ACCOUNT)).toStrictEqual(
        await utils.commitOfEither(NOTE, ACCOUNT),
      );
    });

    it('should move the commitment with the value', async () => {
      expect(await utils.commitOfField(NOTE, FIELD_KEY)).not.toStrictEqual(
        await utils.commitOfField(OTHER_VALUE, FIELD_KEY),
      );
      expect(await utils.commitOfEither(NOTE, ACCOUNT)).not.toStrictEqual(
        await utils.commitOfEither(OTHER_VALUE, ACCOUNT),
      );
    });

    it('should move the commitment with the nonce', async () => {
      expect(await utils.commitOfField(NOTE, FIELD_KEY)).not.toStrictEqual(
        await utils.commitOfField(OTHER_NONCE, FIELD_KEY),
      );
      expect(await utils.commitOfEither(NOTE, ACCOUNT)).not.toStrictEqual(
        await utils.commitOfEither(OTHER_NONCE, ACCOUNT),
      );
    });

    it('should move the commitment with the key', async () => {
      expect(await utils.commitOfField(NOTE, FIELD_KEY)).not.toStrictEqual(
        await utils.commitOfField(NOTE, OTHER_FIELD_KEY),
      );
      expect(await utils.commitOfEither(NOTE, ACCOUNT)).not.toStrictEqual(
        await utils.commitOfEither(NOTE, OTHER_ACCOUNT),
      );
    });

    // No guard: a zero value, nonce and key still commit.
    it('should return for all-zero inputs', async () => {
      expect((await utils.commitOfField(ZERO_NOTE, 0n)).length).toBe(32);
      expect(
        (
          await utils.commitOfEither(ZERO_NOTE, {
            is_left: false,
            left: new Uint8Array(32),
            right: { bytes: new Uint8Array(32) },
          })
        ).length,
      ).toBe(32);
    });

    it('should accept the largest value, nonce and Field key', async () => {
      const note: Note = { value: MAX_UINT_128, nonce: P - 1n };

      expect(await utils.commitOfField(note, P - 1n)).toStrictEqual(
        await utils.refCommitOfField(note, P - 1n),
      );
    });
  });

  describe('nullifierOf', () => {
    it('should return 32 bytes', async () => {
      const digest = await utils.nullifierOf(NOTE);

      expect(digest).toBeInstanceOf(Uint8Array);
      expect(digest.length).toBe(32);
    });

    it('should return the same nullifier for the same note', async () => {
      expect(await utils.nullifierOf(NOTE)).toStrictEqual(
        await utils.nullifierOf(NOTE),
      );
    });

    it('should move the nullifier with the nonce', async () => {
      expect(await utils.nullifierOf(NOTE)).not.toStrictEqual(
        await utils.nullifierOf(OTHER_NONCE),
      );
    });

    it('should keep the nullifier when only the value changes', async () => {
      expect(await utils.nullifierOf(NOTE)).toStrictEqual(
        await utils.nullifierOf(OTHER_VALUE),
      );
    });

    it('should accept the largest Field as nonce', async () => {
      const note: Note = { value: 0n, nonce: P - 1n };

      expect(await utils.nullifierOf(note)).toStrictEqual(
        await utils.refNullifierOf(note),
      );
    });
  });

  describe('issuedTagOf', () => {
    it('should return 32 bytes', async () => {
      const digest = await utils.issuedTagOf(NOTE);

      expect(digest).toBeInstanceOf(Uint8Array);
      expect(digest.length).toBe(32);
    });

    it('should return the same tag for the same note', async () => {
      expect(await utils.issuedTagOf(NOTE)).toStrictEqual(
        await utils.issuedTagOf(NOTE),
      );
    });

    it('should move the tag with the nonce', async () => {
      expect(await utils.issuedTagOf(NOTE)).not.toStrictEqual(
        await utils.issuedTagOf(OTHER_NONCE),
      );
    });

    it('should keep the tag when only the value changes', async () => {
      expect(await utils.issuedTagOf(NOTE)).toStrictEqual(
        await utils.issuedTagOf(OTHER_VALUE),
      );
    });

    it('should accept the largest Field as nonce', async () => {
      const note: Note = { value: 0n, nonce: P - 1n };

      expect(await utils.issuedTagOf(note)).toStrictEqual(
        await utils.refIssuedTagOf(note),
      );
    });
  });

  describe('domain separation', () => {
    it('should give one note distinct nullifier and issued tag', async () => {
      expect(await utils.nullifierOf(NOTE)).not.toStrictEqual(
        await utils.issuedTagOf(NOTE),
      );
      expect(await utils.nullifierOf(ZERO_NOTE)).not.toStrictEqual(
        await utils.issuedTagOf(ZERO_NOTE),
      );
    });
  });

  describe('purity', () => {
    it('should declare three pure circuits and hold no ledger, witness or assert', () => {
      const code = codeLines(UTILS_SOURCE);

      expect(
        code
          .filter((line) => /\bcircuit\b/.test(line))
          .map((line) => line.slice(0, line.indexOf('('))),
      ).toStrictEqual([
        'export pure circuit commitOf<T>',
        'export pure circuit nullifierOf',
        'export pure circuit issuedTagOf',
      ]);
      expect(
        code.filter((line) => /\b(ledger|witness)\b/.test(line)),
      ).toStrictEqual([]);
      expect(code.join('\n')).not.toMatch(/\bassert\(/);
    });

    // The mock's call counter is unexported, so a reader sees no state.
    it('should leave the mock with no exported ledger state', async () => {
      await utils.commitOfField(NOTE, FIELD_KEY);

      expect(await utils.getPublicState()).toStrictEqual({});
    });
  });
});
