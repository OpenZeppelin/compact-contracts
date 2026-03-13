import { Bytes8Simulator } from '@src/math/test/mocks/Bytes8Simulator.js';
import { MAX_UINT64 } from '@src/math/utils/consts.js';
import { beforeEach, describe, expect, test } from 'vitest';

let bytes8Simulator: Bytes8Simulator;

const setup = () => {
  bytes8Simulator = new Bytes8Simulator();
};

type Bytes8 = [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

const bytes = (...values: number[]): Bytes8 => {
  const a = [...values];
  while (a.length < 8) a.push(0);
  return a.map((x) => BigInt(x)) as Bytes8;
};

describe('Bytes8', () => {
  beforeEach(setup);

  describe('conversions', () => {
    describe('pack', () => {
      test('should convert zero vector to zero bytes', () => {
        const result = bytes8Simulator.pack(bytes(0, 0, 0, 0, 0, 0, 0, 0));
        expect(result).toEqual(new Uint8Array(8).fill(0));
      });

      test('should match vector elements as bytes', () => {
        const v = bytes(1, 2, 3, 4, 5, 6, 7, 8);
        const result = bytes8Simulator.pack(v);
        expect(result.length).toBe(8);
        for (let i = 0; i < 8; i++) {
          expect(result[i]).toBe(Number(v[i]));
        }
      });

      test('should roundtrip with vectorToUint64', () => {
        const v = bytes(0xef, 0xcd, 0xab, 0x89, 0x67, 0x45, 0x23, 0x01);
        const asU64 = bytes8Simulator.vectorToUint64(v);
        const backBytes = bytes8Simulator.pack(v);
        expect(asU64).toBe(0x0123456789abcdefn);
        const fromBack = Array.from(backBytes).reduce(
          (acc, b, i) => acc + (BigInt(b) << (8n * BigInt(i))),
          0n,
        );
        expect(fromBack).toBe(asU64);
      });
    });

    describe('unpack', () => {
      test('should unpack bytes to vector matching pack roundtrip', () => {
        const v = bytes(0xef, 0xcd, 0xab, 0x89, 0x67, 0x45, 0x23, 0x01);
        const packed = bytes8Simulator.pack(v);
        const unpacked = bytes8Simulator.unpack(packed);
        expect(unpacked).toEqual(v);
      });

      test('should unpack zero bytes to zero vector', () => {
        const packed = new Uint8Array(8).fill(0);
        const unpacked = bytes8Simulator.unpack(packed);
        expect(unpacked).toEqual(bytes(0, 0, 0, 0, 0, 0, 0, 0));
      });

      test('should fail when witness returns pack(vec) != bytes', () => {
        bytes8Simulator.overrideWitness(
          'wit_unpackBytes',
          (context, _bytes) => [
            context.privateState,
            bytes(0, 0, 0, 0, 0, 0, 0, 0),
          ],
        );
        const packed = new Uint8Array(8);
        packed[0] = 1;
        expect(() => bytes8Simulator.unpack(packed)).toThrow(
          'failed assert: Pack: unpack verification failed',
        );
      });
    });

    describe('vectorToUint64', () => {
      test('should convert zero bytes to zero', () => {
        expect(
          bytes8Simulator.vectorToUint64(bytes(0, 0, 0, 0, 0, 0, 0, 0)),
        ).toBe(0n);
      });

      test('should place single byte at b0', () => {
        expect(bytes8Simulator.vectorToUint64(bytes(0xab))).toBe(0xabn);
      });

      test('should place single byte at b1 through b7', () => {
        expect(bytes8Simulator.vectorToUint64(bytes(0, 1))).toBe(0x100n);
        expect(bytes8Simulator.vectorToUint64(bytes(0, 0, 1))).toBe(0x10000n);
        expect(bytes8Simulator.vectorToUint64(bytes(0, 0, 0, 1))).toBe(
          0x1000000n,
        );
        expect(bytes8Simulator.vectorToUint64(bytes(0, 0, 0, 0, 1))).toBe(
          0x100000000n,
        );
        expect(bytes8Simulator.vectorToUint64(bytes(0, 0, 0, 0, 0, 1))).toBe(
          0x10000000000n,
        );
        expect(bytes8Simulator.vectorToUint64(bytes(0, 0, 0, 0, 0, 0, 1))).toBe(
          0x1000000000000n,
        );
        expect(
          bytes8Simulator.vectorToUint64(bytes(0, 0, 0, 0, 0, 0, 0, 1)),
        ).toBe(0x100000000000000n);
      });

      test('should convert MAX_UINT64 all-0xFF bytes', () => {
        const allFF: Bytes8 = [255n, 255n, 255n, 255n, 255n, 255n, 255n, 255n];
        expect(bytes8Simulator.vectorToUint64(allFF)).toBe(MAX_UINT64);
      });

      test('should convert arbitrary multi-byte value', () => {
        const b = bytes(0xef, 0xcd, 0xab, 0x89, 0x67, 0x45, 0x23, 0x01);
        expect(bytes8Simulator.vectorToUint64(b)).toBe(0x0123456789abcdefn);
      });
    });

    describe('bytesToUint64', () => {
      test('should convert zero bytes to zero', () => {
        const packed = new Uint8Array(8).fill(0);
        expect(bytes8Simulator.bytesToUint64(packed)).toBe(0n);
      });

      test('should place single byte at b0', () => {
        const packed = bytes8Simulator.pack(bytes(0xab));
        expect(bytes8Simulator.bytesToUint64(packed)).toBe(0xabn);
      });

      test('should place single byte at b1 through b7', () => {
        expect(
          bytes8Simulator.bytesToUint64(bytes8Simulator.pack(bytes(0, 1))),
        ).toBe(0x100n);
        expect(
          bytes8Simulator.bytesToUint64(bytes8Simulator.pack(bytes(0, 0, 1))),
        ).toBe(0x10000n);
        expect(
          bytes8Simulator.bytesToUint64(
            bytes8Simulator.pack(bytes(0, 0, 0, 1)),
          ),
        ).toBe(0x1000000n);
        expect(
          bytes8Simulator.bytesToUint64(
            bytes8Simulator.pack(bytes(0, 0, 0, 0, 1)),
          ),
        ).toBe(0x100000000n);
        expect(
          bytes8Simulator.bytesToUint64(
            bytes8Simulator.pack(bytes(0, 0, 0, 0, 0, 1)),
          ),
        ).toBe(0x10000000000n);
        expect(
          bytes8Simulator.bytesToUint64(
            bytes8Simulator.pack(bytes(0, 0, 0, 0, 0, 0, 1)),
          ),
        ).toBe(0x1000000000000n);
        expect(
          bytes8Simulator.bytesToUint64(
            bytes8Simulator.pack(bytes(0, 0, 0, 0, 0, 0, 0, 1)),
          ),
        ).toBe(0x100000000000000n);
      });

      test('should convert MAX_UINT64 all-0xFF bytes', () => {
        const allFF: Bytes8 = [255n, 255n, 255n, 255n, 255n, 255n, 255n, 255n];
        const packed = bytes8Simulator.pack(allFF);
        expect(bytes8Simulator.bytesToUint64(packed)).toBe(MAX_UINT64);
      });

      test('should convert arbitrary multi-byte value', () => {
        const b = bytes(0xef, 0xcd, 0xab, 0x89, 0x67, 0x45, 0x23, 0x01);
        const packed = bytes8Simulator.pack(b);
        expect(bytes8Simulator.bytesToUint64(packed)).toBe(0x0123456789abcdefn);
      });

      test('should fail when witness returns pack(vec) != bytes', () => {
        bytes8Simulator.overrideWitness(
          'wit_unpackBytes',
          (context, _bytes) => [
            context.privateState,
            bytes(0, 0, 0, 0, 0, 0, 0, 0),
          ],
        );
        const packed = new Uint8Array(8);
        packed[0] = 1;
        expect(() => bytes8Simulator.bytesToUint64(packed)).toThrow(
          'failed assert: Pack: unpack verification failed',
        );
      });
    });
  });
});
