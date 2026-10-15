import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { expectRejection } from '#test-utils/assertions/rejection.js';
import { Bytes32Simulator } from './simulators/Bytes32Simulator.js';
import { MAX_UINT64, MAX_UINT128, MAX_UINT256 } from './utils/consts.js';
import { fromU256, toBytesLE, toVecLE } from './utils/oracles.js';

let bytes32Simulator: Bytes32Simulator;

// Witnesses bind at deploy on a live node, so a test that swaps one with
// `overrideWitness` is dry-only.
const testDryOnly = test.skipIf(isLiveBackend());

// Each circuit call is a transaction with a proof on the live backend. The
// loops below check the first and the last value there, and every value on
// the dry backend.
const liveSample = <T>(values: readonly T[]): readonly T[] =>
  isLiveBackend() ? [values[0], values[values.length - 1]] : values;

const setup = async () => {
  bytes32Simulator = await Bytes32Simulator.create();
};

/** 32-element vector from bigint (little-endian bytes). */
const toVec32 = (value: bigint): bigint[] => toVecLE(value, 32);

/** Bytes<32> from bigint (little-endian). */
const toBytes = (value: bigint): Uint8Array => toBytesLE(value, 32);

describe('Bytes32', () => {
  // The mock keeps no state that a test reads. A live run deploys it once per
  // file, because each deploy is a transaction. A dry run creates it again for
  // each test, because `overrideWitness` changes the instance.
  if (isLiveBackend()) {
    beforeAll(setup);
  } else {
    beforeEach(setup);
  }

  describe('conversions', () => {
    describe('pack', () => {
      test('should convert zero vector to zero bytes', async () => {
        const vec = toVec32(0n);
        const result = await bytes32Simulator.pack(vec);
        expect(result).toEqual(new Uint8Array(32).fill(0));
      });

      test('should match vector elements as bytes', async () => {
        const value = 1234567890123456789012345678901234567890n;
        const vec = toVec32(value);
        const result = await bytes32Simulator.pack(vec);
        expect(result.length).toBe(32);
        for (let i = 0; i < 32; i++) {
          expect(result[i]).toBe(Number(vec[i]));
        }
      });

      test('should roundtrip with vectorToU256', async () => {
        const value = MAX_UINT128 + (1n << 128n);
        const vec = toVec32(value);
        const u256 = await bytes32Simulator.vectorToU256(vec);
        const bytes = await bytes32Simulator.pack(vec);
        expect(fromU256(u256)).toBe(value);
        let back = 0n;
        for (let i = 0; i < 32; i++) {
          back += BigInt(bytes[i]) << (8n * BigInt(i));
        }
        expect(back).toBe(value);
      });
    });

    describe('unpack', () => {
      test('should unpack bytes to vector matching pack roundtrip', async () => {
        const value = 0x0123456789abcdefn;
        const vec = toVec32(value);
        const bytes = await bytes32Simulator.pack(vec);
        const unpacked = await bytes32Simulator.unpack(bytes);
        expect(unpacked).toEqual(vec);
      });

      test('should unpack zero bytes to zero vector', async () => {
        const bytes = new Uint8Array(32).fill(0);
        const unpacked = await bytes32Simulator.unpack(bytes);
        expect(unpacked).toEqual(new Array(32).fill(0n));
      });

      testDryOnly(
        'should fail when witness returns pack(vec) != bytes',
        async () => {
          bytes32Simulator.overrideWitness(
            'wit_unpackBytes',
            (context, _bytes) => [
              context.privateState,
              new Array<bigint>(32).fill(0n),
            ],
          );
          const bytes = new Uint8Array(32);
          bytes[0] = 1;
          await expectRejection(
            bytes32Simulator.unpack(bytes),
            'failed assert: Pack: unpack verification failed',
          );
        },
      );
    });

    describe('vectorToU256', () => {
      test('should convert zero vector to zero U256', async () => {
        const vec = toVec32(0n);
        const result = await bytes32Simulator.vectorToU256(vec);
        expect(fromU256(result)).toBe(0n);
      });

      test('should convert small value in first limb only', async () => {
        const vec = toVec32(0x0123456789abcdefn);
        const result = await bytes32Simulator.vectorToU256(vec);
        expect(fromU256(result)).toBe(0x0123456789abcdefn);
      });

      test('should convert value spanning all 4 limbs', async () => {
        const value = 1n + (2n << 64n) + (3n << 128n) + (4n << 192n);
        const vec = toVec32(value);
        const result = await bytes32Simulator.vectorToU256(vec);
        expect(fromU256(result)).toBe(value);
      });

      test('should convert MAX_U256 all-0xFF vector', async () => {
        const vec = new Array<bigint>(32).fill(255n);
        const result = await bytes32Simulator.vectorToU256(vec);
        expect(result.low.low).toBe(MAX_UINT64);
        expect(result.low.high).toBe(MAX_UINT64);
        expect(result.high.low).toBe(MAX_UINT64);
        expect(result.high.high).toBe(MAX_UINT64);
        expect(fromU256(result)).toBe(MAX_UINT256);
      });

      test('should place byte at limb boundary (byte 8)', async () => {
        const vec = new Array<bigint>(32).fill(0n);
        vec[8] = 1n;
        const result = await bytes32Simulator.vectorToU256(vec);
        expect(fromU256(result)).toBe(1n << 64n);
      });

      test('should place byte at limb boundary (byte 16)', async () => {
        const vec = new Array<bigint>(32).fill(0n);
        vec[16] = 1n;
        const result = await bytes32Simulator.vectorToU256(vec);
        expect(fromU256(result)).toBe(1n << 128n);
      });

      test('should place byte at limb boundary (byte 24)', async () => {
        const vec = new Array<bigint>(32).fill(0n);
        vec[24] = 1n;
        const result = await bytes32Simulator.vectorToU256(vec);
        expect(fromU256(result)).toBe(1n << 192n);
      });
    });

    describe('bytesToU256', () => {
      test('should convert zero bytes to zero U256', async () => {
        const bytes = new Uint8Array(32).fill(0);
        const result = await bytes32Simulator.bytesToU256(bytes);
        expect(fromU256(result)).toBe(0n);
      });

      test('should convert small value in first limb only', async () => {
        const value = 0x0123456789abcdefn;
        const bytes = await bytes32Simulator.pack(toVec32(value));
        const result = await bytes32Simulator.bytesToU256(bytes);
        expect(fromU256(result)).toBe(value);
      });

      test('should convert value spanning all 4 limbs', async () => {
        const value = 1n + (2n << 64n) + (3n << 128n) + (4n << 192n);
        const bytes = await bytes32Simulator.pack(toVec32(value));
        const result = await bytes32Simulator.bytesToU256(bytes);
        expect(fromU256(result)).toBe(value);
      });

      test('should convert MAX_U256 all-0xFF bytes', async () => {
        const bytes = await bytes32Simulator.pack(
          new Array<bigint>(32).fill(255n),
        );
        const result = await bytes32Simulator.bytesToU256(bytes);
        expect(result.low.low).toBe(MAX_UINT64);
        expect(result.low.high).toBe(MAX_UINT64);
        expect(result.high.low).toBe(MAX_UINT64);
        expect(result.high.high).toBe(MAX_UINT64);
        expect(fromU256(result)).toBe(MAX_UINT256);
      });

      test('should place byte at limb boundary (byte 8)', async () => {
        const vec = new Array<bigint>(32).fill(0n);
        vec[8] = 1n;
        const bytes = await bytes32Simulator.pack(vec);
        const result = await bytes32Simulator.bytesToU256(bytes);
        expect(fromU256(result)).toBe(1n << 64n);
      });

      test('should place byte at limb boundary (byte 16)', async () => {
        const vec = new Array<bigint>(32).fill(0n);
        vec[16] = 1n;
        const bytes = await bytes32Simulator.pack(vec);
        const result = await bytes32Simulator.bytesToU256(bytes);
        expect(fromU256(result)).toBe(1n << 128n);
      });

      test('should place byte at limb boundary (byte 24)', async () => {
        const vec = new Array<bigint>(32).fill(0n);
        vec[24] = 1n;
        const bytes = await bytes32Simulator.pack(vec);
        const result = await bytes32Simulator.bytesToU256(bytes);
        expect(fromU256(result)).toBe(1n << 192n);
      });

      testDryOnly(
        'should fail when witness returns pack(vec) != bytes',
        async () => {
          bytes32Simulator.overrideWitness(
            'wit_unpackBytes',
            (context, _bytes) => [
              context.privateState,
              new Array<bigint>(32).fill(0n),
            ],
          );
          const bytes = new Uint8Array(32);
          bytes[0] = 1;
          await expectRejection(
            bytes32Simulator.bytesToU256(bytes),
            'failed assert: Pack: unpack verification failed',
          );
        },
      );
    });
  });

  describe('comparisons', () => {
    describe('eq', () => {
      test('should return true for equal values', async () => {
        const a = toBytes(0x0123456789abcdefn);
        expect(await bytes32Simulator.eq(a, a)).toBe(true);
      });

      test('should return true for zero equals zero', async () => {
        const z = toBytes(0n);
        expect(await bytes32Simulator.eq(z, z)).toBe(true);
      });

      test('should return true for MAX_UINT256 equals MAX_UINT256', async () => {
        const m = toBytes(MAX_UINT256);
        expect(await bytes32Simulator.eq(m, m)).toBe(true);
      });

      test('should return false for different values', async () => {
        const a = toBytes(0n);
        const b = toBytes(1n);
        expect(await bytes32Simulator.eq(a, b)).toBe(false);
        expect(await bytes32Simulator.eq(b, a)).toBe(false);
      });

      test('should return false for zero and one', async () => {
        expect(await bytes32Simulator.eq(toBytes(0n), toBytes(1n))).toBe(false);
      });
    });

    describe('lt', () => {
      test('should return true when first value is smaller', async () => {
        expect(await bytes32Simulator.lt(toBytes(5n), toBytes(10n))).toBe(true);
      });

      test('should return false when first value is larger', async () => {
        expect(await bytes32Simulator.lt(toBytes(10n), toBytes(5n))).toBe(
          false,
        );
      });

      test('should return false for equal values', async () => {
        const a = toBytes(0x0123456789abcdefn);
        expect(await bytes32Simulator.lt(a, a)).toBe(false);
      });

      test('should return true for zero compared to one', async () => {
        expect(await bytes32Simulator.lt(toBytes(0n), toBytes(1n))).toBe(true);
      });

      test('should return false for one compared to zero', async () => {
        expect(await bytes32Simulator.lt(toBytes(1n), toBytes(0n))).toBe(false);
      });

      test('should return true for MAX_UINT256 - 1 compared to MAX_UINT256', async () => {
        expect(
          await bytes32Simulator.lt(
            toBytes(MAX_UINT256 - 1n),
            toBytes(MAX_UINT256),
          ),
        ).toBe(true);
      });

      test('should be inverse of gt: a < b iff b > a', async () => {
        const pairs: [bigint, bigint][] = [
          [0n, 1n],
          [1n, 2n],
          [100n, MAX_UINT128],
          [2n ** 64n, 2n ** 128n],
        ];
        for (const [a, b] of liveSample(pairs)) {
          expect(await bytes32Simulator.lt(toBytes(a), toBytes(b))).toBe(
            await bytes32Simulator.gt(toBytes(b), toBytes(a)),
          );
        }
      });

      testDryOnly(
        'should fail when witness returns bad unpack result',
        async () => {
          bytes32Simulator.overrideWitness(
            'wit_unpackBytes',
            (context, _bytes) => [
              context.privateState,
              new Array<bigint>(32).fill(0n),
            ],
          );
          const a = new Uint8Array(32);
          a[0] = 1;
          const b = new Uint8Array(32);
          await expectRejection(
            bytes32Simulator.lt(a, b),
            'failed assert: Pack: unpack verification failed',
          );
        },
      );
    });

    describe('lte', () => {
      test('should return true when first value is smaller', async () => {
        expect(await bytes32Simulator.lte(toBytes(5n), toBytes(10n))).toBe(
          true,
        );
      });

      test('should return false when first value is larger', async () => {
        expect(await bytes32Simulator.lte(toBytes(10n), toBytes(5n))).toBe(
          false,
        );
      });

      test('should return true for equal values', async () => {
        const a = toBytes(0x0123456789abcdefn);
        expect(await bytes32Simulator.lte(a, a)).toBe(true);
      });

      test('should return true for zero compared to zero', async () => {
        const z = toBytes(0n);
        expect(await bytes32Simulator.lte(z, z)).toBe(true);
      });

      test('should be inverse of gte: a <= b iff b >= a', async () => {
        const pairs: [bigint, bigint][] = [
          [0n, 0n],
          [0n, 1n],
          [1n, 1n],
          [100n, MAX_UINT256],
        ];
        for (const [a, b] of liveSample(pairs)) {
          expect(await bytes32Simulator.lte(toBytes(a), toBytes(b))).toBe(
            await bytes32Simulator.gte(toBytes(b), toBytes(a)),
          );
        }
      });

      testDryOnly(
        'should fail when witness returns bad unpack result',
        async () => {
          bytes32Simulator.overrideWitness(
            'wit_unpackBytes',
            (context, _bytes) => [
              context.privateState,
              new Array<bigint>(32).fill(0n),
            ],
          );
          const a = new Uint8Array(32);
          a[0] = 1;
          const b = new Uint8Array(32);
          await expectRejection(
            bytes32Simulator.lte(a, b),
            'failed assert: Pack: unpack verification failed',
          );
        },
      );
    });

    describe('gt', () => {
      test('should return true when first value is larger', async () => {
        expect(await bytes32Simulator.gt(toBytes(10n), toBytes(5n))).toBe(true);
      });

      test('should return false when first value is smaller', async () => {
        expect(await bytes32Simulator.gt(toBytes(5n), toBytes(10n))).toBe(
          false,
        );
      });

      test('should return false for equal values', async () => {
        const a = toBytes(0x0123456789abcdefn);
        expect(await bytes32Simulator.gt(a, a)).toBe(false);
      });

      test('should return true for one compared to zero', async () => {
        expect(await bytes32Simulator.gt(toBytes(1n), toBytes(0n))).toBe(true);
      });

      testDryOnly(
        'should fail when witness returns bad unpack result',
        async () => {
          bytes32Simulator.overrideWitness(
            'wit_unpackBytes',
            (context, _bytes) => [
              context.privateState,
              new Array<bigint>(32).fill(0n),
            ],
          );
          const a = new Uint8Array(32);
          a[0] = 1;
          const b = new Uint8Array(32);
          await expectRejection(
            bytes32Simulator.gt(a, b),
            'failed assert: Pack: unpack verification failed',
          );
        },
      );
    });

    describe('gte', () => {
      test('should return true when first value is larger', async () => {
        expect(await bytes32Simulator.gte(toBytes(10n), toBytes(5n))).toBe(
          true,
        );
      });

      test('should return false when first value is smaller', async () => {
        expect(await bytes32Simulator.gte(toBytes(5n), toBytes(10n))).toBe(
          false,
        );
      });

      test('should return true for equal values', async () => {
        const a = toBytes(0x0123456789abcdefn);
        expect(await bytes32Simulator.gte(a, a)).toBe(true);
      });

      test('should return true for zero compared to zero', async () => {
        const z = toBytes(0n);
        expect(await bytes32Simulator.gte(z, z)).toBe(true);
      });

      testDryOnly(
        'should fail when witness returns bad unpack result',
        async () => {
          bytes32Simulator.overrideWitness(
            'wit_unpackBytes',
            (context, _bytes) => [
              context.privateState,
              new Array<bigint>(32).fill(0n),
            ],
          );
          const a = new Uint8Array(32);
          a[0] = 1;
          const b = new Uint8Array(32);
          await expectRejection(
            bytes32Simulator.gte(a, b),
            'failed assert: Pack: unpack verification failed',
          );
        },
      );
    });
  });

  describe('utilities', () => {
    describe('isZero', () => {
      test('should return true for zero bytes', async () => {
        expect(await bytes32Simulator.isZero(toBytes(0n))).toBe(true);
      });

      test('should return false for one', async () => {
        expect(await bytes32Simulator.isZero(toBytes(1n))).toBe(false);
      });

      test('should return false for arbitrary non-zero values', async () => {
        expect(
          await bytes32Simulator.isZero(toBytes(0x0123456789abcdefn)),
        ).toBe(false);
        expect(await bytes32Simulator.isZero(toBytes(MAX_UINT256 - 1n))).toBe(
          false,
        );
      });

      test('should return false for MAX_UINT256', async () => {
        expect(await bytes32Simulator.isZero(toBytes(MAX_UINT256))).toBe(false);
      });
    });
  });
});
