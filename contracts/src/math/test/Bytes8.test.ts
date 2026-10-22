import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { expectRejection } from '#test-utils/assertions/rejection.js';
import { Bytes8Simulator } from './simulators/Bytes8Simulator.js';
import { MAX_UINT64 } from './utils/consts.js';

let bytes8Simulator: Bytes8Simulator;

// Witnesses bind at deploy on a live node, so a test that swaps one with
// `overrideWitness` is dry-only.
const testDryOnly = test.skipIf(isLiveBackend());

const setup = async () => {
  bytes8Simulator = await Bytes8Simulator.create();
};

type Bytes8 = [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

const bytes = (...values: number[]): Bytes8 => {
  const a = [...values];
  while (a.length < 8) a.push(0);
  return a.map((x) => BigInt(x)) as Bytes8;
};

describe('Bytes8', () => {
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
        const result = await bytes8Simulator.pack(
          bytes(0, 0, 0, 0, 0, 0, 0, 0),
        );
        expect(result).toEqual(new Uint8Array(8).fill(0));
      });

      test('should match vector elements as bytes', async () => {
        const v = bytes(1, 2, 3, 4, 5, 6, 7, 8);
        const result = await bytes8Simulator.pack(v);
        expect(result.length).toBe(8);
        for (let i = 0; i < 8; i++) {
          expect(result[i]).toBe(Number(v[i]));
        }
      });

      test('should roundtrip with vectorToUint64', async () => {
        const v = bytes(0xef, 0xcd, 0xab, 0x89, 0x67, 0x45, 0x23, 0x01);
        const asU64 = await bytes8Simulator.vectorToUint64(v);
        const backBytes = await bytes8Simulator.pack(v);
        expect(asU64).toBe(0x0123456789abcdefn);
        const fromBack = Array.from(backBytes).reduce(
          (acc, b, i) => acc + (BigInt(b) << (8n * BigInt(i))),
          0n,
        );
        expect(fromBack).toBe(asU64);
      });
    });

    describe('unpack', () => {
      test('should unpack bytes to vector matching pack roundtrip', async () => {
        const v = bytes(0xef, 0xcd, 0xab, 0x89, 0x67, 0x45, 0x23, 0x01);
        const packed = await bytes8Simulator.pack(v);
        const unpacked = await bytes8Simulator.unpack(packed);
        expect(unpacked).toEqual(v);
      });

      test('should unpack zero bytes to zero vector', async () => {
        const packed = new Uint8Array(8).fill(0);
        const unpacked = await bytes8Simulator.unpack(packed);
        expect(unpacked).toEqual(bytes(0, 0, 0, 0, 0, 0, 0, 0));
      });

      testDryOnly(
        'should fail when witness returns pack(vec) != bytes',
        async () => {
          bytes8Simulator.overrideWitness(
            'wit_unpackBytes',
            (context, _bytes) => [
              context.privateState,
              bytes(0, 0, 0, 0, 0, 0, 0, 0),
            ],
          );
          const packed = new Uint8Array(8);
          packed[0] = 1;
          await expectRejection(
            bytes8Simulator.unpack(packed),
            'failed assert: Pack: unpack verification failed',
          );
        },
      );
    });

    describe('vectorToUint64', () => {
      test('should convert zero bytes to zero', async () => {
        expect(
          await bytes8Simulator.vectorToUint64(bytes(0, 0, 0, 0, 0, 0, 0, 0)),
        ).toBe(0n);
      });

      test('should place single byte at b0', async () => {
        expect(await bytes8Simulator.vectorToUint64(bytes(0xab))).toBe(0xabn);
      });

      test('should place single byte at b1 through b7', async () => {
        expect(await bytes8Simulator.vectorToUint64(bytes(0, 1))).toBe(0x100n);
        expect(await bytes8Simulator.vectorToUint64(bytes(0, 0, 1))).toBe(
          0x10000n,
        );
        expect(await bytes8Simulator.vectorToUint64(bytes(0, 0, 0, 1))).toBe(
          0x1000000n,
        );
        expect(await bytes8Simulator.vectorToUint64(bytes(0, 0, 0, 0, 1))).toBe(
          0x100000000n,
        );
        expect(
          await bytes8Simulator.vectorToUint64(bytes(0, 0, 0, 0, 0, 1)),
        ).toBe(0x10000000000n);
        expect(
          await bytes8Simulator.vectorToUint64(bytes(0, 0, 0, 0, 0, 0, 1)),
        ).toBe(0x1000000000000n);
        expect(
          await bytes8Simulator.vectorToUint64(bytes(0, 0, 0, 0, 0, 0, 0, 1)),
        ).toBe(0x100000000000000n);
      });

      test('should convert MAX_UINT64 all-0xFF bytes', async () => {
        const allFF: Bytes8 = [255n, 255n, 255n, 255n, 255n, 255n, 255n, 255n];
        expect(await bytes8Simulator.vectorToUint64(allFF)).toBe(MAX_UINT64);
      });

      test('should convert arbitrary multi-byte value', async () => {
        const b = bytes(0xef, 0xcd, 0xab, 0x89, 0x67, 0x45, 0x23, 0x01);
        expect(await bytes8Simulator.vectorToUint64(b)).toBe(
          0x0123456789abcdefn,
        );
      });
    });

    describe('bytesToUint64', () => {
      test('should convert zero bytes to zero', async () => {
        const packed = new Uint8Array(8).fill(0);
        expect(await bytes8Simulator.bytesToUint64(packed)).toBe(0n);
      });

      test('should place single byte at b0', async () => {
        const packed = await bytes8Simulator.pack(bytes(0xab));
        expect(await bytes8Simulator.bytesToUint64(packed)).toBe(0xabn);
      });

      test('should place single byte at b1 through b7', async () => {
        expect(
          await bytes8Simulator.bytesToUint64(
            await bytes8Simulator.pack(bytes(0, 1)),
          ),
        ).toBe(0x100n);
        expect(
          await bytes8Simulator.bytesToUint64(
            await bytes8Simulator.pack(bytes(0, 0, 1)),
          ),
        ).toBe(0x10000n);
        expect(
          await bytes8Simulator.bytesToUint64(
            await bytes8Simulator.pack(bytes(0, 0, 0, 1)),
          ),
        ).toBe(0x1000000n);
        expect(
          await bytes8Simulator.bytesToUint64(
            await bytes8Simulator.pack(bytes(0, 0, 0, 0, 1)),
          ),
        ).toBe(0x100000000n);
        expect(
          await bytes8Simulator.bytesToUint64(
            await bytes8Simulator.pack(bytes(0, 0, 0, 0, 0, 1)),
          ),
        ).toBe(0x10000000000n);
        expect(
          await bytes8Simulator.bytesToUint64(
            await bytes8Simulator.pack(bytes(0, 0, 0, 0, 0, 0, 1)),
          ),
        ).toBe(0x1000000000000n);
        expect(
          await bytes8Simulator.bytesToUint64(
            await bytes8Simulator.pack(bytes(0, 0, 0, 0, 0, 0, 0, 1)),
          ),
        ).toBe(0x100000000000000n);
      });

      test('should convert MAX_UINT64 all-0xFF bytes', async () => {
        const allFF: Bytes8 = [255n, 255n, 255n, 255n, 255n, 255n, 255n, 255n];
        const packed = await bytes8Simulator.pack(allFF);
        expect(await bytes8Simulator.bytesToUint64(packed)).toBe(MAX_UINT64);
      });

      test('should convert arbitrary multi-byte value', async () => {
        const b = bytes(0xef, 0xcd, 0xab, 0x89, 0x67, 0x45, 0x23, 0x01);
        const packed = await bytes8Simulator.pack(b);
        expect(await bytes8Simulator.bytesToUint64(packed)).toBe(
          0x0123456789abcdefn,
        );
      });

      testDryOnly(
        'should fail when witness returns pack(vec) != bytes',
        async () => {
          bytes8Simulator.overrideWitness(
            'wit_unpackBytes',
            (context, _bytes) => [
              context.privateState,
              bytes(0, 0, 0, 0, 0, 0, 0, 0),
            ],
          );
          const packed = new Uint8Array(8);
          packed[0] = 1;
          await expectRejection(
            bytes8Simulator.bytesToUint64(packed),
            'failed assert: Pack: unpack verification failed',
          );
        },
      );
    });
  });
});
