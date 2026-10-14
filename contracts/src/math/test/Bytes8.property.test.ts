import fc from 'fast-check';
import { beforeAll, describe, expect, test } from 'vitest';
import { Bytes8Simulator } from './simulators/Bytes8Simulator.js';
import { bytesLEToBigint } from './utils/oracles.js';
import { RUNS, skipProperties } from './utils/properties.js';

/**
 * Property tests of the `Bytes8` circuits (INV-4).
 */

describe.skipIf(skipProperties)('Bytes8 properties', () => {
  let s: Bytes8Simulator;
  const bytes8 = fc.uint8Array({ minLength: 8, maxLength: 8 });

  beforeAll(async () => {
    s = await Bytes8Simulator.create();
  });

  test('pack, unpack and both toUint64 forms agree with the little-endian value', async () => {
    await fc.assert(
      fc.asyncProperty(bytes8, async (bytes) => {
        const vec = Array.from(bytes, BigInt);
        expect(await s.unpack(bytes)).toEqual(vec);
        expect(await s.pack(vec)).toEqual(bytes);
        expect(await s.vectorToUint64(vec)).toBe(bytesLEToBigint(bytes));
        expect(await s.bytesToUint64(bytes)).toBe(bytesLEToBigint(bytes));
      }),
      RUNS,
    );
  });
});
