import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { pureCircuits } from '../../../artifacts/MockUintN/contract/index.js';
import { UintNSimulator } from './simulators/UintNSimulator.js';

// Every run is a transaction on the live backend.
const PROPERTY_RUNS = isLiveBackend() ? 2 : 100;

// Pure circuits evaluate locally on either backend.
const PURE_RUNS = 2_000;

let uintNSimulator: UintNSimulator;

const WIDTHS = [
  {
    n: 64n,
    add: (a: bigint, b: bigint) => uintNSimulator.wrappingAdd64(a, b),
    sub: (a: bigint, b: bigint) => uintNSimulator.wrappingSub64(a, b),
  },
  {
    n: 247n,
    add: (a: bigint, b: bigint) => uintNSimulator.wrappingAdd247(a, b),
    sub: (a: bigint, b: bigint) => uintNSimulator.wrappingSub247(a, b),
  },
  {
    n: 248n,
    add: (a: bigint, b: bigint) => uintNSimulator.wrappingAdd248(a, b),
    sub: (a: bigint, b: bigint) => uintNSimulator.wrappingSub248(a, b),
  },
];

/** Every `Uint<n>` for `M = 2^n`, ascending. */
const domain = (M: bigint): bigint[] =>
  Array.from({ length: Number(M) }, (_, i) => BigInt(i));

/** Whether `values` holds each element of `all` exactly once. */
const isPermutation = (all: bigint[], values: bigint[]): boolean => {
  const seen = new Set(values);
  return values.length === all.length && all.every((v) => seen.has(v));
};

describe('UintN property: Uint<1>, Uint<7> and Uint<8>, exhaustively', () => {
  const EXHAUSTIVE_WIDTHS = [
    {
      n: 1n,
      add: pureCircuits.U1_wrappingAdd,
      sub: pureCircuits.U1_wrappingSub,
    },
    {
      n: 7n,
      add: pureCircuits.U7_wrappingAdd,
      sub: pureCircuits.U7_wrappingSub,
    },
    {
      n: 8n,
      add: pureCircuits.U8_wrappingAdd,
      sub: pureCircuits.U8_wrappingSub,
    },
  ];

  for (const { n, add, sub } of EXHAUSTIVE_WIDTHS) {
    const M = 1n << n;
    const values = domain(M);
    const OPS = [
      {
        name: 'wrappingAdd',
        symbol: '+',
        circuit: add,
        expected: (a: bigint, b: bigint) => (a + b) % M,
      },
      {
        name: 'wrappingSub',
        symbol: '-',
        circuit: sub,
        expected: (a: bigint, b: bigint) => (a - b + M) % M,
      },
    ];

    describe(`Uint<${n}>`, () => {
      for (const { name, symbol, circuit, expected } of OPS) {
        describe(name, () => {
          it(`should return (a ${symbol} b) mod 2^${n} for all ${M * M} pairs`, () => {
            const wrong = values.flatMap((a) =>
              values
                .filter((b) => circuit(a, b) !== expected(a, b))
                .map((b) => `${a} ${symbol} ${b}`),
            );

            expect(wrong).toStrictEqual([]);
          });

          it(`should permute Uint<${n}> over b for each fixed a`, () => {
            const failing = values.filter(
              (a) =>
                !isPermutation(
                  values,
                  values.map((b) => circuit(a, b)),
                ),
            );

            expect(failing).toStrictEqual([]);
          });

          it(`should permute Uint<${n}> over a for each fixed b`, () => {
            const failing = values.filter(
              (b) =>
                !isPermutation(
                  values,
                  values.map((a) => circuit(a, b)),
                ),
            );

            expect(failing).toStrictEqual([]);
          });
        });
      }
    });
  }
});

describe('UintN property: Uint<64>, Uint<247> and Uint<248>, pure circuits', () => {
  const PURE_WIDTHS = [
    {
      n: 64n,
      add: pureCircuits.U64_wrappingAdd,
      sub: pureCircuits.U64_wrappingSub,
    },
    {
      n: 247n,
      add: pureCircuits.U247_wrappingAdd,
      sub: pureCircuits.U247_wrappingSub,
    },
    {
      n: 248n,
      add: pureCircuits.U248_wrappingAdd,
      sub: pureCircuits.U248_wrappingSub,
    },
  ];

  for (const { n, add, sub } of PURE_WIDTHS) {
    const M = 1n << n;
    const operand = fc.bigInt({ min: 0n, max: M - 1n });

    describe(`Uint<${n}>`, () => {
      it(`should reduce a + b modulo 2^${n}`, () => {
        fc.assert(
          fc.property(operand, operand, (a, b) => {
            expect(add(a, b)).toBe((a + b) % M);
          }),
          { numRuns: PURE_RUNS },
        );
      });

      it(`should reduce a - b modulo 2^${n}`, () => {
        fc.assert(
          fc.property(operand, operand, (a, b) => {
            expect(sub(a, b)).toBe((a - b + M) % M);
          }),
          { numRuns: PURE_RUNS },
        );
      });

      it('should undo wrappingAdd with wrappingSub', () => {
        fc.assert(
          fc.property(operand, operand, (a, b) => {
            expect(sub(add(a, b), b)).toBe(a);
          }),
          { numRuns: PURE_RUNS },
        );
      });

      it('should undo wrappingSub with wrappingAdd', () => {
        fc.assert(
          fc.property(operand, operand, (a, b) => {
            expect(add(sub(a, b), b)).toBe(a);
          }),
          { numRuns: PURE_RUNS },
        );
      });

      it('should commute wrappingAdd', () => {
        fc.assert(
          fc.property(operand, operand, (a, b) => {
            expect(add(a, b)).toBe(add(b, a));
          }),
          { numRuns: PURE_RUNS },
        );
      });

      it('should map distinct first operands to distinct results', () => {
        fc.assert(
          fc.property(operand, operand, operand, (a, other, b) => {
            fc.pre(a !== other);
            expect(add(a, b)).not.toBe(add(other, b));
            expect(sub(a, b)).not.toBe(sub(other, b));
          }),
          { numRuns: PURE_RUNS },
        );
      });

      it('should map distinct second operands to distinct results', () => {
        fc.assert(
          fc.property(operand, operand, operand, (a, b, other) => {
            fc.pre(b !== other);
            expect(add(a, b)).not.toBe(add(a, other));
            expect(sub(a, b)).not.toBe(sub(a, other));
          }),
          { numRuns: PURE_RUNS },
        );
      });
    });
  }
});

describe('UintN property: Uint<64>, Uint<247> and Uint<248>, impure wrappers', () => {
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
