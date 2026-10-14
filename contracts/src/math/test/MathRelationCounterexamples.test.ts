import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { describe, expect, test } from 'vitest';
import { FIELD_MODULUS } from '#test-utils/zkir/fieldRepr.js';
import { RelationForger } from '#test-utils/zkir/forgery.js';
import { loadZkir } from '#test-utils/zkir/relationCheck.js';
import { evaluate } from '#test-utils/zkir/zkirV2.js';
import { MAX_UINT64, MAX_UINT128 } from './utils/consts.js';
import { findConstraint } from './utils/forgeries.js';
import { toU128 } from './utils/oracles.js';
import { PackWitnesses } from './witnesses/PackWitnesses.js';
import { Uint64Witnesses } from './witnesses/Uint64Witnesses.js';
import { Uint128Witnesses } from './witnesses/Uint128Witnesses.js';

/**
 * Relation tests from the counterexamples of a Z3 model of the circuits.
 *
 * The model (the ZKIR v2 and v3 circuits of compiler 0.34.0, with the
 * constraints that the proof server builds for each instruction) shows which
 * constraints no other constraint of the same circuit implies. For each such
 * constraint, it gives a preimage that satisfies every other constraint.
 * Most of these preimages need a value near the field modulus or a field
 * inverse, which the generated forgeries of the relation tests do not give.
 * Each case below is one preimage, as field elements: the circuit inputs and
 * the private transcript.
 *
 *   1. The relation check rejects the preimage for the expected reason, and
 *      the evaluator (circuit rule) finds exactly one violated constraint:
 *      the constraint of the case.
 *   2. Without that constraint, the evaluator finds no violation, and the
 *      relation check accepts the preimage. In a `wraps` case, the sum of a
 *      `reconstitute_field` chain reaches the field modulus. The circuit
 *      accepts this sum, but the interpreter of the relation check stops
 *      with "Reconstituted element overflows field".
 *
 * Thus each case fails if its constraint is not in the compiled circuit.
 */

const R = FIELD_MODULUS;
/** The top digit `(r - 1) / 256`: `256 * W + 1` is the field modulus. */
const W = (R - 1n) / 256n;
const TWO_64 = 2n ** 64n;

const inverse = (value: bigint): bigint => {
  let result = 1n;
  let base = value % R;
  for (let e = R - 2n; e > 0n; e >>= 1n) {
    if (e & 1n) result = (result * base) % R;
    base = (base * base) % R;
  }
  return result;
};

/** `length` transcript elements: zero except at the given positions. */
const sparse = (length: number, values: Record<number, bigint>): bigint[] =>
  Array.from({ length }, (_, i) => values[i] ?? 0n);

const bits = (n: number) =>
  new RegExp(`^Bit bound failed: [0-9a-f]+ is not ${n}-bit$`);
const ASSERTION = /^Failed direct assertion$/;

type Case = {
  artifact: string;
  circuit: string;
  /** The constraint that rejects the preimage (see `describeConstraint`). */
  constraint: string;
  /** What the preimage forges. */
  attack: string;
  inputs: bigint[];
  privates: bigint[];
  /** Arguments of an honest call: the public transcript and the witness calls. */
  honest: unknown[];
  reason: RegExp;
  wraps?: boolean;
};

const WITNESSES: Record<string, () => object> = {
  MockPack: PackWitnesses,
  MockBytes8: PackWitnesses,
  MockBytes32: PackWitnesses,
  MockField255: PackWitnesses,
  MockUint64: Uint64Witnesses,
  MockUint128: Uint128Witnesses,
};

