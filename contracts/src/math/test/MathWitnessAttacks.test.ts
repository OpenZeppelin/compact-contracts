import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { describe, expect, test } from 'vitest';
import { expectRejection } from '#test-utils/assertions/rejection.js';
import { Bytes8Simulator } from './simulators/Bytes8Simulator.js';
import { Bytes32Simulator } from './simulators/Bytes32Simulator.js';
import { Field255Simulator } from './simulators/Field255Simulator.js';
import { PackSimulator } from './simulators/PackSimulator.js';
import { Uint64Simulator } from './simulators/Uint64Simulator.js';
import { Uint128Simulator } from './simulators/Uint128Simulator.js';
import { Uint256Simulator } from './simulators/Uint256Simulator.js';
import { MAX_UINT64, MAX_UINT128 } from './utils/consts.js';
import { toBytesLE, toU128, toU256 } from './utils/oracles.js';
import { PackWitnesses } from './witnesses/PackWitnesses.js';
import { Uint64Witnesses } from './witnesses/Uint64Witnesses.js';
import {
  type DivResultU128,
  Uint128Witnesses,
} from './witnesses/Uint128Witnesses.js';

/**
 * Malicious-witness table: one test per check that a witness result must
 * pass (04-plan.md section 3, verification code M).
 *
 * Each test replaces one witness call with a forged result and expects the
 * module message of the check that the forgery breaks. The generated
 * JavaScript runs the same checks as the circuit, so these tests show which
 * message a consumer sees. The ZKIR relation tests (`*.zkir.test.ts`) show
 * that the circuit itself rejects the same forgeries.
 *
 * The forgery replaces a witness after deployment, so these tests run on the
 * dry backend only. An "unsupported override" error on the live backend is
 * not a rejection of the forgery.
 *
 * The `Uint<128>` forms of the `Uint128` divisions call `wit_divUint128(a, b)`
 * as their division witness and split nothing. The `U128` forms call
 * `wit_divU128` and split the partial products of `_mul` with
 * `wit_divUint128`.
 *
 * No forgery reaches "Uint128: unexpected multiplication overflow". The final
 * carry of `Uint128._mul` is 0 for every verified split (Z3 proof Z7), and a
 * split that is not verified fails first with "conversion invalid". The
 * message is a defensive check.
 */

/**
 * Wraps the honest witness `honest`: call number `index` (0 for the first
 * call) returns `forged(result)`, every other call the honest result.
 */
function forgeCall<F extends (...args: never[]) => [unknown, unknown]>(
  honest: F,
  index: number,
  forged: (result: ReturnType<F>[1]) => ReturnType<F>[1],
): F {
  let calls = 0;
  const wrapped = (...args: Parameters<F>) => {
    const [state, result] = honest(...args);
    return [state, calls++ === index ? forged(result) : result];
  };
  return wrapped as unknown as F;
}

const pack = PackWitnesses();
const u64 = Uint64Witnesses();
const u128 = Uint128Witnesses();
const bytes8 = toBytesLE(0x0807060504030201n, 8);

