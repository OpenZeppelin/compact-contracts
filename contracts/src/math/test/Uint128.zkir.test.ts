import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { beforeAll, describe, expect, test } from 'vitest';
import { fieldWidths } from '#test-utils/zkir/fieldRepr.js';
import { RelationForger } from '#test-utils/zkir/forgery.js';
import { loadZkir } from '#test-utils/zkir/relationCheck.js';
import { witnessCoverage } from '#test-utils/zkir/witnessCoverage.js';
import { Uint128Simulator } from './simulators/Uint128Simulator.js';
import { MAX_UINT64, MAX_UINT128 } from './utils/consts.js';
import {
  describeRelation,
  expectHonestAccepted,
  expectMustRejectInput,
  inputForgeries,
  RELATION_SEED,
  relationCase,
} from './utils/forgeries.js';
import { toU128, toU256, type U128Limbs } from './utils/oracles.js';
import { sqrtBigint } from './witnesses/sqrtBigint.js';
import { Uint128Witnesses } from './witnesses/Uint128Witnesses.js';

/**
 * ZKIR v2 relation tests of the `Uint128` witness circuits (INV-1, INV-8 to
 * INV-11, INV-15, INV-18, INV-25). See `utils/forgeries.ts`. Both forms of
 * `addChecked` use native addition and no witness; their own block below
 * checks them.
 *
 * Every circuit that takes a `Uint<128>` argument splits it with `toU128`,
 * and `_add` and `_mul` split their intermediate sums and products. The
 * forgeries attack each of these splits, the division witness and the root
 * witness. The free leaves are `quotient.high` and `remainder.high` of each
 * split.
 */

type S = Uint128Simulator;
const u128 = fc.bigInt({ min: 0n, max: MAX_UINT128 });
const A = 2n ** 127n + 0x1234567890abcdefn;
const B = A - 5n;

const pairBoundary: [bigint, bigint][] = [
  [0n, 0n],
  [MAX_UINT128, MAX_UINT128],
  [MAX_UINT64, MAX_UINT64],
  [MAX_UINT64 + 1n, 1n],
  [1n, MAX_UINT128],
];
const sumFits = u128.chain((a) =>
  fc.tuple(fc.constant(a), fc.bigInt({ min: 0n, max: MAX_UINT128 - a })),
);
const productFits = fc
  .bigInt({ min: 1n, max: MAX_UINT128 })
  .chain((a) =>
    fc.tuple(fc.constant(a), fc.bigInt({ min: 0n, max: MAX_UINT128 / a })),
  );
const division = fc.tuple(u128, fc.bigInt({ min: 1n, max: MAX_UINT128 }));
const divisionBoundary: [bigint, bigint][] = [
  [0n, 1n],
  [MAX_UINT128, 1n],
  [MAX_UINT128, MAX_UINT128],
  [MAX_UINT128, MAX_UINT64 + 1n],
  [MAX_UINT128 - 1n, MAX_UINT128],
  [10n, 5n],
];
// An even divisor allows the wrapped-product forgery, an odd one does not.
// The coordinated forgeries need a divisor with b.high = 0 (splits ll, hl
// and offset 1), with b.low = 0 (lh, hh and offset 2) and b.high a power of
// two (offset 3).
const divisionForgeries: [bigint, bigint][] = [
  [A, 2n ** 65n + 2n],
  [A, 12345n],
  [A, 12345n << 64n],
  [A, 1n << 127n],
];
// The coordinated forgeries isolate every split of _mul(quotient, b).
const divisionIsolates = { coordinated: [0, 1, 2, 3, 4, 5, 6] };

const asU128 = <T extends readonly bigint[]>(values: T) =>
  values.map((v) => toU128(v)) as { [K in keyof T]: U128Limbs };

/**
 * A case for the `Uint<128>` form and one for the `U128` form of a circuit.
 * `toResult` converts the oracle result to the result type of the `U128`
 * form.
 */
const both = <A extends readonly bigint[]>(entry: {
  circuit: string;
  call: (s: S, ...args: A) => Promise<unknown>;
  callU128: (s: S, ...args: { [K in keyof A]: U128Limbs }) => Promise<unknown>;
  oracle: (...args: A) => unknown;
  boundary: A[];
  random: fc.Arbitrary<A>;
  forgeries: A[];
  rejects?: A[];
  isolates?: { coordinated: number[]; single?: number[] };
  toResult?: (result: unknown) => unknown;
}) => {
  const toResult = entry.toResult ?? ((result: unknown) => result);
  return [
    relationCase<S, A>(entry),
    relationCase<S, { [K in keyof A]: U128Limbs }>({
      circuit: `${entry.circuit}U128`,
      call: entry.callU128,
      oracle: (...args) =>
        toResult(
          entry.oracle(
            ...(args.map((u) => (u.high << 64n) + u.low) as unknown as A),
          ),
        ),
      boundary: entry.boundary.map(asU128),
      random: entry.random.map(asU128),
      forgeries: entry.forgeries.map(asU128),
      rejects: entry.rejects?.map(asU128),
      isolates: entry.isolates,
    }),
  ];
};

