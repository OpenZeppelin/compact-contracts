import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { beforeAll, describe, expect, test } from 'vitest';
import { FIELD_MODULUS, fieldWidths } from '#test-utils/zkir/fieldRepr.js';
import {
  type ForgeryOutcome,
  type ForgeryPlan,
  RelationForger,
  type Replay,
  type WitnessCall,
  withLeaf,
  witnessLeaves,
} from '#test-utils/zkir/forgery.js';
import {
  checkRelation,
  loadZkir,
  traceCall,
} from '#test-utils/zkir/relationCheck.js';
import { witnessCoverage } from '#test-utils/zkir/witnessCoverage.js';
import {
  CONSTRAINT_OPS,
  OUTPUTS,
  type ZkirV2,
} from '#test-utils/zkir/zkirV2.js';
import { MAX_UINT64, MAX_UINT128 } from './consts.js';
import { toU128 } from './oracles.js';

/**
 * Forged witness results for the relation tests of the math modules.
 *
 * Each forgery replaces the result of one witness call. Two kinds exist:
 *
 *   - Leaf forgeries change one leaf value of the result: +1, -1, 0, the
 *     type maximum, a random value in range, the first value out of range
 *     and the field element -1.
 *   - Joint forgeries change several leaves so that every check passes but
 *     one. They name the check they attack, so a missing constraint shows as
 *     an accepted forgery.
 *
 * A forgery is sound when the relation rejects it. The only exception is a
 * free leaf (see {@link isFreeLeaf}): the relation accepts every in-range
 * value of it, and the circuit output does not change.
 */

/** A forged result for one witness call. */
export type Forgery = {
  /** A short description, used in failure messages. */
  label: string;
  /** The forged result, in the shape of the honest result. */
  value: unknown;
  /**
   * The assertion that the forgery attacks: the lenient run of the generated
   * JavaScript must record this message. Not set for a range forgery.
   */
  attacks?: string;
};

const TWO_64 = 2n ** 64n;
const TWO_128 = 2n ** 128n;

/** The field element `-value`. */
const negField = (value: bigint): bigint =>
  (FIELD_MODULUS - (value % FIELD_MODULUS)) % FIELD_MODULUS;

const modInverse = (value: bigint): bigint => {
  // FIELD_MODULUS is prime: value^(p - 2) is the inverse.
  let result = 1n;
  let base = value % FIELD_MODULUS;
  for (let e = FIELD_MODULUS - 2n; e > 0n; e >>= 1n) {
    if (e & 1n) result = (result * base) % FIELD_MODULUS;
    base = (base * base) % FIELD_MODULUS;
  }
  return result;
};

/** A deterministic value in `[0, 2^bits)` for a call, a leaf and a salt. */
const pseudoRandom = (bits: number, ...salt: number[]): bigint => {
  let state = 0x9e3779b97f4a7c15n;
  for (const s of salt) {
    state =
      (state * 6364136223846793005n + BigInt(s) + 1442695040888963407n) %
      2n ** 64n;
  }
  let value = 0n;
  for (let i = 0; i < Math.ceil(bits / 64); i++) {
    state = (state * 6364136223846793005n + 1442695040888963407n) % 2n ** 64n;
    value = (value << 64n) | state;
  }
  return value % (1n << BigInt(bits));
};

/**
 * Whether leaf `leaf` of `call` is free. `Uint128.toU128` calls
 * `wit_divUint128(value, 2^64)` and uses only `quotient.low` and
 * `remainder.low`. The circuit range-checks `quotient.high` (leaf 1) and
 * `remainder.high` (leaf 3) and uses them nowhere else. No other leaf of any
 * witness call is free.
 */
export function isFreeLeaf(call: WitnessCall, leaf: number): boolean {
  return (
    call.name === 'wit_divUint128' &&
    call.args[1] === TWO_64 &&
    (leaf === 1 || leaf === 3)
  );
}