// The top digit of a `reconstitute_field` chain. The other digit range
// checks are implied: the chain sum stays below 2^255 only when every lower
// digit is below 256.
const digit = (
  artifact: string,
  circuit: string,
  constraint: string,
  attack: string,
  inputs: bigint[],
  privates: bigint[],
  honest: unknown[],
): Case => ({
  artifact,
  circuit,
  constraint,
  attack,
  inputs,
  privates,
  honest,
  reason: bits(8),
  wraps: true,
});
const WRAP_TO_ZERO = 'top digit (r - 1) / 256, next digit 1: the bytes of 0';
const WRAP_TO_255 = 'top digit (r - 1) / 256 + 1 in place of next digit 255';
const BYTES8 = [new Uint8Array(8)];
const BYTES16 = [new Uint8Array(16)];
const BYTES32 = [new Uint8Array(32)];
const DIGITS: Case[] = [
  digit(
    'MockPack',
    'unpack8',
    'range of witness element 7',
    WRAP_TO_ZERO,
    [0n],
    sparse(8, { 6: 1n, 7: W }),
    BYTES8,
  ),
  digit(
    'MockPack',
    'unpack16',
    'range of witness element 15',
    WRAP_TO_ZERO,
    [0n],
    sparse(16, { 14: 1n, 15: W }),
    BYTES16,
  ),
  digit(
    'MockPack',
    'unpack32',
    'range of witness element 30',
    WRAP_TO_ZERO,
    [0n, 0n],
    sparse(32, { 29: 1n, 30: W }),
    BYTES32,
  ),
  digit(
    'MockBytes8',
    'unpack',
    'range of witness element 7',
    WRAP_TO_ZERO,
    [0n],
    sparse(8, { 6: 1n, 7: W }),
    BYTES8,
  ),
  digit(
    'MockBytes8',
    'bytesToUint64',
    'range of witness element 7',
    WRAP_TO_255,
    [0xffn << 48n],
    sparse(8, { 7: W + 1n }),
    BYTES8,
  ),
  digit(
    'MockBytes32',
    'unpack',
    'range of witness element 30',
    WRAP_TO_ZERO,
    [0n, 0n],
    sparse(32, { 29: 1n, 30: W }),
    BYTES32,
  ),
  digit(
    'MockBytes32',
    'bytesToU256',
    'range of witness element 30',
    'top digit (r - 1) / 256 + 256 in place of digits 255 and 0',
    [0n, 0xffff000000000000ffffffffffff0000ffffffffffff0000ffffffffffffffn],
    sparse(32, {
      ...Object.fromEntries(
        [
          0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14, 17, 18, 19, 20, 21, 22,
        ].map((i) => [i, 0xffn]),
      ),
      30: W + 256n,
    }),
    BYTES32,
  ),
  digit(
    'MockField255',
    'toU256',
    'range of witness element 30',
    'top digit (r - 1) / 256 + 256 in place of digits 255 and 0',
    [0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00n],
    sparse(32, {
      ...Object.fromEntries(
        Array.from({ length: 28 }, (_, i) => [i + 1, 0xffn]),
      ),
      30: W + 256n,
    }),
    [5n],
  ),
  digit(
    'MockUint64',
    'toBytes',
    'range of witness element 7',
    WRAP_TO_255,
    [0xffn << 48n],
    sparse(8, { 7: W + 1n }),
    [5n],
  ),
];

// Uint128.addChecked (both forms) adds its arguments in the field and
// range-checks the sum. Only the range checks of the arguments reject an
// argument above its type that gives a sum in range.
const ADD_CHECKED: Case[] = [
  ...[0, 1].map((input) => ({
    artifact: 'MockUint128',
    circuit: 'addChecked',
    constraint: `range of input ${input}`,
    attack: `${input === 0 ? 'a = r - 1, b = 1' : 'a = 1, b = r - 1'}: the sum wraps to 0`,
    inputs: input === 0 ? [R - 1n, 1n] : [1n, R - 1n],
    privates: [],
    honest: [1n, 2n],
    reason: bits(128),
  })),
  ...[0, 1, 2, 3].map((input) => {
    const limb = ['a.low', 'a.high', 'b.low', 'b.high'][input];
    const high = input % 2 === 1;
    const inputs = [0n, 0n, 0n, 0n];
    inputs[input] = high ? inverse(TWO_64) : TWO_64;
    return {
      artifact: 'MockUint128',
      circuit: 'addCheckedU128',
      constraint: `range of input ${input}`,
      attack: high
        ? `${limb} = 1 / 2^64 in the field: the argument counts as 1`
        : `${limb} = 2^64: the sum 2^64 is in range`,
      inputs,
      privates: [],
      honest: [toU128(1n), toU128(2n)],
      reason: bits(64),
    };
  }),
];

/**
 * A `Uint<128>` case in the `U128` form: the inputs are the limbs of the two
 * `toU128` splits (transcript elements 0 to 7), and the transcript starts
 * after them. Each `toU128` split has one assertion.
 */
const asU128Form = (entry: Case): Case => {
  const p = entry.privates;
  return {
    ...entry,
    circuit: `${entry.circuit}U128`,
    constraint: entry.constraint
      .replace(/^assert (\d+)$/, (_m, n) => `assert ${Number(n) - 2}`)
      .replace(
        /^range of witness element (\d+)$/,
        (_m, n) => `range of witness element ${Number(n) - 8}`,
      ),
    inputs: [p[2], p[0], p[6], p[4]],
    privates: p.slice(8),
    honest: (entry.honest as bigint[]).map(toU128),
  };
};

