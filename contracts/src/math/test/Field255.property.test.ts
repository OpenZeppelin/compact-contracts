import { MAX_FIELD } from '@midnight-ntwrk/compact-runtime';
import fc from 'fast-check';
import { beforeAll, describe, expect, test } from 'vitest';
import { Field255Simulator } from './simulators/Field255Simulator.js';
import { toBytesLE, toU256 } from './utils/oracles.js';
import { RUNS, skipProperties, uintUpTo } from './utils/properties.js';

/**
 * Property tests of the `Field255` circuits against bigint oracles (INV-3,
 * Z11).
 */

describe.skipIf(skipProperties)('Field255 properties', () => {
  let s: Field255Simulator;
  const field = uintUpTo(MAX_FIELD);

  beforeAll(async () => {
    s = await Field255Simulator.create();
  });

  test('toBytes and toU256 return the canonical little-endian value', async () => {
    await fc.assert(
      fc.asyncProperty(field, async (x) => {
        expect(await s.toBytes(x)).toEqual(toBytesLE(x, 32));
        expect(await s.toU256(x)).toEqual(toU256(x));
      }),
      RUNS,
    );
  }, 60_000);

  test('eq, lt, lte, gt, gte and isZero agree with the integer order', async () => {
    await fc.assert(
      fc.asyncProperty(field, field, async (a, b) => {
        expect(await s.eq(a, b)).toBe(a === b);
        expect(await s.lt(a, b)).toBe(a < b);
        expect(await s.lte(a, b)).toBe(a <= b);
        expect(await s.gt(a, b)).toBe(a > b);
        expect(await s.gte(a, b)).toBe(a >= b);
        expect(await s.isZero(a)).toBe(a === 0n);
      }),
      RUNS,
    );
  }, 60_000);
});