/** Leaf forgeries for every leaf of `call`. */
export function leafForgeries(
  call: WitnessCall,
  widths: readonly (number | undefined)[],
): Forgery[] {
  const leaves = witnessLeaves(call.result);
  return leaves.flatMap((honest, leaf) => {
    const width = widths[leaf];
    if (width === undefined) {
      throw new Error(`leaf ${leaf} of ${call.name} has no bit width`);
    }
    const max = (1n << BigInt(width)) - 1n;
    const candidates = new Map<bigint, string>([
      [honest + 1n, '+1'],
      [negField(1n - honest), '-1'],
      [0n, '0'],
      [max, 'max'],
      [pseudoRandom(width, call.index, leaf), 'random'],
      [max + 1n, '2^bits'],
      [negField(1n), 'field -1'],
    ]);
    candidates.delete(honest);
    return [...candidates].map(([value, label]) => ({
      label: `${call.name}#${call.index} leaf ${leaf} ${label}`,
      value: withLeaf(call.result, leaf, value),
    }));
  });
}

type DivResult = { quotient: bigint; remainder: bigint };
type U128 = { low: bigint; high: bigint };
type DivResultU128 = { quotient: U128; remainder: U128 };
const big = (u: U128): bigint => (u.high << 64n) + u.low;

/**
 * Range-isolation forgeries for a witness result that the circuit checks
 * only as a weighted sum: `sum(weights[i] * limbs[i])` equals a known value.
 *
 * For each limb `i`, the forgery moves one unit to or from a partner limb
 * `k` and changes limb `i` by `weights[k] / weights[i]` in the field. The
 * weighted sum does not change, limb `k` stays in range and limb `i` leaves
 * its range. Only the range check of limb `i` can reject it.
 */
const rangeIsolations = (
  name: string,
  limbs: readonly bigint[],
  weights: readonly bigint[],
  max: bigint,
  build: (limbs: bigint[]) => unknown,
): Forgery[] =>
  limbs.flatMap((_limb, i) => {
    // Prefer the next limb: then limb i only takes a carry.
    const order = [i + 1, ...limbs.keys()].filter(
      (k) => k !== i && k < limbs.length,
    );
    const down = order.find((k) => limbs[k] >= 1n);
    const up = order.find((k) => limbs[k] < max);
    const k = down ?? up;
    if (k === undefined) {
      return [];
    }
    const sign = down !== undefined ? 1n : -1n;
    const shift =
      (weights[k] * modInverse(weights[i]) * sign + FIELD_MODULUS) %
      FIELD_MODULUS;
    const next = [...limbs];
    next[k] = limbs[k] - sign;
    next[i] = (limbs[i] + shift) % FIELD_MODULUS;
    return [
      {
        label: `${name}: limb ${i} out of range, limb ${k} ${sign > 0n ? '- 1' : '+ 1'} (same sum)`,
        value: build(next),
      },
    ];
  });

const digitForgeries = (
  call: WitnessCall,
  digits: bigint[],
  message: string,
): Forgery[] => [
  {
    label: `${call.name}: digit 0 + 1 mod 256`,
    value: digits.map((d, i) => (i === 0 ? (d + 1n) % 256n : d)),
    attacks: message,
  },
  ...rangeIsolations(
    call.name,
    digits,
    digits.map((_d, i) => 256n ** BigInt(i)),
    0xffn,
    (next) => next,
  ),
];

