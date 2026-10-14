import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { expectRejection } from '#test-utils/assertions/rejection.js';
import { Uint64Simulator } from './simulators/Uint64Simulator.js';
import { MAX_UINT32, MAX_UINT64 } from './utils/consts.js';

let uint64Simulator: Uint64Simulator;

// Witnesses bind at deploy on a live node, so a test that swaps one with
// `overrideWitness` is dry-only.
const testDryOnly = test.skipIf(isLiveBackend());

const setup = async () => {
  uint64Simulator = await Uint64Simulator.create();
};

describe('Uint64', () => {
  // The mock keeps no state that a test reads. A live run deploys it once per
  // file, because each deploy is a transaction. A dry run creates it again for
  // each test, because `overrideWitness` changes the instance.
  if (isLiveBackend()) {
    beforeAll(setup);
  } else {
    beforeEach(setup);
  }

  describe('constants', () => {
    describe('MAX_UINT8', () => {
      test('should return 255', async () => {
        expect(await uint64Simulator.MAX_UINT8()).toBe(0xffn);
      });
    });

    describe('MAX_UINT16', () => {
      test('should return 65535', async () => {
        expect(await uint64Simulator.MAX_UINT16()).toBe(0xffffn);
      });
    });

    describe('MAX_UINT32', () => {
      test('should return 4294967295', async () => {
        expect(await uint64Simulator.MAX_UINT32()).toBe(0xffffffffn);
      });
    });

    describe('MAX_UINT64', () => {
      test('should return 18446744073709551615', async () => {
        expect(await uint64Simulator.MAX_UINT64()).toBe(0xffffffffffffffffn);
      });
    });
  });

  describe('conversions', () => {
    describe('toBytes', () => {
      test('should convert zero to zero bytes', async () => {
        const bytes = await uint64Simulator.toBytes(0n);
        expect(bytes).toEqual(new Uint8Array(8).fill(0));
      });

      test('should convert small value correctly', async () => {
        const bytes = await uint64Simulator.toBytes(123n);
        expect(bytes[0]).toBe(123);
        expect(bytes.slice(1)).toEqual(new Uint8Array(7).fill(0));
      });

      test('should convert MAX_UINT64 to all-0xFF bytes', async () => {
        const bytes = await uint64Simulator.toBytes(MAX_UINT64);
        expect(bytes).toEqual(new Uint8Array(8).fill(255));
      });

      test('should match outputs between toUnpackedBytes and toBytes', async () => {
        const value = 0x0123456789abcdefn;
        const vec = await uint64Simulator.toUnpackedBytes(value);
        const bytes = await uint64Simulator.toBytes(value);
        for (let i = 0; i < 8; i++) {
          expect(Number(vec[i])).toBe(bytes[i]);
        }
      });

      testDryOnly(
        'should fail when witness returns Bytes8_toUint64(vec) != value',
        async () => {
          uint64Simulator.overrideWitness(
            'wit_uint64ToUnpackedBytes',
            (context, _value) => [
              context.privateState,
              [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n],
            ],
          );
          await expectRejection(
            uint64Simulator.toBytes(123n),
            'failed assert: Uint64: toUnpackedBytes verification failed',
          );
        },
      );
    });

    describe('toUnpackedBytes', () => {
      test('should convert zero to all-zero vector', async () => {
        const vec = await uint64Simulator.toUnpackedBytes(0n);
        expect(vec).toEqual([0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]);
      });

      test('should convert small value correctly', async () => {
        const vec = await uint64Simulator.toUnpackedBytes(0x01_02_03n);
        expect(vec[0]).toBe(3n);
        expect(vec[1]).toBe(2n);
        expect(vec[2]).toBe(1n);
        expect(vec.slice(3)).toEqual([0n, 0n, 0n, 0n, 0n]);
      });

      test('should convert MAX_UINT64 to all-0xFF vector', async () => {
        const vec = await uint64Simulator.toUnpackedBytes(MAX_UINT64);
        expect(vec).toEqual([255n, 255n, 255n, 255n, 255n, 255n, 255n, 255n]);
      });

      test('should place single byte at each position', async () => {
        expect((await uint64Simulator.toUnpackedBytes(1n))[0]).toBe(1n);
        expect((await uint64Simulator.toUnpackedBytes(0x100n))[1]).toBe(1n);
        expect((await uint64Simulator.toUnpackedBytes(0x10000n))[2]).toBe(1n);
        expect((await uint64Simulator.toUnpackedBytes(0x1000000n))[3]).toBe(1n);
        expect((await uint64Simulator.toUnpackedBytes(0x100000000n))[4]).toBe(
          1n,
        );
        expect((await uint64Simulator.toUnpackedBytes(0x10000000000n))[5]).toBe(
          1n,
        );
        expect(
          (await uint64Simulator.toUnpackedBytes(0x1000000000000n))[6],
        ).toBe(1n);
        expect(
          (await uint64Simulator.toUnpackedBytes(0x100000000000000n))[7],
        ).toBe(1n);
      });

      testDryOnly(
        'should fail when witness returns Bytes8_toUint64(vec) != value',
        async () => {
          uint64Simulator.overrideWitness(
            'wit_uint64ToUnpackedBytes',
            (context, _value) => [
              context.privateState,
              [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n],
            ],
          );
          await expectRejection(
            uint64Simulator.toUnpackedBytes(123n),
            'failed assert: Uint64: toUnpackedBytes verification failed',
          );
        },
      );
    });
  });

  describe('arithmetic', () => {
    describe('Add', () => {
      test('should add two numbers', async () => {
        expect(await uint64Simulator.add(5n, 3n)).toBe(8n);
      });

      test('should not overflow', async () => {
        expect(await uint64Simulator.add(MAX_UINT64, MAX_UINT64)).toBe(
          MAX_UINT64 * 2n,
        );
      });
    });

    describe('AddChecked', () => {
      test('should add two small numbers', async () => {
        expect(await uint64Simulator.addChecked(5n, 3n)).toBe(8n);
      });

      test('should add zero', async () => {
        expect(await uint64Simulator.addChecked(5n, 0n)).toBe(5n);
        expect(await uint64Simulator.addChecked(0n, 5n)).toBe(5n);
      });

      test('should add at boundary without overflow', async () => {
        expect(await uint64Simulator.addChecked(MAX_UINT64 - 1n, 1n)).toBe(
          MAX_UINT64,
        );
        expect(await uint64Simulator.addChecked(1n, MAX_UINT64 - 1n)).toBe(
          MAX_UINT64,
        );
      });

      test('should fail on overflow', async () => {
        await expectRejection(
          uint64Simulator.addChecked(MAX_UINT64, 1n),
          'failed assert: Uint64: addition overflow',
        );
      });

      test('should fail on large overflow', async () => {
        await expectRejection(
          uint64Simulator.addChecked(MAX_UINT64, MAX_UINT64),
          'failed assert: Uint64: addition overflow',
        );
      });

      test('should handle half max values without overflow', async () => {
        const halfMax = MAX_UINT64 / 2n;
        expect(await uint64Simulator.addChecked(halfMax, halfMax)).toBe(
          halfMax * 2n,
        );
      });
    });

    describe('Sub', () => {
      test('should subtract two numbers', async () => {
        expect(await uint64Simulator.sub(10n, 4n)).toBe(6n);
      });

      test('should subtract zero', async () => {
        expect(await uint64Simulator.sub(5n, 0n)).toBe(5n);
        expect(await uint64Simulator.sub(0n, 0n)).toBe(0n);
      });

      test('should subtract from zero', async () => {
        await expectRejection(
          uint64Simulator.sub(0n, 5n),
          'failed assert: Uint64: subtraction underflow',
        );
      });

      test('should subtract max Uint<64> minus 1', async () => {
        expect(await uint64Simulator.sub(MAX_UINT64, 1n)).toBe(MAX_UINT64 - 1n);
      });

      test('should subtract max Uint<64> minus itself', async () => {
        expect(await uint64Simulator.sub(MAX_UINT64, MAX_UINT64)).toBe(0n);
      });

      test('should fail on underflow with small numbers', async () => {
        await expectRejection(
          uint64Simulator.sub(3n, 5n),
          'failed assert: Uint64: subtraction underflow',
        );
      });

      test('should fail on underflow with large numbers', async () => {
        await expectRejection(
          uint64Simulator.sub(MAX_UINT64 - 10n, MAX_UINT64),
          'failed assert: Uint64: subtraction underflow',
        );
      });
    });

    describe('Mul', () => {
      test('should multiply two numbers', async () => {
        expect(await uint64Simulator.mul(4n, 3n)).toBe(12n);
      });

      test('should handle max Uint<64> times 1', async () => {
        expect(await uint64Simulator.mul(MAX_UINT64, 1n)).toBe(MAX_UINT64);
      });

      test('should handle max Uint<64> times max Uint<64> without overflow', async () => {
        expect(await uint64Simulator.mul(MAX_UINT64, MAX_UINT64)).toBe(
          MAX_UINT64 * MAX_UINT64,
        );
      });
    });

    describe('MulChecked', () => {
      test('should multiply two small numbers', async () => {
        expect(await uint64Simulator.mulChecked(4n, 3n)).toBe(12n);
      });

      test('should multiply by zero', async () => {
        expect(await uint64Simulator.mulChecked(5n, 0n)).toBe(0n);
        expect(await uint64Simulator.mulChecked(0n, 5n)).toBe(0n);
      });

      test('should multiply by one', async () => {
        expect(await uint64Simulator.mulChecked(MAX_UINT64, 1n)).toBe(
          MAX_UINT64,
        );
        expect(await uint64Simulator.mulChecked(1n, MAX_UINT64)).toBe(
          MAX_UINT64,
        );
      });

      test('should multiply at boundary without overflow', async () => {
        // sqrt(MAX_UINT64) ≈ 4294967295, so 4294967295 * 4294967295 should be within range
        const sqrtMax = MAX_UINT32;
        expect(await uint64Simulator.mulChecked(sqrtMax, sqrtMax)).toBe(
          sqrtMax * sqrtMax,
        );
      });

      test('should fail on overflow', async () => {
        await expectRejection(
          uint64Simulator.mulChecked(MAX_UINT64, 2n),
          'failed assert: Uint64: multiplication overflow',
        );
      });

      test('should fail on large overflow', async () => {
        await expectRejection(
          uint64Simulator.mulChecked(MAX_UINT64, MAX_UINT64),
          'failed assert: Uint64: multiplication overflow',
        );
      });

      test('should fail when product exceeds MAX_UINT64', async () => {
        // MAX_UINT32 + 1 = 2^32, and (2^32)^2 = 2^64 which overflows
        const sqrtMaxPlusOne = MAX_UINT32 + 1n;
        await expectRejection(
          uint64Simulator.mulChecked(sqrtMaxPlusOne, sqrtMaxPlusOne),
          'failed assert: Uint64: multiplication overflow',
        );
      });
    });
  });

  describe('division', () => {
    describe('div', () => {
      test('should divide small numbers', async () => {
        expect(await uint64Simulator.div(10n, 3n)).toBe(3n);
      });

      test('should handle dividend is zero', async () => {
        expect(await uint64Simulator.div(0n, 5n)).toBe(0n);
      });

      test('should handle divisor is one', async () => {
        expect(await uint64Simulator.div(10n, 1n)).toBe(10n);
      });

      test('should handle dividend equals divisor', async () => {
        expect(await uint64Simulator.div(5n, 5n)).toBe(1n);
      });

      test('should handle dividend less than divisor', async () => {
        expect(await uint64Simulator.div(3n, 5n)).toBe(0n);
      });

      test('should handle large division', async () => {
        expect(await uint64Simulator.div(MAX_UINT64, 2n)).toBe(MAX_UINT64 / 2n);
      });

      test('should fail on division by zero', async () => {
        await expectRejection(
          uint64Simulator.div(5n, 0n),
          'failed assert: Uint64: division by zero',
        );
      });

      testDryOnly('should fail when remainder >= divisor', async () => {
        uint64Simulator.overrideWitness('wit_divUint64', (context) => [
          context.privateState,
          { quotient: 1n, remainder: 10n },
        ]);
        await expectRejection(
          uint64Simulator.div(10n, 5n),
          'failed assert: Uint64: remainder error',
        );
      });

      testDryOnly(
        'should fail when quotient * b + remainder != a',
        async () => {
          uint64Simulator.overrideWitness('wit_divUint64', (context) => [
            context.privateState,
            { quotient: 1n, remainder: 1n },
          ]);
          await expectRejection(
            uint64Simulator.div(10n, 5n),
            'failed assert: Uint64: division invalid',
          );
        },
      );

      testDryOnly(
        'should fail with "division invalid" when quotient * b + remainder exceeds MAX_UINT64',
        async () => {
          // q * b + r = 2^63 * 4 + 2 = 2^65 + 2 does not fit in Uint<64>. The
          // remainder check passes (2 < 4), so the sum check must reject it.
          uint64Simulator.overrideWitness('wit_divUint64', (context) => [
            context.privateState,
            { quotient: 2n ** 63n, remainder: 2n },
          ]);
          await expectRejection(
            uint64Simulator.div(10n, 4n),
            'failed assert: Uint64: division invalid',
          );
        },
      );
    });

    describe('rem', () => {
      test('should compute remainder of small numbers', async () => {
        expect(await uint64Simulator.rem(10n, 3n)).toBe(1n);
      });

      test('should handle dividend is zero', async () => {
        expect(await uint64Simulator.rem(0n, 5n)).toBe(0n);
      });

      test('should handle divisor is one', async () => {
        expect(await uint64Simulator.rem(10n, 1n)).toBe(0n);
      });

      test('should handle dividend equals divisor', async () => {
        expect(await uint64Simulator.rem(5n, 5n)).toBe(0n);
      });

      test('should handle dividend less than divisor', async () => {
        expect(await uint64Simulator.rem(3n, 5n)).toBe(3n);
      });

      test('should compute remainder of max U64 by 2', async () => {
        expect(await uint64Simulator.rem(MAX_UINT64, 2n)).toBe(1n);
      });

      test('should handle zero remainder', async () => {
        expect(await uint64Simulator.rem(6n, 3n)).toBe(0n);
      });

      test('should fail on division by zero', async () => {
        await expectRejection(
          uint64Simulator.rem(5n, 0n),
          'failed assert: Uint64: division by zero',
        );
      });

      testDryOnly('should fail when remainder >= divisor', async () => {
        uint64Simulator.overrideWitness('wit_divUint64', (context) => [
          context.privateState,
          { quotient: 1n, remainder: 5n },
        ]);
        await expectRejection(
          uint64Simulator.rem(10n, 5n),
          'failed assert: Uint64: remainder error',
        );
      });

      testDryOnly(
        'should fail when quotient * b + remainder != a',
        async () => {
          uint64Simulator.overrideWitness('wit_divUint64', (context) => [
            context.privateState,
            { quotient: 0n, remainder: 2n },
          ]);
          await expectRejection(
            uint64Simulator.rem(10n, 5n),
            'failed assert: Uint64: division invalid',
          );
        },
      );
    });

    describe('divRem', () => {
      test('should compute quotient and remainder of small numbers', async () => {
        const result = await uint64Simulator.divRem(10n, 3n);
        expect(result.quotient).toBe(3n);
        expect(result.remainder).toBe(1n);
      });

      test('should handle dividend is zero', async () => {
        const result = await uint64Simulator.divRem(0n, 5n);
        expect(result.quotient).toBe(0n);
        expect(result.remainder).toBe(0n);
      });

      test('should handle divisor is one', async () => {
        const result = await uint64Simulator.divRem(10n, 1n);
        expect(result.quotient).toBe(10n);
        expect(result.remainder).toBe(0n);
      });

      test('should handle dividend equals divisor', async () => {
        const result = await uint64Simulator.divRem(5n, 5n);
        expect(result.quotient).toBe(1n);
        expect(result.remainder).toBe(0n);
      });

      test('should handle dividend less than divisor', async () => {
        const result = await uint64Simulator.divRem(3n, 5n);
        expect(result.quotient).toBe(0n);
        expect(result.remainder).toBe(3n);
      });

      test('should compute quotient and remainder of max U64 by 2', async () => {
        const result = await uint64Simulator.divRem(MAX_UINT64, 2n);
        expect(result.quotient).toBe(MAX_UINT64 / 2n);
        expect(result.remainder).toBe(1n);
      });

      test('should handle zero remainder', async () => {
        const result = await uint64Simulator.divRem(6n, 3n);
        expect(result.quotient).toBe(2n);
        expect(result.remainder).toBe(0n);
      });

      test('should fail on division by zero', async () => {
        await expectRejection(
          uint64Simulator.divRem(5n, 0n),
          'failed assert: Uint64: division by zero',
        );
      });

      testDryOnly('should fail when remainder >= divisor', async () => {
        uint64Simulator.overrideWitness('wit_divUint64', (context) => [
          context.privateState,
          { quotient: 1n, remainder: 5n },
        ]);
        await expectRejection(
          uint64Simulator.divRem(10n, 5n),
          'failed assert: Uint64: remainder error',
        );
      });

      testDryOnly(
        'should fail when quotient * b + remainder != a',
        async () => {
          uint64Simulator.overrideWitness('wit_divUint64', (context) => [
            context.privateState,
            { quotient: 2n, remainder: 0n },
          ]);
          await expectRejection(
            uint64Simulator.divRem(11n, 5n),
            'failed assert: Uint64: division invalid',
          ); // 2*5 + 0 = 10 ≠ 11
        },
      );

      testDryOnly(
        'should fail when remainder >= divisor (duplicate)',
        async () => {
          uint64Simulator.overrideWitness('wit_divUint64', (context) => [
            context.privateState,
            { quotient: 1n, remainder: 10n },
          ]);
          await expectRejection(
            uint64Simulator.divRem(10n, 5n),
            'failed assert: Uint64: remainder error',
          );
        },
      );
    });
  });

  describe('square root', () => {
    describe('Sqrt', () => {
      test('should compute square root of small perfect squares', async () => {
        expect(await uint64Simulator.sqrt(4n)).toBe(2n);
        expect(await uint64Simulator.sqrt(9n)).toBe(3n);
        expect(await uint64Simulator.sqrt(16n)).toBe(4n);
        expect(await uint64Simulator.sqrt(25n)).toBe(5n);
        expect(await uint64Simulator.sqrt(100n)).toBe(10n);
      });

      test('should compute square root of small imperfect squares', async () => {
        expect(await uint64Simulator.sqrt(2n)).toBe(1n); // floor(sqrt(2)) ≈ 1.414
        expect(await uint64Simulator.sqrt(3n)).toBe(1n); // floor(sqrt(3)) ≈ 1.732
        expect(await uint64Simulator.sqrt(5n)).toBe(2n); // floor(sqrt(5)) ≈ 2.236
        expect(await uint64Simulator.sqrt(8n)).toBe(2n); // floor(sqrt(8)) ≈ 2.828
        expect(await uint64Simulator.sqrt(99n)).toBe(9n); // floor(sqrt(99)) ≈ 9.95
      });

      test('should compute square root of large perfect squares', async () => {
        expect(await uint64Simulator.sqrt(10000n)).toBe(100n);
        expect(await uint64Simulator.sqrt(1000000n)).toBe(1000n);
        expect(await uint64Simulator.sqrt(100000000n)).toBe(10000n);
      });

      test('should compute square root of large imperfect squares', async () => {
        expect(await uint64Simulator.sqrt(101n)).toBe(10n); // floor(sqrt(101)) ≈ 10.05
        expect(await uint64Simulator.sqrt(999999n)).toBe(999n); // floor(sqrt(999999)) ≈ 999.9995
        expect(await uint64Simulator.sqrt(100000001n)).toBe(10000n); // floor(sqrt(100000001)) ≈ 10000.00005
      });

      test('should handle powers of 2', async () => {
        expect(await uint64Simulator.sqrt(2n ** 32n)).toBe(65536n); // sqrt(2^32) = 2^16
        expect(await uint64Simulator.sqrt(MAX_UINT64)).toBe(4294967295n); // sqrt(2^64 - 1) ≈ 2^32 - 1
      });

      test('should fail if number exceeds MAX_64', async () => {
        await expectRejection(
          uint64Simulator.sqrt(MAX_UINT64 + 1n),
          'expected value of type Uint<0..18446744073709551616> but received 18446744073709551616n',
        );
      });

      test('should handle zero', async () => {
        expect(await uint64Simulator.sqrt(0n)).toBe(0n);
      });

      test('should handle 1', async () => {
        expect(await uint64Simulator.sqrt(1n)).toBe(1n);
      });

      test('should handle max Uint<64>', async () => {
        expect(await uint64Simulator.sqrt(MAX_UINT64)).toBe(MAX_UINT32); // floor(sqrt(2^64 - 1)) = 2^32 - 1
      });

      testDryOnly('should fail with overestimated root', async () => {
        uint64Simulator.overrideWitness('wit_sqrtUint64', (context) => [
          context.privateState,
          5n,
        ]);
        await expectRejection(
          uint64Simulator.sqrt(10n),
          'failed assert: Uint64: sqrt overestimate',
        );
      });

      testDryOnly('should fail with underestimated root', async () => {
        uint64Simulator.overrideWitness('wit_sqrtUint64', (context) => [
          context.privateState,
          3n,
        ]);
        await expectRejection(
          uint64Simulator.sqrt(16n),
          'failed assert: Uint64: sqrt underestimate',
        );
      });
    });
  });

  describe('utilities', () => {
    describe('IsMultiple', () => {
      test('should check if multiple', async () => {
        expect(await uint64Simulator.isMultiple(6n, 3n)).toBe(true);
      });

      test('should fail on zero divisor', async () => {
        await expectRejection(
          uint64Simulator.isMultiple(5n, 0n),
          'failed assert: Uint64: division by zero',
        );
      });

      test('should check max Uint<64> is multiple of 1', async () => {
        expect(await uint64Simulator.isMultiple(MAX_UINT64, 1n)).toBe(true);
      });

      test('should detect a failed case', async () => {
        expect(await uint64Simulator.isMultiple(7n, 3n)).toBe(false);
      });

      testDryOnly(
        'should fail when witness returns quotient * b + remainder != a',
        async () => {
          uint64Simulator.overrideWitness('wit_divUint64', (context) => [
            context.privateState,
            { quotient: 1n, remainder: 1n },
          ]);
          await expectRejection(
            uint64Simulator.isMultiple(6n, 3n),
            'failed assert: Uint64: division invalid',
          );
        },
      );
    });

    describe('Min', () => {
      test('should return minimum', async () => {
        expect(await uint64Simulator.min(5n, 3n)).toBe(3n);
      });

      test('should handle equal values', async () => {
        expect(await uint64Simulator.min(4n, 4n)).toBe(4n);
      });

      test('should handle max Uint<64> and smaller value', async () => {
        expect(await uint64Simulator.min(MAX_UINT64, 1n)).toBe(1n);
      });
    });

    describe('Max', () => {
      test('should return maximum', async () => {
        expect(await uint64Simulator.max(5n, 3n)).toBe(5n);
      });

      test('should handle equal values', async () => {
        expect(await uint64Simulator.max(4n, 4n)).toBe(4n);
      });

      test('should handle max Uint<64> and smaller value', async () => {
        expect(await uint64Simulator.max(MAX_UINT64, 1n)).toBe(MAX_UINT64);
      });
    });
  });
});
