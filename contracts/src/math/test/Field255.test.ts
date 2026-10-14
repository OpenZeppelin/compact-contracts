import { MAX_FIELD } from '@midnight-ntwrk/compact-runtime';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { expectRejection } from '#test-utils/assertions/rejection.js';
import { Field255Simulator } from './simulators/Field255Simulator.js';
import { bytesLEToBigint, fromU256 } from './utils/oracles.js';

let field255Simulator: Field255Simulator;

// Witnesses bind at deploy on a live node, so a test that swaps one with
// `overrideWitness` is dry-only.
const testDryOnly = test.skipIf(isLiveBackend());

// Each circuit call is a transaction with a proof on the live backend. The
// loops below check the first and the last value there, and every value on
// the dry backend.
const liveSample = <T>(values: readonly T[]): readonly T[] =>
  isLiveBackend() ? [values[0], values[values.length - 1]] : values;

const setup = async () => {
  field255Simulator = await Field255Simulator.create();
};

/**
 * Boundary values for comprehensive testing.
 */
const BOUNDARY_VALUES = [0n, 1n, 2n, MAX_FIELD - 1n, MAX_FIELD];

/**
 * Powers of 2 for testing.
 */
const POWERS_OF_2 = [
  1n, // 2^0
  2n, // 2^1
  4n, // 2^2
  256n, // 2^8
  65536n, // 2^16
  2n ** 32n, // 2^32
  2n ** 64n, // 2^64
  2n ** 128n, // 2^128
  2n ** 192n, // 2^192
  2n ** 254n, // 2^254 (close to MAX_FIELD)
];

