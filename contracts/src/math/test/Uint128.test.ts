import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { expectRejection } from '#test-utils/assertions/rejection.js';
import type {
  U128,
  U256,
} from '../../../artifacts/MockUint128/contract/index.js';
import { Uint128Simulator } from './simulators/Uint128Simulator.js';
import {
  MAX_UINT8,
  MAX_UINT16,
  MAX_UINT32,
  MAX_UINT64,
  MAX_UINT128,
} from './utils/consts.js';
import { toU128 as u128 } from './utils/oracles.js';
import { Uint128Witnesses } from './witnesses/Uint128Witnesses.js';

let uint128Simulator: Uint128Simulator;

// Witnesses bind at deploy on a live node, so a test that swaps one with
// `overrideWitness` is dry-only.
const testDryOnly = test.skipIf(isLiveBackend());

const setup = async () => {
  uint128Simulator = await Uint128Simulator.create();
};

describe('Uint128', () => {
  // The mock keeps no state that a test reads. A live run deploys it once per
  // file, because each deploy is a transaction. A dry run creates it again for
  // each test, because `overrideWitness` changes the instance.
  if (isLiveBackend()) {
    beforeAll(setup);
  } else {
    beforeEach(setup);
  }

  test('MODULUS', async () => {
    const result = await uint128Simulator.MODULUS();
    expect(result).toBe(MAX_UINT64 + 1n);
  });

  test('ZERO_U128', async () => {
    const result = await uint128Simulator.ZERO_U128();
    expect(result).toEqual({ low: 0n, high: 0n });
  });

  test('MAX_U128', async () => {
    const result = await uint128Simulator.MAX_U128();
    expect(result.low).toBe(0xffffffffffffffffn);
    expect(result.high).toBe(0xffffffffffffffffn);
  });

  test('MAX_UINT128', async () => {
    expect(await uint128Simulator.MAX_UINT128()).toBe(
      0xffffffffffffffffffffffffffffffffn,
    );
  });

  describe('toU128', () => {
    test('should convert small Uint<128> to U128', async () => {
      const value = 123n;
      const result = await uint128Simulator.toU128(value);
      expect(result.low).toBe(value);
      expect(result.high).toBe(0n);
    });

    test('should convert max Uint<128> to U128', async () => {
      const result = await uint128Simulator.toU128(MAX_UINT128);
      expect(result.low).toBe(MAX_UINT64);
      expect(result.high).toBe(MAX_UINT64);
    });

    test('should handle zero', async () => {
      const result = await uint128Simulator.toU128(0n);
      expect(result.low).toBe(0n);
      expect(result.high).toBe(0n);
    });

    testDryOnly('should fail when reconstruction is invalid', async () => {
      uint128Simulator.overrideWitness('wit_divUint128', (context) => [
        context.privateState,
        { quotient: { low: 1n, high: 0n }, remainder: { low: 1n, high: 0n } },
      ]);
      await expectRejection(
        uint128Simulator.toU128(123n),
        'failed assert: Uint128: conversion invalid',
      );
    });
  });

  describe('toUint128', () => {
    test('should convert U128 to small Uint<128>', async () => {
      const u128: U128 = { low: 123n, high: 0n };
      expect(await uint128Simulator.toUint128(u128)).toBe(123n);
    });

    test('should convert U128 to max Uint<128>', async () => {
      const u128: U128 = { low: MAX_UINT64, high: MAX_UINT64 };
      expect(await uint128Simulator.toUint128(u128)).toBe(MAX_UINT128);
    });

    test('should handle zero U128', async () => {
      const u128: U128 = { low: 0n, high: 0n };
      expect(await uint128Simulator.toUint128(u128)).toBe(0n);
    });
  });

  describe('isZero', () => {
    test('should return true for zero', async () => {
      expect(await uint128Simulator.isZero(0n)).toBe(true);
    });

    test('should return false for non-zero', async () => {
      expect(await uint128Simulator.isZero(1n)).toBe(false);
    });
  });

  describe('isZeroU128', () => {
    test('should return true for zero U128', async () => {
      expect(await uint128Simulator.isZeroU128(u128(0n))).toBe(true);
    });

    test('should return false for non-zero U128', async () => {
      expect(await uint128Simulator.isZeroU128(u128(1n))).toBe(false);
    });
  });

  describe('eq', () => {
    test('should return true for equal numbers', async () => {
      expect(await uint128Simulator.eq(5n, 5n)).toBe(true);
    });

    test('should return false for non-equal numbers', async () => {
      expect(await uint128Simulator.eq(5n, 10n)).toBe(false);
    });
  });

  describe('eqU128', () => {
    test('should return true for equal U128 numbers', async () => {
      expect(await uint128Simulator.eqU128(u128(5n), u128(5n))).toBe(true);
    });

    test('should return false for non-equal U128 numbers', async () => {
      expect(await uint128Simulator.eqU128(u128(5n), u128(10n))).toBe(false);
    });
  });

  describe('lt', () => {
    test('should compare small numbers', async () => {
      expect(await uint128Simulator.lt(5n, 10n)).toBe(true);
      expect(await uint128Simulator.lt(10n, 5n)).toBe(false);
      expect(await uint128Simulator.lt(5n, 5n)).toBe(false);
    });

    test('should compare max Uint<128>', async () => {
      expect(await uint128Simulator.lt(MAX_UINT128, MAX_UINT128)).toBe(false);
      expect(await uint128Simulator.lt(MAX_UINT128 - 1n, MAX_UINT128)).toBe(
        true,
      );
    });

    test('should handle zero', async () => {
      expect(await uint128Simulator.lt(0n, 1n)).toBe(true);
      expect(await uint128Simulator.lt(0n, 0n)).toBe(false);
    });
  });

  describe('lte', () => {
    test('should compare small numbers', async () => {
      expect(await uint128Simulator.lte(5n, 10n)).toBe(true);
      expect(await uint128Simulator.lte(10n, 5n)).toBe(false);
      expect(await uint128Simulator.lte(5n, 5n)).toBe(true);
    });

    test('should compare max Uint<128>', async () => {
      expect(await uint128Simulator.lte(MAX_UINT128, MAX_UINT128)).toBe(true);
      expect(await uint128Simulator.lte(MAX_UINT128 - 1n, MAX_UINT128)).toBe(
        true,
      );
    });

    test('should handle zero', async () => {
      expect(await uint128Simulator.lte(0n, 1n)).toBe(true);
      expect(await uint128Simulator.lte(0n, 0n)).toBe(true);
    });
  });

  describe('ltU128', () => {
    test('should compare small U128 numbers', async () => {
      expect(await uint128Simulator.ltU128(u128(5n), u128(10n))).toBe(true);
      expect(await uint128Simulator.ltU128(u128(10n), u128(5n))).toBe(false);
      expect(await uint128Simulator.ltU128(u128(5n), u128(5n))).toBe(false);
    });

    test('should compare U128 with high parts', async () => {
      expect(
        await uint128Simulator.ltU128(
          u128(MAX_UINT128 - 1n),
          u128(MAX_UINT128),
        ),
      ).toBe(true);
    });

    test('should return false for equal U128 numbers', async () => {
      expect(await uint128Simulator.ltU128(u128(5n), u128(5n))).toBe(false);
    });
  });

  describe('lteU128', () => {
    test('should compare small U128 numbers', async () => {
      expect(await uint128Simulator.lteU128(u128(5n), u128(10n))).toBe(true);
      expect(await uint128Simulator.lteU128(u128(10n), u128(5n))).toBe(false);
      expect(await uint128Simulator.lteU128(u128(5n), u128(5n))).toBe(true);
    });

    test('should compare U128 with high parts', async () => {
      expect(
        await uint128Simulator.lteU128(
          u128(MAX_UINT128 - 1n),
          u128(MAX_UINT128),
        ),
      ).toBe(true);
    });

    test('should return true for equal U128 numbers', async () => {
      expect(await uint128Simulator.lteU128(u128(5n), u128(5n))).toBe(true);
    });
  });

  describe('gt', () => {
    test('should compare small numbers', async () => {
      expect(await uint128Simulator.gt(10n, 5n)).toBe(true);
      expect(await uint128Simulator.gt(5n, 10n)).toBe(false);
      expect(await uint128Simulator.gt(5n, 5n)).toBe(false);
    });

    test('should compare max Uint<128>', async () => {
      expect(await uint128Simulator.gt(MAX_UINT128, MAX_UINT128 - 1n)).toBe(
        true,
      );
      expect(await uint128Simulator.gt(MAX_UINT128, MAX_UINT128)).toBe(false);
    });

    test('should handle zero', async () => {
      expect(await uint128Simulator.gt(1n, 0n)).toBe(true);
      expect(await uint128Simulator.gt(0n, 0n)).toBe(false);
    });
  });

  describe('gtU128', () => {
    test('should compare small U128 numbers', async () => {
      expect(await uint128Simulator.gtU128(u128(10n), u128(5n))).toBe(true);
      expect(await uint128Simulator.gtU128(u128(5n), u128(10n))).toBe(false);
      expect(await uint128Simulator.gtU128(u128(10n), u128(10n))).toBe(false);
    });

    test('should compare U128 with high parts', async () => {
      expect(
        await uint128Simulator.gtU128(
          u128(MAX_UINT128),
          u128(MAX_UINT128 - 1n),
        ),
      ).toBe(true);
    });

    test('should return false for equal U128 numbers', async () => {
      expect(await uint128Simulator.gtU128(u128(5n), u128(5n))).toBe(false);
    });
  });

  describe('gte', () => {
    test('should compare small numbers', async () => {
      expect(await uint128Simulator.gte(10n, 5n)).toBe(true);
      expect(await uint128Simulator.gte(5n, 10n)).toBe(false);
      expect(await uint128Simulator.gte(5n, 5n)).toBe(true);
    });

    test('should compare max Uint<128>', async () => {
      expect(await uint128Simulator.gte(MAX_UINT128, MAX_UINT128 - 1n)).toBe(
        true,
      );
      expect(await uint128Simulator.gte(MAX_UINT128, MAX_UINT128)).toBe(true);
    });

    test('should handle zero', async () => {
      expect(await uint128Simulator.gte(1n, 0n)).toBe(true);
      expect(await uint128Simulator.gte(0n, 0n)).toBe(true);
    });
  });

  describe('gteU128', () => {
    test('should compare small U128 numbers', async () => {
      expect(await uint128Simulator.gteU128(u128(10n), u128(5n))).toBe(true);
      expect(await uint128Simulator.gteU128(u128(5n), u128(10n))).toBe(false);
      expect(await uint128Simulator.gteU128(u128(10n), u128(10n))).toBe(true);
    });

    test('should compare U128 with high parts', async () => {
      expect(
        await uint128Simulator.gteU128(
          u128(MAX_UINT128),
          u128(MAX_UINT128 - 1n),
        ),
      ).toBe(true);
    });

    test('should return true for equal U128 numbers', async () => {
      expect(await uint128Simulator.gteU128(u128(5n), u128(5n))).toBe(true);
    });
  });

  describe('add', () => {
    test('should add two small numbers', async () => {
      const result: U256 = await uint128Simulator.add(5n, 3n);
      expect(result.low.low).toBe(8n);
      expect(result.low.high).toBe(0n);
      expect(result.high.low).toBe(0n);
      expect(result.high.high).toBe(0n);
    });

    test('should handle zero addition', async () => {
      const result: U256 = await uint128Simulator.add(0n, 0n);
      expect(result.low.low).toBe(0n);
      expect(result.low.high).toBe(0n);
      expect(result.high.low).toBe(0n);
      expect(result.high.high).toBe(0n);
      const result2: U256 = await uint128Simulator.add(5n, 0n);
      expect(result2.low.low).toBe(5n);
      expect(result2.low.high).toBe(0n);
      expect(result2.high.low).toBe(0n);
      expect(result2.high.high).toBe(0n);
      const result3: U256 = await uint128Simulator.add(0n, 5n);
      expect(result3.low.low).toBe(5n);
      expect(result3.low.high).toBe(0n);
      expect(result3.high.low).toBe(0n);
      expect(result3.high.high).toBe(0n);
    });

    test('should handle equal values', async () => {
      const result: U256 = await uint128Simulator.add(5n, 5n);
      expect(result.low.low).toBe(10n);
      expect(result.low.high).toBe(0n);
      expect(result.high.low).toBe(0n);
      expect(result.high.high).toBe(0n);
    });

    test('should handle max U128 minus 1 plus 1', async () => {
      const result: U256 = await uint128Simulator.add(MAX_UINT128 - 1n, 1n);
      expect(result.low.low).toBe(MAX_UINT64);
      expect(result.low.high).toBe(MAX_UINT64);
      expect(result.high.low).toBe(0n);
      expect(result.high.high).toBe(0n);
    });

    test('should handle max U128 plus 1', async () => {
      const result: U256 = await uint128Simulator.add(MAX_UINT128, 1n);
      expect(result.low.low).toBe(0n);
      expect(result.low.high).toBe(0n);
      expect(result.high.low).toBe(1n);
      expect(result.high.high).toBe(0n);
    });
  });

  describe('addU128', () => {
    test('should add two small U128 numbers', async () => {
      const result: U256 = await uint128Simulator.addU128(u128(5n), u128(3n));
      expect(result.low.low).toBe(8n);
      expect(result.low.high).toBe(0n);
      expect(result.high.low).toBe(0n);
      expect(result.high.high).toBe(0n);
    });

    test('should handle zero addition', async () => {
      const result: U256 = await uint128Simulator.addU128(u128(0n), u128(0n));
      expect(result.low.low).toBe(0n);
      expect(result.low.high).toBe(0n);
      expect(result.high.low).toBe(0n);
      expect(result.high.high).toBe(0n);

      const result2: U256 = await uint128Simulator.addU128(u128(5n), u128(0n));
      expect(result2.low.low).toBe(5n);
      expect(result2.low.high).toBe(0n);
      expect(result2.high.low).toBe(0n);
      expect(result2.high.high).toBe(0n);

      const result3: U256 = await uint128Simulator.addU128(u128(0n), u128(5n));
      expect(result3.low.low).toBe(5n);
      expect(result3.low.high).toBe(0n);
      expect(result3.high.low).toBe(0n);
      expect(result3.high.high).toBe(0n);
    });

    test('should handle equal U128 values', async () => {
      const result: U256 = await uint128Simulator.addU128(u128(5n), u128(5n));
      expect(result.low.low).toBe(10n);
      expect(result.low.high).toBe(0n);
      expect(result.high.low).toBe(0n);
      expect(result.high.high).toBe(0n);
    });

    test('should handle max U128 plus one', async () => {
      const result: U256 = await uint128Simulator.addU128(
        u128(MAX_UINT128),
        u128(1n),
      );
      expect(result.low.low).toBe(0n);
      expect(result.low.high).toBe(0n);
      expect(result.high.low).toBe(1n);
      expect(result.high.high).toBe(0n);
    });

    test('should handle addition with carry', async () => {
      const result: U256 = await uint128Simulator.addU128(
        u128(MAX_UINT64),
        u128(1n),
      );
      expect(result.low.low).toBe(0n);
      expect(result.low.high).toBe(1n);
      expect(result.high.low).toBe(0n);
      expect(result.high.high).toBe(0n);
    });
  });

  describe('addChecked', () => {
    test('should add two numbers within bounds', async () => {
      const a = 100n;
      const b = 200n;
      const result = await uint128Simulator.addChecked(a, b);
      expect(result).toBe(300n);
    });

    test('should throw on overflow', async () => {
      const a = MAX_UINT128;
      const b = 1n;
      await expectRejection(
        uint128Simulator.addChecked(a, b),
        'failed assert: Uint128: addition overflow',
      );
    });
  });

  describe('addCheckedU128', () => {
    test('should add two U128 numbers within bounds', async () => {
      const a = await uint128Simulator.toU128(100n);
      const b = await uint128Simulator.toU128(200n);
      const result = await uint128Simulator.addCheckedU128(a, b);
      expect(result).toBe(300n);
    });

    test('should throw on overflow', async () => {
      const a = await uint128Simulator.toU128(2n ** 128n - 1n);
      const b = await uint128Simulator.toU128(1n);
      await expectRejection(
        uint128Simulator.addCheckedU128(a, b),
        'failed assert: Uint128: addition overflow',
      );
    });
  });

  describe('sub', () => {
    test('should subtract two small numbers', async () => {
      const result = await uint128Simulator.sub(10n, 4n);
      expect(result).toBe(6n);
    });

    test('should handle equal values', async () => {
      const result = await uint128Simulator.sub(4n, 4n);
      expect(result).toBe(0n);
    });

    test('should handle zero subtraction', async () => {
      const result = await uint128Simulator.sub(5n, 0n);
      expect(result).toBe(5n);
    });

    test('should handle max U128 minus one', async () => {
      const result = await uint128Simulator.sub(MAX_UINT128, 1n);
      expect(result).toBe(MAX_UINT128 - 1n);
    });

    test('should fail on underflow', async () => {
      await expectRejection(
        uint128Simulator.sub(3n, 5n),
        'failed assert: Uint128: subtraction underflow',
      );
      await expectRejection(
        uint128Simulator.sub(0n, 1n),
        'failed assert: Uint128: subtraction underflow',
      );
    });
  });

  describe('subU128', () => {
    test('should subtract two small U128 numbers', async () => {
      const result = await uint128Simulator.subU128(u128(10n), u128(4n));
      expect(result.low).toBe(6n);
      expect(result.high).toBe(0n);
    });

    test('should handle equal U128 values', async () => {
      const result = await uint128Simulator.subU128(u128(4n), u128(4n));
      expect(result.low).toBe(0n);
      expect(result.high).toBe(0n);
    });

    test('should handle zero subtraction', async () => {
      const result = await uint128Simulator.subU128(u128(5n), u128(0n));
      expect(result.low).toBe(5n);
      expect(result.high).toBe(0n);
    });

    test('should handle max U128 minus one', async () => {
      const result = await uint128Simulator.subU128(
        u128(MAX_UINT128),
        u128(1n),
      );
      expect(result.low).toBe(MAX_UINT64 - 1n);
      expect(result.high).toBe(MAX_UINT64);
    });

    test('should subtract with borrow', async () => {
      const result = await uint128Simulator.subU128(
        u128(MAX_UINT64 + 1n),
        u128(1n),
      );
      expect(result.low).toBe(MAX_UINT64);
      expect(result.high).toBe(0n);
    });

    test('should fail on underflow', async () => {
      await expectRejection(
        uint128Simulator.subU128(u128(3n), u128(5n)),
        'failed assert: Uint128: subtraction underflow',
      );
    });
  });

  describe('mul', () => {
    test('should multiply small numbers', async () => {
      const result: U256 = await uint128Simulator.mul(4n, 3n);
      expect(result.low.low).toBe(12n);
      expect(result.low.high).toBe(0n);
      expect(result.high.low).toBe(0n);
      expect(result.high.high).toBe(0n);
    });

    test('should handle zero multiplication', async () => {
      const result: U256 = await uint128Simulator.mul(5n, 0n);
      expect(result.low.low).toBe(0n);
      expect(result.low.high).toBe(0n);
      expect(result.high.low).toBe(0n);
      expect(result.high.high).toBe(0n);

      const result2: U256 = await uint128Simulator.mul(0n, MAX_UINT128);
      expect(result2.low.low).toBe(0n);
      expect(result2.low.high).toBe(0n);
      expect(result2.high.low).toBe(0n);
      expect(result2.high.high).toBe(0n);
    });

    test('should handle multiplication by one', async () => {
      const result: U256 = await uint128Simulator.mul(1n, 5n);
      expect(result.low.low).toBe(5n);
      expect(result.low.high).toBe(0n);
      expect(result.high.low).toBe(0n);
      expect(result.high.high).toBe(0n);

      const result2: U256 = await uint128Simulator.mul(5n, 1n);
      expect(result2.low.low).toBe(5n);
      expect(result2.low.high).toBe(0n);
      expect(result2.high.low).toBe(0n);
      expect(result2.high.high).toBe(0n);
    });

    test('should handle equal values', async () => {
      const result: U256 = await uint128Simulator.mul(5n, 5n);
      expect(result.low.low).toBe(25n);
      expect(result.low.high).toBe(0n);
      expect(result.high.low).toBe(0n);
      expect(result.high.high).toBe(0n);
    });

    test('should handle max U128 by one', async () => {
      const result: U256 = await uint128Simulator.mul(MAX_UINT128, 1n);
      expect(result.low.low).toBe(MAX_UINT64);
      expect(result.low.high).toBe(MAX_UINT64);
      expect(result.high.low).toBe(0n);
      expect(result.high.high).toBe(0n);
    });

    test('should handle max U128 by two', async () => {
      const result: U256 = await uint128Simulator.mul(MAX_UINT128, 2n);
      expect(result.low.low).toBe(MAX_UINT64 - 1n);
      expect(result.low.high).toBe(MAX_UINT64);
      expect(result.high.low).toBe(1n);
      expect(result.high.high).toBe(0n);
    });
  });

  describe('mulU128', () => {
    test('should multiply small U128 numbers', async () => {
      const result: U256 = await uint128Simulator.mulU128(u128(4n), u128(3n));
      expect(result.low.low).toBe(12n);
      expect(result.low.high).toBe(0n);
      expect(result.high.low).toBe(0n);
      expect(result.high.high).toBe(0n);
    });

    test('should handle zero multiplication', async () => {
      const result: U256 = await uint128Simulator.mulU128(u128(5n), u128(0n));
      expect(result.low.low).toBe(0n);
      expect(result.low.high).toBe(0n);
      expect(result.high.low).toBe(0n);
      expect(result.high.high).toBe(0n);

      const result2: U256 = await uint128Simulator.mulU128(u128(0n), u128(5n));
      expect(result2.low.low).toBe(0n);
      expect(result2.low.high).toBe(0n);
      expect(result2.high.low).toBe(0n);
      expect(result2.high.high).toBe(0n);
    });

    test('should handle multiplication by one', async () => {
      const result: U256 = await uint128Simulator.mulU128(u128(1n), u128(5n));
      expect(result.low.low).toBe(5n);
      expect(result.low.high).toBe(0n);
      expect(result.high.low).toBe(0n);
      expect(result.high.high).toBe(0n);

      const result2: U256 = await uint128Simulator.mulU128(u128(5n), u128(1n));
      expect(result2.low.low).toBe(5n);
      expect(result2.low.high).toBe(0n);
      expect(result2.high.low).toBe(0n);
      expect(result2.high.high).toBe(0n);
    });

    test('should handle equal U128 values', async () => {
      const result: U256 = await uint128Simulator.mulU128(u128(5n), u128(5n));
      expect(result.low.low).toBe(25n);
      expect(result.low.high).toBe(0n);
      expect(result.high.low).toBe(0n);
      expect(result.high.high).toBe(0n);
    });

    test('should handle max U128 by two', async () => {
      const result: U256 = await uint128Simulator.mulU128(
        u128(MAX_UINT128),
        u128(2n),
      );
      expect(result.low.low).toBe(MAX_UINT64 - 1n);
      expect(result.low.high).toBe(MAX_UINT64);
      expect(result.high.low).toBe(1n);
      expect(result.high.high).toBe(0n);
    });

    test('should handle multiplication with high part contribution', async () => {
      const result: U256 = await uint128Simulator.mulU128(
        u128(MAX_UINT64 + 1n),
        u128(1n),
      );
      expect(result.low.low).toBe(0n);
      expect(result.low.high).toBe(1n);
      expect(result.high.low).toBe(0n);
      expect(result.high.high).toBe(0n);
    });

    testDryOnly(
      'should split the partial products with 7 toU128 calls',
      async () => {
        // The _mul carry handling (audit L-06) adds each 64-bit result word in
        // one step, so a U128 product needs 7 limb splits: 4 partial products
        // and 3 word sums.
        const honest = Uint128Witnesses().wit_divUint128;
        let calls = 0;
        uint128Simulator.overrideWitness('wit_divUint128', (context, a, b) => {
          calls += 1;
          return honest(context, a, b);
        });
        const result = await uint128Simulator.mulU128(
          u128(MAX_UINT128),
          u128(MAX_UINT128),
        );
        // (2^128 - 1)^2 = (2^128 - 2) * 2^128 + 1
        expect(result).toEqual({ low: u128(1n), high: u128(MAX_UINT128 - 1n) });
        expect(calls).toBe(7);
      },
    );
  });

  describe('mulChecked', () => {
    test('should multiply two numbers within bounds', async () => {
      const a = 100n;
      const b = 200n;
      const result = await uint128Simulator.mulChecked(a, b);
      expect(result).toBe(20000n);
    });

    test('should throw on overflow', async () => {
      const a = 2n ** 64n;
      const b = 2n ** 64n;
      await expectRejection(
        uint128Simulator.mulChecked(a, b),
        'failed assert: Uint128: multiplication overflow',
      );
    });
  });

  describe('mulCheckedU128', () => {
    test('should multiply two U128 numbers within bounds', async () => {
      const a = await uint128Simulator.toU128(100n);
      const b = await uint128Simulator.toU128(200n);
      const result = await uint128Simulator.mulCheckedU128(a, b);
      expect(result).toBe(20000n);
    });

    test('should throw on overflow', async () => {
      const a = await uint128Simulator.toU128(2n ** 64n);
      const b = await uint128Simulator.toU128(2n ** 64n);
      await expectRejection(
        uint128Simulator.mulCheckedU128(a, b),
        'failed assert: Uint128: multiplication overflow',
      );
    });
  });

  describe('div', () => {
    test('should divide small numbers', async () => {
      const result = await uint128Simulator.div(10n, 3n);
      expect(result).toBe(3n);
    });

    test('should handle dividend is zero', async () => {
      const result = await uint128Simulator.div(0n, 5n);
      expect(result).toBe(0n);
    });

    test('should handle divisor is one', async () => {
      const result = await uint128Simulator.div(10n, 1n);
      expect(result).toBe(10n);
    });

    test('should handle dividend equals divisor', async () => {
      const result = await uint128Simulator.div(5n, 5n);
      expect(result).toBe(1n);
    });

    test('should handle dividend less than divisor', async () => {
      const result = await uint128Simulator.div(3n, 5n);
      expect(result).toBe(0n);
    });

    test('should handle max U128 by one', async () => {
      const result = await uint128Simulator.div(MAX_UINT128, 1n);
      expect(result).toBe(MAX_UINT128);
    });

    test('should handle division with remainder', async () => {
      const result = await uint128Simulator.div(100n, 7n);
      expect(result).toBe(14n);
    });

    test('should fail on division by zero', async () => {
      await expectRejection(
        uint128Simulator.div(5n, 0n),
        'failed assert: Uint128: division by zero',
      );
    });

    testDryOnly('should fail when remainder >= divisor', async () => {
      uint128Simulator.overrideWitness('wit_divU128', (context) => [
        context.privateState,
        { quotient: { low: 1n, high: 0n }, remainder: { low: 5n, high: 0n } },
      ]);
      await expectRejection(
        uint128Simulator.div(10n, 5n),
        'failed assert: Uint128: remainder error',
      );
    });

    testDryOnly('should fail when the toU128 witness is invalid', async () => {
      uint128Simulator.overrideWitness('wit_divUint128', (context) => [
        context.privateState,
        { quotient: { low: 1n, high: 0n }, remainder: { low: 5n, high: 0n } },
      ]);
      await expectRejection(
        uint128Simulator.div(10n, 5n),
        'failed assert: Uint128: conversion invalid',
      );
    });
  });

  describe('divU128', () => {
    test('should divide small U128 numbers', async () => {
      const result = await uint128Simulator.divU128(u128(10n), u128(3n));
      expect(result.low).toBe(3n);
      expect(result.high).toBe(0n);
    });

    test('should handle dividend is zero', async () => {
      const result = await uint128Simulator.divU128(u128(0n), u128(5n));
      expect(result.low).toBe(0n);
      expect(result.high).toBe(0n);
    });

    test('should handle divisor is one', async () => {
      const result = await uint128Simulator.divU128(u128(10n), u128(1n));
      expect(result.low).toBe(10n);
      expect(result.high).toBe(0n);
    });

    test('should handle dividend equals divisor', async () => {
      const result = await uint128Simulator.divU128(u128(5n), u128(5n));
      expect(result.low).toBe(1n);
      expect(result.high).toBe(0n);
    });

    test('should handle dividend less than divisor', async () => {
      const result = await uint128Simulator.divU128(u128(3n), u128(5n));
      expect(result.low).toBe(0n);
      expect(result.high).toBe(0n);
    });

    test('should handle max U128 by one', async () => {
      const result = await uint128Simulator.divU128(
        u128(MAX_UINT128),
        u128(1n),
      );
      expect(result.low).toBe(MAX_UINT64);
      expect(result.high).toBe(MAX_UINT64);
    });

    test('should fail on division by zero', async () => {
      await expectRejection(
        uint128Simulator.divU128(u128(5n), u128(0n)),
        'failed assert: Uint128: division by zero',
      );
    });

    testDryOnly('should fail when remainder >= divisor', async () => {
      uint128Simulator.overrideWitness('wit_divU128', (context) => [
        context.privateState,
        { quotient: { low: 1n, high: 0n }, remainder: { low: 5n, high: 0n } },
      ]);
      await expectRejection(
        uint128Simulator.divU128(u128(10n), u128(5n)),
        'failed assert: Uint128: remainder error',
      );
    });
  });

  describe('rem', () => {
    test('should compute remainder of small numbers', async () => {
      const remainder = await uint128Simulator.rem(10n, 3n);
      expect(remainder).toBe(1n);
    });

    test('should handle dividend is zero', async () => {
      const remainder = await uint128Simulator.rem(0n, 5n);
      expect(remainder).toBe(0n);
    });

    test('should handle divisor is one', async () => {
      const remainder = await uint128Simulator.rem(10n, 1n);
      expect(remainder).toBe(0n);
    });

    test('should handle dividend equals divisor', async () => {
      const remainder = await uint128Simulator.rem(5n, 5n);
      expect(remainder).toBe(0n);
    });

    test('should handle dividend less than divisor', async () => {
      const remainder = await uint128Simulator.rem(3n, 5n);
      expect(remainder).toBe(3n);
    });

    test('should compute remainder of max U128 by 2', async () => {
      const remainder = await uint128Simulator.rem(MAX_UINT128, 2n);
      expect(remainder).toBe(1n);
    });

    test('should handle zero remainder', async () => {
      const remainder = await uint128Simulator.rem(6n, 3n);
      expect(remainder).toBe(0n);
    });

    test('should fail on division by zero', async () => {
      await expectRejection(
        uint128Simulator.rem(5n, 0n),
        'failed assert: Uint128: division by zero',
      );
    });

    testDryOnly('should fail when remainder >= divisor', async () => {
      uint128Simulator.overrideWitness('wit_divU128', (context) => [
        context.privateState,
        { quotient: { low: 1n, high: 0n }, remainder: { low: 10n, high: 0n } },
      ]);
      await expectRejection(
        uint128Simulator.rem(20n, 10n),
        'failed assert: Uint128: remainder error',
      );
    });

    testDryOnly('should fail when the toU128 witness is invalid', async () => {
      uint128Simulator.overrideWitness('wit_divUint128', (context) => [
        context.privateState,
        { quotient: { low: 1n, high: 0n }, remainder: { low: 10n, high: 0n } },
      ]);
      await expectRejection(
        uint128Simulator.rem(20n, 10n),
        'failed assert: Uint128: conversion invalid',
      );
    });
  });

  describe('remU128', () => {
    test('should compute remainder of small U128 numbers', async () => {
      const result = await uint128Simulator.remU128(u128(10n), u128(3n));
      expect(result.low).toBe(1n);
      expect(result.high).toBe(0n);
    });

    test('should handle dividend is zero', async () => {
      const result = await uint128Simulator.remU128(u128(0n), u128(5n));
      expect(result.low).toBe(0n);
      expect(result.high).toBe(0n);
    });

    test('should handle divisor is one', async () => {
      const result = await uint128Simulator.remU128(u128(10n), u128(1n));
      expect(result.low).toBe(0n);
      expect(result.high).toBe(0n);
    });

    test('should handle dividend equals divisor', async () => {
      const result = await uint128Simulator.remU128(u128(5n), u128(5n));
      expect(result.low).toBe(0n);
      expect(result.high).toBe(0n);
    });

    test('should handle dividend less than divisor', async () => {
      const result = await uint128Simulator.remU128(u128(3n), u128(5n));
      expect(result.low).toBe(3n);
      expect(result.high).toBe(0n);
    });

    test('should compute remainder of max U128 by 2', async () => {
      const result = await uint128Simulator.remU128(
        u128(MAX_UINT128),
        u128(2n),
      );
      expect(result.low).toBe(1n);
      expect(result.high).toBe(0n);
    });

    test('should fail on division by zero', async () => {
      await expectRejection(
        uint128Simulator.remU128(u128(5n), u128(0n)),
        'failed assert: Uint128: division by zero',
      );
    });

    testDryOnly('remU128 should fail when remainder >= divisor', async () => {
      uint128Simulator.overrideWitness('wit_divU128', (context) => [
        context.privateState,
        { quotient: { low: 1n, high: 0n }, remainder: { low: 10n, high: 0n } },
      ]);
      await expectRejection(
        uint128Simulator.remU128(u128(20n), u128(10n)),
        'failed assert: Uint128: remainder error',
      );
    });
  });
  describe('divRem', () => {
    test('should handle basic division with remainder', async () => {
      const result = await uint128Simulator.divRem(17n, 5n);
      expect(result.quotient.low).toBe(3n);
      expect(result.quotient.high).toBe(0n);
      expect(result.remainder.low).toBe(2n);
      expect(result.remainder.high).toBe(0n);
    });

    test('should handle division without remainder', async () => {
      const result = await uint128Simulator.divRem(15n, 3n);
      expect(result.quotient.low).toBe(5n);
      expect(result.quotient.high).toBe(0n);
      expect(result.remainder.low).toBe(0n);
      expect(result.remainder.high).toBe(0n);
    });

    test('should handle dividend equals divisor', async () => {
      const result = await uint128Simulator.divRem(5n, 5n);
      expect(result.quotient.low).toBe(1n);
      expect(result.quotient.high).toBe(0n);
      expect(result.remainder.low).toBe(0n);
      expect(result.remainder.high).toBe(0n);
    });

    test('should handle dividend less than divisor', async () => {
      const result = await uint128Simulator.divRem(3n, 5n);
      expect(result.quotient.low).toBe(0n);
      expect(result.quotient.high).toBe(0n);
      expect(result.remainder.low).toBe(3n);
      expect(result.remainder.high).toBe(0n);
    });

    test('should compute division of max U128 by 2', async () => {
      const result = await uint128Simulator.divRem(MAX_UINT128, 2n);
      expect(result.quotient.low).toBe(MAX_UINT64);
      expect(result.quotient.high).toBe(MAX_UINT64 >> 1n);
      expect(result.remainder.low).toBe(1n);
      expect(result.remainder.high).toBe(0n);
    });

    test('should fail on division by zero', async () => {
      await expectRejection(
        uint128Simulator.divRem(5n, 0n),
        'failed assert: Uint128: division by zero',
      );
    });

    testDryOnly(
      'should fail when witness returns remainder >= divisor',
      async () => {
        uint128Simulator.overrideWitness('wit_divU128', (context) => [
          context.privateState,
          { quotient: { low: 1n, high: 0n }, remainder: { low: 5n, high: 0n } },
        ]);
        await expectRejection(
          uint128Simulator.divRem(10n, 5n),
          'failed assert: Uint128: remainder error',
        );
      },
    );

    testDryOnly(
      'should fail when witness returns quotient * b + remainder != a',
      async () => {
        uint128Simulator.overrideWitness('wit_divU128', (context) => [
          context.privateState,
          { quotient: { low: 2n, high: 0n }, remainder: { low: 0n, high: 0n } },
        ]);
        await expectRejection(
          uint128Simulator.divRem(11n, 5n),
          'failed assert: Uint128: division invalid',
        );
      },
    );

    testDryOnly(
      'should fail with "division invalid" when quotient * b > a',
      async () => {
        // q * b = 15 fits in 128 bits and r < b, but q * b > a = 10.
        uint128Simulator.overrideWitness('wit_divU128', (context) => [
          context.privateState,
          { quotient: { low: 3n, high: 0n }, remainder: { low: 0n, high: 0n } },
        ]);
        await expectRejection(
          uint128Simulator.divRem(10n, 5n),
          'failed assert: Uint128: division invalid',
        );
      },
    );
  });

  describe('divRemU128', () => {
    test('should handle basic division with remainder', async () => {
      const result = await uint128Simulator.divRemU128(u128(17n), u128(5n));
      expect(result.quotient.low).toBe(3n);
      expect(result.quotient.high).toBe(0n);
      expect(result.remainder.low).toBe(2n);
      expect(result.remainder.high).toBe(0n);
    });

    test('should handle division without remainder', async () => {
      const result = await uint128Simulator.divRemU128(u128(15n), u128(3n));
      expect(result.quotient.low).toBe(5n);
      expect(result.quotient.high).toBe(0n);
      expect(result.remainder.low).toBe(0n);
      expect(result.remainder.high).toBe(0n);
    });

    test('should handle dividend equals divisor', async () => {
      const result = await uint128Simulator.divRemU128(u128(5n), u128(5n));
      expect(result.quotient.low).toBe(1n);
      expect(result.quotient.high).toBe(0n);
      expect(result.remainder.low).toBe(0n);
      expect(result.remainder.high).toBe(0n);
    });

    test('should handle dividend less than divisor', async () => {
      const result = await uint128Simulator.divRemU128(u128(3n), u128(5n));
      expect(result.quotient.low).toBe(0n);
      expect(result.quotient.high).toBe(0n);
      expect(result.remainder.low).toBe(3n);
      expect(result.remainder.high).toBe(0n);
    });

    test('should compute division of max U128 by 2', async () => {
      const result = await uint128Simulator.divRemU128(
        u128(MAX_UINT128),
        u128(2n),
      );
      expect(result.quotient.low).toBe(MAX_UINT64);
      expect(result.quotient.high).toBe(MAX_UINT64 >> 1n);
      expect(result.remainder.low).toBe(1n);
      expect(result.remainder.high).toBe(0n);
    });

    test('should fail on division by zero', async () => {
      await expectRejection(
        uint128Simulator.divRemU128(u128(5n), u128(0n)),
        'failed assert: Uint128: division by zero',
      );
    });

    testDryOnly(
      'should fail when witness returns remainder >= divisor',
      async () => {
        uint128Simulator.overrideWitness('wit_divU128', (context) => [
          context.privateState,
          { quotient: { low: 1n, high: 0n }, remainder: { low: 5n, high: 0n } },
        ]);
        await expectRejection(
          uint128Simulator.divRemU128(u128(10n), u128(5n)),
          'failed assert: Uint128: remainder error',
        );
      },
    );

    testDryOnly(
      'should fail when witness returns quotient * b + remainder != a',
      async () => {
        uint128Simulator.overrideWitness('wit_divU128', (context) => [
          context.privateState,
          { quotient: { low: 2n, high: 0n }, remainder: { low: 0n, high: 0n } },
        ]);
        await expectRejection(
          uint128Simulator.divRemU128(u128(11n), u128(5n)),
          'failed assert: Uint128: division invalid',
        );
      },
    );
  });

  describe('sqrt', () => {
    test('should handle zero', async () => {
      expect(await uint128Simulator.sqrt(0n)).toBe(0n);
    });

    test('should handle one', async () => {
      expect(await uint128Simulator.sqrt(1n)).toBe(1n);
    });

    test('should handle small non-perfect squares', async () => {
      expect(await uint128Simulator.sqrt(2n)).toBe(1n); // floor(sqrt(2)) ≈ 1.414
      expect(await uint128Simulator.sqrt(3n)).toBe(1n); // floor(sqrt(3)) ≈ 1.732
      expect(await uint128Simulator.sqrt(5n)).toBe(2n); // floor(sqrt(5)) ≈ 2.236
    });

    test('should handle small perfect squares', async () => {
      expect(await uint128Simulator.sqrt(4n)).toBe(2n);
      expect(await uint128Simulator.sqrt(9n)).toBe(3n);
      expect(await uint128Simulator.sqrt(16n)).toBe(4n);
    });

    test('should handle maximum values', async () => {
      expect(await uint128Simulator.sqrt(MAX_UINT8)).toBe(15n);
      expect(await uint128Simulator.sqrt(MAX_UINT16)).toBe(255n);
      expect(await uint128Simulator.sqrt(MAX_UINT32)).toBe(65535n);
      expect(await uint128Simulator.sqrt(MAX_UINT64)).toBe(4294967295n);
      expect(await uint128Simulator.sqrt(MAX_UINT128)).toBe(MAX_UINT64);
    });

    test('should handle large perfect square', async () => {
      expect(await uint128Simulator.sqrt(1000000n)).toBe(1000n);
    });

    test('should handle large non-perfect square', async () => {
      expect(await uint128Simulator.sqrt(100000001n)).toBe(10000n); // floor(sqrt(100000001)) ≈ 10000.00005
    });

    testDryOnly(
      'should fail if sqrt witness overestimates (root^2 > radicand)',
      async () => {
        uint128Simulator.overrideWitness('wit_sqrtU128', (context) => [
          context.privateState,
          11n,
        ]);
        await expectRejection(
          uint128Simulator.sqrt(100n),
          'failed assert: Uint128: sqrt overestimate',
        );
      },
    );

    testDryOnly(
      'should fail if sqrt witness underestimates (next^2 <= radicand)',
      async () => {
        uint128Simulator.overrideWitness('wit_sqrtU128', (context) => [
          context.privateState,
          9n,
        ]);
        await expectRejection(
          uint128Simulator.sqrt(100n),
          'failed assert: Uint128: sqrt underestimate',
        );
      },
    );
  });

  describe('sqrtU128', () => {
    test('should handle zero', async () => {
      expect(await uint128Simulator.sqrtU128(u128(0n))).toBe(0n);
    });

    test('should handle one', async () => {
      expect(await uint128Simulator.sqrtU128(u128(1n))).toBe(1n);
    });

    test('should handle small non-perfect squares', async () => {
      expect(await uint128Simulator.sqrtU128(u128(2n))).toBe(1n); // floor(sqrt(2)) ≈ 1.414
      expect(await uint128Simulator.sqrtU128(u128(3n))).toBe(1n); // floor(sqrt(3)) ≈ 1.732
      expect(await uint128Simulator.sqrtU128(u128(5n))).toBe(2n); // floor(sqrt(5)) ≈ 2.236
    });

    test('should handle small perfect squares', async () => {
      expect(await uint128Simulator.sqrtU128(u128(4n))).toBe(2n);
      expect(await uint128Simulator.sqrtU128(u128(9n))).toBe(3n);
      expect(await uint128Simulator.sqrtU128(u128(16n))).toBe(4n);
    });

    test('should handle maximum values', async () => {
      expect(await uint128Simulator.sqrtU128(u128(MAX_UINT8))).toBe(15n);
      expect(await uint128Simulator.sqrtU128(u128(MAX_UINT16))).toBe(255n);
      expect(await uint128Simulator.sqrtU128(u128(MAX_UINT32))).toBe(65535n);
      expect(await uint128Simulator.sqrtU128(u128(MAX_UINT64))).toBe(
        4294967295n,
      );
      expect(await uint128Simulator.sqrtU128(u128(MAX_UINT128))).toBe(
        MAX_UINT64,
      );
    });

    test('should handle large perfect square', async () => {
      expect(await uint128Simulator.sqrtU128(u128(1000000n))).toBe(1000n);
    });

    test('should handle large non-perfect square', async () => {
      expect(await uint128Simulator.sqrtU128(u128(100000001n))).toBe(10000n); // floor(sqrt(100000001)) ≈ 10000.00005
    });
  });

  describe('min', () => {
    test('should return minimum of small numbers', async () => {
      expect(await uint128Simulator.min(5n, 3n)).toBe(3n);
      expect(await uint128Simulator.min(3n, 5n)).toBe(3n);
      expect(await uint128Simulator.min(5n, 5n)).toBe(5n);
    });

    test('should handle max Uint<128>', async () => {
      expect(await uint128Simulator.min(MAX_UINT128, 1n)).toBe(1n);
      expect(await uint128Simulator.min(MAX_UINT128, MAX_UINT128)).toBe(
        MAX_UINT128,
      );
    });

    test('should handle zero', async () => {
      expect(await uint128Simulator.min(0n, 5n)).toBe(0n);
      expect(await uint128Simulator.min(5n, 0n)).toBe(0n);
    });
  });

  describe('minU128', () => {
    test('should return minimum of small U128 numbers', async () => {
      const result = await uint128Simulator.minU128(u128(5n), u128(3n));
      expect(result.low).toBe(3n);
      expect(result.high).toBe(0n);
    });

    test('should handle large U128 numbers', async () => {
      const result = await uint128Simulator.minU128(
        u128(MAX_UINT128),
        u128(1n),
      );
      expect(result.low).toBe(1n);
      expect(result.high).toBe(0n);
    });
  });

  describe('max', () => {
    test('should return maximum of small numbers', async () => {
      expect(await uint128Simulator.max(5n, 3n)).toBe(5n);
      expect(await uint128Simulator.max(3n, 5n)).toBe(5n);
      expect(await uint128Simulator.max(5n, 5n)).toBe(5n);
    });

    test('should handle max Uint<128>', async () => {
      expect(await uint128Simulator.max(MAX_UINT128, 1n)).toBe(MAX_UINT128);
      expect(await uint128Simulator.max(MAX_UINT128, MAX_UINT128)).toBe(
        MAX_UINT128,
      );
    });

    test('should handle zero', async () => {
      expect(await uint128Simulator.max(0n, 5n)).toBe(5n);
      expect(await uint128Simulator.max(5n, 0n)).toBe(5n);
    });
  });

  describe('maxU128', () => {
    test('should return maximum of small U128 numbers', async () => {
      const result = await uint128Simulator.maxU128(u128(5n), u128(3n));
      expect(result.low).toBe(5n);
      expect(result.high).toBe(0n);
    });

    test('should handle large U128 numbers', async () => {
      const result = await uint128Simulator.maxU128(
        u128(MAX_UINT128),
        u128(1n),
      );
      expect(result.low).toBe(MAX_UINT64);
      expect(result.high).toBe(MAX_UINT64);
    });
  });

  describe('isMultiple', () => {
    test('should check if small number is multiple', async () => {
      expect(await uint128Simulator.isMultiple(6n, 3n)).toBe(true);
      expect(await uint128Simulator.isMultiple(7n, 3n)).toBe(false);
    });

    test('should check max Uint<128> is multiple of 1', async () => {
      expect(await uint128Simulator.isMultiple(MAX_UINT128, 1n)).toBe(true);
    });

    test('should fail on division by zero', async () => {
      await expectRejection(
        uint128Simulator.isMultiple(5n, 0n),
        'failed assert: Uint128: division by zero',
      );
    });

    test('should handle large divisors', async () => {
      expect(await uint128Simulator.isMultiple(MAX_UINT128, MAX_UINT128)).toBe(
        true,
      );
      expect(
        await uint128Simulator.isMultiple(MAX_UINT128 - 1n, MAX_UINT128),
      ).toBe(false);
    });

    testDryOnly(
      'should fail when witness returns quotient * b + remainder != a',
      async () => {
        uint128Simulator.overrideWitness('wit_divU128', (context) => [
          context.privateState,
          { quotient: { low: 1n, high: 0n }, remainder: { low: 1n, high: 0n } },
        ]);
        await expectRejection(
          uint128Simulator.isMultiple(6n, 3n),
          'failed assert: Uint128: division invalid',
        );
      },
    );
  });

  describe('isMultipleU128', () => {
    test('should check if small U128 number is multiple', async () => {
      expect(await uint128Simulator.isMultipleU128(u128(6n), u128(3n))).toBe(
        true,
      );
    });

    test('should check large U128 numbers', async () => {
      expect(
        await uint128Simulator.isMultipleU128(u128(MAX_UINT128), u128(1n)),
      ).toBe(true);
    });

    test('should fail on division by zero', async () => {
      await expectRejection(
        uint128Simulator.isMultipleU128(u128(5n), u128(0n)),
        'failed assert: Uint128: division by zero',
      );
    });

    testDryOnly(
      'should fail when witness returns quotient * b + remainder != a',
      async () => {
        uint128Simulator.overrideWitness('wit_divU128', (context) => [
          context.privateState,
          { quotient: { low: 1n, high: 0n }, remainder: { low: 1n, high: 0n } },
        ]);
        await expectRejection(
          uint128Simulator.isMultipleU128(u128(6n), u128(3n)),
          'failed assert: Uint128: division invalid',
        );
      },
    );
  });
});