/** Joint forgeries for `call`, each against one check of the circuit. */
export function jointForgeries(call: WitnessCall): Forgery[] {
  switch (call.name) {
    case 'wit_divUint64': {
      const [a, b] = call.args as [bigint, bigint];
      const { quotient: q, remainder: r } = call.result as DivResult;
      const out: Forgery[] = [
        {
          label: 'wit_divUint64: q + 1',
          value: { quotient: q + 1n, remainder: r },
          attacks: 'Uint64: division invalid',
        },
      ];
      if (r + 1n < b) {
        out.push({
          label: 'wit_divUint64: r + 1',
          value: { quotient: q, remainder: r + 1n },
          attacks: 'Uint64: division invalid',
        });
      }
      if (q >= 1n && r + b <= MAX_UINT64) {
        out.push({
          label: 'wit_divUint64: q - 1, r + b',
          value: { quotient: q - 1n, remainder: r + b },
          attacks: 'Uint64: remainder error',
        });
      }
      if (b >= 2n) {
        // q * b + r == a holds in the field, q is out of range.
        const r2 = (r + 1n) % b;
        out.push({
          label: 'wit_divUint64: q = (a - r - 1) / b in the field',
          value: {
            quotient:
              ((a - r2 + FIELD_MODULUS) * modInverse(b)) % FIELD_MODULUS,
            remainder: r2,
          },
        });
      }
      out.push({
        label: 'wit_divUint64: q + 1, r - b in the field',
        value: { quotient: q + 1n, remainder: negField(b - r) },
      });
      return out;
    }
    case 'wit_sqrtUint64':
    case 'wit_sqrtU128': {
      const root = call.result as bigint;
      const prefix = call.name === 'wit_sqrtUint64' ? 'Uint64' : 'Uint128';
      const width = call.name === 'wit_sqrtUint64' ? 32n : 64n;
      const out: Forgery[] = [
        {
          label: `${call.name}: root + 1`,
          value: root + 1n,
          // For the largest root, root + 1 is out of range instead.
          attacks:
            root + 1n < 1n << width
              ? `${prefix}: sqrt overestimate`
              : undefined,
        },
        { label: `${call.name}: root + 2^bits`, value: root + (1n << width) },
        { label: `${call.name}: -root (same square)`, value: negField(root) },
        { label: `${call.name}: -root - 1`, value: negField(root + 1n) },
      ];
      if (root >= 1n) {
        out.push({
          label: `${call.name}: root - 1`,
          value: root - 1n,
          attacks: `${prefix}: sqrt underestimate`,
        });
      }
      return out;
    }
    case 'wit_uint64ToUnpackedBytes':
      return digitForgeries(
        call,
        call.result as bigint[],
        'Uint64: toUnpackedBytes verification failed',
      );
    case 'wit_unpackBytes':
      return digitForgeries(
        call,
        call.result as bigint[],
        'Pack: unpack verification failed',
      );
    case 'wit_divUint128': {
      const [, divisor] = call.args as [bigint, bigint];
      if (divisor !== TWO_64) {
        throw new Error('wit_divUint128 is called only by toU128');
      }
      const { quotient, remainder } = call.result as DivResultU128;
      const high = quotient.low;
      const low = remainder.low;
      const split = (h: bigint, l: bigint, qh = 0n, rh = 0n) => ({
        quotient: { low: h, high: qh },
        remainder: { low: l, high: rh },
      });
      const out: Forgery[] = [
        {
          label: 'toU128 split: high + 1',
          value: split(high + 1n, low),
          attacks: 'Uint128: conversion invalid',
        },
        {
          label: 'toU128 split: low + 1',
          value: split(high, low + 1n),
          attacks: 'Uint128: conversion invalid',
        },
        {
          label: 'toU128 split: free quotient.high = 1',
          value: split(high, low, 1n, 0n),
        },
        {
          label: 'toU128 split: free remainder.high = 2^64 - 1',
          value: split(high, low, 0n, MAX_UINT64),
        },
        {
          label: 'toU128 split: free quotient.high = 2^64 (out of range)',
          value: split(high, low, TWO_64, 0n),
        },
      ];
      out.push(
        ...rangeIsolations(
          'toU128 split [low, high]',
          [low, high],
          [1n, TWO_64],
          MAX_UINT64,
          ([l, h]) => split(h, l),
        ),
      );
      return out;
    }
    case 'wit_divU128': {
      const b = big((call.args as [U128, U128])[1]);
      const result = call.result as DivResultU128;
      const q = big(result.quotient);
      const r = big(result.remainder);
      const as = (quotient: bigint, rem: bigint) => ({
        quotient: toU128(quotient),
        remainder: toU128(rem),
      });
      const out: Forgery[] = [
        {
          label: 'wit_divU128: q + 1',
          value: as(q + 1n, r),
          attacks: 'Uint128: division invalid',
        },
      ];
      if (r + 1n < b) {
        out.push({
          label: 'wit_divU128: r + 1',
          value: as(q, r + 1n),
          attacks: 'Uint128: division invalid',
        });
      }
      if (q >= 1n && r + b <= MAX_UINT128) {
        out.push({
          label: 'wit_divU128: q - 1, r + b',
          value: as(q - 1n, r + b),
          attacks: 'Uint128: remainder error',
        });
      }
      // k * b is a multiple of 2^128: q + k gives the same low product.
      const k = b === 0n ? 0n : TWO_128 / (b & -b);
      if (b > 0n && b % 2n === 0n && q + k <= MAX_UINT128) {
        out.push({
          label: 'wit_divU128: q + 2^128 / 2^v(b) (product wraps to q * b)',
          value: as(q + k, r),
          attacks: 'Uint128: division product overflow',
        });
      }
      if (result.quotient.high >= 1n) {
        out.push({
          label: 'wit_divU128: quotient.low + 2^64, quotient.high - 1',
          value: {
            quotient: {
              low: result.quotient.low + TWO_64,
              high: result.quotient.high - 1n,
            },
            remainder: result.remainder,
          },
        });
      }
      if (result.remainder.high >= 1n) {
        out.push({
          label: 'wit_divU128: remainder.low + 2^64, remainder.high - 1',
          value: {
            quotient: result.quotient,
            remainder: {
              low: result.remainder.low + TWO_64,
              high: result.remainder.high - 1n,
            },
          },
        });
      }
      out.push({
        label: 'wit_divU128: quotient.low - 2^64 (field), quotient.high + 1',
        value: {
          quotient: {
            low: negField(TWO_64 - result.quotient.low),
            high: result.quotient.high + 1n,
          },
          remainder: result.remainder,
        },
      });
      return out;
    }
    default:
      throw new Error(`no joint forgeries for ${call.name}`);
  }
}