describe('Field255', () => {
  // The mock keeps no state that a test reads. A live run deploys it once per
  // file, because each deploy is a transaction. A dry run creates it again for
  // each test, because `overrideWitness` changes the instance.
  if (isLiveBackend()) {
    beforeAll(setup);
  } else {
    beforeEach(setup);
  }

  describe('constants', () => {
    describe('MAX_FIELD', () => {
      test('should return BLS12-381 scalar field prime minus 1', async () => {
        const result = await field255Simulator.MAX_FIELD();
        expect(result).toBe(MAX_FIELD);
      });
    });
  });

  describe('conversions', () => {
    describe('toBytes', () => {
      test('should convert zero Field to zero bytes', async () => {
        const result = await field255Simulator.toBytes(0n);
        expect(result).toEqual(new Uint8Array(32).fill(0));
      });

      test('should convert small Field to bytes with correct first byte', async () => {
        const result = await field255Simulator.toBytes(123n);
        expect(result[0]).toBe(123);
        expect(result.slice(1)).toEqual(new Uint8Array(31).fill(0));
      });

      test('should convert large Field to bytes and back correctly', async () => {
        const value = 123456789012345678901234567890n;
        const bytes = await field255Simulator.toBytes(value);
        const backToValue = bytesLEToBigint(bytes);
        expect(backToValue).toBe(value);
      });

      test('should convert powers of 2 to bytes and back correctly', async () => {
        for (const value of liveSample(POWERS_OF_2)) {
          const bytes = await field255Simulator.toBytes(value);
          const backToValue = bytesLEToBigint(bytes);
          expect(backToValue).toBe(value);
        }
      });

      test('should convert MAX_FIELD to bytes and back correctly', async () => {
        const bytes = await field255Simulator.toBytes(MAX_FIELD);
        const backToValue = bytesLEToBigint(bytes);
        expect(backToValue).toBe(MAX_FIELD);
      });

      test('should convert MAX_FIELD - 1 to bytes and back correctly', async () => {
        const bytes = await field255Simulator.toBytes(MAX_FIELD - 1n);
        const backToValue = bytesLEToBigint(bytes);
        expect(backToValue).toBe(MAX_FIELD - 1n);
      });
    });

    describe('toU256', () => {
      test('should convert zero Field to zero U256', async () => {
        const result = await field255Simulator.toU256(0n);
        expect(fromU256(result)).toBe(0n);
      });

      test('should convert one to U256 with only low.low set', async () => {
        const u256 = await field255Simulator.toU256(1n);
        expect(u256.low.low).toBe(1n);
        expect(u256.low.high).toBe(0n);
        expect(u256.high.low).toBe(0n);
        expect(u256.high.high).toBe(0n);
      });

      test('should convert small Field to U256', async () => {
        const result = await field255Simulator.toU256(123n);
        expect(fromU256(result)).toBe(123n);
      });

      test('should convert large Field to U256', async () => {
        const value = 123456789012345678901234567890n;
        const result = await field255Simulator.toU256(value);
        expect(fromU256(result)).toBe(value);
      });

      test('should convert powers of 2 to U256 and back correctly', async () => {
        for (const value of liveSample(POWERS_OF_2)) {
          const u256 = await field255Simulator.toU256(value);
          expect(fromU256(u256)).toBe(value);
        }
      });

      test('should convert MAX_FIELD to U256 and back correctly', async () => {
        const u256 = await field255Simulator.toU256(MAX_FIELD);
        expect(fromU256(u256)).toBe(MAX_FIELD);
      });

      testDryOnly(
        'should fail when witness returns bad unpack result',
        async () => {
          field255Simulator.overrideWitness(
            'wit_unpackBytes',
            (context, _bytes) => [
              context.privateState,
              new Array<bigint>(32).fill(0n),
            ],
          );
          await expectRejection(
            field255Simulator.toU256(1n),
            'failed assert: Pack: unpack verification failed',
          );
        },
      );
    });
  });

  describe('comparisons', () => {
    describe('eq', () => {
      test('should return true for equal small values', async () => {
        expect(await field255Simulator.eq(123n, 123n)).toBe(true);
      });

      test('should return true for zero equals zero', async () => {
        expect(await field255Simulator.eq(0n, 0n)).toBe(true);
      });

      test('should return true for MAX_FIELD equals MAX_FIELD', async () => {
        expect(await field255Simulator.eq(MAX_FIELD, MAX_FIELD)).toBe(true);
      });

      test('should return false for adjacent values', async () => {
        expect(await field255Simulator.eq(123n, 124n)).toBe(false);
      });

      test('should return false for zero and one', async () => {
        expect(await field255Simulator.eq(0n, 1n)).toBe(false);
        expect(await field255Simulator.eq(1n, 0n)).toBe(false);
      });

      test('should correctly compare all boundary value combinations', async () => {
        for (const a of liveSample(BOUNDARY_VALUES)) {
          for (const b of liveSample(BOUNDARY_VALUES)) {
            expect(await field255Simulator.eq(a, b)).toBe(a === b);
          }
        }
      });
    });

    describe('lt', () => {
      test('should return true when first value is smaller', async () => {
        expect(await field255Simulator.lt(5n, 10n)).toBe(true);
      });

      test('should return false when first value is larger', async () => {
        expect(await field255Simulator.lt(10n, 5n)).toBe(false);
      });

      test('should return false for equal values', async () => {
        expect(await field255Simulator.lt(5n, 5n)).toBe(false);
      });

      test('should return true for zero compared to one', async () => {
        expect(await field255Simulator.lt(0n, 1n)).toBe(true);
      });

      test('should return false for zero compared to zero', async () => {
        expect(await field255Simulator.lt(0n, 0n)).toBe(false);
      });

      test('should return false for one compared to zero', async () => {
        expect(await field255Simulator.lt(1n, 0n)).toBe(false);
      });

      test('should return true for MAX_FIELD - 1 compared to MAX_FIELD', async () => {
        expect(await field255Simulator.lt(MAX_FIELD - 1n, MAX_FIELD)).toBe(
          true,
        );
      });

      test('should return false for MAX_FIELD compared to MAX_FIELD', async () => {
        expect(await field255Simulator.lt(MAX_FIELD, MAX_FIELD)).toBe(false);
      });

      test('should return false for MAX_FIELD compared to MAX_FIELD - 1', async () => {
        expect(await field255Simulator.lt(MAX_FIELD, MAX_FIELD - 1n)).toBe(
          false,
        );
      });

      test('should correctly compare all boundary value combinations', async () => {
        for (const a of liveSample(BOUNDARY_VALUES)) {
          for (const b of liveSample(BOUNDARY_VALUES)) {
            expect(await field255Simulator.lt(a, b)).toBe(a < b);
          }
        }
      });

      test('should be transitive: if a < b and b < c then a < c', async () => {
        const a = 10n;
        const b = 100n;
        const c = 1000n;

        expect(await field255Simulator.lt(a, b)).toBe(true);
        expect(await field255Simulator.lt(b, c)).toBe(true);
        expect(await field255Simulator.lt(a, c)).toBe(true);
      });

      test('should be inverse of gt: a < b iff b > a', async () => {
        const pairs = [
          [0n, 1n],
          [1n, 2n],
          [100n, MAX_FIELD],
          [2n ** 64n, 2n ** 128n],
        ];
        for (const [a, b] of liveSample(pairs)) {
          expect(await field255Simulator.lt(a, b)).toBe(
            await field255Simulator.gt(b, a),
          );
          expect(await field255Simulator.gt(a, b)).toBe(
            await field255Simulator.lt(b, a),
          );
        }
      });

      testDryOnly(
        'should fail when witness returns bad unpack result',
        async () => {
          field255Simulator.overrideWitness(
            'wit_unpackBytes',
            (context, _bytes) => [
              context.privateState,
              new Array<bigint>(32).fill(0n),
            ],
          );
          await expectRejection(
            field255Simulator.lt(1n, 2n),
            'failed assert: Pack: unpack verification failed',
          );
        },
      );
    });

    describe('lte', () => {
      test('should return true when first value is smaller', async () => {
        expect(await field255Simulator.lte(5n, 10n)).toBe(true);
      });

      test('should return false when first value is larger', async () => {
        expect(await field255Simulator.lte(10n, 5n)).toBe(false);
      });

      test('should return true for equal values', async () => {
        expect(await field255Simulator.lte(5n, 5n)).toBe(true);
      });

      test('should return true for zero compared to one', async () => {
        expect(await field255Simulator.lte(0n, 1n)).toBe(true);
      });

      test('should return true for zero compared to zero', async () => {
        expect(await field255Simulator.lte(0n, 0n)).toBe(true);
      });

      test('should return false for one compared to zero', async () => {
        expect(await field255Simulator.lte(1n, 0n)).toBe(false);
      });

      test('should correctly compare all boundary value combinations', async () => {
        for (const a of liveSample(BOUNDARY_VALUES)) {
          for (const b of liveSample(BOUNDARY_VALUES)) {
            expect(await field255Simulator.lte(a, b)).toBe(a <= b);
          }
        }
      });

      test('should be inverse of gte: a <= b iff b >= a', async () => {
        const pairs = [
          [0n, 0n],
          [0n, 1n],
          [1n, 1n],
          [100n, MAX_FIELD],
        ];
        for (const [a, b] of liveSample(pairs)) {
          expect(await field255Simulator.lte(a, b)).toBe(
            await field255Simulator.gte(b, a),
          );
          expect(await field255Simulator.gte(a, b)).toBe(
            await field255Simulator.lte(b, a),
          );
        }
      });

      testDryOnly(
        'should fail when witness returns bad unpack result',
        async () => {
          field255Simulator.overrideWitness(
            'wit_unpackBytes',
            (context, _bytes) => [
              context.privateState,
              new Array<bigint>(32).fill(0n),
            ],
          );
          await expectRejection(
            field255Simulator.lte(1n, 2n),
            'failed assert: Pack: unpack verification failed',
          );
        },
      );
    });

    describe('gt', () => {
      test('should return true when first value is larger', async () => {
        expect(await field255Simulator.gt(10n, 5n)).toBe(true);
      });

      test('should return false when first value is smaller', async () => {
        expect(await field255Simulator.gt(5n, 10n)).toBe(false);
      });

      test('should return false for equal values', async () => {
        expect(await field255Simulator.gt(5n, 5n)).toBe(false);
      });

      test('should return true for one compared to zero', async () => {
        expect(await field255Simulator.gt(1n, 0n)).toBe(true);
      });

      test('should return false for zero compared to zero', async () => {
        expect(await field255Simulator.gt(0n, 0n)).toBe(false);
      });

      test('should return false for zero compared to one', async () => {
        expect(await field255Simulator.gt(0n, 1n)).toBe(false);
      });

      test('should correctly compare all boundary value combinations', async () => {
        for (const a of liveSample(BOUNDARY_VALUES)) {
          for (const b of liveSample(BOUNDARY_VALUES)) {
            expect(await field255Simulator.gt(a, b)).toBe(a > b);
          }
        }
      });

      testDryOnly(
        'should fail when witness returns bad unpack result',
        async () => {
          field255Simulator.overrideWitness(
            'wit_unpackBytes',
            (context, _bytes) => [
              context.privateState,
              new Array<bigint>(32).fill(0n),
            ],
          );
          await expectRejection(
            field255Simulator.gt(2n, 1n),
            'failed assert: Pack: unpack verification failed',
          );
        },
      );
    });

    describe('gte', () => {
      test('should return true when first value is larger', async () => {
        expect(await field255Simulator.gte(10n, 5n)).toBe(true);
      });

      test('should return false when first value is smaller', async () => {
        expect(await field255Simulator.gte(5n, 10n)).toBe(false);
      });

      test('should return true for equal values', async () => {
        expect(await field255Simulator.gte(5n, 5n)).toBe(true);
      });

      test('should return true for one compared to zero', async () => {
        expect(await field255Simulator.gte(1n, 0n)).toBe(true);
      });

      test('should return true for zero compared to zero', async () => {
        expect(await field255Simulator.gte(0n, 0n)).toBe(true);
      });

      test('should return false for zero compared to one', async () => {
        expect(await field255Simulator.gte(0n, 1n)).toBe(false);
      });

      test('should correctly compare all boundary value combinations', async () => {
        for (const a of liveSample(BOUNDARY_VALUES)) {
          for (const b of liveSample(BOUNDARY_VALUES)) {
            expect(await field255Simulator.gte(a, b)).toBe(a >= b);
          }
        }
      });

      testDryOnly(
        'should fail when witness returns bad unpack result',
        async () => {
          field255Simulator.overrideWitness(
            'wit_unpackBytes',
            (context, _bytes) => [
              context.privateState,
              new Array<bigint>(32).fill(0n),
            ],
          );
          await expectRejection(
            field255Simulator.gte(2n, 1n),
            'failed assert: Pack: unpack verification failed',
          );
        },
      );
    });
  });

  describe('utilities', () => {
    describe('isZero', () => {
      test('should return true for zero', async () => {
        expect(await field255Simulator.isZero(0n)).toBe(true);
      });

      test('should return false for one', async () => {
        expect(await field255Simulator.isZero(1n)).toBe(false);
      });

      test('should return false for arbitrary non-zero values', async () => {
        expect(await field255Simulator.isZero(123n)).toBe(false);
      });

      test('should return false for MAX_FIELD - 1', async () => {
        expect(await field255Simulator.isZero(MAX_FIELD - 1n)).toBe(false);
      });

      test('should return false for MAX_FIELD', async () => {
        expect(await field255Simulator.isZero(MAX_FIELD)).toBe(false);
      });
    });
  });
});
