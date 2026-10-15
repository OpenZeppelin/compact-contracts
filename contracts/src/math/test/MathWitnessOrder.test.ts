import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { describe, expect, test } from 'vitest';
import { expectRejection } from '#test-utils/assertions/rejection.js';
import { Uint64Simulator } from './simulators/Uint64Simulator.js';
import { Uint128Simulator } from './simulators/Uint128Simulator.js';
import { toU128 } from './utils/oracles.js';
import {
  type Uint64PrivateState,
  Uint64Witnesses,
} from './witnesses/Uint64Witnesses.js';
import {
  type DivResultU128,
  type U128,
  type Uint128PrivateState,
  Uint128Witnesses,
} from './witnesses/Uint128Witnesses.js';

/**
 * INV-12: a division checks the divisor before it calls the division
 * witness. The honest witness divides with bigint `/`, which throws a
 * `RangeError` for a zero divisor, so a call in the other order would fail
 * with that error and not with the module message.
 *
 * Each test counts the calls of the division witness with a spy. The spy
 * replaces the witness after deployment, so the tests run on the dry backend
 * only.
 */

describe.skipIf(isLiveBackend())('division witness order', () => {
  describe('Uint64', () => {
    const cases: [string, (s: Uint64Simulator) => Promise<unknown>][] = [
      ['div', (s) => s.div(5n, 0n)],
      ['rem', (s) => s.rem(5n, 0n)],
      ['divRem', (s) => s.divRem(5n, 0n)],
      ['isMultiple', (s) => s.isMultiple(5n, 0n)],
    ];

    test.each(cases)(
      '%s(5, 0) fails before wit_divUint64',
      async (_name, call) => {
        const simulator = await Uint64Simulator.create();
        const honest = Uint64Witnesses().wit_divUint64;
        let calls = 0;
        simulator.overrideWitness(
          'wit_divUint64',
          (context: WitnessContext<unknown, Uint64PrivateState>, a, b) => {
            calls++;
            return honest(context, a, b);
          },
        );
        await expectRejection(call(simulator), 'Uint64: division by zero');
        expect(calls).toBe(0);
      },
    );
  });

  describe('Uint128', () => {
    const zero = toU128(0n);
    const cases: [string, (s: Uint128Simulator) => Promise<unknown>][] = [
      ['div', (s) => s.div(5n, 0n)],
      ['divU128', (s) => s.divU128(toU128(5n), zero)],
      ['rem', (s) => s.rem(5n, 0n)],
      ['remU128', (s) => s.remU128(toU128(5n), zero)],
      ['divRem', (s) => s.divRem(5n, 0n)],
      ['divRemU128', (s) => s.divRemU128(toU128(5n), zero)],
      ['isMultiple', (s) => s.isMultiple(5n, 0n)],
      ['isMultipleU128', (s) => s.isMultipleU128(toU128(5n), zero)],
    ];

    test.each(cases)(
      '%s(5, 0) fails before wit_divU128',
      async (_name, call) => {
        const simulator = await Uint128Simulator.create();
        const honest = Uint128Witnesses().wit_divU128;
        let calls = 0;
        simulator.overrideWitness(
          'wit_divU128',
          (
            context: WitnessContext<unknown, Uint128PrivateState>,
            a: U128,
            b: U128,
          ): [Uint128PrivateState, DivResultU128] => {
            calls++;
            return honest(context, a, b);
          },
        );
        await expectRejection(call(simulator), 'Uint128: division by zero');
        expect(calls).toBe(0);
      },
    );
  });
});
