import fc from 'fast-check';
import { beforeAll, describe, expect, test } from 'vitest';
import { PackSimulator } from './simulators/PackSimulator.js';
import { RUNS, skipProperties } from './utils/properties.js';

/**
 * Property tests of `Pack` for N = 8, 16 and 32 (INV-4).
 */

describe.skipIf(skipProperties)('Pack properties', () => {
  let s: PackSimulator;

  beforeAll(async () => {
    s = await PackSimulator.create();
  });

  test.each([
    [8, 'pack8', 'unpack8'],
    [16, 'pack16', 'unpack16'],
    [32, 'pack32', 'unpack32'],
  ] as const)(
    'pack and unpack are inverse for N = %i',
    async (n, pack, unpack) => {
      await fc.assert(
        fc.asyncProperty(
          fc.uint8Array({ minLength: n, maxLength: n }),
          async (bytes) => {
            const vec = Array.from(bytes, BigInt);
            expect(await s[unpack](bytes)).toEqual(vec);
            expect(await s[pack](vec)).toEqual(bytes);
          },
        ),
        RUNS,
      );
    },
    60_000,
  );
});