/**
 * Circuit arguments with one bigint leaf set to `2^bits + 1`, a value above
 * its declared type. (`2^bits` itself splits to a zero `U128` divisor in
 * `Uint128`, and the honest division witness cannot run on it.) A `Bytes`
 * argument has no such value in a `Uint8Array`, and a `Field` argument has
 * no bit bound, so neither gets a forgery.
 */
export function inputForgeries(
  args: readonly unknown[],
  widths: readonly (number | undefined)[],
): { label: string; args: unknown[] }[] {
  if (args.some((arg) => arg instanceof Uint8Array)) {
    return [];
  }
  const leaves = witnessLeaves([...args]);
  if (leaves.length !== widths.length) {
    throw new Error(
      `arguments have ${leaves.length} leaves, input has ${widths.length}`,
    );
  }
  return leaves.flatMap((_value, leaf) => {
    const width = widths[leaf];
    if (width === undefined) {
      return [];
    }
    return [
      {
        label: `argument leaf ${leaf} = 2^${width} + 1`,
        args: withLeaf(
          [...args],
          leaf,
          (1n << BigInt(width)) + 1n,
        ) as unknown[],
      },
    ];
  });
}

/**
 * The witness plan for an input that the circuit must reject. The honest
 * division witnesses throw for a zero divisor, so this plan gives them the
 * result `quotient 0, remainder a`. Every other call stays honest.
 */
export const mustRejectPlan: ForgeryPlan = (call) => {
  if (call.result !== undefined) return undefined;
  if (call.name === 'wit_divUint64') {
    return { quotient: 0n, remainder: call.args[0] };
  }
  if (call.name === 'wit_divU128') {
    return { quotient: toU128(0n), remainder: call.args[0] };
  }
  return undefined;
};

/** Counts of a forgery run, for the test log and the coverage report. */
export type ForgeryTally = {
  forgeries: number;
  rejected: number;
  acceptedFree: number;
  incoherent: number;
};

/**
 * Asserts that `outcome` is sound for `forgery`, which forges one call:
 *
 *   - The evaluator and the relation check agree.
 *   - If only free leaves change and they stay in range, the relation accepts
 *     and the output does not change. Otherwise the relation rejects.
 *   - The relation never accepts a changed output.
 *   - A joint forgery records the assertion that it attacks.
 */
export function expectSound(
  outcome: ForgeryOutcome,
  forgery: Forgery,
  tally?: ForgeryTally,
): void {
  const where = `${forgery.label}: ${JSON.stringify(outcome.verdict)}`;
  expect(outcome.violations.length === 0, where).toBe(outcome.verdict.accepted);
  expect(outcome.verdict.accepted && outcome.outputChanged, where).toBe(false);
  const freeInRange =
    outcome.deviations.length > 0 &&
    outcome.deviations.every(({ call, leaves }) =>
      leaves.every(
        (leaf) =>
          isFreeLeaf(call, leaf) &&
          witnessLeaves(forgery.value)[leaf] <= MAX_UINT64,
      ),
    );
  expect(outcome.verdict.accepted, where).toBe(freeInRange);
  if (forgery.attacks !== undefined && outcome.coherent) {
    expect(outcome.failures, where).toContain(forgery.attacks);
  }
  if (tally !== undefined) {
    tally.forgeries++;
    if (outcome.verdict.accepted) tally.acceptedFree++;
    else tally.rejected++;
    if (!outcome.coherent) tally.incoherent++;
  }
}

