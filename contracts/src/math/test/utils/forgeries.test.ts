import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { describe, expect, test } from 'vitest';
import { FIELD_MODULUS } from '#test-utils/zkir/fieldRepr.js';
import { RelationForger, type WitnessCall } from '#test-utils/zkir/forgery.js';
import { loadZkir } from '#test-utils/zkir/relationCheck.js';
import { Uint64Witnesses } from '../witnesses/Uint64Witnesses.js';
import {
  describeConstraint,
  divisionFailure,
  findConstraint,
  inputForgeries,
  isDivisionCall,
  isFreeLeaf,
  jointForgeries,
  leafForgeries,
  mustRejectPlan,
  SQRT_FIELD_ROOT,
  SQRT_FIELD_SQUARE,
} from './forgeries.js';
import { toU128 } from './oracles.js';

const call = (name: string, args: unknown[], result: unknown): WitnessCall => ({
  index: 0,
  name,
  args,
  result,
});

describe('forgery catalogue', () => {
  test('marks only the high fields of a toU128 split as free', () => {
    const split = call('wit_divUint128', [5n, 2n ** 64n], {});
    expect(
      [0, 1, 2, 3].filter((leaf) => isFreeLeaf('mulChecked', split, leaf)),
    ).toEqual([1, 3]);
    expect(isFreeLeaf('toU128', call('wit_divUint128', [5n, 3n], {}), 1)).toBe(
      false,
    );
    expect(
      isFreeLeaf('divU128', call('wit_divU128', [5n, 2n ** 64n], {}), 1),
    ).toBe(false);
  });

  test('marks no leaf of the division witness of a Uint<128> division as free', () => {
    // A division by 2^64 has the arguments of a split.
    const division = call('wit_divUint128', [5n, 2n ** 64n], {});
    for (const circuit of ['div', 'rem', 'divRem', 'isMultiple']) {
      expect(isDivisionCall(circuit, division)).toBe(true);
      expect(
        [0, 1, 2, 3].filter((leaf) => isFreeLeaf(circuit, division, leaf)),
      ).toEqual([]);
    }
    expect(isDivisionCall('divU128', division)).toBe(false);
    expect(isDivisionCall('div', call('wit_divUint64', [5n, 3n], {}))).toBe(
      false,
    );
  });

  test('gives a field root that passes both bound checks of Uint128.sqrt', () => {
    const square = (x: bigint) => (x * x) % FIELD_MODULUS;
    expect(square(SQRT_FIELD_ROOT)).toBe(SQRT_FIELD_SQUARE);
    expect(SQRT_FIELD_SQUARE).toBeLessThan(2n ** 128n);
    expect(square(SQRT_FIELD_ROOT + 1n)).toBeGreaterThan(2n ** 128n - 1n);
    expect(square(SQRT_FIELD_ROOT + 1n)).toBeLessThan(2n ** 129n);
    expect(SQRT_FIELD_ROOT).toBeGreaterThan(2n ** 64n);
    const sqrtCall = (n: bigint) =>
      call('wit_sqrtU128', [toU128(n)], 2n ** 63n);
    expect(
      jointForgeries('sqrt', sqrtCall(2n ** 128n - 1n)).map((f) => f.value),
    ).toContain(SQRT_FIELD_ROOT);
    expect(
      jointForgeries('sqrt', sqrtCall(SQRT_FIELD_SQUARE - 1n)).map(
        (f) => f.value,
      ),
    ).not.toContain(SQRT_FIELD_ROOT);
  });

  test('names the first failing check of a division in the module order', () => {
    expect(divisionFailure(10n, 5n, 2n, 0n)).toBeUndefined();
    expect(divisionFailure(10n, 5n, 1n, 5n)).toBe('Uint128: remainder error');
    // Plan review MM-04: a = 10, b = 2^65, q = 2^64 - 1, r = 0.
    expect(divisionFailure(10n, 2n ** 65n, 2n ** 64n - 1n, 0n)).toBe(
      'Uint128: division product overflow',
    );
    expect(divisionFailure(10n, 5n, 3n, 0n)).toBe('Uint128: division invalid');
  });

  test('gives division forgeries for the division witness of a Uint<128> division', () => {
    const division = (a: bigint, b: bigint) =>
      call('wit_divUint128', [a, b], {
        quotient: toU128(a / b),
        remainder: toU128(a % b),
      });
    const forgeries = jointForgeries('div', division(10n, 2n ** 65n));
    expect(forgeries).toContainEqual({
      label: 'wit_divUint128 division: quotient.low = 2^64 - 1',
      value: { quotient: toU128(2n ** 64n - 1n), remainder: toU128(10n) },
      attacks: 'Uint128: division product overflow',
    });
    expect(forgeries.map((f) => f.attacks)).toContain(
      'Uint128: division invalid',
    );
    expect(
      jointForgeries('rem', division(2n ** 100n, 3n)).map((f) => f.attacks),
    ).toContain('Uint128: remainder error');
    // The split forgeries stay for every other circuit.
    expect(
      jointForgeries('mulChecked', division(10n, 2n ** 64n)).map(
        (f) => f.label,
      ),
    ).toContain('toU128 split: high + 1');
  });

  test('gives leaf forgeries that differ from the honest leaf', () => {
    const forgeries = leafForgeries(call('wit_sqrtUint64', [9n], 3n), [32]);
    expect(forgeries.map((f) => f.value)).not.toContain(3n);
    expect(forgeries.map((f) => f.value)).toContain(2n ** 32n);
  });

  test('rejects a leaf without a bit width', () => {
    expect(() =>
      leafForgeries(call('wit_sqrtUint64', [9n], 3n), [undefined]),
    ).toThrow('leaf 0 of wit_sqrtUint64 has no bit width');
  });

  test('gives no range isolation for a single digit', () => {
    const forgeries = jointForgeries(
      'unpack8',
      call('wit_unpackBytes', [], [5n]),
    );
    expect(forgeries.map((f) => f.label)).toEqual([
      'wit_unpackBytes: digit 0 + 1 mod 256',
    ]);
  });

  test('gives the product-overflow forgery only for an even divisor', () => {
    const forge = (b: bigint) =>
      jointForgeries(
        'divU128',
        call('wit_divU128', [toU128(100n), toU128(b)], {
          quotient: toU128(100n / b),
          remainder: toU128(100n % b),
        }),
      ).map((f) => f.attacks);
    expect(forge(4n)).toContain('Uint128: division product overflow');
    expect(forge(3n)).not.toContain('Uint128: division product overflow');
  });

  test('rejects an unknown witness and a split with another divisor', () => {
    expect(() => jointForgeries('other', call('wit_other', [], 0n))).toThrow(
      'no joint forgeries for wit_other',
    );
    expect(() =>
      jointForgeries('toU128', call('wit_divUint128', [5n, 3n], {})),
    ).toThrow(
      'wit_divUint128 outside a Uint<128> division is a toU128 split with the divisor 2^64',
    );
  });

  test('forges each bounded argument leaf and skips bytes and fields', () => {
    expect(inputForgeries([1n, toU128(2n)], [64, 64, 64])).toEqual([
      {
        label: 'argument leaf 0 = 2^64 + 1',
        args: [2n ** 64n + 1n, toU128(2n)],
      },
      {
        label: 'argument leaf 1 = 2^64 + 1',
        args: [1n, { low: 2n ** 64n + 1n, high: 0n }],
      },
      {
        label: 'argument leaf 2 = 2^64 + 1',
        args: [1n, { low: 2n, high: 2n ** 64n + 1n }],
      },
    ]);
    expect(inputForgeries([new Uint8Array(8)], [64])).toEqual([]);
    expect(inputForgeries([5n], [undefined])).toEqual([]);
    expect(() => inputForgeries([1n, 2n], [64])).toThrow(
      'arguments have 2 leaves, input has 1',
    );
  });

  test('fills only a division witness that throws', () => {
    expect(mustRejectPlan(call('wit_divUint64', [5n, 0n], undefined))).toEqual({
      quotient: 0n,
      remainder: 5n,
    });
    expect(
      mustRejectPlan(call('wit_divU128', [toU128(5n), toU128(0n)], undefined)),
    ).toEqual({ quotient: toU128(0n), remainder: toU128(5n) });
    expect(
      mustRejectPlan(call('wit_divUint128', [2n ** 100n, 0n], undefined)),
    ).toEqual({ quotient: toU128(0n), remainder: toU128(2n ** 100n) });
    expect(mustRejectPlan(call('wit_divUint64', [5n, 1n], {}))).toBeUndefined();
    expect(mustRejectPlan(call('wit_sqrtU128', [], undefined))).toBeUndefined();
  });
});

