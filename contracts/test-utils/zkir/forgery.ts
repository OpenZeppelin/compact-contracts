import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  type CallProofData,
  createCircuitContext,
  createConstructorContext,
  dummyContractAddress,
} from '@midnight-ntwrk/compact-runtime';
import {
  FIELD_MODULUS,
  fieldAtoms,
  fieldWidths,
  modField,
  toFields,
} from './fieldRepr.js';
import {
  checkRelation,
  loadZkir,
  type RelationVerdict,
} from './relationCheck.js';
import {
  type Evaluation,
  evaluate,
  type ReconstituteRule,
  type Violation,
  type ZkirV2,
} from './zkirV2.js';

/**
 * Coherent witness forgeries for the ZKIR v2 relation check.
 *
 * A forgery replaces the result of one or more witness calls. A check that
 * changes only a witness result and keeps the honest circuit output can fail
 * because the output no longer matches, even when the circuit has no
 * constraint on that result. A coherent forgery avoids this:
 *
 *   1. A lenient copy of the generated contract runs the circuit with the
 *      forged result. The copy records each failed assertion, cast or type
 *      check instead of throwing, so the run continues as an honest prover
 *      would after the forged call. Every later witness call gets the honest
 *      result for its actual (possibly changed) arguments.
 *   2. The ZKIR v2 evaluator computes the outputs that the relation forces
 *      for the inputs and the forged private transcript.
 *   3. The `zkir-v2` relation check runs on the preimage with these outputs.
 *
 * A later witness call whose honest witness has no result for its changed
 * arguments (for example a zero divisor) gets its result from a fill plan.
 *
 * The runtime cannot encode a value at or above the field modulus. If a
 * forged result has a value outside its declared width and the lenient run
 * stops with such an encoding error ({@link REPRESENTATION_ERRORS}), the
 * forgery falls back to the honest transcript with only the forged results
 * changed, and reports `coherent: false`. Every other error of the lenient
 * run propagates.
 */

/**
 * Messages of the runtime errors for a value that the runtime cannot encode
 * (a value at or above the field modulus). Only these errors allow the
 * field-level fallback, and only for a forged value outside its declared
 * width.
 */
export const REPRESENTATION_ERRORS: readonly RegExp[] = [
  /^out of bounds for prime field$/,
];

/**
 * A witness call that the honest witness cannot answer for its arguments
 * and that no plan answers.
 */
export class UnansweredWitnessCall extends Error {
  constructor(
    readonly call: WitnessCall,
    readonly reason: unknown,
  ) {
    super(
      `witness call ${call.index} (${call.name}) has no result: ${reason instanceof Error ? reason.message : String(reason)}`,
    );
    this.name = 'UnansweredWitnessCall';
  }
}

/** One witness call of a circuit run. */
export type WitnessCall = {
  /** Position of the call in the private transcript. */
  index: number;
  /** The witness name, for example `wit_divUint128`. */
  name: string;
  /** The arguments of the call. */
  args: readonly unknown[];
  /**
   * The result of the honest witness for these arguments, or `undefined` if
   * the honest witness throws (for example on a zero divisor).
   */
  result: unknown;
};

/**
 * Returns a forged result for `call`, or `undefined` to keep the honest
 * result. The forged result has the same shape as `call.result`. Its leaf
 * values can be any field element, also above the declared type.
 */
export type ForgeryPlan = (call: WitnessCall) => unknown;

/** A run of the lenient contract. */
export type Replay = {
  proofData: CallProofData;
  calls: WitnessCall[];
  /** The messages of the checks that failed and did not throw. */
  failures: string[];
  /** The circuit result of the generated JavaScript. */
  result: unknown;
};

/** A forged witness result. */
export type Deviation = {
  /** The witness call. */
  call: WitnessCall;
  /** The forged result. */
  value: unknown;
  /** The positions of the leaf values that differ from `call.result`. */
  leaves: number[];
};

