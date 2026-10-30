import { beforeAll, describe, expect, it } from 'vitest';
import { expectRejection } from '#test-utils/assertions/rejection.js';
import { UintNSimulator } from './simulators/UintNSimulator.js';

let uintNSimulator: UintNSimulator;

/** The mock's wrappers for one instantiation `UintN<n>`. */
type Width = {
  n: bigint;
  modulus: () => Promise<bigint>;
  add: (a: bigint, b: bigint) => Promise<bigint>;
  sub: (a: bigint, b: bigint) => Promise<bigint>;
};

const WIDTHS: Width[] = [
  {
    n: 7n,
    modulus: () => uintNSimulator.MODULUS7(),
    add: (a, b) => uintNSimulator.wrappingAdd7(a, b),
    sub: (a, b) => uintNSimulator.wrappingSub7(a, b),
  },
  {
    n: 8n,
    modulus: () => uintNSimulator.MODULUS8(),
    add: (a, b) => uintNSimulator.wrappingAdd8(a, b),
    sub: (a, b) => uintNSimulator.wrappingSub8(a, b),
  },
  {
    n: 64n,
    modulus: () => uintNSimulator.MODULUS64(),
    add: (a, b) => uintNSimulator.wrappingAdd64(a, b),
    sub: (a, b) => uintNSimulator.wrappingSub64(a, b),
  },
  {
    n: 247n,
    modulus: () => uintNSimulator.MODULUS247(),
    add: (a, b) => uintNSimulator.wrappingAdd247(a, b),
    sub: (a, b) => uintNSimulator.wrappingSub247(a, b),
  },
  {
    n: 248n,
    modulus: () => uintNSimulator.MODULUS248(),
    add: (a, b) => uintNSimulator.wrappingAdd248(a, b),
    sub: (a, b) => uintNSimulator.wrappingSub248(a, b),
  },
];

/** `[a, b, expected]` for every pair of `Uint<n>`. */
type TruthTable = readonly (readonly [bigint, bigint, bigint])[];

/** Widths too narrow for the `WIDTHS` literals, tested pair by pair. */
const DEGENERATE: (Width & { sums: TruthTable; differences: TruthTable })[] = [
  {
    n: 0n,
    modulus: () => uintNSimulator.MODULUS0(),
    add: (a, b) => uintNSimulator.wrappingAdd0(a, b),
    sub: (a, b) => uintNSimulator.wrappingSub0(a, b),
    sums: [[0n, 0n, 0n]],
    differences: [[0n, 0n, 0n]],
  },
  {
    n: 1n,
    modulus: () => uintNSimulator.MODULUS1(),
    add: (a, b) => uintNSimulator.wrappingAdd1(a, b),
    sub: (a, b) => uintNSimulator.wrappingSub1(a, b),
    sums: [
      [0n, 0n, 0n],
      [0n, 1n, 1n],
      [1n, 0n, 1n],
      [1n, 1n, 0n],
    ],
    differences: [
      [0n, 0n, 0n],
      [0n, 1n, 1n],
      [1n, 0n, 1n],
      [1n, 1n, 0n],
    ],
  },
];

/** `M = 2^n`, the largest `Uint<n>`, `2^(n-1)`, and a mid-range value. */
const bounds = (n: bigint) => {
  const M = 1n << n;
  return { M, MAX: M - 1n, half: M / 2n, mid: M / 3n };
};

/** The bindings' type error for an argument of `M`, one past `Uint<n>`. */
const outOfRange = (M: bigint): string =>
  `expected value of type Uint<0..${M}> but received ${M}n`;

