import { describe, expect, test } from 'vitest';
import type { WitnessCall } from '#test-utils/zkir/forgery.js';
import {
  inputForgeries,
  isFreeLeaf,
  jointForgeries,
  leafForgeries,
  mustRejectPlan,
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
    expect([0, 1, 2, 3].filter((leaf) => isFreeLeaf(split, leaf))).toEqual([
      1, 3,
    ]);
    expect(isFreeLeaf(call('wit_divUint128', [5n, 3n], {}), 1)).toBe(false);
    expect(isFreeLeaf(call('wit_divU128', [5n, 2n ** 64n], {}), 1)).toBe(false);
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
    const forgeries = jointForgeries(call('wit_unpackBytes', [], [5n]));
    expect(forgeries.map((f) => f.label)).toEqual([
      'wit_unpackBytes: digit 0 + 1 mod 256',
    ]);
  });

  test('gives the product-overflow forgery only for an even divisor', () => {
    const forge = (b: bigint) =>
      jointForgeries(
        call('wit_divU128', [toU128(100n), toU128(b)], {
          quotient: toU128(100n / b),
          remainder: toU128(100n % b),
        }),
      ).map((f) => f.attacks);
    expect(forge(4n)).toContain('Uint128: division product overflow');
    expect(forge(3n)).not.toContain('Uint128: division product overflow');
  });

  test('rejects an unknown witness and a split with another divisor', () => {
    expect(() => jointForgeries(call('wit_other', [], 0n))).toThrow(
      'no joint forgeries for wit_other',
    );
    expect(() => jointForgeries(call('wit_divUint128', [5n, 3n], {}))).toThrow(
      'wit_divUint128 is called only by toU128',
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
    expect(mustRejectPlan(call('wit_divUint64', [5n, 1n], {}))).toBeUndefined();
    expect(mustRejectPlan(call('wit_sqrtU128', [], undefined))).toBeUndefined();
  });
});