/** One forgery of one witness call of a run. */
type CallForgery = { call: WitnessCall; forgery: Forgery };

/**
 * The joint and leaf forgeries of every witness call of `run`. A call whose
 * honest witness threw (a zero divisor) uses the result of
 * {@link mustRejectPlan}.
 */
function callForgeries(run: Replay): CallForgery[] {
  return run.calls.flatMap((honestCall) => {
    const call =
      honestCall.result === undefined
        ? { ...honestCall, result: mustRejectPlan(honestCall) }
        : honestCall;
    const widths = fieldWidths(
      run.proofData.privateTranscriptOutputs[call.index].alignment,
    );
    return [...jointForgeries(call), ...leafForgeries(call, widths)].map(
      (forgery) => ({ call, forgery }),
    );
  });
}

/**
 * Forges every witness call of one honest run of `circuit` with the leaf and
 * joint forgeries, and asserts that each outcome is sound.
 */
export async function expectForgeriesRejected(
  forger: RelationForger,
  circuit: string,
  args: readonly unknown[],
): Promise<ForgeryTally> {
  const tally: ForgeryTally = {
    forgeries: 0,
    rejected: 0,
    acceptedFree: 0,
    incoherent: 0,
  };
  const honest = await forger.replay(circuit, args);
  expect(honest.failures, `honest ${circuit}`).toEqual([]);
  for (const { call, forgery } of callForgeries(honest)) {
    const outcome = await forger.forge(circuit, args, (c) =>
      c.index === call.index ? forgery.value : undefined,
    );
    expectSound(outcome, forgery, tally);
  }
  return tally;
}

/**
 * Asserts that the relation rejects every preimage of `args`, an input that
 * the circuit must reject: the one with honest witness results and every
 * forgery of each witness call. Returns the number of preimages.
 */
export async function expectMustRejectInput(
  forger: RelationForger,
  circuit: string,
  args: readonly unknown[],
): Promise<number> {
  const run = await forger.replay(circuit, args, mustRejectPlan);
  let count = 0;
  for (const entry of [undefined, ...callForgeries(run)]) {
    const label = entry?.forgery.label ?? 'honest witness results';
    const outcome = await forger.attempt(circuit, args, {
      plan: (c) =>
        entry !== undefined && c.index === entry.call.index
          ? entry.forgery.value
          : mustRejectPlan(c),
      fill: mustRejectPlan,
    });
    expect(outcome.violations.length === 0, label).toBe(
      outcome.verdict.accepted,
    );
    expect(outcome.verdict.accepted, label).toBe(false);
    count++;
  }
  return count;
}

/** The transcript positions of the free leaves of an honest run. */
export function freePositions(calls: readonly WitnessCall[]): number[] {
  const positions: number[] = [];
  let offset = 0;
  for (const call of calls) {
    const count = witnessLeaves(call.result).length;
    for (let leaf = 0; leaf < count; leaf++) {
      if (isFreeLeaf(call, leaf)) positions.push(offset + leaf);
    }
    offset += count;
  }
  return positions;
}

/**
 * Asserts the static coverage of `circuit`: every private input has a range
 * check of its declared width, and exactly the free leaves of the honest run
 * reach no assertion and no output.
 */
export async function expectCoverage(
  forger: RelationForger,
  artifact: string,
  circuit: string,
  args: readonly unknown[],
): Promise<void> {
  const honest = await forger.replay(circuit, args);
  const widths = honest.proofData.privateTranscriptOutputs.flatMap((entry) =>
    fieldWidths(entry.alignment),
  );
  const coverage = witnessCoverage(loadZkir(artifact, circuit));
  expect(coverage.length).toBe(widths.length);
  for (const entry of coverage) {
    expect(entry.bits, `private input ${entry.position}`).toContain(
      widths[entry.position],
    );
  }
  expect(
    coverage.filter((entry) => !entry.reachesSink).map((e) => e.position),
  ).toEqual(freePositions(honest.calls));
}

/**
 * Runs `call` on a simulator, checks the relation on its proof data and
 * returns the result.
 */
export async function expectHonestAccepted<R>(
  simulator: unknown,
  artifact: string,
  circuit: string,
  call: () => Promise<R>,
): Promise<R> {
  const { result, proofData } = await traceCall(simulator, call);
  expect(
    await checkRelation(loadZkir(artifact, circuit), circuit, proofData),
    `honest ${circuit}`,
  ).toEqual({ accepted: true });
  return result;
}

