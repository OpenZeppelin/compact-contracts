import { PackSimulator } from '@src/math/test/mocks/PackSimulator.js';
import { beforeEach, describe, expect, test } from 'vitest';

let packSimulator: PackSimulator;

const setup = () => {
  packSimulator = new PackSimulator();
};

type Vec8 = [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

const vec8 = (...values: number[]): Vec8 => {
  const a = [...values];
  while (a.length < 8) a.push(0);
  return a.map((x) => BigInt(x)) as Vec8;
};

const vec16 = (value: bigint): bigint[] => {
  const vec = new Array<bigint>(16).fill(0n);
  for (let i = 0; i < 16; i++) {
    vec[i] = (value >> (8n * BigInt(i))) & 0xffn;
  }
  return vec;
};

const vec32 = (value: bigint): bigint[] => {
  const vec = new Array<bigint>(32).fill(0n);
  for (let i = 0; i < 32; i++) {
    vec[i] = (value >> (8n * BigInt(i))) & 0xffn;
  }
  return vec;
};

describe('Pack', () => {
  beforeEach(setup);

  describe('Bytes8', () => {
    describe('pack8', () => {
      test('should convert zero vector to zero bytes', () => {
        const result = packSimulator.pack8(vec8(0, 0, 0, 0, 0, 0, 0, 0));
        expect(result).toEqual(new Uint8Array(8).fill(0));
      });

      test('should match vector elements as bytes', () => {
        const v = vec8(1, 2, 3, 4, 5, 6, 7, 8);
        const result = packSimulator.pack8(v);
        expect(result.length).toBe(8);
        for (let i = 0; i < 8; i++) {
          expect(result[i]).toBe(Number(v[i]));
        }
      });
    });

    describe('unpack8', () => {
      test('should roundtrip: unpack8(pack8(vec)) equals vec', () => {
        const v = vec8(0xef, 0xcd, 0xab, 0x89, 0x67, 0x45, 0x23, 0x01);
        const packed = packSimulator.pack8(v);
        const unpacked = packSimulator.unpack8(packed);
        expect(unpacked).toEqual(v);
      });

      test('should unpack zero bytes to zero vector', () => {
        const packed = new Uint8Array(8).fill(0);
        const unpacked = packSimulator.unpack8(packed);
        expect(unpacked).toEqual(vec8(0, 0, 0, 0, 0, 0, 0, 0));
      });

      test('should fail when witness returns pack(vec) != bytes', () => {
        packSimulator.overrideWitness(
          'wit_unpackBytes',
          (_context: unknown, _bytes: Uint8Array) => [
            {},
            vec8(0, 0, 0, 0, 0, 0, 0, 0),
          ],
        );
        const packed = new Uint8Array(8);
        packed[0] = 1;
        expect(() => packSimulator.unpack8(packed)).toThrow(
          'failed assert: Pack: unpack verification failed',
        );
      });
    });
  });

  describe('Bytes16', () => {
    describe('pack16', () => {
      test('should convert zero vector to zero bytes', () => {
        const result = packSimulator.pack16(vec16(0n));
        expect(result).toEqual(new Uint8Array(16).fill(0));
      });

      test('should match vector elements as bytes', () => {
        const value = 0x0123456789abcdefn;
        const v = vec16(value);
        const result = packSimulator.pack16(v);
        expect(result.length).toBe(16);
        for (let i = 0; i < 16; i++) {
          expect(result[i]).toBe(Number(v[i]));
        }
      });
    });

    describe('unpack16', () => {
      test('should roundtrip: unpack16(pack16(vec)) equals vec', () => {
        const value = 0x0123456789abcdefn;
        const v = vec16(value);
        const packed = packSimulator.pack16(v);
        const unpacked = packSimulator.unpack16(packed);
        expect(unpacked).toEqual(v);
      });

      test('should unpack zero bytes to zero vector', () => {
        const packed = new Uint8Array(16).fill(0);
        const unpacked = packSimulator.unpack16(packed);
        expect(unpacked).toEqual(vec16(0n));
      });

      test('should fail when witness returns pack(vec) != bytes', () => {
        packSimulator.overrideWitness(
          'wit_unpackBytes',
          (_context: unknown, _bytes: Uint8Array) => [{}, vec16(0n)],
        );
        const packed = new Uint8Array(16);
        packed[0] = 1;
        expect(() => packSimulator.unpack16(packed)).toThrow(
          'failed assert: Pack: unpack verification failed',
        );
      });
    });
  });

  describe('Bytes32', () => {
    describe('pack32', () => {
      test('should convert zero vector to zero bytes', () => {
        const result = packSimulator.pack32(vec32(0n));
        expect(result).toEqual(new Uint8Array(32).fill(0));
      });

      test('should match vector elements as bytes', () => {
        const value = 1n + (2n << 64n) + (3n << 128n) + (4n << 192n);
        const v = vec32(value);
        const result = packSimulator.pack32(v);
        expect(result.length).toBe(32);
        for (let i = 0; i < 32; i++) {
          expect(result[i]).toBe(Number(v[i]));
        }
      });
    });

    describe('unpack32', () => {
      test('should roundtrip: unpack32(pack32(vec)) equals vec', () => {
        const value = 1n + (2n << 64n) + (3n << 128n) + (4n << 192n);
        const v = vec32(value);
        const packed = packSimulator.pack32(v);
        const unpacked = packSimulator.unpack32(packed);
        expect(unpacked).toEqual(v);
      });

      test('should unpack zero bytes to zero vector', () => {
        const packed = new Uint8Array(32).fill(0);
        const unpacked = packSimulator.unpack32(packed);
        expect(unpacked).toEqual(vec32(0n));
      });

      test('should fail when witness returns pack(vec) != bytes', () => {
        packSimulator.overrideWitness(
          'wit_unpackBytes',
          (_context: unknown, _bytes: Uint8Array) => [{}, vec32(0n)],
        );
        const packed = new Uint8Array(32);
        packed[0] = 1;
        expect(() => packSimulator.unpack32(packed)).toThrow(
          'failed assert: Pack: unpack verification failed',
        );
      });
    });
  });
});
