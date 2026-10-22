import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { beforeAll, describe, expect, test } from 'vitest';
import { RelationForger } from '#test-utils/zkir/forgery.js';
import { Uint64Simulator } from './simulators/Uint64Simulator.js';
import { MAX_UINT32, MAX_UINT64 } from './utils/consts.js';
import { describeRelation, relationCase } from './utils/forgeries.js';
import { toBytesLE, toVecLE } from './utils/oracles.js';
import { sqrtBigint } from './witnesses/sqrtBigint.js';
import { Uint64Witnesses } from './witnesses/Uint64Witnesses.js';

/**
 * ZKIR v2 relation tests of the `Uint64` witness circuits (INV-1, INV-2,
 * INV-5 to INV-7, INV-18, INV-25). See `utils/forgeries.ts`.
 */

const u64 = fc.bigInt({ min: 0n, max: MAX_UINT64 });
const divisor = fc.bigInt({ min: 1n, max: MAX_UINT64 });
const pair = fc.tuple(u64, divisor);
const DIVISION_BOUNDARY: [bigint, bigint][] = [
  [0n, 1n],
  [1n, 1n],
  [MAX_UINT64, 1n],
  [MAX_UINT64, MAX_UINT64],
  [MAX_UINT64, 2n],
  [MAX_UINT64 - 1n, MAX_UINT64],
  [10n, 3n],
];
const DIVISION_FORGERIES: [bigint, bigint][] = [
  [12345678901234n, 97n],
  [MAX_UINT64, 3n],
];

const division = (
  circuit: 'div' | 'rem' | 'divRem' | 'isMultiple',
  oracle: (a: bigint, b: bigint) => unknown,
) =>
  relationCase<Uint64Simulator, [bigint, bigint]>({
    circuit,
    call: (s, a, b) => s[circuit](a, b),
    oracle,
    boundary: DIVISION_BOUNDARY,
    random: pair,
    forgeries: DIVISION_FORGERIES,
    rejects: [
      [5n, 0n],
      [MAX_UINT64, 0n],
    ],
  });

describeRelation('MockUint64', {
  simulator: () => Uint64Simulator.create(),
  witnesses: () => Uint64Witnesses(),
  cases: [
    division('div', (a, b) => a / b),
    division('rem', (a, b) => a % b),
    division('divRem', (a, b) => ({ quotient: a / b, remainder: a % b })),
    division('isMultiple', (a, b) => a % b === 0n),
    relationCase<Uint64Simulator, [bigint]>({
      circuit: 'sqrt',
      call: (s, n) => s.sqrt(n),
      oracle: (n) => sqrtBigint(n),
      boundary: [
        [0n],
        [1n],
        [2n],
        [3n],
        [4n],
        [MAX_UINT64],
        [MAX_UINT32 ** 2n],
      ],
      random: fc.tuple(u64),
      forgeries: [[99999n], [MAX_UINT64]],
    }),
    relationCase<Uint64Simulator, [bigint]>({
      circuit: 'toUnpackedBytes',
      call: (s, v) => s.toUnpackedBytes(v),
      oracle: (v) => toVecLE(v, 8),
      boundary: [[0n], [1n], [0xffn], [0x100n], [MAX_UINT64]],
      random: fc.tuple(u64),
      forgeries: [[0x0102030405060708n], [0xff00ff00ff00ff00n]],
    }),
    relationCase<Uint64Simulator, [bigint]>({
      circuit: 'toBytes',
      call: (s, v) => s.toBytes(v),
      oracle: (v) => toBytesLE(v, 8),
      boundary: [[0n], [1n], [MAX_UINT64]],
      random: fc.tuple(u64),
      forgeries: [[0x0102030405060708n]],
    }),
  ],
});

describe.skipIf(isLiveBackend())(
  'MockUint64 ZKIR v2 relation: zero divisor',
  () => {
    let forger: RelationForger;

    beforeAll(async () => {
      forger = await RelationForger.create('MockUint64', Uint64Witnesses());
    });

    // INV-6: b != 0 is a constraint. No witness result proves a division by 0.
    test.each(['div', 'rem', 'divRem', 'isMultiple'])(
      '%s(5, 0) has no accepted preimage',
      async (circuit) => {
        for (const forged of [
          { quotient: 0n, remainder: 5n },
          { quotient: 5n, remainder: 0n },
          { quotient: 0n, remainder: 0n },
        ]) {
          const outcome = await forger.attempt(circuit, [5n, 0n], {
            plan: () => forged,
          });
          expect(outcome.verdict.accepted).toBe(false);
          expect(outcome.failures).toContain('Uint64: division by zero');
        }
      },
    );
  },
);
