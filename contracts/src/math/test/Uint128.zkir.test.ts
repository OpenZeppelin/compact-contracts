import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { beforeAll, describe, expect, test } from 'vitest';
import { fieldWidths } from '#test-utils/zkir/fieldRepr.js';
import {
  type ForgeryPlan,
  RelationForger,
  witnessLeaves,
} from '#test-utils/zkir/forgery.js';
import { loadZkir } from '#test-utils/zkir/relationCheck.js';
import { witnessCoverage } from '#test-utils/zkir/witnessCoverage.js';
import { OUTPUTS } from '#test-utils/zkir/zkirV2.js';
import { Uint128Simulator } from './simulators/Uint128Simulator.js';
import { MAX_UINT64, MAX_UINT128 } from './utils/consts.js';
import {
  describeRelation,
  expectHonestAccepted,
  expectMustRejectInput,
  inputForgeries,
  mustRejectPlan,
  productForgeries,
  RELATION_SEED,
  relationCase,
  SQRT_FIELD_ROOT,
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
 * Most circuits that take a `Uint<128>` argument split it with `toU128`,
 * and `_add` and `_mul` split their intermediate sums and products. The
 * `Uint<128>` forms of `div`, `rem`, `divRem` and `isMultiple` split nothing:
 * they call `wit_divUint128(a, b)` as their division witness and check it with
 * native arithmetic. The forgeries attack each split, both division witnesses
 * and the root witness. The free leaves are `quotient.high` and
 * `remainder.high` of each split.
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
// The coordinated forgeries of the U128 forms need a divisor with b.high = 0
// (splits ll, hl and offset 1), with b.low = 0 (lh, hh and offset 2) and
// b.high a power of two (offset 3). 10 / 2^65 is the input of plan review
// MM-04: the quotient 2^64 - 1 has a zero high limb, and its product with b
// is above 2^128.
const divisionForgeries: [bigint, bigint][] = [
  [A, 2n ** 65n + 2n],
  [A, 12345n],
  [A, 12345n << 64n],
  [A, 1n << 127n],
  [10n, 2n ** 65n],
];
// The coordinated forgeries isolate every split of _mul(quotient, b) in the
// U128 forms. The Uint<128> forms split nothing.
const divisionIsolates = { coordinated: [0, 1, 2, 3, 4, 5, 6] };

const asU128 = <T extends readonly bigint[]>(values: T) =>
  values.map((v) => toU128(v)) as { [K in keyof T]: U128Limbs };

/**
 * A case for the `Uint<128>` form and one for the `U128` form of a circuit.
 * `toResult` converts the oracle result to the result type of the `U128`
 * form. `isolates` applies to both forms, `isolatesU128` to the `U128` form
 * only (a `Uint<128>` form that checks its witness with native arithmetic
 * has no internal split).
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
  isolatesU128?: { coordinated: number[]; single?: number[] };
  /** Argument forgeries of the `Uint<128>` form only. */
  argumentForgeries?: (args: A) => { label: string; args: unknown[] }[];
  toResult?: (result: unknown) => unknown;
}) => {
  const toResult = entry.toResult ?? ((result: unknown) => result);
  const { isolatesU128, ...scalar } = entry;
  return [
    relationCase<S, A>(scalar),
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
      isolates: isolatesU128 ?? entry.isolates,
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
      // b = 3 * 2^64 lets a split of a with a high limb out of range give the
      // same product, so only the range check of that limb rejects it.
      forgeries: [
        [2n ** 63n + 5n, 2n ** 63n + 0x7fffn],
        [A, 0n],
        [0n, B],
        [2n ** 40n + 5n, 3n * 2n ** 64n],
      ],
      argumentForgeries: productForgeries,
      // 2^127 * 2^127 makes the last split of _mul nonzero while the one
      // before has a zero low part: only that split shows the overflow.
      rejects: [
        [2n ** 64n, 2n ** 64n],
        [MAX_UINT128, 2n],
        [2n ** 127n, 2n ** 127n],
        [MAX_UINT64, 2n ** 64n + 2n],
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
      isolatesU128: divisionIsolates,
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
      isolatesU128: divisionIsolates,
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
      isolatesU128: divisionIsolates,
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
      isolatesU128: divisionIsolates,
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
      // In sqrtU128 (_sqrt), hh, offset 2 and offset 3 reach only the high
      // half of the square, which _sqrt does not check: no forgery with
      // another root passes. The Uint<128> form splits only the radicand,
      // before the root.
      isolatesU128: {
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
        // The honest division witnesses throw for a zero divisor:
        // mustRejectPlan gives a result for them. The second plan also
        // changes the free fields of the first split, if the circuit has one.
        const plans: ForgeryPlan[] = [
          mustRejectPlan,
          (call) => {
            const filled = mustRejectPlan(call);
            if (filled !== undefined) return filled;
            if (
              call.index !== 0 ||
              call.name !== 'wit_divUint128' ||
              call.args[1] !== 2n ** 64n
            ) {
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
  'MockUint128 ZKIR v2 relation: the division witness of plan review MM-04',
  () => {
    // a = 10, b = 2^65, quotient 2^64 - 1, remainder 0: the quotient has a
    // zero high limb, and q * b = 2^129 - 2^65 does not fit in 128 bits.
    const forged = { quotient: toU128(MAX_UINT64), remainder: toU128(0n) };
    let forger: RelationForger;

    beforeAll(async () => {
      forger = await RelationForger.create('MockUint128', Uint128Witnesses());
    });

    test.each([
      ['div', [10n, 2n ** 65n], 'wit_divUint128'],
      ['rem', [10n, 2n ** 65n], 'wit_divUint128'],
      ['divRem', [10n, 2n ** 65n], 'wit_divUint128'],
      ['isMultiple', [10n, 2n ** 65n], 'wit_divUint128'],
      ['divU128', [toU128(10n), toU128(2n ** 65n)], 'wit_divU128'],
      ['divRemU128', [toU128(10n), toU128(2n ** 65n)], 'wit_divU128'],
    ] as [string, unknown[], string][])(
      '%s has no accepted preimage and fails first with "division product overflow"',
      async (circuit, args, witness) => {
        const outcome = await forger.forge(circuit, args, (call) =>
          call.name === witness ? forged : undefined,
        );
        expect(outcome.coherent).toBe(true);
        expect(outcome.deviations.map((d) => d.call.name)).toEqual([witness]);
        expect(outcome.verdict.accepted).toBe(false);
        expect(outcome.failures[0]).toBe('Uint128: division product overflow');
      },
    );
  },
);

describe.skipIf(isLiveBackend())(
  'MockUint128 ZKIR v2 relation: a root that is a field element',
  () => {
    // For n = 2^128 - 1, the field element SQRT_FIELD_ROOT has root^2 <= n and
    // (root + 1)^2 > n in the field (see utils/forgeries.ts). Only the range
    // check of the root (a Uint<64>) rejects it.
    const n = MAX_UINT128;
    const plan: ForgeryPlan = (call) =>
      call.name === 'wit_sqrtU128' ? SQRT_FIELD_ROOT : undefined;
    let forger: RelationForger;

    beforeAll(async () => {
      forger = await RelationForger.create('MockUint128', Uint128Witnesses());
    });

    test.each([
      ['sqrt', [n]],
      ['sqrtU128', [toU128(n)]],
    ] as [string, unknown[]][])('%s rejects it', async (circuit, args) => {
      const outcome = await forger.forge(circuit, args, plan);
      expect(outcome.verdict.accepted).toBe(false);
    });

    test('sqrt accepts it without the range check of the root, with a wrong result', async () => {
      const honest = await forger.replay('sqrt', [n]);
      const position = honest.calls
        .slice(
          0,
          honest.calls.findIndex((c) => c.name === 'wit_sqrtU128'),
        )
        .reduce((sum, c) => sum + witnessLeaves(c.result).length, 0);
      const zkir = loadZkir('MockUint128', 'sqrt');
      const mutant = structuredClone(zkir);
      let variable = zkir.num_inputs;
      let privateIndex = 0;
      let rootVariable: number | undefined;
      for (const ins of zkir.instructions) {
        if (ins.op === 'private_input') {
          if (privateIndex === position) rootVariable = variable;
          privateIndex++;
        }
        variable += OUTPUTS[ins.op] ?? 0;
      }
      const check = mutant.instructions.findIndex(
        (ins) => ins.op === 'constrain_bits' && ins.var === rootVariable,
      );
      expect(check).toBeGreaterThan(0);
      mutant.instructions.splice(check, 1);
      const outcome = await forger.forge('sqrt', [n], plan, mutant);
      expect(outcome.verdict.accepted).toBe(true);
      expect(outcome.outputChanged).toBe(true);
    });
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
      ['addChecked', [MAX_UINT128, 1n]],
      ['addCheckedU128', [toU128(MAX_UINT128), toU128(1n)]],
    ] as [string, unknown[]][])(
      '%s rejects an overflow with "Uint128: addition overflow"',
      async (circuit, args) => {
        const outcome = await forger.attempt(circuit, args);
        expect(outcome.verdict.accepted).toBe(false);
        expect(outcome.failures).toContain('Uint128: addition overflow');
      },
    );

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