describe.skipIf(isLiveBackend())(
  'constraint descriptions and field preimages',
  () => {
    test('describes each constraint of Uint64.div by what it constrains', () => {
      const zkir = loadZkir('MockUint64', 'div');
      expect(describeConstraint(zkir, 0)).toBe('range of input 0');
      const quotient = findConstraint(zkir, 'range of witness element 0');
      expect(zkir.instructions[quotient]).toMatchObject({
        op: 'constrain_bits',
        bits: 64,
      });
      expect(findConstraint(zkir, 'assert 0')).toBeLessThan(
        findConstraint(zkir, 'assert 1'),
      );
      expect(() => describeConstraint(zkir, -1)).toThrow(
        'instruction -1 is not a constraint',
      );
      expect(() => findConstraint(zkir, 'assert 99')).toThrow(
        "0 constraints are described as 'assert 99', not 1",
      );
    });

    test('checks a preimage given as field elements', async () => {
      const forger = await RelationForger.create(
        'MockUint64',
        Uint64Witnesses(),
      );
      const honest = await forger.checkFields(
        'div',
        [10n, 3n],
        [10n, 3n],
        [3n, 1n],
      );
      expect(honest.verdict).toEqual({ accepted: true });
      expect(honest.evaluation.outputs).toEqual([3n]);
      const forged = await forger.checkFields(
        'div',
        [10n, 3n],
        [10n, 3n],
        [2n, 4n],
      );
      expect(forged.verdict.accepted).toBe(false);
      await expect(
        forger.checkFields('div', [10n, 3n], [10n, 3n], [3n]),
      ).rejects.toThrow(
        'the honest run of div reads 2 private elements, not 1',
      );
    });
  },
);
