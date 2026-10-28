import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { pureCircuits } from '../../../artifacts/MockUintN/contract/index.js';
import { UintNSimulator } from './simulators/UintNSimulator.js';

// Every run is a transaction on the live backend.
const PROPERTY_RUNS = isLiveBackend() ? 2 : 100;

const U8 = Array.from({ length: 256 }, (_, i) => BigInt(i));

let uintNSimulator: UintNSimulator;

const WIDTHS = [
  {
    n: 64n,
    add: (a: bigint, b: bigint) => uintNSimulator.wrappingAdd64(a, b),
    sub: (a: bigint, b: bigint) => uintNSimulator.wrappingSub64(a, b),
  },
  {
    n: 248n,
    add: (a: bigint, b: bigint) => uintNSimulator.wrappingAdd248(a, b),
    sub: (a: bigint, b: bigint) => uintNSimulator.wrappingSub248(a, b),
  },
];

/** Whether `values` holds each `Uint<8>` exactly once. */
const isPermutation = (values: bigint[]): boolean => {
  const seen = new Set(values);
  return values.length === U8.length && U8.every((v) => seen.has(v));
};

describe('UintN property: Uint<8>, exhaustively', () => {
  const OPS = [
    {
      name: 'wrappingAdd',
      symbol: '+',
      circuit: pureCircuits.U8_wrappingAdd,
      expected: (a: bigint, b: bigint) => (a + b) % 256n,
    },
    {
      name: 'wrappingSub',
      symbol: '-',
      circuit: pureCircuits.U8_wrappingSub,
      expected: (a: bigint, b: bigint) => (a - b + 256n) % 256n,
    },
  ];

  for (const { name, symbol, circuit, expected } of OPS) {
    describe(name, () => {
      it(`should return (a ${symbol} b) mod 2^8 for all 65536 pairs`, () => {
        const wrong = U8.flatMap((a) =>
          U8.filter((b) => circuit(a, b) !== expected(a, b)).map(
            (b) => `${a} ${symbol} ${b}`,
          ),
        );

        expect(wrong).toStrictEqual([]);
      });

      it('should permute Uint<8> over b for each fixed a', () => {
        const failing = U8.filter(
          (a) => !isPermutation(U8.map((b) => circuit(a, b))),
        );

        expect(failing).toStrictEqual([]);
      });

      it('should permute Uint<8> over a for each fixed b', () => {
        const failing = U8.filter(
          (b) => !isPermutation(U8.map((a) => circuit(a, b))),
        );

        expect(failing).toStrictEqual([]);
      });
    });
  }
});

describe('UintN property: generated operands', () => {
  beforeAll(async () => {
    uintNSimulator = await UintNSimulator.create();
  });

  for (const { n, add, sub } of WIDTHS) {
    const M = 1n << n;
    const MAX = M - 1n;
    const operand = fc.bigInt({ min: 0n, max: MAX });

    describe(`Uint<${n}>`, () => {
      it(`should return (a + b) mod 2^${n} from wrappingAdd(a, b)`, async () => {
        await fc.assert(
          fc.asyncProperty(operand, operand, async (a, b) => {
            expect(await add(a, b)).toBe((a + b) % M);
          }),
          { numRuns: PROPERTY_RUNS },
        );
      });

      it(`should return (a - b) mod 2^${n} from wrappingSub(a, b)`, async () => {
        await fc.assert(
          fc.asyncProperty(operand, operand, async (a, b) => {
            expect(await sub(a, b)).toBe((a - b + M) % M);
          }),
          { numRuns: PROPERTY_RUNS },
        );
      });

      it('should return a from wrappingSub(wrappingAdd(a, b), b)', async () => {
        await fc.assert(
          fc.asyncProperty(operand, operand, async (a, b) => {
            expect(await sub(await add(a, b), b)).toBe(a);
          }),
          { numRuns: PROPERTY_RUNS },
        );
      });

      it('should return a from wrappingAdd(wrappingSub(a, b), b)', async () => {
        await fc.assert(
          fc.asyncProperty(operand, operand, async (a, b) => {
            expect(await add(await sub(a, b), b)).toBe(a);
          }),
          { numRuns: PROPERTY_RUNS },
        );
      });

      it('should return wrappingAdd(b, a) from wrappingAdd(a, b)', async () => {
        await fc.assert(
          fc.asyncProperty(operand, operand, async (a, b) => {
            expect(await add(a, b)).toBe(await add(b, a));
          }),
          { numRuns: PROPERTY_RUNS },
        );
      });

      it('should return MAX from wrappingAdd(a, MAX - a)', async () => {
        await fc.assert(
          fc.asyncProperty(operand, async (a) => {
            expect(await add(a, MAX - a)).toBe(MAX);
          }),
          { numRuns: PROPERTY_RUNS },
        );
      });

      it(`should return 0 from wrappingAdd(a, (MAX - a + 1) mod 2^${n})`, async () => {
        await fc.assert(
          fc.asyncProperty(operand, async (a) => {
            expect(await add(a, (MAX - a + 1n) % M)).toBe(0n);
          }),
          { numRuns: PROPERTY_RUNS },
        );
      });

      it('should return 0 from wrappingSub(a, a)', async () => {
        await fc.assert(
          fc.asyncProperty(operand, async (a) => {
            expect(await sub(a, a)).toBe(0n);
          }),
          { numRuns: PROPERTY_RUNS },
        );
      });

      it(`should return MAX from wrappingSub(a, (a + 1) mod 2^${n})`, async () => {
        await fc.assert(
          fc.asyncProperty(operand, async (a) => {
            expect(await sub(a, (a + 1n) % M)).toBe(MAX);
          }),
          { numRuns: PROPERTY_RUNS },
        );
      });
    });
  }
});
