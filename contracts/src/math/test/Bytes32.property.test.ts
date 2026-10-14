import fc from 'fast-check';
import { beforeAll, describe, expect, test } from 'vitest';
import { Bytes32Simulator } from './simulators/Bytes32Simulator.js';
import { bytesLEToBigint, toU256 } from './utils/oracles.js';
import { RUNS, skipProperties } from './utils/properties.js';

/**
 * Property tests of the `Bytes32` circuits against bigint oracles (INV-4,
 * Z12).
 */

describe.skipIf(skipProperties)('Bytes32 properties', () => {
  let s: Bytes32Simulator;
  const bytes32 = fc.oneof(
    fc.uint8Array({ minLength: 32, maxLength: 32 }),
    fc.constantFrom(new Uint8Array(32), new Uint8Array(32).fill(0xff)),
  );
  const n = bytesLEToBigint;

  beforeAll(async () => {
    s = await Bytes32Simulator.create();
  });

  test('pack and unpack are inverse', async () => {
    await fc.assert(
      fc.asyncProperty(bytes32, async (bytes) => {
        const vec = Array.from(bytes, BigInt);
        expect(await s.unpack(bytes)).toEqual(vec);
        expect(await s.pack(vec)).toEqual(bytes);
      }),
      RUNS,
    );
  }, 60_000);

  test('vectorToU256 and bytesToU256 return the little-endian value', async () => {
    await fc.assert(
      fc.asyncProperty(bytes32, async (bytes) => {
        expect(await s.bytesToU256(bytes)).toEqual(toU256(n(bytes)));
        expect(await s.vectorToU256(Array.from(bytes, BigInt))).toEqual(
          toU256(n(bytes)),
        );
      }),
      RUNS,
    );
  }, 60_000);

  test('eq, lt, lte, gt, gte and isZero agree with the little-endian value', async () => {
    // Pairs that differ only in byte 0 test the byte order.
    const pair = fc.oneof(
      fc.tuple(bytes32, bytes32),
      bytes32.chain((a) =>
        fc.tuple(
          fc.constant(a),
          fc.integer({ min: 0, max: 255 }).map((b) => {
            const copy = Uint8Array.from(a);
            copy[0] = b;
            return copy;
          }),
        ),
      ),
    );
    await fc.assert(
      fc.asyncProperty(pair, async ([a, b]) => {
        expect(await s.eq(a, b)).toBe(n(a) === n(b));
        expect(await s.lt(a, b)).toBe(n(a) < n(b));
        expect(await s.lte(a, b)).toBe(n(a) <= n(b));
        expect(await s.gt(a, b)).toBe(n(a) > n(b));
        expect(await s.gte(a, b)).toBe(n(a) >= n(b));
        expect(await s.isZero(a)).toBe(n(a) === 0n);
      }),
      RUNS,
    );
  }, 60_000);
});