/** The result of {@link RelationForger.forge}. */
export type ForgeryOutcome = {
  /** The verdict of the `zkir-v2` relation check. */
  verdict: RelationVerdict;
  /** The forged results. Empty if the plan forged nothing. */
  deviations: Deviation[];
  /** Whether the forced outputs differ from the honest outputs. */
  outputChanged: boolean;
  /** The constraints that the evaluator finds violated. */
  violations: Violation[];
  /** The checks that failed in the lenient run of the generated JavaScript. */
  failures: string[];
  /** Whether every later witness call got its honest result (see above). */
  coherent: boolean;
  /** Whether a forged result has a value outside its declared width. */
  outOfType: boolean;
  /** The honest run with the same inputs. */
  honest: Replay;
};

/** Whether `value` has a leaf outside the width of its transcript entry. */
function outsideType(run: Replay, call: WitnessCall, value: unknown): boolean {
  const entry = run.proofData.privateTranscriptOutputs[call.index];
  if (entry === undefined) {
    throw new Error(`no transcript entry for witness call ${call.index}`);
  }
  const widths = fieldWidths(entry.alignment);
  return witnessLeaves(value).some((leaf, i) => {
    const width = widths[i];
    return (
      leaf < 0n ||
      leaf >= FIELD_MODULUS ||
      (width !== undefined && leaf >= 1n << BigInt(width))
    );
  });
}

/** Whether `error` is a runtime encoding error (see {@link REPRESENTATION_ERRORS}). */
function representationError(error: unknown): boolean {
  return (
    error instanceof Error &&
    REPRESENTATION_ERRORS.some((pattern) => pattern.test(error.message))
  );
}

/** Returns the leaf values of a witness result, in declaration order. */
export function witnessLeaves(value: unknown): bigint[] {
  if (typeof value === 'bigint') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(witnessLeaves);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(witnessLeaves);
  }
  throw new Error(`unsupported witness value ${String(value)}`);
}

/**
 * Returns a copy of `value` with leaf `leaf` (in the order of
 * {@link witnessLeaves}) replaced by `replacement`.
 */
export function withLeaf(
  value: unknown,
  leaf: number,
  replacement: bigint,
): unknown {
  let next = 0;
  const walk = (node: unknown): unknown => {
    if (typeof node === 'bigint') {
      return next++ === leaf ? replacement : node;
    }
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (typeof node === 'object' && node !== null) {
      return Object.fromEntries(
        Object.entries(node).map(([key, child]) => [key, walk(child)]),
      );
    }
    throw new Error(`unsupported witness value ${String(node)}`);
  };
  const result = walk(value);
  if (leaf < 0 || leaf >= next) {
    throw new Error(`witness value has no leaf ${leaf}`);
  }
  return result;
}

const LENIENT = Symbol.for('@openzeppelin/compact-contracts/zkir/lenient');
const RUNTIME_IMPORT =
  "import * as __compactRuntime from '@midnight-ntwrk/compact-runtime';";

type Recorder = {
  failures: string[];
  assert(condition: boolean, message: string): void;
  typeError(name: string, ...rest: unknown[]): void;
  fail(message: unknown): void;
  output(
    descriptor: { toValue(value: unknown): unknown },
    value: unknown,
  ): unknown;
};

const recorder: Recorder = {
  failures: [],
  assert(condition, message) {
    if (!condition) {
      recorder.failures.push(message);
    }
  },
  typeError(name) {
    recorder.failures.push(`type error in ${name}`);
  },
  fail(message) {
    recorder.failures.push(String(message));
  },
  output(descriptor, value) {
    // A lenient run can compute a circuit output at or above the field
    // modulus, for example a product of arguments above their declared type.
    // The relation check takes the outputs from the ZKIR evaluator, so the
    // copy converts the value reduced modulo p and records the event.
    if (typeof value === 'bigint' && value !== modField(value)) {
      recorder.failures.push('output at or above the field modulus');
      return descriptor.toValue(modField(value));
    }
    return descriptor.toValue(value);
  },
};