/** Seed of the random relation inputs, so that a failure can be repeated. */
export const RELATION_SEED = 1301;

/** One witness circuit of a mock, with its oracle and its inputs. */
export type RelationCase<
  S,
  A extends readonly unknown[] = readonly unknown[],
> = {
  /** The mock circuit name, also the ZKIR file name. */
  circuit: string;
  /** Calls the circuit on the simulator. */
  call: (simulator: S, ...args: A) => Promise<unknown>;
  /** An independent bigint oracle of the result. */
  oracle: (...args: A) => unknown;
  /** Boundary inputs for the honest check. */
  boundary: A[];
  /** Random inputs for the honest check (32 samples). */
  random: fc.Arbitrary<A>;
  /** Inputs for the forgeries. */
  forgeries: A[];
  /** Inputs that the circuit must reject, for example an overflow. */
  rejects?: A[];
};

/** Erases the argument type of a case, so that one list holds all cases. */
export const relationCase = <S, A extends readonly unknown[]>(
  entry: RelationCase<S, A>,
): RelationCase<S> => entry as unknown as RelationCase<S>;

/**
 * Defines the relation tests of the witness circuits of one mock:
 *
 *   1. The relation accepts the proof data of each honest call, and the
 *      result equals the oracle.
 *   2. Every leaf and joint forgery of every witness call is sound
 *      ({@link expectSound}).
 *   3. The relation rejects each argument above its declared type.
 *   4. The relation rejects every preimage of an input that the circuit
 *      must reject (`rejects`), with honest and with forged witness results.
 *   5. Every witness result has its range check, and only the documented
 *      free leaves reach no assertion and no output.
 *
 * The tests run on the dry backend only: they read the dry call trace and
 * use forged witness results.
 */
export function describeRelation<S>(
  artifact: string,
  options: {
    simulator: () => Promise<S>;
    witnesses: () => object;
    cases: RelationCase<S>[];
  },
): void {
  describe.skipIf(isLiveBackend())(`${artifact} ZKIR v2 relation`, () => {
    let simulator: S;
    let forger: RelationForger;

    beforeAll(async () => {
      simulator = await options.simulator();
      forger = await RelationForger.create(artifact, options.witnesses());
    });

    describe.each(options.cases)('$circuit', (entry) => {
      test('accepts the honest preimage of the boundary and random inputs', async () => {
        const inputs = [
          ...entry.boundary,
          ...fc.sample(entry.random, { numRuns: 32, seed: RELATION_SEED }),
        ];
        for (const args of inputs) {
          const result = await expectHonestAccepted(
            simulator,
            artifact,
            entry.circuit,
            () => entry.call(simulator, ...args),
          );
          expect(result).toEqual(entry.oracle(...args));
        }
      }, 60_000);

      test('rejects every forged witness result', async () => {
        for (const args of entry.forgeries) {
          const tally = await expectForgeriesRejected(
            forger,
            entry.circuit,
            args,
          );
          expect(tally.forgeries).toBeGreaterThan(0);
        }
      }, 120_000);

      test('rejects every argument above its declared type', async () => {
        for (const args of entry.forgeries) {
          const honest = await forger.replay(entry.circuit, args);
          for (const forged of inputForgeries(
            args,
            fieldWidths(honest.proofData.input.alignment),
          )) {
            const outcome = await forger.attempt(entry.circuit, forged.args);
            expect(outcome.violations.length === 0, forged.label).toBe(
              outcome.verdict.accepted,
            );
            expect(outcome.verdict.accepted, forged.label).toBe(false);
          }
        }
      });

      const rejects = entry.rejects;
      if (rejects !== undefined) {
        test('has no accepted preimage for an input that it must reject', async () => {
          for (const args of rejects) {
            expect(
              await expectMustRejectInput(forger, entry.circuit, args),
            ).toBeGreaterThan(0);
          }
        }, 120_000);
      }

      test('range-checks every witness result and leaves only the documented leaves free', async () => {
        await expectCoverage(
          forger,
          artifact,
          entry.circuit,
          entry.forgeries[0],
        );
      });
    });
  });
}

/**
 * Runs every forgery of {@link expectForgeriesRejected}, every argument
 * forgery and every input in `rejects` against `zkir`, and returns the label
 * of the first one that the relation accepts although it is not sound, or
 * `undefined`.
 *
 * A mutation test passes a copy of the circuit with one constraint removed:
 * a label shows that the forgeries detect the missing constraint.
 */
