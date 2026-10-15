import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeAll, describe, expect, test } from 'vitest';
import { FIELD_MODULUS, toFields } from '#test-utils/zkir/fieldRepr.js';
import { RelationForger, type WitnessCall } from '#test-utils/zkir/forgery.js';
import {
  checkRelation,
  loadZkir,
  traceCall,
} from '#test-utils/zkir/relationCheck.js';
import type { ZkirV2 } from '#test-utils/zkir/zkirV2.js';
import { PackSimulator } from './simulators/PackSimulator.js';
import { Uint64Simulator } from './simulators/Uint64Simulator.js';
import { Uint128Simulator } from './simulators/Uint128Simulator.js';
import {
  describeConstraint,
  findUnsoundForgery,
  undetectedRemovals,
} from './utils/forgeries.js';
import { toU128, type U128Limbs } from './utils/oracles.js';
import { PackWitnesses } from './witnesses/PackWitnesses.js';
import { Uint64Witnesses } from './witnesses/Uint64Witnesses.js';
import { Uint128Witnesses } from './witnesses/Uint128Witnesses.js';

/**
 * Tests of the relation-check helpers (`test-utils/zkir`) through the real
 * math simulators and compiled circuits:
 *
 *   - `traceCall` reads the proof data of a dry call (MM-01, AM7).
 *   - The lenient replay of `RelationForger` gives the same preimage as the
 *     simulator.
 *   - A coherent forgery detects a missing constraint that a forgery with
 *     the honest output does not detect (MM-03, AM9).
 *   - For a set of circuits, each removed constraint is either detected by
 *     the forgeries or listed with the reason why no forgery can detect it.
 *   - A removed split check inside `_div` needs a coordinated forgery (the
 *     quotient and one split together).
 *   - The lenient replay falls back to a field-level preimage only for a
 *     forged value outside its declared type; every other error propagates.
 */

const json = (value: unknown) =>
  JSON.stringify(value, (_key, item) =>
    typeof item === 'bigint'
      ? `${item}n`
      : item instanceof Uint8Array
        ? Buffer.from(item).toString('hex')
        : item,
  );

