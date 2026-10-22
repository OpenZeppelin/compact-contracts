import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { expectRejection } from '#test-utils/assertions/rejection.js';
import type { U256 } from '../../../artifacts/MockUint256/contract/index.js';
import { Uint256Simulator } from './simulators/Uint256Simulator.js';
import { MAX_UINT64, MAX_UINT128, MAX_UINT256 } from './utils/consts.js';
import { bytesLEToBigint, toU256 } from './utils/oracles.js';

let uint256Simulator: Uint256Simulator;

// Witnesses bind at deploy on a live node, so a test that swaps one with
// `overrideWitness` is dry-only.
const testDryOnly = test.skipIf(isLiveBackend());

const setup = async () => {
  uint256Simulator = await Uint256Simulator.create();
};

describe('Uint256', () => {
  // The mock keeps no state that a test reads. A live run deploys it once per
  // file, because each deploy is a transaction. A dry run creates it again for
  // each test, because `overrideWitness` changes the instance.
  if (isLiveBackend()) {
    beforeAll(setup);
  } else {
    beforeEach(setup);
  }

  describe('constants', () => {
    describe('ZERO_U256', () => {
      test('should return zero struct', async () => {
        const result = await uint256Simulator.ZERO_U256();
        expect(result.low.low).toBe(0n);
        expect(result.low.high).toBe(0n);
        expect(result.high.low).toBe(0n);
        expect(result.high.high).toBe(0n);
      });
    });

    describe('MAX_U256', () => {
      test('should return U256 with all four limbs equal to MAX_UINT64', async () => {
        const result = await uint256Simulator.MAX_U256();
        expect(result.low.low).toBe(MAX_UINT64);
        expect(result.low.high).toBe(MAX_UINT64);
        expect(result.high.low).toBe(MAX_UINT64);
        expect(result.high.high).toBe(MAX_UINT64);
      });
    });
  });

  describe('conversions', () => {
    describe('toBytes', () => {
      test('should convert zero U256 to zero bytes', async () => {
        const u256 = toU256(0n);
        const result = await uint256Simulator.toBytes(u256);
        expect(result).toEqual(new Uint8Array(32).fill(0));
      });

      test('should convert small U256 to bytes', async () => {
        const u256 = toU256(123n);
        const result = await uint256Simulator.toBytes(u256);
        expect(result[0]).toBe(123);
        expect(result.slice(1)).toEqual(new Uint8Array(31).fill(0));
      });

      test('should convert max U256 to bytes', async () => {
        const u256 = toU256(MAX_UINT256);
        const result = await uint256Simulator.toBytes(u256);
        expect(result).toEqual(new Uint8Array(32).fill(255));
      });

      test('should convert MAX_UINT256 decimal value to all 0xFF bytes', async () => {
        // MAX_UINT256 = 2^256 - 1
        const maxUint256Decimal =
          0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn;
        expect(maxUint256Decimal).toBe(MAX_UINT256);

        const u256 = toU256(maxUint256Decimal);

        // Verify the U256 struct has all limbs at max
        expect(u256.low.low).toBe(MAX_UINT64);
        expect(u256.low.high).toBe(MAX_UINT64);
        expect(u256.high.low).toBe(MAX_UINT64);
        expect(u256.high.high).toBe(MAX_UINT64);

        // Convert to bytes
        const result = await uint256Simulator.toBytes(u256);

        // All 32 bytes should be 0xFF (255)
        expect(result.length).toBe(32);
        for (let i = 0; i < 32; i++) {
          expect(result[i]).toBe(0xff);
        }

        // Verify as hex string
        const hexString = Array.from(result)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        expect(hexString).toBe('ff'.repeat(32));
      });

      test('should place value at correct limb positions', async () => {
        const u256: U256 = {
          low: { low: 1n, high: 2n },
          high: { low: 3n, high: 4n },
        };
        const result = await uint256Simulator.toBytes(u256);
        expect(result[0]).toBe(1); // low.low at byte 0
        expect(result[8]).toBe(2); // low.high at byte 8
        expect(result[16]).toBe(3); // high.low at byte 16
        expect(result[24]).toBe(4); // high.high at byte 24
      });

      test('should correctly convert MAX_UINT64', async () => {
        const u256 = toU256(MAX_UINT64);
        const result = await uint256Simulator.toBytes(u256);
        // First 8 bytes should be 0xFF
        for (let i = 0; i < 8; i++) {
          expect(result[i]).toBe(255);
        }
        // Remaining bytes should be 0
        for (let i = 8; i < 32; i++) {
          expect(result[i]).toBe(0);
        }
      });

      test('should correctly convert MAX_UINT128', async () => {
        const u256 = toU256(MAX_UINT128);
        const result = await uint256Simulator.toBytes(u256);
        // First 16 bytes should be 0xFF
        for (let i = 0; i < 16; i++) {
          expect(result[i]).toBe(255);
        }
        // Remaining bytes should be 0
        for (let i = 16; i < 32; i++) {
          expect(result[i]).toBe(0);
        }
      });

      test('should correctly convert arbitrary value', async () => {
        const value = 123456789012345678901234567890n;
        const u256 = toU256(value);
        const result = await uint256Simulator.toBytes(u256);
        expect(bytesLEToBigint(result)).toBe(value);
      });

      testDryOnly(
        'should fail when witness returns Bytes8_toUint64(vec) != value for any limb',
        async () => {
          uint256Simulator.overrideWitness(
            'wit_uint64ToUnpackedBytes',
            (_context, _value) => [{}, [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]],
          );
          await expectRejection(
            uint256Simulator.toBytes(toU256(123n)),
            'failed assert: Uint64: toUnpackedBytes verification failed',
          );
        },
      );
    });

    describe('toUnpackedBytes', () => {
      test('should convert zero U256 to zero vector', async () => {
        const u256 = toU256(0n);
        const result = await uint256Simulator.toUnpackedBytes(u256);
        expect(result).toHaveLength(32);
        expect(result.every((b) => b === 0n)).toBe(true);
      });

      test('should convert small U256 to vector', async () => {
        const u256 = toU256(123n);
        const result = await uint256Simulator.toUnpackedBytes(u256);
        expect(result).toHaveLength(32);
        expect(result[0]).toBe(123n);
        expect(result.slice(1).every((b) => b === 0n)).toBe(true);
      });

      test('should convert MAX_U256 to all-0xFF vector', async () => {
        const u256 = toU256(MAX_UINT256);
        const result = await uint256Simulator.toUnpackedBytes(u256);
        expect(result).toHaveLength(32);
        expect(result.every((b) => b === 255n)).toBe(true);
      });

      test('should roundtrip with toBytes', async () => {
        const u256 = toU256(1n + (2n << 64n) + (3n << 128n) + (4n << 192n));
        const vec = await uint256Simulator.toUnpackedBytes(u256);
        const bytes = new Uint8Array(vec.map((b) => Number(b)));
        const back = await uint256Simulator.toBytes(u256);
        expect(bytes).toEqual(back);
      });

      testDryOnly(
        'should fail when witness returns Bytes8_toUint64(vec) != value for any limb',
        async () => {
          uint256Simulator.overrideWitness(
            'wit_uint64ToUnpackedBytes',
            (_context, _value) => [{}, [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]],
          );
          await expectRejection(
            uint256Simulator.toUnpackedBytes(toU256(123n)),
            'failed assert: Uint64: toUnpackedBytes verification failed',
          );
        },
      );
    });
  });

  describe('comparisons', () => {
    describe('eq', () => {
      test('should compare equal values', async () => {
        const a = toU256(123n);
        const b = toU256(123n);
        expect(await uint256Simulator.eq(a, b)).toBe(true);
      });

      test('should compare different low parts', async () => {
        const a = toU256(123n);
        const b = toU256(124n);
        expect(await uint256Simulator.eq(a, b)).toBe(false);
      });

      test('should compare different high parts', async () => {
        const a: U256 = {
          low: { low: 123n, high: 0n },
          high: { low: 456n, high: 0n },
        };
        const b: U256 = {
          low: { low: 123n, high: 0n },
          high: { low: 457n, high: 0n },
        };
        expect(await uint256Simulator.eq(a, b)).toBe(false);
      });

      test('should compare zero values', async () => {
        expect(await uint256Simulator.eq(toU256(0n), toU256(0n))).toBe(true);
      });

      test('should compare max U256 values', async () => {
        const max = toU256(MAX_UINT256);
        expect(await uint256Simulator.eq(max, max)).toBe(true);
      });
    });

    describe('lt', () => {
      test('should compare small numbers', async () => {
        const a = toU256(5n);
        const b = toU256(10n);
        expect(await uint256Simulator.lt(a, b)).toBe(true);
        expect(await uint256Simulator.lt(b, a)).toBe(false);
        expect(await uint256Simulator.lt(a, a)).toBe(false);
      });

      test('should compare max U256 values', async () => {
        const max = toU256(MAX_UINT256);
        const maxMinusOne = toU256(MAX_UINT256 - 1n);
        expect(await uint256Simulator.lt(max, max)).toBe(false);
        expect(await uint256Simulator.lt(maxMinusOne, max)).toBe(true);
        expect(await uint256Simulator.lt(max, maxMinusOne)).toBe(false);
      });

      test('should handle zero', async () => {
        const zero = toU256(0n);
        const one = toU256(1n);
        expect(await uint256Simulator.lt(zero, one)).toBe(true);
        expect(await uint256Simulator.lt(zero, zero)).toBe(false);
        expect(await uint256Simulator.lt(one, zero)).toBe(false);
      });

      test('should compare with high parts', async () => {
        const a: U256 = {
          low: { low: MAX_UINT64, high: MAX_UINT64 },
          high: { low: 0n, high: 0n },
        };
        const b: U256 = {
          low: { low: MAX_UINT64, high: MAX_UINT64 },
          high: { low: 1n, high: 0n },
        };
        expect(await uint256Simulator.lt(a, b)).toBe(true);
        expect(await uint256Simulator.lt(b, a)).toBe(false);
      });

      test('should compare values differing only in highest limb', async () => {
        const a: U256 = {
          low: { low: 0n, high: 0n },
          high: { low: 0n, high: 1n },
        };
        const b: U256 = {
          low: { low: 0n, high: 0n },
          high: { low: 0n, high: 2n },
        };
        expect(await uint256Simulator.lt(a, b)).toBe(true);
        expect(await uint256Simulator.lt(b, a)).toBe(false);
      });

      test('should compare values where lower is larger in low but smaller overall', async () => {
        const a: U256 = {
          low: { low: MAX_UINT64, high: MAX_UINT64 },
          high: { low: 0n, high: 0n },
        };
        const b: U256 = {
          low: { low: 0n, high: 0n },
          high: { low: 1n, high: 0n },
        };
        // a has larger low part but b has larger high part, so a < b
        expect(await uint256Simulator.lt(a, b)).toBe(true);
      });

      test('should compare values differing only in low.low vs low.high', async () => {
        const a: U256 = {
          low: { low: MAX_UINT64, high: 0n },
          high: { low: 0n, high: 0n },
        };
        const b: U256 = {
          low: { low: 0n, high: 1n },
          high: { low: 0n, high: 0n },
        };
        // a = 2^64 - 1, b = 2^64, so a < b
        expect(await uint256Simulator.lt(a, b)).toBe(true);
      });

      test('should compare values differing only in high limbs', async () => {
        const a: U256 = {
          low: { low: MAX_UINT64, high: MAX_UINT64 },
          high: { low: MAX_UINT64, high: 0n },
        };
        const b: U256 = {
          low: { low: MAX_UINT64, high: MAX_UINT64 },
          high: { low: 0n, high: 1n },
        };
        // b has larger high.high
        expect(await uint256Simulator.lt(a, b)).toBe(true);
      });
    });

    describe('lte', () => {
      test('should compare small numbers', async () => {
        const a = toU256(5n);
        const b = toU256(10n);
        expect(await uint256Simulator.lte(a, b)).toBe(true);
        expect(await uint256Simulator.lte(b, a)).toBe(false);
        expect(await uint256Simulator.lte(a, a)).toBe(true);
      });

      test('should compare max U256 values', async () => {
        const max = toU256(MAX_UINT256);
        const maxMinusOne = toU256(MAX_UINT256 - 1n);
        expect(await uint256Simulator.lte(max, max)).toBe(true);
        expect(await uint256Simulator.lte(maxMinusOne, max)).toBe(true);
        expect(await uint256Simulator.lte(max, maxMinusOne)).toBe(false);
      });

      test('should handle zero', async () => {
        const zero = toU256(0n);
        const one = toU256(1n);
        expect(await uint256Simulator.lte(zero, one)).toBe(true);
        expect(await uint256Simulator.lte(zero, zero)).toBe(true);
        expect(await uint256Simulator.lte(one, zero)).toBe(false);
      });

      test('should compare with high parts', async () => {
        const a: U256 = {
          low: { low: MAX_UINT64, high: MAX_UINT64 },
          high: { low: 0n, high: 0n },
        };
        const b: U256 = {
          low: { low: MAX_UINT64, high: MAX_UINT64 },
          high: { low: 1n, high: 0n },
        };
        expect(await uint256Simulator.lte(a, b)).toBe(true);
        expect(await uint256Simulator.lte(b, a)).toBe(false);
      });
    });

    describe('gt', () => {
      test('should compare small numbers', async () => {
        const a = toU256(10n);
        const b = toU256(5n);
        expect(await uint256Simulator.gt(a, b)).toBe(true);
        expect(await uint256Simulator.gt(b, a)).toBe(false);
        expect(await uint256Simulator.gt(a, a)).toBe(false);
      });

      test('should compare max U256 values', async () => {
        const max = toU256(MAX_UINT256);
        const maxMinusOne = toU256(MAX_UINT256 - 1n);
        expect(await uint256Simulator.gt(max, maxMinusOne)).toBe(true);
        expect(await uint256Simulator.gt(maxMinusOne, max)).toBe(false);
        expect(await uint256Simulator.gt(max, max)).toBe(false);
      });

      test('should handle zero', async () => {
        const zero = toU256(0n);
        const one = toU256(1n);
        expect(await uint256Simulator.gt(one, zero)).toBe(true);
        expect(await uint256Simulator.gt(zero, one)).toBe(false);
        expect(await uint256Simulator.gt(zero, zero)).toBe(false);
      });

      test('should compare with high parts', async () => {
        const a: U256 = {
          low: { low: MAX_UINT64, high: MAX_UINT64 },
          high: { low: 1n, high: 0n },
        };
        const b: U256 = {
          low: { low: MAX_UINT64, high: MAX_UINT64 },
          high: { low: 0n, high: 0n },
        };
        expect(await uint256Simulator.gt(a, b)).toBe(true);
        expect(await uint256Simulator.gt(b, a)).toBe(false);
      });
    });

    describe('gte', () => {
      test('should compare small numbers', async () => {
        const a = toU256(10n);
        const b = toU256(5n);
        expect(await uint256Simulator.gte(a, b)).toBe(true);
        expect(await uint256Simulator.gte(b, a)).toBe(false);
        expect(await uint256Simulator.gte(a, a)).toBe(true);
      });

      test('should compare max U256 values', async () => {
        const max = toU256(MAX_UINT256);
        const maxMinusOne = toU256(MAX_UINT256 - 1n);
        expect(await uint256Simulator.gte(max, maxMinusOne)).toBe(true);
        expect(await uint256Simulator.gte(maxMinusOne, max)).toBe(false);
        expect(await uint256Simulator.gte(max, max)).toBe(true);
      });

      test('should handle zero', async () => {
        const zero = toU256(0n);
        const one = toU256(1n);
        expect(await uint256Simulator.gte(one, zero)).toBe(true);
        expect(await uint256Simulator.gte(zero, one)).toBe(false);
        expect(await uint256Simulator.gte(zero, zero)).toBe(true);
      });

      test('should compare with high parts', async () => {
        const a: U256 = {
          low: { low: MAX_UINT64, high: MAX_UINT64 },
          high: { low: 1n, high: 0n },
        };
        const b: U256 = {
          low: { low: MAX_UINT64, high: MAX_UINT64 },
          high: { low: 0n, high: 0n },
        };
        expect(await uint256Simulator.gte(a, b)).toBe(true);
        expect(await uint256Simulator.gte(b, a)).toBe(false);
      });
    });
  });
});