const quotientRemainder = (a: bigint, b: bigint) => ({
  quotient: toU128(a / b),
  remainder: toU128(a % b),
});
const divisionRejects: [bigint, bigint][] = [
  [5n, 0n],
  [MAX_UINT128, 0n],
];

describeRelation('MockUint128', {
  simulator: () => Uint128Simulator.create(),
  witnesses: () => Uint128Witnesses(),
  cases: [
    relationCase<S, [bigint]>({
      circuit: 'toU128',
      call: (s, v) => s.toU128(v),
      oracle: (v) => toU128(v),
      boundary: [[0n], [1n], [MAX_UINT64], [MAX_UINT64 + 1n], [MAX_UINT128]],
      random: fc.tuple(u128),
      forgeries: [[A], [MAX_UINT64]],
    }),
    ...both<[bigint, bigint]>({
      circuit: 'add',
      call: (s, a, b) => s.add(a, b),
      callU128: (s, a, b) => s.addU128(a, b),
      oracle: (a, b) => toU256(a + b),
      boundary: pairBoundary,
      random: fc.tuple(u128, u128),
      forgeries: [[A, B]],
    }),
    ...both<[bigint, bigint]>({
      circuit: 'mul',
      call: (s, a, b) => s.mul(a, b),
      callU128: (s, a, b) => s.mulU128(a, b),
      oracle: (a, b) => toU256(a * b),
      boundary: pairBoundary,
      random: fc.tuple(u128, u128),
      // With a zero operand, a split of the other operand that is not
      // canonical gives the same product: only its range check rejects it.
      forgeries: [
        [A, B],
        [A, 0n],
        [0n, B],
      ],
    }),
    ...both<[bigint, bigint]>({
      circuit: 'mulChecked',
      call: (s, a, b) => s.mulChecked(a, b),
      callU128: (s, a, b) => s.mulCheckedU128(a, b),
      oracle: (a, b) => a * b,
      boundary: [
        [0n, MAX_UINT128],
        [MAX_UINT128, 1n],
        [MAX_UINT64 + 1n, MAX_UINT64],
      ],
      random: productFits,
      forgeries: [
        [2n ** 63n + 5n, 2n ** 63n + 0x7fffn],
        [A, 0n],
        [0n, B],
      ],
      // 2^127 * 2^127 makes the last split of _mul nonzero while the one
      // before has a zero low part: only that split shows the overflow.
      rejects: [
        [2n ** 64n, 2n ** 64n],
        [MAX_UINT128, 2n],
        [2n ** 127n, 2n ** 127n],
      ],
    }),
    ...both<[bigint, bigint]>({
      circuit: 'div',
      call: (s, a, b) => s.div(a, b),
      callU128: (s, a, b) => s.divU128(a, b),
      oracle: (a, b) => a / b,
      boundary: divisionBoundary,
      random: division,
      forgeries: divisionForgeries,
      rejects: divisionRejects,
      isolates: divisionIsolates,
      toResult: (result) => toU128(result as bigint),
    }),
    ...both<[bigint, bigint]>({
      circuit: 'rem',
      call: (s, a, b) => s.rem(a, b),
      callU128: (s, a, b) => s.remU128(a, b),
      oracle: (a, b) => a % b,
      boundary: divisionBoundary,
      random: division,
      forgeries: divisionForgeries,
      rejects: divisionRejects,
      isolates: divisionIsolates,
      toResult: (result) => toU128(result as bigint),
    }),
    ...both<[bigint, bigint]>({
      circuit: 'divRem',
      call: (s, a, b) => s.divRem(a, b),
      callU128: (s, a, b) => s.divRemU128(a, b),
      oracle: quotientRemainder,
      boundary: divisionBoundary,
      random: division,
      forgeries: divisionForgeries,
      rejects: divisionRejects,
      isolates: divisionIsolates,
    }),
    ...both<[bigint, bigint]>({
      circuit: 'isMultiple',
      call: (s, a, b) => s.isMultiple(a, b),
      callU128: (s, a, b) => s.isMultipleU128(a, b),
      oracle: (a, b) => a % b === 0n,
      boundary: divisionBoundary,
      random: division,
      forgeries: divisionForgeries,
      rejects: divisionRejects,
      isolates: divisionIsolates,
    }),
    ...both<[bigint]>({
      circuit: 'sqrt',
      call: (s, n) => s.sqrt(n),
      callU128: (s, n) => s.sqrtU128(n),
      oracle: (n) => sqrtBigint(n),
      boundary: [
        [0n],
        [1n],
        [3n],
        [4n],
        [MAX_UINT128],
        [MAX_UINT64 * MAX_UINT64],
      ],
      random: fc.tuple(u128),
      forgeries: [[A], [MAX_UINT128]],
      // hh, offset 2 and offset 3 reach only the high half of the square,
      // which _sqrt does not check: no forgery with another root passes.
      isolates: {
        coordinated: [0, 1, 2, 4, 7, 8, 9, 10, 11, 12],
        single: [3, 5, 6],
      },
    }),
  ],
});