describe.skipIf(isLiveBackend())(
  'ZKIR v2 relation check of the math circuits',
  () => {
    test('traceCall returns the proof data of a dry call, and the relation accepts it', async () => {
      const simulator = await Uint64Simulator.create();
      const { result, proofData } = await traceCall(simulator, () =>
        simulator.div(10n, 3n),
      );
      expect(result).toBe(3n);
      expect(
        await checkRelation(loadZkir('MockUint64', 'div'), 'div', proofData),
      ).toEqual({ accepted: true });
    });

    test('traceCall throws for a call that fails, because it adds no trace entry', async () => {
      const simulator = await Uint64Simulator.create();
      await expect(
        traceCall(simulator, () => simulator.div(10n, 0n)),
      ).rejects.toThrow('Uint64: division by zero');
      await simulator.div(10n, 3n);
      await expect(traceCall(simulator, async () => undefined)).rejects.toThrow(
        'the call added 0 trace entries, not 1',
      );
    });

    test('the lenient replay gives the same preimage as the simulator', async () => {
      const cases: [
        string,
        object,
        () => Promise<unknown>,
        string,
        unknown[],
      ][] = [];
      const u64 = await Uint64Simulator.create();
      const u128 = await Uint128Simulator.create();
      const pack = await PackSimulator.create();
      const bytes = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
      cases.push(
        ['MockUint64', Uint64Witnesses(), () => u64.sqrt(99n), 'sqrt', [99n]],
        [
          'MockUint128',
          Uint128Witnesses(),
          () => u128.div(2n ** 100n + 1n, 7n),
          'div',
          [2n ** 100n + 1n, 7n],
        ],
        [
          'MockPack',
          PackWitnesses(),
          () => pack.unpack8(bytes),
          'unpack8',
          [bytes],
        ],
      );
      const simulators = [u64, u128, pack];
      for (const [
        index,
        [artifact, witnesses, call, circuit, args],
      ] of cases.entries()) {
        const { proofData } = await traceCall(simulators[index], call);
        const forger = await RelationForger.create(artifact, witnesses);
        const replay = await forger.replay(circuit, args);
        expect(replay.failures).toEqual([]);
        expect(toFields(replay.proofData.input)).toEqual(
          toFields(proofData.input),
        );
        expect(toFields(replay.proofData.output)).toEqual(
          toFields(proofData.output),
        );
        expect(replay.proofData.privateTranscriptOutputs.map(toFields)).toEqual(
          proofData.privateTranscriptOutputs.map(toFields),
        );
        expect(json(replay.proofData.publicTranscript)).toBe(
          json(proofData.publicTranscript),
        );
      }
    });

    describe('a missing constraint (MM-03)', () => {
      let forger: RelationForger;
      let withoutFinalAssert: ZkirV2;

      beforeAll(async () => {
        forger = await RelationForger.create('MockUint64', Uint64Witnesses());
        withoutFinalAssert = structuredClone(loadZkir('MockUint64', 'div'));
        const last = withoutFinalAssert.instructions.findLastIndex(
          (ins) => ins.op === 'assert',
        );
        withoutFinalAssert.instructions.splice(last, 1);
      });

      test('a forged quotient with the honest output is rejected even without the constraint', async () => {
        // The honest output 3 no longer matches the forged quotient 2, so the
        // relation fails on the output alone. This forgery cannot show that
        // q * b + r == a is a constraint.
        const replay = await forger.replay('div', [10n, 3n]);
        const forged = structuredClone(replay.proofData);
        forged.privateTranscriptOutputs[0].value[0] = Uint8Array.of(2);
        expect(
          (await checkRelation(withoutFinalAssert, 'div', forged)).accepted,
        ).toBe(false);
      });

      test('a coherent forgery is accepted without the constraint and rejected with it', async () => {
        const plan = () => ({ quotient: 2n, remainder: 1n });
        const mutant = await forger.forge(
          'div',
          [10n, 3n],
          plan,
          withoutFinalAssert,
        );
        expect(mutant.verdict.accepted).toBe(true);
        expect(mutant.outputChanged).toBe(true);
        const original = await forger.forge('div', [10n, 3n], plan);
        expect(original.verdict).toEqual({
          accepted: false,
          reason: 'Failed direct assertion',
        });
        expect(original.failures).toEqual(['Uint64: division invalid']);
      });
    });

    test('a removed overflow assertion shows only on an input that the circuit must reject', async () => {
      // With a non-overflowing input, the forgeries cannot reach the overflow
      // check. 2^64 * 2^64 overflows: without the check, the relation accepts
      // the wrapped product.
      const forger = await RelationForger.create(
        'MockUint128',
        Uint128Witnesses(),
      );
      const zkir = loadZkir('MockUint128', 'mulCheckedU128');
      const mutant = structuredClone(zkir);
      mutant.instructions.splice(
        mutant.instructions.findLastIndex((ins) => ins.op === 'assert'),
        1,
      );
      const args = [toU128(2n ** 63n + 5n), toU128(2n ** 63n + 0x7fffn)];
      const overflow = [toU128(2n ** 64n), toU128(2n ** 64n)];
      expect(
        await findUnsoundForgery(forger, 'mulCheckedU128', args, mutant),
      ).toBeUndefined();
      expect(
        await findUnsoundForgery(forger, 'mulCheckedU128', args, mutant, [
          overflow,
        ]),
      ).toBe('must-reject input 0: honest witness results');
      expect(
        await findUnsoundForgery(forger, 'mulCheckedU128', args, zkir, [
          overflow,
        ]),
      ).toBeUndefined();
    }, 120_000);

    describe('a removed split check inside _div (A2)', () => {
      test('only a coordinated forgery detects it', async () => {
        const forger = await RelationForger.create(
          'MockUint128',
          Uint128Witnesses(),
        );
        const zkir = loadZkir('MockUint128', 'divU128');
        const index = zkir.instructions.findIndex(
          (ins, i) =>
            ins.op === 'assert' &&
            zkir.instructions
              .slice(0, i)
              .filter((other) => other.op === 'assert').length === 2,
        );
        const mutant = structuredClone(zkir);
        mutant.instructions.splice(index, 1);
        // b.high = 0: q + 1 changes only the split ll = quotient.low * b.low.
        const args = [toU128(2n ** 127n + 0x1234567890abcdefn), toU128(12345n)];
        expect(await findUnsoundForgery(forger, 'divU128', args, mutant)).toBe(
          'wit_divU128: q + 1, split ll as in the honest run',
        );
        expect(
          await findUnsoundForgery(forger, 'divU128', args, zkir),
        ).toBeUndefined();
      }, 120_000);
    });

    // The tests use divU128: wit_divU128 runs before the splits of _mul. (The
    // Uint<128> form of div calls only wit_divUint128.)
    describe('the field-level fallback of the lenient replay (A2)', () => {
      const ten = toU128(10n);
      const three = toU128(3n);
      const split = (value: bigint) => ({
        quotient: toU128(value >> 64n),
        remainder: toU128(value & (2n ** 64n - 1n)),
      });
      const wrongQuotient = (call: WitnessCall) =>
        call.name === 'wit_divU128'
          ? { quotient: toU128(4n), remainder: toU128(1n) }
          : undefined;
      /** Uint128 witnesses whose split witness answers `12` with `answer`. */
      const witnessesWith = (answer: () => unknown) => {
        const honest = Uint128Witnesses();
        return {
          ...honest,
          wit_divUint128: (
            context: Parameters<typeof honest.wit_divUint128>[0],
            a: bigint,
            b: bigint,
          ) =>
            a === 12n
              ? [context.privateState, answer()]
              : honest.wit_divUint128(context, a, b),
        };
      };

      test('an unexpected error of a later witness call propagates', async () => {
        const forger = await RelationForger.create(
          'MockUint128',
          witnessesWith(() => {
            throw new Error('injected replay error');
          }),
        );
        await expect(
          forger.forge('divU128', [ten, three], wrongQuotient),
        ).rejects.toThrow('injected replay error');
      });

      test('an encoding error with every forged value in range propagates', async () => {
        // The later split of 12 returns a limb above the field modulus, which
        // the runtime cannot encode. The forged quotient 4 is in range, so
        // the replay does not fall back.
        const forger = await RelationForger.create(
          'MockUint128',
          witnessesWith(() => ({
            quotient: { low: FIELD_MODULUS + 12n, high: 0n },
            remainder: toU128(0n),
          })),
        );
        await expect(
          forger.forge('divU128', [ten, three], wrongQuotient),
        ).rejects.toThrow('out of bounds for prime field');
      });

      test('a forged value outside its type falls back and fails its range check', async () => {
        const forger = await RelationForger.create(
          'MockUint128',
          Uint128Witnesses(),
        );
        const args: U128Limbs[] = [toU128(2n ** 127n + 0x1234567890abcdefn)];
        const honest = await forger.replay('sqrtU128', args);
        const root = honest.calls[0].result as bigint;
        const outcome = await forger.forge('sqrtU128', args, (call) =>
          call.index === 0 ? FIELD_MODULUS - root : undefined,
        );
        expect(outcome.coherent).toBe(false);
        expect(outcome.outOfType).toBe(true);
        expect(outcome.verdict.accepted).toBe(false);
        expect(outcome.verdict.accepted ? '' : outcome.verdict.reason).toMatch(
          /^Bit bound failed: [0-9a-f]+ is not 64-bit$/,
        );
      });

      test('a later call without an honest result gets the fill result and stays coherent', async () => {
        // After the forged quotient 4, the split witness has no answer for the
        // product 12 (as an honest division witness has none for a zero
        // divisor). The fill plan answers it, so the run continues.
        const forger = await RelationForger.create(
          'MockUint128',
          witnessesWith(() => {
            throw new RangeError('no answer for 12');
          }),
        );
        await expect(
          forger.forge('divU128', [ten, three], wrongQuotient),
        ).rejects.toThrow('witness call 1 (wit_divUint128) has no result');
        const outcome = await forger.forge(
          'divU128',
          [ten, three],
          wrongQuotient,
          undefined,
          (call) =>
            call.name === 'wit_divUint128' && call.args[0] === 12n
              ? split(12n)
              : undefined,
        );
        expect(outcome.coherent).toBe(true);
        expect(outcome.verdict.accepted).toBe(false);
        expect(outcome.failures).toContain('Uint128: division invalid');
      });
    });

    // Each removed constraint is detected by a forgery, except the listed
    // constraints, which other constraints imply for the zkir-v2 relation
    // check. The full list for every witness circuit is in the PR 5 evidence
    // (mutation sweep). MathRelationCounterexamples.test.ts covers the
    // listed constraints that the circuit needs.
    describe('constraint removal', () => {
      const cases: {
        artifact: string;
        witnesses: () => object;
        circuit: string;
        args: unknown[];
        rejects?: unknown[][];
        implied: Record<string, string>;
      }[] = [
        {
          artifact: 'MockUint64',
          witnesses: Uint64Witnesses,
          circuit: 'div',
          args: [12345678901234n, 97n],
          rejects: [[5n, 0n]],
          implied: {
            'range of input 1': 'less_than(r, b, 64) bounds b',
            'assert 0': 'b != 0: r < b fails for b = 0',
            'range of witness element 1': 'less_than(r, b, 64) bounds r',
          },
        },
        {
          artifact: 'MockUint64',
          witnesses: Uint64Witnesses,
          circuit: 'sqrt',
          args: [99999n],
          implied: {
            'range of input 0':
              'n < (root + 1)^2 <= 2^64 for a root below 2^32',
            'range of witness element 0':
              'root^2 <= n < (root + 1)^2 with both squares below 2^128 has no root at or above 2^32, also in the field',
          },
        },
        {
          artifact: 'MockUint64',
          witnesses: Uint64Witnesses,
          circuit: 'toUnpackedBytes',
          args: [0x0102030405060708n],
          implied: {
            'range of input 0':
              'eight digits below 256 recompose to less than 2^64',
          },
        },
        {
          artifact: 'MockPack',
          witnesses: PackWitnesses,
          circuit: 'unpack8',
          args: [Uint8Array.from([0x11, 0, 0xff, 7, 9, 0x80, 3, 0xc8])],
          implied: Object.fromEntries([
            ['range of input 0', 'pack(vec) of 8 digits is below 2^64'],
            ...Array.from({ length: 7 }, (_, i) => [
              `range of witness element ${i}`,
              'reconstitute_field in pack(vec) bounds each digit and the recomposition',
            ]),
            [
              'range of witness element 7',
              'the zkir-v2 interpreter requires each reconstitute_field sum below the field modulus; the circuit does not, see MathRelationCounterexamples.test.ts',
            ],
          ]),
        },
        {
          artifact: 'MockUint128',
          witnesses: Uint128Witnesses,
          circuit: 'toU128',
          args: [2n ** 127n + 0x1234567890abcdefn],
          implied: {
            'range of input 0':
              'the split parts are range-checked: high * 2^64 + low < 2^128',
          },
        },
        {
          artifact: 'MockUint128',
          witnesses: Uint128Witnesses,
          circuit: 'addU128',
          args: [
            toU128(2n ** 127n + 0x1234567890abcdefn),
            toU128(2n ** 127n + 3n),
          ],
          implied: {
            'range of witness element 0':
              'the carry of the low sum is a term of the high sum, which the next split bounds',
          },
        },
        {
          artifact: 'MockUint128',
          witnesses: Uint128Witnesses,
          circuit: 'sqrt',
          // The root 2^64 - 2 leaves root + 1 in range, and the radicand is at
          // least the square of the field root (utils/forgeries.ts).
          args: [(2n ** 64n - 2n) ** 2n + 7n],
          implied: {
            'range of input 0':
              'the split of the radicand recomposes it from two range-checked limbs',
            'range of witness element 0':
              'the split of the radicand is only the argument of wit_sqrtU128; the root checks use the radicand itself',
          },
        },
        ...['divRem', 'isMultiple'].map((circuit) => ({
          artifact: 'MockUint128',
          witnesses: Uint128Witnesses,
          circuit,
          args: [2n ** 127n + 0x1234567890abcdefn, 2n ** 65n + 2n],
          rejects: [[5n, 0n]],
          implied: {
            'range of input 1': 'less_than(r, b, 128) bounds b',
            'assert 0': 'b != 0: r < b fails for b = 0',
            'assert 2':
              'q_h * b <= 2^64 - 1: the cast of q_h * b to Uint<64> gives the same bound',
            'constrain_bits on variable 17':
              'the cast of q_h * b to Uint<64>: the assert q_h * b <= 2^64 - 1 gives the same bound',
            'assert 3':
              'q * b <= 2^128 - 1: q * b + r == a and a < 2^128 imply it; the assert gives the message of the U128 form',
          },
        })),
      ];

      test.each(cases)(
        '$artifact $circuit: only implied constraints are undetected',
        async ({ artifact, witnesses, circuit, args, rejects, implied }) => {
          const forger = await RelationForger.create(artifact, witnesses());
          const zkir = loadZkir(artifact, circuit);
          const undetected = await undetectedRemovals(
            forger,
            circuit,
            args,
            zkir,
            rejects,
          );
          expect(
            undetected.map((index) => describeConstraint(zkir, index)).sort(),
          ).toEqual(Object.keys(implied).sort());
        },
        120_000,
      );
    });
  },
);