describe('UintN', () => {
  beforeAll(async () => {
    uintNSimulator = await UintNSimulator.create();
  });

  describe('MODULUS', () => {
    for (const { n, modulus } of WIDTHS) {
      it(`should return 2^${n} for Uint<${n}>`, async () => {
        expect(await modulus()).toBe(1n << n);
      });
    }
  });

  describe('wrappingAdd', () => {
    for (const { n, add } of WIDTHS) {
      const { M, MAX, half, mid } = bounds(n);

      describe(`Uint<${n}>`, () => {
        it('should return 0 for 0 + 0', async () => {
          expect(await add(0n, 0n)).toBe(0n);
        });

        it('should return 2 for 1 + 1', async () => {
          expect(await add(1n, 1n)).toBe(2n);
        });

        it('should return a for a + 0', async () => {
          expect(await add(mid, 0n)).toBe(mid);
        });

        it('should return MAX for (MAX - b) + b', async () => {
          expect(await add(MAX - mid, mid)).toBe(MAX);
        });

        it(`should return MAX for 2^${n - 1n} + (2^${n - 1n} - 1)`, async () => {
          expect(await add(half, half - 1n)).toBe(MAX);
        });

        it('should wrap (MAX - b + 1) + b to 0', async () => {
          expect(await add(MAX - mid + 1n, mid)).toBe(0n);
        });

        it(`should wrap 2^${n - 1n} + 2^${n - 1n} to 0`, async () => {
          expect(await add(half, half)).toBe(0n);
        });

        it('should wrap MAX + 1 to 0', async () => {
          expect(await add(MAX, 1n)).toBe(0n);
        });

        it('should wrap 1 + MAX to 0', async () => {
          expect(await add(1n, MAX)).toBe(0n);
        });

        it('should wrap MAX + MAX to MAX - 1', async () => {
          expect(await add(MAX, MAX)).toBe(MAX - 1n);
        });

        it(`should reject 2^${n} as the first operand`, async () => {
          await expectRejection(add(M, 0n), outOfRange(M));
        });

        it(`should reject 2^${n} as the second operand`, async () => {
          await expectRejection(add(0n, M), outOfRange(M));
        });
      });
    }
  });

  describe('wrappingSub', () => {
    for (const { n, sub } of WIDTHS) {
      const { M, MAX, mid } = bounds(n);

      describe(`Uint<${n}>`, () => {
        it('should return 0 for 0 - 0', async () => {
          expect(await sub(0n, 0n)).toBe(0n);
        });

        it('should return 0 for 1 - 1', async () => {
          expect(await sub(1n, 1n)).toBe(0n);
        });

        it('should return a for a - 0', async () => {
          expect(await sub(mid, 0n)).toBe(mid);
        });

        it('should return 0 for a - a', async () => {
          expect(await sub(mid, mid)).toBe(0n);
        });

        it('should return 0 for MAX - MAX', async () => {
          expect(await sub(MAX, MAX)).toBe(0n);
        });

        it('should wrap 0 - 1 to MAX', async () => {
          expect(await sub(0n, 1n)).toBe(MAX);
        });

        it('should wrap 3 - 5 to MAX - 1', async () => {
          expect(await sub(3n, 5n)).toBe(MAX - 1n);
        });

        it('should wrap 0 - MAX to 1', async () => {
          expect(await sub(0n, MAX)).toBe(1n);
        });

        it(`should reject 2^${n} as the first operand`, async () => {
          await expectRejection(sub(M, 0n), outOfRange(M));
        });

        it(`should reject 2^${n} as the second operand`, async () => {
          await expectRejection(sub(0n, M), outOfRange(M));
        });
      });
    }
  });
});

describe('UintN: Uint<0> and Uint<1>, whole domain', () => {
  beforeAll(async () => {
    uintNSimulator = await UintNSimulator.create();
  });

  for (const { n, modulus, add, sub, sums, differences } of DEGENERATE) {
    const M = 1n << n;

    describe(`Uint<${n}>`, () => {
      it(`should return 2^${n} from MODULUS`, async () => {
        expect(await modulus()).toBe(M);
      });

      describe('wrappingAdd', () => {
        for (const [a, b, sum] of sums) {
          it(`should return ${sum} for ${a} + ${b}`, async () => {
            expect(await add(a, b)).toBe(sum);
          });
        }

        it(`should reject 2^${n} as the first operand`, async () => {
          await expectRejection(add(M, 0n), outOfRange(M));
        });

        it(`should reject 2^${n} as the second operand`, async () => {
          await expectRejection(add(0n, M), outOfRange(M));
        });
      });

      describe('wrappingSub', () => {
        for (const [a, b, difference] of differences) {
          it(`should return ${difference} for ${a} - ${b}`, async () => {
            expect(await sub(a, b)).toBe(difference);
          });
        }

        it(`should reject 2^${n} as the first operand`, async () => {
          await expectRejection(sub(M, 0n), outOfRange(M));
        });

        it(`should reject 2^${n} as the second operand`, async () => {
          await expectRejection(sub(0n, M), outOfRange(M));
        });
      });
    });
  }
});