// The last split of `_mul` (offset 3): a forged split hides an overflow.
const MUL_CHECKED: Case = {
  artifact: 'MockUint128',
  circuit: 'mulChecked',
  constraint: 'assert 8',
  attack:
    'a * b above 2^128 - 1: a forged split of offset 3 hides the overflow',
  inputs: [0x33333333333333330000000000000004n, 0x50000000000000009n],
  privates: sparse(36, {
    0: 0x3333333333333333n,
    2: 4n,
    4: 5n,
    6: 9n,
    10: 36n,
    12: 1n,
    14: 14757395258967641291n,
    18: 20n,
    22: MAX_UINT64,
    26: 14757395258967641311n,
    28: 1n,
  }),
  honest: [3n, 5n],
  reason: ASSERTION,
};

// `_div`: the range checks of the quotient limbs of `wit_divU128` and the
// conversion assertions of the seven splits of `_mul(quotient, b)`
// (transcript elements 0 to 7: the splits of a and b; 8 to 11: quotient.low,
// quotient.high, remainder.low, remainder.high; then four elements per
// split). The circuits div, rem, divRem and isMultiple have the same
// constraints up to their outputs, and div also range-checks its output.
// The preimages for quotient.high, and the div preimage for quotient.low,
// are not from the model (it found no answer for quotient.high in 60 s):
// each one gives q * b + r = a in the field with a quotient limb at or
// above 2^64.
type Division = Omit<Case, 'artifact' | 'circuit' | 'honest' | 'reason'> & {
  /** A preimage for div, where the preimage of the other circuits gives an output above 2^128 - 1. */
  div?: Pick<Case, 'attack' | 'inputs' | 'privates'>;
};
const split = (term: string) =>
  `a forged split of ${term}: q * b in the field differs from the product`;