describe.skipIf(isLiveBackend())(
  'MockUint128 ZKIR v2 relation: inputs the circuit must reject',
  () => {
    let forger: RelationForger;

    beforeAll(async () => {
      forger = await RelationForger.create('MockUint128', Uint128Witnesses());
    });

    test.each([
      ['addChecked', [MAX_UINT128, 1n], 'Uint128: addition overflow'],
      [
        'addCheckedU128',
        [toU128(MAX_UINT128), toU128(1n)],
        'Uint128: addition overflow',
      ],
      [
        'mulChecked',
        [2n ** 64n, 2n ** 64n],
        'Uint128: multiplication overflow',
      ],
      [
        'mulCheckedU128',
        [toU128(2n ** 64n), toU128(2n ** 64n)],
        'Uint128: multiplication overflow',
      ],
      ['div', [5n, 0n], 'Uint128: division by zero'],
      ['divU128', [toU128(5n), toU128(0n)], 'Uint128: division by zero'],
    ] as [string, unknown[], string][])(
      '%s has no accepted preimage, with honest or forged splits',
      async (circuit, args, message) => {
        // The honest division witness throws for a zero divisor: the plan
        // gives a result for it.
        const zeroDivision = { quotient: toU128(0n), remainder: toU128(5n) };
        const plans = [
          (call: { name: string }) =>
            call.name === 'wit_divU128' ? zeroDivision : undefined,
          (call: { name: string; index: number; result: unknown }) => {
            if (call.name === 'wit_divU128') return zeroDivision;
            if (call.index !== 0 || call.name !== 'wit_divUint128') {
              return undefined;
            }
            const split = call.result as {
              quotient: U128Limbs;
              remainder: U128Limbs;
            };
            return {
              quotient: { ...split.quotient, high: 1n },
              remainder: { ...split.remainder, high: 1n },
            };
          },
        ];
        for (const plan of plans) {
          const outcome = await forger.attempt(circuit, args, { plan });
          expect(outcome.verdict.accepted).toBe(false);
          expect(outcome.failures).toContain(message);
        }
      },
    );
  },
);

describe.skipIf(isLiveBackend())(
  'MockUint128 ZKIR v2 relation: addChecked, which uses no witness',
  () => {
    let simulator: S;
    let forger: RelationForger;
    const boundary: [bigint, bigint][] = [
      [0n, 0n],
      [MAX_UINT128, 0n],
      [MAX_UINT64, 1n],
      [2n ** 127n, 2n ** 127n - 1n],
    ];
    const overflows: [bigint, bigint][] = [
      [MAX_UINT128, 1n],
      [2n ** 127n, 2n ** 127n],
      [MAX_UINT128, MAX_UINT128],
    ];

    beforeAll(async () => {
      simulator = await Uint128Simulator.create();
      forger = await RelationForger.create('MockUint128', Uint128Witnesses());
    });

    test.each(['addChecked', 'addCheckedU128'])(
      '%s has no private input',
      (circuit) => {
        expect(witnessCoverage(loadZkir('MockUint128', circuit))).toEqual([]);
      },
    );

    test('accepts the honest preimage of the boundary and random inputs', async () => {
      const inputs = [
        ...boundary,
        ...fc.sample(sumFits, { numRuns: 32, seed: RELATION_SEED }),
      ];
      for (const [a, b] of inputs) {
        expect(
          await expectHonestAccepted(
            simulator,
            'MockUint128',
            'addChecked',
            () => simulator.addChecked(a, b),
          ),
        ).toBe(a + b);
        expect(
          await expectHonestAccepted(
            simulator,
            'MockUint128',
            'addCheckedU128',
            () => simulator.addCheckedU128(toU128(a), toU128(b)),
          ),
        ).toBe(a + b);
      }
    }, 60_000);

    test('has no accepted preimage for an overflow', async () => {
      for (const [a, b] of overflows) {
        await expectMustRejectInput(forger, 'addChecked', [a, b]);
        await expectMustRejectInput(forger, 'addCheckedU128', [
          toU128(a),
          toU128(b),
        ]);
      }
    });

    test.each([
      ['addChecked', [1n, 2n]],
      ['addCheckedU128', [toU128(1n), toU128(2n)]],
    ] as [string, unknown[]][])(
      '%s rejects every argument above its declared type',
      async (circuit, args) => {
        const honest = await forger.replay(circuit, args);
        expect(honest.calls).toEqual([]);
        const forged = inputForgeries(
          args,
          fieldWidths(honest.proofData.input.alignment),
        );
        expect(forged.length).toBeGreaterThan(0);
        for (const { label, args: forgedArgs } of forged) {
          const outcome = await forger.attempt(circuit, forgedArgs);
          expect(outcome.verdict.accepted, label).toBe(false);
        }
      },
    );
  },
);
