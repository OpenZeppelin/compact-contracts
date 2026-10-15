import { MAX_FIELD } from '@midnight-ntwrk/compact-runtime';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { FIELD_MODULUS, fieldAtoms } from '#test-utils/zkir/fieldRepr.js';
import {
  checkRelation,
  loadZkir,
  traceCall,
} from '#test-utils/zkir/relationCheck.js';
import { Field255Simulator } from './simulators/Field255Simulator.js';
import { describeRelation, relationCase } from './utils/forgeries.js';
import { toBytesLE, toU256 } from './utils/oracles.js';
import { PackWitnesses } from './witnesses/PackWitnesses.js';

/**
 * ZKIR v2 relation tests of the `Field255` witness circuits (INV-1, INV-3,
 * INV-4, INV-18, INV-25). See `utils/forgeries.ts`.
 */

const field = fc.bigInt({ min: 0n, max: MAX_FIELD });
const X = 0x1234567890abcdef1234567890abcdefn;
const Y = 2n ** 250n + 7n;

const compare = (
  circuit: 'lt' | 'lte' | 'gt' | 'gte',
  oracle: (a: bigint, b: bigint) => boolean,
) =>
  relationCase<Field255Simulator, [bigint, bigint]>({
    circuit,
    call: (s, a, b) => s[circuit](a, b),
    oracle,
    boundary: [
      [0n, 0n],
      [0n, MAX_FIELD],
      [MAX_FIELD, 0n],
      [MAX_FIELD, MAX_FIELD],
      [MAX_FIELD - 1n, MAX_FIELD],
    ],
    random: fc.tuple(field, field),
    forgeries: [[X, Y]],
  });

describeRelation('MockField255', {
  simulator: () => Field255Simulator.create(),
  witnesses: () => PackWitnesses(),
  cases: [
    relationCase<Field255Simulator, [bigint]>({
      circuit: 'toU256',
      call: (s, value) => s.toU256(value),
      oracle: (value) => toU256(value),
      boundary: [[0n], [1n], [MAX_FIELD], [2n ** 248n]],
      random: fc.tuple(field),
      forgeries: [[X], [MAX_FIELD]],
    }),
    compare('lt', (a, b) => a < b),
    compare('lte', (a, b) => a <= b),
    compare('gt', (a, b) => a > b),
    compare('gte', (a, b) => a >= b),
  ],
});

describe.skipIf(isLiveBackend())(
  'MockField255 ZKIR v2 relation: toBytes',
  () => {
    // INV-3: the circuit computes the bytes of x itself. The 32-byte value
    // x + r has the same field value, but the relation rejects its bytes.
    test.each([0n, 1n, X, 2n ** 254n])(
      'rejects the bytes of %s + r as the result',
      async (value) => {
        const simulator = await Field255Simulator.create();
        const { result, proofData } = await traceCall(simulator, () =>
          simulator.toBytes(value),
        );
        expect(result).toEqual(toBytesLE(value, 32));
        const zkir = loadZkir('MockField255', 'toBytes');
        expect(await checkRelation(zkir, 'toBytes', proofData)).toEqual({
          accepted: true,
        });
        const wrapped = value + FIELD_MODULUS;
        const forged = fieldAtoms([wrapped >> 248n, wrapped % 2n ** 248n]);
        const verdict = await checkRelation(zkir, 'toBytes', {
          ...proofData,
          output: forged,
        });
        expect(verdict.accepted).toBe(false);
      },
    );
  },
);