const DIVISION: Division[] = [
  {
    constraint: 'range of witness element 8',
    attack:
      'quotient.low = 367848911362215602 / (2^64 - 1) in the field, remainder 2^64 + 1',
    inputs: [0x51adca2ccc24eb3051adca2ccc24eb3n, MAX_UINT128],
    privates: sparse(40, {
      0: 367848911362215603n,
      2: 367848911362215603n,
      4: MAX_UINT64,
      6: MAX_UINT64,
      8: 0x73eda753299d7d48a7277f5b333f554dfae5235e333db14dn,
      10: 1n,
      11: 1n,
      14: 367848911362215602n,
      22: 367848911362215602n,
      30: 367848911362215602n,
    }),
    div: {
      attack: 'quotient.low = 2^64, quotient.high = 0 for 3 * 2^64 / 3',
      inputs: [3n * TWO_64, 3n],
      privates: sparse(40, { 0: 3n, 6: 3n, 8: TWO_64, 12: 3n, 30: 3n }),
    },
  },
  {
    constraint: 'range of witness element 9',
    attack: 'quotient.high = 1 / 3 in the field: 2^64 / 3 with remainder 0',
    inputs: [TWO_64, 3n],
    privates: sparse(40, { 0: 1n, 6: 3n, 9: inverse(3n), 18: 1n, 30: 1n }),
    div: {
      attack: 'quotient.high = 1 / 2 in the field for 2^64 / 2',
      inputs: [TWO_64, 2n],
      privates: sparse(40, { 0: 1n, 6: 2n, 9: inverse(2n), 18: 1n, 30: 1n }),
    },
  },
  {
    constraint: 'assert 4',
    attack: split('quotient.low * b.low'),
    inputs: [0x40000000000000000n, 0x1ffffffffffffffffn],
    privates: sparse(40, {
      0: 4n,
      4: 1n,
      6: MAX_UINT64,
      8: 2n,
      10: 4n,
      12: 1n,
      14: 18446744073709551612n,
      22: 2n,
      30: 3n,
    }),
  },
  {
    constraint: 'assert 5',
    attack: split('quotient.high * b.low'),
    inputs: [1n, 1n],
    privates: sparse(40, { 2: 1n, 6: 1n, 8: 1n, 9: 1n, 14: 1n }),
  },
  {
    constraint: 'assert 6',
    attack: split('quotient.low * b.high'),
    inputs: [0x30000000000000001n, 0x1ffffffffffffffffn],
    privates: sparse(40, {
      0: 3n,
      2: 1n,
      4: 1n,
      6: MAX_UINT64,
      8: 1n,
      10: 2n,
      14: MAX_UINT64,
      22: 2n,
      30: 2n,
    }),
  },
  {
    constraint: 'assert 7',
    attack: split('quotient.high * b.high'),
    inputs: [0x10000000000000001n, 0x20000000000000001n],
    privates: sparse(40, {
      0: 1n,
      2: 1n,
      4: 2n,
      6: 1n,
      9: 1n,
      10: 1n,
      18: 1n,
      30: 1n,
    }),
  },
  {
    constraint: 'assert 8',
    attack: split('offset 1'),
    inputs: [0x10000000000000001n, 0x28000000000000000n],
    privates: sparse(40, {
      0: 1n,
      2: 1n,
      4: 2n,
      6: 9223372036854775808n,
      8: 4n,
      10: 1n,
      11: 1n,
      12: 2n,
      22: 8n,
    }),
  },
  {
    constraint: 'assert 9',
    attack: split('offset 2'),
    inputs: [1n, 0x10000000000000002n],
    privates: sparse(40, {
      2: 1n,
      4: 1n,
      6: 2n,
      9: 9223372036854775808n,
      10: 1n,
      16: 1n,
      26: 9223372036854775808n,
    }),
  },
  {
    constraint: 'assert 10',
    attack: split('offset 3'),
    inputs: [
      0x20000000000000070000000000000000n,
      0x20000000000000000000000000000001n,
    ],
    privates: sparse(40, {
      0: 2305843009213693959n,
      4: 2305843009213693952n,
      6: 1n,
      9: 8n,
      11: 2305843009213693951n,
      18: 8n,
      24: 1n,
      30: 8n,
    }),
  },
];
const DIVISION_CASES: Case[] = ['div', 'rem', 'divRem', 'isMultiple'].flatMap(
  (circuit) =>
    DIVISION.flatMap(({ div, ...entry }) => {
      const base: Case = {
        ...entry,
        artifact: 'MockUint128',
        circuit,
        honest: [10n, 5n],
        reason: entry.constraint.startsWith('assert') ? ASSERTION : bits(64),
      };
      return [
        circuit === 'div' && div !== undefined ? { ...base, ...div } : base,
        asU128Form(base),
      ];
    }),
);

const CASES: Case[] = [
  ...DIGITS,
  ...ADD_CHECKED,
  MUL_CHECKED,
  asU128Form(MUL_CHECKED),
  ...DIVISION_CASES,
];

describe.skipIf(isLiveBackend())(
  'ZKIR v2 relation: counterexamples of the Z3 model',
  () => {
    const forgers = new Map<string, Promise<RelationForger>>();
    const forger = (artifact: string): Promise<RelationForger> => {
      let entry = forgers.get(artifact);
      if (entry === undefined) {
        entry = RelationForger.create(artifact, WITNESSES[artifact]());
        forgers.set(artifact, entry);
      }
      return entry;
    };

    for (const entry of CASES) {
      test(`${entry.artifact}.${entry.circuit} needs [${entry.constraint}]: ${entry.attack}`, async () => {
        const relation = await forger(entry.artifact);
        const zkir = loadZkir(entry.artifact, entry.circuit);
        const check = (options: Parameters<RelationForger['checkFields']>[4]) =>
          relation.checkFields(
            entry.circuit,
            entry.honest,
            entry.inputs,
            entry.privates,
            options,
          );

        const full = await check({ reconstitute: 'circuit' });
        expect(full.verdict.accepted).toBe(false);
        expect(full.verdict.accepted ? '' : full.verdict.reason).toMatch(
          entry.reason,
        );
        const index = findConstraint(zkir, entry.constraint);
        expect(full.evaluation.violations).toEqual([
          { index, op: zkir.instructions[index].op },
        ]);

        const without = structuredClone(zkir);
        without.instructions.splice(index, 1);
        expect(
          evaluate(without, entry.inputs, entry.privates, {
            reconstitute: 'circuit',
          }).violations,
        ).toEqual([]);
        if (entry.wraps) {
          await expect(check({ zkir: without })).rejects.toThrow(
            'Reconstituted element overflows field',
          );
        } else {
          expect((await check({ zkir: without })).verdict).toEqual({
            accepted: true,
          });
        }
      });
    }
  },
);
