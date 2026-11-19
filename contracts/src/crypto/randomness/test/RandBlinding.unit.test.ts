import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  circuitSurface,
  readContractInfo,
} from '#test-utils/compiler/contractInfo.js';
import { RandBlindingSimulator } from './simulators/RandBlindingSimulator.js';
import { RandBlindingPrivateState } from './witnesses/RandBlindingWitnesses.js';

/** Deterministic 32 bytes from a label; also Compact's `pad(32, label)`. */
const bytes32 = (label: string): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(label));
  return bytes;
};

/** 32 bytes, zero except `0x01` at `index`. */
const oneHot = (index: number): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes[index] = 0x01;
  return bytes;
};

const BLINDING = bytes32('blinding');
const OTHER_BLINDING = bytes32('other blinding');
const ZERO = new Uint8Array(32);

const ARTIFACT = 'crypto/randomness/test/mocks/MockRandBlinding';

const RAND_SOURCE = readFileSync(
  new URL('../RandBlinding.compact', import.meta.url),
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

let rand: RandBlindingSimulator;

/** Sets the witness value, then reads it through the circuit. */
const readWith = async (blinding: Uint8Array): Promise<Uint8Array> => {
  await rand.updatePrivateState({ blinding });
  return rand.read();
};

describe('RandBlinding', () => {
  beforeAll(async () => {
    rand = await RandBlindingSimulator.create({
      privateState: RandBlindingPrivateState.withBlinding(BLINDING),
    });
  });

  describe('read', () => {
    it('should return the blinding factor of the witness', async () => {
      expect(await readWith(BLINDING)).toEqual(BLINDING);
    });

    it('should return the same value on every call', async () => {
      const first = await readWith(BLINDING);

      expect(await rand.read()).toEqual(first);
    });

    it('should follow the witness when the private state changes', async () => {
      expect(await readWith(OTHER_BLINDING)).toEqual(OTHER_BLINDING);
      expect(await readWith(BLINDING)).toEqual(BLINDING);
    });

    it('should fail on a zero blinding factor', async () => {
      await expect(readWith(ZERO)).rejects.toThrow(
        'RandBlinding: zero blinding',
      );
    });

    it('should accept a value whose only non-zero byte is the first', async () => {
      expect(await readWith(oneHot(0))).toEqual(oneHot(0));
    });

    it('should accept a value whose only non-zero byte is the last', async () => {
      expect(await readWith(oneHot(31))).toEqual(oneHot(31));
    });

    it('should accept the all-ones value', async () => {
      const ones = new Uint8Array(32).fill(0xff);

      expect(await readWith(ones)).toEqual(ones);
    });
  });

  describe('Blinding', () => {
    it('should expose read(): Blinding over Bytes<32>', () => {
      const read = readContractInfo(ARTIFACT).circuits.find(
        ({ name }) => name === 'read',
      );

      expect(read?.arguments).toStrictEqual([]);
      expect(read?.['result-type']).toStrictEqual({
        'type-name': 'Alias',
        name: 'Blinding',
        type: { 'type-name': 'Bytes', length: 32 },
      });
    });
  });

  describe('purity', () => {
    it('should keep read impure and provable', () => {
      expect(circuitSurface(readContractInfo(ARTIFACT))).toStrictEqual([
        { name: 'read', pure: false, proof: true },
      ]);
    });

    it('should declare one witness and one assert, and hold no ledger or disclose', () => {
      const code = codeLines(RAND_SOURCE);

      expect(code.filter((line) => /\bwitness\b/.test(line))).toStrictEqual([
        'witness wit_RandBlindingFactor(): Bytes<32>;',
      ]);
      expect(code.filter((line) => /\bledger\b/.test(line))).toStrictEqual([]);
      expect(code.join('\n')).not.toMatch(/\bdisclose\(/);
      expect(code.join('\n').match(/\bassert\(/g)).toHaveLength(1);
    });

    // The mock's call counter is unexported, so a reader sees no state.
    it('should leave the mock with no exported ledger state', async () => {
      await readWith(BLINDING);

      expect(await rand.getPublicState()).toStrictEqual({});
    });
  });
});