export async function findUnsoundForgery(
  forger: RelationForger,
  circuit: string,
  args: readonly unknown[],
  zkir: ZkirV2,
  rejects: readonly (readonly unknown[])[] = [],
): Promise<string | undefined> {
  const honest = await forger.replay(circuit, args);
  for (const { call, forgery } of callForgeries(honest)) {
    const outcome = await forger.forge(
      circuit,
      args,
      (c) => (c.index === call.index ? forgery.value : undefined),
      zkir,
    );
    if (!outcome.verdict.accepted) continue;
    const values = witnessLeaves(forgery.value);
    const free = outcome.deviations.every(({ call: c, leaves }) =>
      leaves.every((leaf) => isFreeLeaf(c, leaf) && values[leaf] <= MAX_UINT64),
    );
    if (outcome.outputChanged || !free) return forgery.label;
  }
  for (const forged of inputForgeries(
    args,
    fieldWidths(honest.proofData.input.alignment),
  )) {
    const outcome = await forger.attempt(circuit, forged.args, { zkir });
    if (outcome.verdict.accepted) return forged.label;
  }
  for (const [index, rejected] of rejects.entries()) {
    const run = await forger.replay(circuit, rejected, mustRejectPlan);
    for (const entry of [undefined, ...callForgeries(run)]) {
      const outcome = await forger.attempt(circuit, rejected, {
        plan: (c) =>
          entry !== undefined && c.index === entry.call.index
            ? entry.forgery.value
            : mustRejectPlan(c),
        fill: mustRejectPlan,
        zkir,
      });
      if (outcome.verdict.accepted) {
        return `must-reject input ${index}: ${entry?.forgery.label ?? 'honest witness results'}`;
      }
    }
  }
  return undefined;
}

/**
 * Returns the indexes of the constraint instructions of `zkir` whose removal
 * no forgery detects (see {@link findUnsoundForgery}).
 */
export async function undetectedRemovals(
  forger: RelationForger,
  circuit: string,
  args: readonly unknown[],
  zkir: ZkirV2,
  rejects: readonly (readonly unknown[])[] = [],
): Promise<number[]> {
  const undetected: number[] = [];
  for (const [index, instruction] of zkir.instructions.entries()) {
    if (!CONSTRAINT_OPS.includes(instruction.op)) continue;
    const mutant = structuredClone(zkir);
    mutant.instructions.splice(index, 1);
    if (
      (await findUnsoundForgery(forger, circuit, args, mutant, rejects)) ===
      undefined
    ) {
      undetected.push(index);
    }
  }
  return undetected;
}

/**
 * Describes the constraint instruction at `index` by what it constrains:
 * `assert <n>` (the n-th assertion of the circuit), `range of input <n>`,
 * `range of witness element <n>` (the n-th private transcript element) or
 * `<op> on variable <n>`.
 */
export function describeConstraint(zkir: ZkirV2, index: number): string {
  const instruction = zkir.instructions[index];
  if (instruction === undefined || !CONSTRAINT_OPS.includes(instruction.op)) {
    throw new Error(`instruction ${index} is not a constraint`);
  }
  const privateVariables: number[] = [];
  let next = zkir.num_inputs;
  let asserts = 0;
  for (const [i, ins] of zkir.instructions.entries()) {
    if (i === index) break;
    if (ins.op === 'assert') asserts++;
    if (ins.op === 'private_input') privateVariables.push(next);
    next += OUTPUTS[ins.op] ?? 0;
  }
  if (instruction.op === 'assert') return `assert ${asserts}`;
  const variable = instruction.var as number;
  if (variable < zkir.num_inputs) return `range of input ${variable}`;
  const position = privateVariables.indexOf(variable);
  return position >= 0
    ? `range of witness element ${position}`
    : `${instruction.op} on variable ${variable}`;
}

/** The index of the constraint that {@link describeConstraint} describes as `description`. */
export function findConstraint(zkir: ZkirV2, description: string): number {
  const found = zkir.instructions.flatMap((instruction, index) =>
    CONSTRAINT_OPS.includes(instruction.op) &&
    describeConstraint(zkir, index) === description
      ? [index]
      : [],
  );
  if (found.length !== 1) {
    throw new Error(
      `${found.length} constraints are described as '${description}', not 1`,
    );
  }
  return found[0];
}
