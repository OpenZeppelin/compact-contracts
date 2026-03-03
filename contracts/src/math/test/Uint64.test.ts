import { Uint64Simulator } from '@src/math/test/mocks/Uint64Simulator.js';
import { MAX_UINT32, MAX_UINT64 } from '@src/math/utils/consts.js';
import { beforeEach, describe, expect, test } from 'vitest';

let uint64Simulator: Uint64Simulator;

const setup = () => {
  uint64Simulator = new Uint64Simulator();
};

describe('Uint64', () => {
  beforeEach(setup);

  describe('constants', () => {
    describe('MAX_UINT8', () => {
      test('should return 255', () => {
        expect(uint64Simulator.MAX_UINT8()).toBe(0xffn);
      });
    });

    describe('MAX_UINT16', () => {
      test('should return 65535', () => {
        expect(uint64Simulator.MAX_UINT16()).toBe(0xffffn);
      });
    });

    describe('MAX_UINT32', () => {
      test('should return 4294967295', () => {
        expect(uint64Simulator.MAX_UINT32()).toBe(0xffffffffn);
      });
    });

    describe('MAX_UINT64', () => {
      test('should return 18446744073709551615', () => {
        expect(uint64Simulator.MAX_UINT64()).toBe(0xffffffffffffffffn);
      });
    });
  });

  describe('conversions', () => {
    describe('toBytes', () => {
      test('should convert zero to zero bytes', () => {
        const bytes = uint64Simulator.toBytes(0n);
        expect(bytes).toEqual(new Uint8Array(8).fill(0));
      });

      test('should convert small value correctly', () => {
        const bytes = uint64Simulator.toBytes(123n);
        expect(bytes[0]).toBe(123);
        expect(bytes.slice(1)).toEqual(new Uint8Array(7).fill(0));
      });

      test('should convert MAX_UINT64 to all-0xFF bytes', () => {
        const bytes = uint64Simulator.toBytes(MAX_UINT64);
        expect(bytes).toEqual(new Uint8Array(8).fill(255));
      });

      test('should match outputs between toUnpackedBytes and toBytes', () => {
        const value = 0x0123456789abcdefn;
        const vec = uint64Simulator.toUnpackedBytes(value);
        const bytes = uint64Simulator.toBytes(value);
        for (let i = 0; i < 8; i++) {
          expect(Number(vec[i])).toBe(bytes[i]);
        }
      });

      test('should fail when witness returns Bytes8_toUint64(vec) != value', () => {
        uint64Simulator.overrideWitness(
          'wit_uint64ToUnpackedBytes',
          (context, _value) => [
            context.privateState,
            [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n],
          ],
        );
        expect(() => uint64Simulator.toBytes(123n)).toThrow(
          'failed assert: Uint64: toUnpackedBytes verification failed',
        );
      });
    });

    describe('toUnpackedBytes', () => {
      test('should convert zero to all-zero vector', () => {
        const vec = uint64Simulator.toUnpackedBytes(0n);
        expect(vec).toEqual([0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]);
      });

      test('should convert small value correctly', () => {
        const vec = uint64Simulator.toUnpackedBytes(0x01_02_03n);
        expect(vec[0]).toBe(3n);
        expect(vec[1]).toBe(2n);
        expect(vec[2]).toBe(1n);
        expect(vec.slice(3)).toEqual([0n, 0n, 0n, 0n, 0n]);
      });

      test('should convert MAX_UINT64 to all-0xFF vector', () => {
        const vec = uint64Simulator.toUnpackedBytes(MAX_UINT64);
        expect(vec).toEqual([255n, 255n, 255n, 255n, 255n, 255n, 255n, 255n]);
      });

      test('should place single byte at each position', () => {
        expect(uint64Simulator.toUnpackedBytes(1n)[0]).toBe(1n);
        expect(uint64Simulator.toUnpackedBytes(0x100n)[1]).toBe(1n);
        expect(uint64Simulator.toUnpackedBytes(0x10000n)[2]).toBe(1n);
        expect(uint64Simulator.toUnpackedBytes(0x1000000n)[3]).toBe(1n);
        expect(uint64Simulator.toUnpackedBytes(0x100000000n)[4]).toBe(1n);
        expect(uint64Simulator.toUnpackedBytes(0x10000000000n)[5]).toBe(1n);
        expect(uint64Simulator.toUnpackedBytes(0x1000000000000n)[6]).toBe(1n);
        expect(uint64Simulator.toUnpackedBytes(0x100000000000000n)[7]).toBe(1n);
      });

      test('should fail when witness returns Bytes8_toUint64(vec) != value', () => {
        uint64Simulator.overrideWitness(
          'wit_uint64ToUnpackedBytes',
          (context, _value) => [
            context.privateState,
            [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n],
          ],
        );
        expect(() => uint64Simulator.toUnpackedBytes(123n)).toThrow(
          'failed assert: Uint64: toUnpackedBytes verification failed',
        );
      });
    });
  });

  describe('arithmetic', () => {
    describe('Add', () => {
      test('should add two numbers', () => {
        expect(uint64Simulator.add(5n, 3n)).toBe(8n);
      });

      test('should not overflow', () => {
        expect(uint64Simulator.add(MAX_UINT64, MAX_UINT64)).toBe(
          MAX_UINT64 * 2n,
        );
      });
    });

    describe('AddChecked', () => {
      test('should add two small numbers', () => {
        expect(uint64Simulator.addChecked(5n, 3n)).toBe(8n);
      });

      test('should add zero', () => {
        expect(uint64Simulator.addChecked(5n, 0n)).toBe(5n);
        expect(uint64Simulator.addChecked(0n, 5n)).toBe(5n);
      });

      test('should add at boundary without overflow', () => {
        expect(uint64Simulator.addChecked(MAX_UINT64 - 1n, 1n)).toBe(
          MAX_UINT64,
        );
        expect(uint64Simulator.addChecked(1n, MAX_UINT64 - 1n)).toBe(
          MAX_UINT64,
        );
      });

      test('should fail on overflow', () => {
        expect(() => uint64Simulator.addChecked(MAX_UINT64, 1n)).toThrowError(
          'failed assert: Uint64: addition overflow',
        );
      });

      test('should fail on large overflow', () => {
        expect(() =>
          uint64Simulator.addChecked(MAX_UINT64, MAX_UINT64),
        ).toThrowError('failed assert: Uint64: addition overflow');
      });

      test('should handle half max values without overflow', () => {
        const halfMax = MAX_UINT64 / 2n;
        expect(uint64Simulator.addChecked(halfMax, halfMax)).toBe(halfMax * 2n);
      });
    });

    describe('Sub', () => {
      test('should subtract two numbers', () => {
        expect(uint64Simulator.sub(10n, 4n)).toBe(6n);
      });

      test('should subtract zero', () => {
        expect(uint64Simulator.sub(5n, 0n)).toBe(5n);
        expect(uint64Simulator.sub(0n, 0n)).toBe(0n);
      });

      test('should subtract from zero', () => {
        expect(() => uint64Simulator.sub(0n, 5n)).toThrowError(
          'failed assert: Uint64: subtraction underflow',
        );
      });

      test('should subtract max Uint<64> minus 1', () => {
        expect(uint64Simulator.sub(MAX_UINT64, 1n)).toBe(MAX_UINT64 - 1n);
      });

      test('should subtract max Uint<64> minus itself', () => {
        expect(uint64Simulator.sub(MAX_UINT64, MAX_UINT64)).toBe(0n);
      });

      test('should fail on underflow with small numbers', () => {
        expect(() => uint64Simulator.sub(3n, 5n)).toThrowError(
          'failed assert: Uint64: subtraction underflow',
        );
      });

      test('should fail on underflow with large numbers', () => {
        expect(() =>
          uint64Simulator.sub(MAX_UINT64 - 10n, MAX_UINT64),
        ).toThrowError('failed assert: Uint64: subtraction underflow');
      });
    });

    describe('Mul', () => {
      test('should multiply two numbers', () => {
        expect(uint64Simulator.mul(4n, 3n)).toBe(12n);
      });

      test('should handle max Uint<64> times 1', () => {
        expect(uint64Simulator.mul(MAX_UINT64, 1n)).toBe(MAX_UINT64);
      });

      test('should handle max Uint<64> times max Uint<64> without overflow', () => {
        expect(uint64Simulator.mul(MAX_UINT64, MAX_UINT64)).toBe(
          MAX_UINT64 * MAX_UINT64,
        );
      });
    });

    describe('MulChecked', () => {
      test('should multiply two small numbers', () => {
        expect(uint64Simulator.mulChecked(4n, 3n)).toBe(12n);
      });

      test('should multiply by zero', () => {
        expect(uint64Simulator.mulChecked(5n, 0n)).toBe(0n);
        expect(uint64Simulator.mulChecked(0n, 5n)).toBe(0n);
      });

      test('should multiply by one', () => {
        expect(uint64Simulator.mulChecked(MAX_UINT64, 1n)).toBe(MAX_UINT64);
        expect(uint64Simulator.mulChecked(1n, MAX_UINT64)).toBe(MAX_UINT64);
      });

      test('should multiply at boundary without overflow', () => {
        // sqrt(MAX_UINT64) ≈ 4294967295, so 4294967295 * 4294967295 should be within range
        const sqrtMax = MAX_UINT32;
        expect(uint64Simulator.mulChecked(sqrtMax, sqrtMax)).toBe(
          sqrtMax * sqrtMax,
        );
      });

      test('should fail on overflow', () => {
        expect(() => uint64Simulator.mulChecked(MAX_UINT64, 2n)).toThrowError(
          'failed assert: Uint64: multiplication overflow',
        );
      });

      test('should fail on large overflow', () => {
        expect(() =>
          uint64Simulator.mulChecked(MAX_UINT64, MAX_UINT64),
        ).toThrowError('failed assert: Uint64: multiplication overflow');
      });

      test('should fail when product exceeds MAX_UINT64', () => {
        // MAX_UINT32 + 1 = 2^32, and (2^32)^2 = 2^64 which overflows
        const sqrtMaxPlusOne = MAX_UINT32 + 1n;
        expect(() =>
          uint64Simulator.mulChecked(sqrtMaxPlusOne, sqrtMaxPlusOne),
        ).toThrowError('failed assert: Uint64: multiplication overflow');
      });
    });
  });

  describe('division', () => {
    describe('div', () => {
      test('should divide small numbers', () => {
        expect(uint64Simulator.div(10n, 3n)).toBe(3n);
      });

      test('should handle dividend is zero', () => {
        expect(uint64Simulator.div(0n, 5n)).toBe(0n);
      });

      test('should handle divisor is one', () => {
        expect(uint64Simulator.div(10n, 1n)).toBe(10n);
      });

      test('should handle dividend equals divisor', () => {
        expect(uint64Simulator.div(5n, 5n)).toBe(1n);
      });

      test('should handle dividend less than divisor', () => {
        expect(uint64Simulator.div(3n, 5n)).toBe(0n);
      });

      test('should handle large division', () => {
        expect(uint64Simulator.div(MAX_UINT64, 2n)).toBe(MAX_UINT64 / 2n);
      });

      test('should fail on division by zero', () => {
        expect(() => uint64Simulator.div(5n, 0n)).toThrowError(
          'failed assert: Uint64: division by zero',
        );
      });

      test('should fail when remainder >= divisor', () => {
        uint64Simulator.overrideWitness('wit_divUint64', (context) => [
          context.privateState,
          { quotient: 1n, remainder: 10n },
        ]);
        expect(() => uint64Simulator.div(10n, 5n)).toThrow(
          'failed assert: Uint64: remainder error',
        );
      });

      test('should fail when quotient * b + remainder != a', () => {
        uint64Simulator.overrideWitness('wit_divUint64', (context) => [
          context.privateState,
          { quotient: 1n, remainder: 1n },
        ]);
        expect(() => uint64Simulator.div(10n, 5n)).toThrow(
          'failed assert: Uint64: division invalid',
        );
      });
    });

    describe('rem', () => {
      test('should compute remainder of small numbers', () => {
        expect(uint64Simulator.rem(10n, 3n)).toBe(1n);
      });

      test('should handle dividend is zero', () => {
        expect(uint64Simulator.rem(0n, 5n)).toBe(0n);
      });

      test('should handle divisor is one', () => {
        expect(uint64Simulator.rem(10n, 1n)).toBe(0n);
      });

      test('should handle dividend equals divisor', () => {
        expect(uint64Simulator.rem(5n, 5n)).toBe(0n);
      });

      test('should handle dividend less than divisor', () => {
        expect(uint64Simulator.rem(3n, 5n)).toBe(3n);
      });

      test('should compute remainder of max U64 by 2', () => {
        expect(uint64Simulator.rem(MAX_UINT64, 2n)).toBe(1n);
      });

      test('should handle zero remainder', () => {
        expect(uint64Simulator.rem(6n, 3n)).toBe(0n);
      });

      test('should fail on division by zero', () => {
        expect(() => uint64Simulator.rem(5n, 0n)).toThrowError(
          'failed assert: Uint64: division by zero',
        );
      });

      test('should fail when remainder >= divisor', () => {
        uint64Simulator.overrideWitness('wit_divUint64', (context) => [
          context.privateState,
          { quotient: 1n, remainder: 5n },
        ]);
        expect(() => uint64Simulator.rem(10n, 5n)).toThrow(
          'failed assert: Uint64: remainder error',
        );
      });

      test('should fail when quotient * b + remainder != a', () => {
        uint64Simulator.overrideWitness('wit_divUint64', (context) => [
          context.privateState,
          { quotient: 0n, remainder: 2n },
        ]);
        expect(() => uint64Simulator.rem(10n, 5n)).toThrow(
          'failed assert: Uint64: division invalid',
        );
      });
    });

    describe('divRem', () => {
      test('should compute quotient and remainder of small numbers', () => {
        const result = uint64Simulator.divRem(10n, 3n);
        expect(result.quotient).toBe(3n);
        expect(result.remainder).toBe(1n);
      });

      test('should handle dividend is zero', () => {
        const result = uint64Simulator.divRem(0n, 5n);
        expect(result.quotient).toBe(0n);
        expect(result.remainder).toBe(0n);
      });

      test('should handle divisor is one', () => {
        const result = uint64Simulator.divRem(10n, 1n);
        expect(result.quotient).toBe(10n);
        expect(result.remainder).toBe(0n);
      });

      test('should handle dividend equals divisor', () => {
        const result = uint64Simulator.divRem(5n, 5n);
        expect(result.quotient).toBe(1n);
        expect(result.remainder).toBe(0n);
      });

      test('should handle dividend less than divisor', () => {
        const result = uint64Simulator.divRem(3n, 5n);
        expect(result.quotient).toBe(0n);
        expect(result.remainder).toBe(3n);
      });

      test('should compute quotient and remainder of max U64 by 2', () => {
        const result = uint64Simulator.divRem(MAX_UINT64, 2n);
        expect(result.quotient).toBe(MAX_UINT64 / 2n);
        expect(result.remainder).toBe(1n);
      });

      test('should handle zero remainder', () => {
        const result = uint64Simulator.divRem(6n, 3n);
        expect(result.quotient).toBe(2n);
        expect(result.remainder).toBe(0n);
      });

      test('should fail on division by zero', () => {
        expect(() => uint64Simulator.divRem(5n, 0n)).toThrowError(
          'failed assert: Uint64: division by zero',
        );
      });

      test('should fail when remainder >= divisor', () => {
        uint64Simulator.overrideWitness('wit_divUint64', (context) => [
          context.privateState,
          { quotient: 1n, remainder: 5n },
        ]);
        expect(() => uint64Simulator.divRem(10n, 5n)).toThrow(
          'failed assert: Uint64: remainder error',
        );
      });

      test('should fail when quotient * b + remainder != a', () => {
        uint64Simulator.overrideWitness('wit_divUint64', (context) => [
          context.privateState,
          { quotient: 2n, remainder: 0n },
        ]);
        expect(() => uint64Simulator.divRem(11n, 5n)).toThrow(
          'failed assert: Uint64: division invalid',
        ); // 2*5 + 0 = 10 ≠ 11
      });

      test('should fail when remainder >= divisor (duplicate)', () => {
        uint64Simulator.overrideWitness('wit_divUint64', (context) => [
          context.privateState,
          { quotient: 1n, remainder: 10n },
        ]);
        expect(() => uint64Simulator.divRem(10n, 5n)).toThrow(
          'failed assert: Uint64: remainder error',
        );
      });
    });
  });

  describe('square root', () => {
    describe('Sqrt', () => {
      test('should compute square root of small perfect squares', () => {
        expect(uint64Simulator.sqrt(4n)).toBe(2n);
        expect(uint64Simulator.sqrt(9n)).toBe(3n);
        expect(uint64Simulator.sqrt(16n)).toBe(4n);
        expect(uint64Simulator.sqrt(25n)).toBe(5n);
        expect(uint64Simulator.sqrt(100n)).toBe(10n);
      });

      test('should compute square root of small imperfect squares', () => {
        expect(uint64Simulator.sqrt(2n)).toBe(1n); // floor(sqrt(2)) ≈ 1.414
        expect(uint64Simulator.sqrt(3n)).toBe(1n); // floor(sqrt(3)) ≈ 1.732
        expect(uint64Simulator.sqrt(5n)).toBe(2n); // floor(sqrt(5)) ≈ 2.236
        expect(uint64Simulator.sqrt(8n)).toBe(2n); // floor(sqrt(8)) ≈ 2.828
        expect(uint64Simulator.sqrt(99n)).toBe(9n); // floor(sqrt(99)) ≈ 9.95
      });

      test('should compute square root of large perfect squares', () => {
        expect(uint64Simulator.sqrt(10000n)).toBe(100n);
        expect(uint64Simulator.sqrt(1000000n)).toBe(1000n);
        expect(uint64Simulator.sqrt(100000000n)).toBe(10000n);
      });

      test('should compute square root of large imperfect squares', () => {
        expect(uint64Simulator.sqrt(101n)).toBe(10n); // floor(sqrt(101)) ≈ 10.05
        expect(uint64Simulator.sqrt(999999n)).toBe(999n); // floor(sqrt(999999)) ≈ 999.9995
        expect(uint64Simulator.sqrt(100000001n)).toBe(10000n); // floor(sqrt(100000001)) ≈ 10000.00005
      });

      test('should handle powers of 2', () => {
        expect(uint64Simulator.sqrt(2n ** 32n)).toBe(65536n); // sqrt(2^32) = 2^16
        expect(uint64Simulator.sqrt(MAX_UINT64)).toBe(4294967295n); // sqrt(2^64 - 1) ≈ 2^32 - 1
      });

      test('should fail if number exceeds MAX_64', () => {
        expect(() => uint64Simulator.sqrt(MAX_UINT64 + 1n)).toThrow(
          'expected value of type Uint<0..18446744073709551616> but received 18446744073709551616',
        );
      });

      test('should handle zero', () => {
        expect(uint64Simulator.sqrt(0n)).toBe(0n);
      });

      test('should handle 1', () => {
        expect(uint64Simulator.sqrt(1n)).toBe(1n);
      });

      test('should handle max Uint<64>', () => {
        expect(uint64Simulator.sqrt(MAX_UINT64)).toBe(MAX_UINT32); // floor(sqrt(2^64 - 1)) = 2^32 - 1
      });

      test('should fail with overestimated root', () => {
        uint64Simulator.overrideWitness('wit_sqrtUint64', (context) => [
          context.privateState,
          5n,
        ]);
        expect(() => uint64Simulator.sqrt(10n)).toThrow(
          'failed assert: Uint64: sqrt overestimate',
        );
      });

      test('should fail with underestimated root', () => {
        uint64Simulator.overrideWitness('wit_sqrtUint64', (context) => [
          context.privateState,
          3n,
        ]);
        expect(() => uint64Simulator.sqrt(16n)).toThrow(
          'failed assert: Uint64: sqrt underestimate',
        );
      });
    });
  });

  describe('utilities', () => {
    describe('IsMultiple', () => {
      test('should check if multiple', () => {
        expect(uint64Simulator.isMultiple(6n, 3n)).toBe(true);
      });

      test('should fail on zero divisor', () => {
        expect(() => uint64Simulator.isMultiple(5n, 0n)).toThrowError(
          'failed assert: Uint64: division by zero',
        );
      });

      test('should check max Uint<64> is multiple of 1', () => {
        expect(uint64Simulator.isMultiple(MAX_UINT64, 1n)).toBe(true);
      });

      test('should detect a failed case', () => {
        expect(uint64Simulator.isMultiple(7n, 3n)).toBe(false);
      });

      test('should fail when witness returns quotient * b + remainder != a', () => {
        uint64Simulator.overrideWitness('wit_divUint64', (context) => [
          context.privateState,
          { quotient: 1n, remainder: 1n },
        ]);
        expect(() => uint64Simulator.isMultiple(6n, 3n)).toThrow(
          'failed assert: Uint64: division invalid',
        );
      });
    });

    describe('Min', () => {
      test('should return minimum', () => {
        expect(uint64Simulator.min(5n, 3n)).toBe(3n);
      });

      test('should handle equal values', () => {
        expect(uint64Simulator.min(4n, 4n)).toBe(4n);
      });

      test('should handle max Uint<64> and smaller value', () => {
        expect(uint64Simulator.min(MAX_UINT64, 1n)).toBe(1n);
      });
    });

    describe('Max', () => {
      test('should return maximum', () => {
        expect(uint64Simulator.max(5n, 3n)).toBe(5n);
      });

      test('should handle equal values', () => {
        expect(uint64Simulator.max(4n, 4n)).toBe(4n);
      });

      test('should handle max Uint<64> and smaller value', () => {
        expect(uint64Simulator.max(MAX_UINT64, 1n)).toBe(MAX_UINT64);
      });
    });
  });
});