/**
 * Rewrites the JavaScript that `compactc` generates into a lenient copy:
 * `assert`, `typeError` and the thrown `CompactError`s of casts call a
 * recorder instead, and the conversion of the circuit output reduces a
 * bigint at or above the field modulus. The runtime import points to
 * `runtimeUrl`, so the copy can live outside the package. The copy has no
 * source map.
 *
 * @throws If the source does not have the expected runtime import.
 */
export function lenientSource(source: string, runtimeUrl: string): string {
  if (source.split(RUNTIME_IMPORT).length !== 2) {
    throw new Error('lenient copy: the runtime import was not found once');
  }
  return source
    .replace(
      RUNTIME_IMPORT,
      `import * as __compactRuntime from '${runtimeUrl}';\n` +
        `const __lenient = globalThis[Symbol.for('${LENIENT.description}')];`,
    )
    .replaceAll('__compactRuntime.assert(', '__lenient.assert(')
    .replaceAll('__compactRuntime.typeError(', '__lenient.typeError(')
    .replaceAll('throw new __compactRuntime.CompactError(', '__lenient.fail(')
    .replace(
      /partialProofData\.output = \{ value: (_descriptor_\d+)\.toValue\(/g,
      'partialProofData.output = { value: __lenient.output($1, ',
    )
    .replace(/^\/\/# sourceMappingURL=.*$/m, '');
}

const ARTIFACTS = new URL('../../artifacts/', import.meta.url);
let lenientDir: string | undefined;

type ContractClass = new (
  witnesses: Record<string, unknown>,
) => {
  initialState(context: unknown): Promise<{
    currentContractState: { data: unknown };
    currentPrivateState: unknown;
    currentZswapLocalState: unknown;
  }>;
  impureCircuits: Record<
    string,
    (
      context: unknown,
      ...args: unknown[]
    ) => Promise<{
      result: unknown;
      context: { callProofDataTrace: CallProofData[] };
    }>
  >;
};

async function loadLenientContract(artifact: string): Promise<ContractClass> {
  const contractUrl = new URL(`${artifact}/contract/index.js`, ARTIFACTS);
  const contractPath = fileURLToPath(contractUrl);
  const runtimePath = createRequire(contractPath).resolve(
    '@midnight-ntwrk/compact-runtime',
  );
  if (lenientDir === undefined) {
    const dir = mkdtempSync(join(tmpdir(), 'zkir-lenient-'));
    lenientDir = dir;
    process.once('exit', () => rmSync(dir, { recursive: true, force: true }));
  }
  const copy = join(lenientDir, `${artifact}.mjs`);
  writeFileSync(
    copy,
    lenientSource(
      readFileSync(contractPath, 'utf8'),
      pathToFileURL(runtimePath).href,
    ),
  );
  (globalThis as Record<symbol, unknown>)[LENIENT] = recorder;
  const module = (await import(pathToFileURL(copy).href)) as {
    Contract: ContractClass;
  };
  return module.Contract;
}

type WitnessFunction = (
  context: { privateState: unknown },
  ...args: unknown[]
) => [unknown, unknown];

const COIN_PUBLIC_KEY = '0'.repeat(64);

/** A stable text key for circuit arguments (bigints, bytes, arrays, structs). */
const argsKey = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    typeof item === 'bigint'
      ? `${item}n`
      : item instanceof Uint8Array
        ? `0x${Buffer.from(item).toString('hex')}`
        : item,
  );

/**
 * Runs circuits of one compiled contract with forged witness results and
 * checks the forged preimages against the ZKIR v2 relation.
 */
export class RelationForger {
  private initial:
    | Awaited<ReturnType<InstanceType<ContractClass>['initialState']>>
    | undefined;
  private lastHonest: { key: string; replay: Replay } | undefined;

  private constructor(
    private readonly artifact: string,
    private readonly Contract: ContractClass,
    private readonly witnesses: Readonly<Record<string, WitnessFunction>>,
  ) {}

  /**
   * @param artifact - The compiled contract, for example `MockUint128`.
   * @param witnesses - The honest witnesses of the contract.
   */
  static async create(
    artifact: string,
    witnesses: object,
  ): Promise<RelationForger> {
    const functions: Record<string, WitnessFunction> = {};
    for (const [name, value] of Object.entries(witnesses)) {
      if (typeof value !== 'function') {
        throw new Error(`witness '${name}' is not a function`);
      }
      functions[name] = value as WitnessFunction;
    }
    return new RelationForger(
      artifact,
      await loadLenientContract(artifact),
      functions,
    );
  }

  /**
   * Runs `circuit` on the lenient contract. `plan` can replace witness
   * results. Without a plan, the run is honest. If the honest witness
   * throws (for example on a zero divisor), the plan must give the result.
   *
   * @throws {@link UnansweredWitnessCall} for a call that the honest witness
   * and the plan do not answer.
   */
  async replay(
    circuit: string,
    args: readonly unknown[],
    plan?: ForgeryPlan,
  ): Promise<Replay> {
    const calls: WitnessCall[] = [];
    const witnesses = Object.fromEntries(
      Object.entries(this.witnesses).map(([name, honest]) => [
        name,
        (context: { privateState: unknown }, ...callArgs: unknown[]) => {
          let privateState: unknown = context.privateState;
          let result: unknown;
          let thrown: unknown;
          try {
            [privateState, result] = honest(context, ...callArgs);
          } catch (error) {
            thrown = error;
          }
          const call: WitnessCall = {
            index: calls.length,
            name,
            args: callArgs,
            result,
          };
          calls.push(call);
          const forged = plan?.(call);
          if (forged !== undefined) {
            return [privateState, forged];
          }
          if (thrown !== undefined) {
            throw new UnansweredWitnessCall(call, thrown);
          }
          return [privateState, result];
        },
      ]),
    );
    const contract = new this.Contract(witnesses);
    this.initial ??= await contract.initialState(
      createConstructorContext({}, COIN_PUBLIC_KEY),
    );
    const context = createCircuitContext(
      circuit,
      dummyContractAddress(),
      COIN_PUBLIC_KEY,
      this.initial.currentContractState as never,
      this.initial.currentPrivateState,
    );
    const circuitFn = contract.impureCircuits[circuit];
    if (circuitFn === undefined) {
      throw new Error(`${this.artifact} has no impure circuit '${circuit}'`);
    }
    recorder.failures = [];
    const { result, context: after } = await circuitFn(context, ...args);
    const proofData = after.callProofDataTrace.at(-1);
    if (proofData === undefined || proofData.circuitId !== circuit) {
      throw new Error(`no proof data for '${circuit}' in the call trace`);
    }
    return { proofData, calls, failures: [...recorder.failures], result };
  }

  /** The honest run of `circuit` on `args`, cached for the last inputs. */
  private async honestReplay(
    circuit: string,
    args: readonly unknown[],
  ): Promise<Replay> {
    const key = `${circuit}(${argsKey(args)})`;
    if (this.lastHonest?.key !== key) {
      this.lastHonest = { key, replay: await this.replay(circuit, args) };
    }
    return this.lastHonest.replay;
  }

  /**
   * Checks the coherent preimage of one lenient run, without an honest
   * reference. Use it for inputs that the circuit must reject, for example
   * an overflow, a zero divisor or an argument above its declared type:
   * every preimage must fail.
   */
  async attempt(
    circuit: string,
    args: readonly unknown[],
    options: {
      /** Replaces witness results, as for {@link forge}. */
      plan?: ForgeryPlan;
      /** The circuit to check. The default is the compiled circuit. */
      zkir?: ZkirV2;
      /**
       * Gives the result of a call whose honest witness throws. The default
       * is `plan`.
       */
      fill?: ForgeryPlan;
    } = {},
  ): Promise<{
    verdict: RelationVerdict;
    violations: Violation[];
    failures: string[];
    coherent: boolean;
    outOfType: boolean;
  }> {
    const { plan, zkir = loadZkir(this.artifact, circuit) } = options;
    const fill = options.fill ?? plan;
    const answer: ForgeryPlan = (call) =>
      plan?.(call) ?? (call.result === undefined ? fill?.(call) : undefined);
    let run: Replay;
    let entries: bigint[][];
    let coherent = true;
    let outOfType = false;
    try {
      run = await this.replay(circuit, args, answer);
      entries = run.proofData.privateTranscriptOutputs.map(toFields);
    } catch (error) {
      if (plan === undefined || !representationError(error)) {
        throw error;
      }
      // Field-level fallback, as in `forge`: `fill` gives the calls whose
      // honest witness throws, then the plan results replace the others.
      const base = await this.replay(circuit, args, (call) =>
        call.result === undefined ? fill?.(call) : undefined,
      );
      outOfType = base.calls.some((call) => {
        const forged = plan(call);
        return forged !== undefined && outsideType(base, call, forged);
      });
      if (!outOfType) {
        throw error;
      }
      coherent = false;
      const baseEntries = base.proofData.privateTranscriptOutputs.map(toFields);
      entries = base.calls.map((call, index) => {
        const forged = plan(call);
        return forged === undefined
          ? baseEntries[index]
          : witnessLeaves(forged).map(modField);
      });
      run = { ...base, failures: [] };
    }
    const inputs = toFields(run.proofData.input);
    const evaluation = evaluate(zkir, inputs, entries.flat());
    const verdict = await checkRelation(zkir, circuit, {
      // Field atoms also carry an argument above its declared type.
      input: fieldAtoms(inputs),
      output: fieldAtoms(evaluation.outputs),
      publicTranscript: run.proofData.publicTranscript,
      privateTranscriptOutputs: entries.map(fieldAtoms),
    });
    return {
      verdict,
      violations: evaluation.violations,
      failures: run.failures,
      coherent,
      outOfType,
    };
  }

  /**
   * Checks a preimage that is given as field elements: the circuit inputs
   * and the private transcript, for example a counterexample of an SMT model
   * of the circuit. The outputs are the values that the evaluator computes.
   * The public transcript, and the split of the private transcript into the
   * results of the witness calls, come from the honest run of `honestArgs`.
   *
   * @param options.zkir - The circuit to check. The default is the compiled
   * circuit.
   * @param options.reconstitute - The rule of the returned evaluation (see
   * {@link ReconstituteRule}). It does not change the relation check.
   * @throws If the honest run reads a different number of private elements,
   * or as {@link checkRelation}.
   */
  async checkFields(
    circuit: string,
    honestArgs: readonly unknown[],
    inputs: readonly bigint[],
    privates: readonly bigint[],
    options: { zkir?: ZkirV2; reconstitute?: ReconstituteRule } = {},
  ): Promise<{ verdict: RelationVerdict; evaluation: Evaluation }> {
    const zkir = options.zkir ?? loadZkir(this.artifact, circuit);
    const honest = await this.honestReplay(circuit, honestArgs);
    const sizes = honest.calls.map((call) => witnessLeaves(call.result).length);
    const read = sizes.reduce((sum, size) => sum + size, 0);
    if (read !== privates.length) {
      throw new Error(
        `the honest run of ${circuit} reads ${read} private elements, not ${privates.length}`,
      );
    }
    let next = 0;
    const entries = sizes.map((size) => {
      next += size;
      return privates.slice(next - size, next);
    });
    const evaluation = evaluate(zkir, inputs, privates, {
      reconstitute: options.reconstitute,
    });
    const verdict = await checkRelation(zkir, circuit, {
      input: fieldAtoms(inputs),
      output: fieldAtoms(evaluation.outputs),
      publicTranscript: honest.proofData.publicTranscript,
      privateTranscriptOutputs: entries.map(fieldAtoms),
    });
    return { verdict, evaluation };
  }

  /**
   * Forges witness results with `plan` and checks the coherent preimage.
   *
   * @param zkir - The circuit to check. The default is the compiled circuit.
   * A test can pass a changed copy to show that the forgery detects a
   * missing constraint.
   * @param fill - Gives the result of a later call whose honest witness has
   * no result for its changed arguments. Its results are not deviations.
   * @throws Every error of the lenient run, except a runtime encoding error
   * for a forged value outside its declared width (field-level fallback).
   */
  async forge(
    circuit: string,
    args: readonly unknown[],
    plan: ForgeryPlan,
    zkir: ZkirV2 = loadZkir(this.artifact, circuit),
    fill?: ForgeryPlan,
  ): Promise<ForgeryOutcome> {
    const honest = await this.honestReplay(circuit, args);
    const honestEntries =
      honest.proofData.privateTranscriptOutputs.map(toFields);
    honest.calls.forEach((call, index) => {
      const leaves = witnessLeaves(call.result);
      const fields = honestEntries[index];
      if (
        fields === undefined ||
        leaves.length !== fields.length ||
        leaves.some((leaf, i) => modField(leaf) !== fields[i])
      ) {
        throw new Error(
          `witness call ${index} (${call.name}) does not match its transcript entry`,
        );
      }
    });

    const deviations: Deviation[] = [];
    const recordDeviation = (call: WitnessCall, forged: unknown) => {
      const before = witnessLeaves(call.result);
      const after = witnessLeaves(forged);
      if (before.length !== after.length) {
        throw new Error(
          `forged result of ${call.name} has ${after.length} leaves, not ${before.length}`,
        );
      }
      const leaves = after.flatMap((value, i) =>
        modField(value) === modField(before[i]) ? [] : [i],
      );
      if (leaves.length > 0) {
        deviations.push({ call, value: forged, leaves });
      }
    };

    let entries: bigint[][];
    let publicTranscript = honest.proofData.publicTranscript;
    let failures: string[];
    let coherent = true;
    try {
      const forged = await this.replay(circuit, args, (call) => {
        const result = plan(call);
        if (result !== undefined) {
          recordDeviation(call, result);
          return result;
        }
        return call.result === undefined ? fill?.(call) : undefined;
      });
      entries = forged.proofData.privateTranscriptOutputs.map(toFields);
      publicTranscript = forged.proofData.publicTranscript;
      failures = forged.failures;
    } catch (error) {
      // Field-level fallback: change only the forged results. Only for a
      // runtime encoding error and a forged value outside its type.
      const outside = honest.calls.some((call) => {
        const result = plan(call);
        return result !== undefined && outsideType(honest, call, result);
      });
      if (!representationError(error) || !outside) {
        throw error;
      }
      coherent = false;
      deviations.length = 0;
      failures = [];
      entries = honest.calls.map((call, index) => {
        const result = plan(call);
        if (result === undefined) {
          return honestEntries[index];
        }
        recordDeviation(call, result);
        return witnessLeaves(result).map(modField);
      });
    }

    const inputs = toFields(honest.proofData.input);
    const evaluation = evaluate(zkir, inputs, entries.flat());
    const honestOutputs = toFields(honest.proofData.output);
    const outputChanged =
      evaluation.outputs.length !== honestOutputs.length ||
      evaluation.outputs.some((value, i) => value !== honestOutputs[i]);

    const verdict = await checkRelation(zkir, circuit, {
      input: honest.proofData.input,
      output: fieldAtoms(evaluation.outputs),
      publicTranscript,
      privateTranscriptOutputs: entries.map(fieldAtoms),
    });
    return {
      verdict,
      deviations,
      outputChanged,
      violations: evaluation.violations,
      failures,
      coherent,
      outOfType: deviations.some(({ call, value }) =>
        outsideType(honest, call, value),
      ),
      honest,
    };
  }
}