describe.skipIf(isLiveBackend())('malicious witness results', () => {
  describe('wit_unpackBytes: pack(vec) == bytes', () => {
    const changeByte = (result: bigint[]) =>
      result.map((b, i) => (i === 0 ? (b + 1n) % 256n : b));

    test('Pack.unpack rejects a changed byte', async () => {
      const s = await PackSimulator.create();
      s.overrideWitness(
        'wit_unpackBytes',
        forgeCall(pack.wit_unpackBytes, 0, changeByte),
      );
      await expectRejection(
        s.unpack8(bytes8),
        'Pack: unpack verification failed',
      );
    });

    test('Bytes8.toUint64(bytes) rejects a changed byte', async () => {
      const s = await Bytes8Simulator.create();
      s.overrideWitness(
        'wit_unpackBytes',
        forgeCall(pack.wit_unpackBytes, 0, changeByte),
      );
      await expectRejection(
        s.bytesToUint64(bytes8),
        'Pack: unpack verification failed',
      );
    });

    test('Bytes32.lt rejects a changed byte of the second operand', async () => {
      const s = await Bytes32Simulator.create();
      s.overrideWitness(
        'wit_unpackBytes',
        forgeCall(pack.wit_unpackBytes, 1, changeByte),
      );
      await expectRejection(
        s.lt(new Uint8Array(32), new Uint8Array(32).fill(1)),
        'Pack: unpack verification failed',
      );
    });

    test('Field255.toU256 rejects a changed byte', async () => {
      const s = await Field255Simulator.create();
      s.overrideWitness(
        'wit_unpackBytes',
        forgeCall(pack.wit_unpackBytes, 0, changeByte),
      );
      await expectRejection(
        s.toU256(123456789n),
        'Pack: unpack verification failed',
      );
    });

    test('a byte above 255 fails the witness type check', async () => {
      const s = await PackSimulator.create();
      // Same packed value: byte 0 takes 256 and byte 1 gives 1.
      s.overrideWitness(
        'wit_unpackBytes',
        forgeCall(pack.wit_unpackBytes, 0, (result) =>
          result.map((b, i) => (i === 0 ? b + 256n : i === 1 ? b - 1n : b)),
        ),
      );
      await expectRejection(
        s.unpack8(bytes8),
        'type error: wit_unpackBytes return value',
      );
    });
  });

  describe('wit_uint64ToUnpackedBytes: the digits recompose the value', () => {
    const changeDigit = (result: bigint[]) =>
      result.map((b, i) => (i === 7 ? (b + 1n) % 256n : b));

    test('Uint64.toUnpackedBytes rejects a changed digit', async () => {
      const s = await Uint64Simulator.create();
      s.overrideWitness(
        'wit_uint64ToUnpackedBytes',
        forgeCall(u64.wit_uint64ToUnpackedBytes, 0, changeDigit),
      );
      await expectRejection(
        s.toUnpackedBytes(0x0807060504030201n),
        'Uint64: toUnpackedBytes verification failed',
      );
    });

    test('Uint256.toBytes rejects a changed digit of the third limb', async () => {
      const s = await Uint256Simulator.create();
      s.overrideWitness(
        'wit_uint64ToUnpackedBytes',
        forgeCall(u64.wit_uint64ToUnpackedBytes, 2, changeDigit),
      );
      await expectRejection(
        s.toBytes(toU256(2n ** 200n + 12345n)),
        'Uint64: toUnpackedBytes verification failed',
      );
    });
  });

  describe('wit_divUint64: r < b and q * b + r == a', () => {
    const cases: [string, (s: Uint64Simulator) => Promise<unknown>][] = [
      ['div', (s) => s.div(10n, 3n)],
      ['rem', (s) => s.rem(10n, 3n)],
      ['divRem', (s) => s.divRem(10n, 3n)],
      ['isMultiple', (s) => s.isMultiple(10n, 3n)],
    ];

    test.each(cases)(
      '%s rejects q - 1, r + b (remainder error)',
      async (_n, call) => {
        const s = await Uint64Simulator.create();
        s.overrideWitness(
          'wit_divUint64',
          forgeCall(u64.wit_divUint64, 0, () => ({
            quotient: 2n,
            remainder: 4n,
          })),
        );
        await expectRejection(call(s), 'Uint64: remainder error');
      },
    );

    test.each(cases)(
      '%s rejects q + 1 (division invalid)',
      async (_n, call) => {
        const s = await Uint64Simulator.create();
        s.overrideWitness(
          'wit_divUint64',
          forgeCall(u64.wit_divUint64, 0, () => ({
            quotient: 4n,
            remainder: 1n,
          })),
        );
        await expectRejection(call(s), 'Uint64: division invalid');
      },
    );

    test('rejects q * b + r above 2^64 - 1 with "division invalid" (BUG-2)', async () => {
      const s = await Uint64Simulator.create();
      s.overrideWitness(
        'wit_divUint64',
        forgeCall(u64.wit_divUint64, 0, () => ({
          quotient: 2n ** 63n,
          remainder: 2n,
        })),
      );
      await expectRejection(s.div(10n, 4n), 'Uint64: division invalid');
    });
  });

  describe('wit_sqrtUint64: root^2 <= n < (root + 1)^2', () => {
    test('rejects root + 1 (sqrt overestimate)', async () => {
      const s = await Uint64Simulator.create();
      s.overrideWitness(
        'wit_sqrtUint64',
        forgeCall(u64.wit_sqrtUint64, 0, (r) => r + 1n),
      );
      await expectRejection(s.sqrt(99n), 'Uint64: sqrt overestimate');
    });

    test('rejects root - 1 (sqrt underestimate)', async () => {
      const s = await Uint64Simulator.create();
      s.overrideWitness(
        'wit_sqrtUint64',
        forgeCall(u64.wit_sqrtUint64, 0, (r) => r - 1n),
      );
      await expectRejection(s.sqrt(99n), 'Uint64: sqrt underestimate');
    });
  });

  describe('wit_divUint128 in toU128: high * 2^64 + low == value', () => {
    const badSplit = (r: DivResultU128): DivResultU128 => {
      return {
        quotient: r.quotient,
        remainder: { ...r.remainder, low: r.remainder.low ^ 1n },
      };
    };
    const cases: [string, (s: Uint128Simulator) => Promise<unknown>][] = [
      ['toU128', (s) => s.toU128(2n ** 100n + 7n)],
      ['add', (s) => s.add(2n ** 100n + 7n, 5n)],
      ['addU128', (s) => s.addU128(toU128(2n ** 100n + 7n), toU128(5n))],
      ['mul', (s) => s.mul(2n ** 100n + 7n, 5n)],
      ['mulChecked', (s) => s.mulChecked(2n ** 100n + 7n, 5n)],
      ['divU128', (s) => s.divU128(toU128(2n ** 100n + 7n), toU128(5n))],
      ['sqrt', (s) => s.sqrt(2n ** 100n + 7n)],
    ];

    test.each(cases)(
      '%s rejects a wrong split (conversion invalid)',
      async (_n, call) => {
        const s = await Uint128Simulator.create();
        s.overrideWitness(
          'wit_divUint128',
          forgeCall(u128.wit_divUint128, 0, badSplit),
        );
        await expectRejection(call(s), 'Uint128: conversion invalid');
      },
    );

    test('the free fields quotient.high and remainder.high change no result', async () => {
      const value = 2n ** 100n + 7n;
      const free = (r: DivResultU128): DivResultU128 => {
        return {
          quotient: { ...r.quotient, high: MAX_UINT64 },
          remainder: { ...r.remainder, high: 12345n },
        };
      };
      const expected: [
        string,
        (s: Uint128Simulator) => Promise<unknown>,
        unknown,
      ][] = [
        ['toU128', (s) => s.toU128(value), toU128(value)],
        ['mulChecked', (s) => s.mulChecked(value, 5n), value * 5n],
        [
          'divU128',
          (s) => s.divU128(toU128(value), toU128(5n)),
          toU128(value / 5n),
        ],
        ['sqrt', (s) => s.sqrt(value), 2n ** 50n],
      ];
      for (const [name, call, result] of expected) {
        const s = await Uint128Simulator.create();
        // Every split call of the circuit gets the free fields.
        s.overrideWitness('wit_divUint128', (context, a: bigint, b: bigint) => {
          const [state, honest] = u128.wit_divUint128(context, a, b);
          return [state, free(honest)];
        });
        expect(await call(s), name).toEqual(result);
      }
    });
  });

  describe('mulChecked(Uint<128>): one split', () => {
    // The Uint<128> form splits only a; b enters the native product. A forged
    // second split, which the U128 algorithm would use for b, does not reach
    // the circuit.
    test('ignores a forged second split', async () => {
      const s = await Uint128Simulator.create();
      s.overrideWitness(
        'wit_divUint128',
        forgeCall(u128.wit_divUint128, 1, (r) => ({
          quotient: r.quotient,
          remainder: { ...r.remainder, low: r.remainder.low ^ 1n },
        })),
      );
      expect(await s.mulChecked(2n ** 100n + 7n, 5n)).toBe(
        (2n ** 100n + 7n) * 5n,
      );
    });
  });

  describe('addChecked: no witness', () => {
    // Both forms use native addition: a forged split cannot reach them.
    test.each([
      [
        'addChecked',
        (s: Uint128Simulator) => s.addChecked(2n ** 100n + 7n, 5n),
      ],
      [
        'addCheckedU128',
        (s: Uint128Simulator) =>
          s.addCheckedU128(toU128(2n ** 100n + 7n), toU128(5n)),
      ],
    ])('%s ignores a wrong split', async (_name, call) => {
      const s = await Uint128Simulator.create();
      s.overrideWitness(
        'wit_divUint128',
        forgeCall(u128.wit_divUint128, 0, (r) => ({
          quotient: r.quotient,
          remainder: { ...r.remainder, low: r.remainder.low ^ 1n },
        })),
      );
      expect(await call(s)).toBe(2n ** 100n + 12n);
    });
  });

  describe('wit_divU128: the checks of Uint128._div', () => {
    test('rejects r >= b (remainder error)', async () => {
      const s = await Uint128Simulator.create();
      s.overrideWitness(
        'wit_divU128',
        forgeCall(u128.wit_divU128, 0, () => ({
          quotient: toU128(2n),
          remainder: toU128(4n),
        })),
      );
      await expectRejection(
        s.divU128(toU128(10n), toU128(3n)),
        'Uint128: remainder error',
      );
    });

    test('rejects q * b of 2^128 or more (division product overflow)', async () => {
      const s = await Uint128Simulator.create();
      s.overrideWitness(
        'wit_divU128',
        forgeCall(u128.wit_divU128, 0, () => ({
          quotient: toU128(MAX_UINT64),
          remainder: toU128(0n),
        })),
      );
      await expectRejection(
        s.divU128(toU128(10n), toU128(2n ** 65n)),
        'Uint128: division product overflow',
      );
    });

    test('rejects q * b + 2^128 that wraps to a (division product overflow)', async () => {
      // q + 2^63 times 2^65 is q * 2^65 + 2^128: the low 128 bits equal the
      // honest product.
      const s = await Uint128Simulator.create();
      const a = 2n ** 100n + 3n;
      const b = 2n ** 65n;
      s.overrideWitness(
        'wit_divU128',
        forgeCall(u128.wit_divU128, 0, () => ({
          quotient: toU128(a / b + 2n ** 63n),
          remainder: toU128(a % b),
        })),
      );
      await expectRejection(
        s.divU128(toU128(a), toU128(b)),
        'Uint128: division product overflow',
      );
    });

    test('rejects q * b > a with "division invalid" (BUG-3)', async () => {
      const s = await Uint128Simulator.create();
      s.overrideWitness(
        'wit_divU128',
        forgeCall(u128.wit_divU128, 0, () => ({
          quotient: toU128(4n),
          remainder: toU128(0n),
        })),
      );
      await expectRejection(
        s.divU128(toU128(10n), toU128(3n)),
        'Uint128: division invalid',
      );
    });

    test('rejects a - q * b != r (division invalid)', async () => {
      const s = await Uint128Simulator.create();
      s.overrideWitness(
        'wit_divU128',
        forgeCall(u128.wit_divU128, 0, () => ({
          quotient: toU128(3n),
          remainder: toU128(2n),
        })),
      );
      await expectRejection(
        s.remU128(toU128(10n), toU128(3n)),
        'Uint128: division invalid',
      );
    });
  });

  describe('wit_divUint128 as the division witness of the Uint<128> forms', () => {
    // div, rem, divRem and isMultiple check one division witness result with
    // native arithmetic, in the order of Uint128._div: the same forged
    // quotient and remainder fail with the same message in both forms.
    const forms: [
      string,
      (s: Uint128Simulator, a: bigint, b: bigint) => Promise<unknown>,
    ][] = [
      ['div', (s, a, b) => s.div(a, b)],
      ['rem', (s, a, b) => s.rem(a, b)],
      ['divRem', (s, a, b) => s.divRem(a, b)],
      ['isMultiple', (s, a, b) => s.isMultiple(a, b)],
    ];
    const attacks: [string, bigint, bigint, bigint, bigint, string][] = [
      ['r >= b', 10n, 3n, 2n, 4n, 'Uint128: remainder error'],
      [
        'quotient.high * b >= 2^64',
        2n ** 100n + 3n,
        2n ** 65n,
        2n ** 64n + 2n ** 35n,
        3n,
        'Uint128: division product overflow',
      ],
      // Plan review MM-04: the high part of q is zero.
      [
        'q * b >= 2^128 with quotient.high = 0',
        10n,
        2n ** 65n,
        MAX_UINT64,
        0n,
        'Uint128: division product overflow',
      ],
      // q + 2^63 times 2^65 is q * 2^65 + 2^128.
      [
        'q * b + 2^128 that wraps to a',
        2n ** 100n + 3n,
        2n ** 65n,
        2n ** 35n + 2n ** 63n,
        3n,
        'Uint128: division product overflow',
      ],
      ['q * b > a', 10n, 3n, 4n, 0n, 'Uint128: division invalid'],
      ['a - q * b != r', 10n, 3n, 3n, 0n, 'Uint128: division invalid'],
    ];

    for (const [label, a, b, q, r, message] of attacks) {
      test.each(forms)(`%s rejects ${label}`, async (_name, call) => {
        const s = await Uint128Simulator.create();
        s.overrideWitness(
          'wit_divUint128',
          forgeCall(u128.wit_divUint128, 0, () => ({
            quotient: toU128(q),
            remainder: toU128(r),
          })),
        );
        await expectRejection(call(s, a, b), message);
        // The U128 form fails with the same message for the same result.
        const u = await Uint128Simulator.create();
        u.overrideWitness(
          'wit_divU128',
          forgeCall(u128.wit_divU128, 0, () => ({
            quotient: toU128(q),
            remainder: toU128(r),
          })),
        );
        await expectRejection(u.divRemU128(toU128(a), toU128(b)), message);
      });
    }

    test.each(forms)(
      '%s rejects changed high fields: no field of the division witness is free',
      async (_name, call) => {
        const s = await Uint128Simulator.create();
        s.overrideWitness(
          'wit_divUint128',
          forgeCall(u128.wit_divUint128, 0, (honest) => ({
            quotient: { ...honest.quotient, high: MAX_UINT64 },
            remainder: { ...honest.remainder, high: 12345n },
          })),
        );
        await expectRejection(
          call(s, 2n ** 100n + 7n, 5n),
          'Uint128: remainder error',
        );
      },
    );

    test.each(forms)(
      '%s ignores a forged wit_divU128: the Uint<128> form does not call it',
      async (_name, call) => {
        const s = await Uint128Simulator.create();
        s.overrideWitness(
          'wit_divU128',
          forgeCall(u128.wit_divU128, 0, () => ({
            quotient: toU128(2n),
            remainder: toU128(4n),
          })),
        );
        const honest = await Uint128Simulator.create();
        expect(await call(s, 10n, 3n)).toEqual(await call(honest, 10n, 3n));
      },
    );
  });

  describe('wit_sqrtU128: root^2 <= n < (root + 1)^2', () => {
    const cases: [string, (s: Uint128Simulator) => Promise<unknown>][] = [
      ['sqrt', (s) => s.sqrt(2n ** 100n + 7n)],
      ['sqrtU128', (s) => s.sqrtU128(toU128(2n ** 100n + 7n))],
    ];

    test.each(cases)(
      '%s rejects root + 1 (sqrt overestimate)',
      async (_n, call) => {
        const s = await Uint128Simulator.create();
        s.overrideWitness(
          'wit_sqrtU128',
          forgeCall(u128.wit_sqrtU128, 0, (r) => r + 1n),
        );
        await expectRejection(call(s), 'Uint128: sqrt overestimate');
      },
    );

    test.each(cases)(
      '%s rejects root - 1 (sqrt underestimate)',
      async (_n, call) => {
        const s = await Uint128Simulator.create();
        s.overrideWitness(
          'wit_sqrtU128',
          forgeCall(u128.wit_sqrtU128, 0, (r) => r - 1n),
        );
        await expectRejection(call(s), 'Uint128: sqrt underestimate');
      },
    );

    test('accepts the root 2^64 - 1 of 2^128 - 1 (the underestimate check is skipped)', async () => {
      const s = await Uint128Simulator.create();
      expect(await s.sqrt(MAX_UINT128)).toBe(MAX_UINT64);
      expect(await s.sqrtU128(toU128(MAX_UINT128))).toBe(MAX_UINT64);
    });

    test('rejects root 2^64 - 2 for 2^128 - 1 (sqrt underestimate)', async () => {
      const s = await Uint128Simulator.create();
      s.overrideWitness(
        'wit_sqrtU128',
        forgeCall(u128.wit_sqrtU128, 0, () => MAX_UINT64 - 1n),
      );
      await expectRejection(
        s.sqrtU128(toU128(MAX_UINT128)),
        'Uint128: sqrt underestimate',
      );
    });
  });
});
