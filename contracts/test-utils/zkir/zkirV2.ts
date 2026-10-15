import { readFileSync } from 'node:fs';
import { FIELD_MODULUS, modField } from './fieldRepr.js';

/**
 * Reader and evaluator for the ZKIR v2 circuits that `compact-compiler`
 * writes to `artifacts/<contract>/zkir/<circuit>.zkir`.
 *
 * The evaluator runs the instructions of one circuit on field elements, as
 * the relation does. It returns the circuit outputs, the public inputs and
 * every instruction whose constraint does not hold. It does not stop at a
 * failed constraint. A test uses it to find the outputs that a forged witness
 * result forces, and the `zkir-v2` relation check then decides whether the
 * relation accepts that preimage. The evaluator does not replace the relation
 * check: it supports only the instructions in {@link OUTPUTS}, and a test
 * compares its verdict with the relation check.
 */

/** One ZKIR v2 instruction, as the compiler writes it. */
export type ZkirV2Instruction = { op: string } & Record<string, unknown>;

/** A ZKIR v2 circuit file. */
export type ZkirV2 = {
  version: { major: number; minor: number };
  do_communications_commitment?: boolean;
  num_inputs: number;
  instructions: ZkirV2Instruction[];
};

/**
 * Number of variables that each supported ZKIR v2 instruction writes. An
 * instruction that is not in this table stops the evaluation, so a new
 * compiler output cannot pass with a wrong variable numbering.
 */
export const OUTPUTS: Readonly<Record<string, number>> = {
  add: 1,
  assert: 0,
  cond_select: 1,
  constrain_bits: 0,
  constrain_eq: 0,
  constrain_to_boolean: 0,
  copy: 1,
  declare_pub_input: 0,
  div_mod_power_of_two: 2,
  less_than: 1,
  load_imm: 1,
  mul: 1,
  neg: 1,
  output: 0,
  pi_skip: 0,
  private_input: 1,
  reconstitute_field: 1,
  test_eq: 1,
};

/** The instructions that add a constraint and write no variable. */
export const CONSTRAINT_OPS: readonly string[] = [
  'assert',
  'constrain_bits',
  'constrain_eq',
  'constrain_to_boolean',
];

/** Parses a ZKIR v2 circuit and rejects every other version. */
export function parseZkirV2(json: string): ZkirV2 {
  const zkir = JSON.parse(json) as ZkirV2;
  if (zkir.version?.major !== 2) {
    throw new Error(
      `expected a ZKIR v2 circuit, got version ${JSON.stringify(zkir.version)}`,
    );
  }
  for (const [index, instruction] of zkir.instructions.entries()) {
    if (OUTPUTS[instruction.op] === undefined) {
      throw new Error(
        `unsupported ZKIR v2 instruction '${instruction.op}' at ${index}`,
      );
    }
  }
  return zkir;
}

/** Reads and parses a ZKIR v2 circuit file. */
export function readZkirV2(path: URL | string): ZkirV2 {
  return parseZkirV2(readFileSync(path, 'utf8'));
}

/**
 * How {@link evaluate} checks `reconstitute_field(divisor, modulus, bits)`:
 *
 *   - `interpreter` (the default): `modulus < 2^bits`, and the sum
 *     `divisor * 2^bits + modulus` is below the field modulus. The ZKIR
 *     interpreter of `@midnight-ntwrk/zkir-v2` `check` stops with
 *     "Reconstituted element overflows field" for a larger sum.
 *   - `circuit`: `modulus < 2^bits` and `divisor < 2^(255 - bits)`, and the
 *     result is the sum modulo the field modulus. The circuit that the proof
 *     server builds for ZKIR v2 decomposes the two parts into 255 bits and
 *     joins them as a field element, so it accepts a sum at or above the
 *     field modulus.
 */
export type ReconstituteRule = 'interpreter' | 'circuit';

/** A constraint that does not hold for the evaluated values. */
export type Violation = {
  /** Index of the instruction in `instructions`. */
  index: number;
  op: string;
};

/** The result of {@link evaluate}. */
export type Evaluation = {
  /** The values of the `output` instructions, in order. */
  outputs: bigint[];
  /** The values of the `declare_pub_input` instructions, in order. */
  publicInputs: bigint[];
  /** Every constraint that does not hold. Empty for a satisfied relation. */
  violations: Violation[];
  /** The number of private transcript elements that the circuit read. */
  privateInputsRead: number;
};

const num = (instruction: ZkirV2Instruction, key: string): number => {
  const value = instruction[key];
  if (typeof value !== 'number') {
    throw new Error(
      `instruction '${instruction.op}' has no numeric field '${key}'`,
    );
  }
  return value;
};

/** Reads a little-endian hex immediate of `load_imm`. */
export const immediate = (hex: string): bigint => {
  let value = 0n;
  for (let i = hex.length - 2; i >= 0; i -= 2) {
    value = (value << 8n) | BigInt(Number.parseInt(hex.slice(i, i + 2), 16));
  }
  return value;
};

/**
 * Runs the instructions of `zkir` on the circuit inputs `inputs` and the
 * private transcript elements `privates`.
 *
 * Variables `0` to `num_inputs - 1` are the inputs. Each instruction appends
 * the number of variables in {@link OUTPUTS}. `private_input` with a guard
 * that is not 1 reads nothing and writes 0. `less_than` requires both
 * operands below `2^bits`, and `reconstitute_field` requires the bounds of
 * `options.reconstitute` (see {@link ReconstituteRule}): a value outside
 * these bounds is a violation of that instruction.
 *
 * @throws If the inputs do not match `num_inputs`, or if the transcript has
 * fewer elements than the circuit reads. A transcript with more elements
 * than the circuit reads gives a violation with index -1.
 */
export function evaluate(
  zkir: ZkirV2,
  inputs: readonly bigint[],
  privates: readonly bigint[],
  options: { reconstitute?: ReconstituteRule } = {},
): Evaluation {
  const rule = options.reconstitute ?? 'interpreter';
  if (inputs.length !== zkir.num_inputs) {
    throw new Error(
      `circuit takes ${zkir.num_inputs} input elements, got ${inputs.length}`,
    );
  }
  const vars = inputs.map(modField);
  const outputs: bigint[] = [];
  const publicInputs: bigint[] = [];
  const violations: Violation[] = [];
  let read = 0;

  zkir.instructions.forEach((ins, index) => {
    const v = (key: string): bigint => {
      const value = vars[num(ins, key)];
      if (value === undefined) {
        throw new Error(`instruction ${index} reads an undefined variable`);
      }
      return value;
    };
    const fail = () => violations.push({ index, op: ins.op });
    const bound = (key: string) => 1n << BigInt(num(ins, key));

    switch (ins.op) {
      case 'constrain_bits':
        if (v('var') >= bound('bits')) fail();
        break;
      case 'constrain_eq':
        if (v('a') !== v('b')) fail();
        break;
      case 'constrain_to_boolean':
        if (v('var') > 1n) fail();
        break;
      case 'assert':
        if (v('cond') !== 1n) fail();
        break;
      case 'load_imm':
        vars.push(modField(immediate(String(ins.imm))));
        break;
      case 'declare_pub_input':
        publicInputs.push(v('var'));
        break;
      case 'pi_skip':
        break;
      case 'test_eq':
        vars.push(v('a') === v('b') ? 1n : 0n);
        break;
      case 'cond_select':
        vars.push(v('bit') === 1n ? v('a') : v('b'));
        break;
      case 'add':
        vars.push(modField(v('a') + v('b')));
        break;
      case 'mul':
        vars.push(modField(v('a') * v('b')));
        break;
      case 'neg':
        vars.push(modField(-v('a')));
        break;
      case 'copy':
        vars.push(v('var'));
        break;
      case 'less_than':
        if (v('a') >= bound('bits') || v('b') >= bound('bits')) fail();
        vars.push(v('a') < v('b') ? 1n : 0n);
        break;
      case 'private_input':
        if (ins.guard === null || v('guard') === 1n) {
          if (read >= privates.length) {
            throw new Error(
              `the circuit reads more than ${privates.length} private elements`,
            );
          }
          vars.push(modField(privates[read++]));
        } else {
          vars.push(0n);
        }
        break;
      case 'output':
        outputs.push(v('var'));
        break;
      case 'div_mod_power_of_two': {
        const bits = BigInt(num(ins, 'bits'));
        vars.push(v('var') >> bits, v('var') & ((1n << bits) - 1n));
        break;
      }
      case 'reconstitute_field': {
        const value = v('divisor') * bound('bits') + v('modulus');
        const highFits =
          rule === 'circuit'
            ? v('divisor') < 1n << BigInt(255 - num(ins, 'bits'))
            : value < FIELD_MODULUS;
        if (v('modulus') >= bound('bits') || !highFits) fail();
        vars.push(modField(value));
        break;
      }
      default:
        throw new Error(`unsupported ZKIR v2 instruction '${ins.op}'`);
    }
  });

  if (read !== privates.length) {
    violations.push({ index: -1, op: 'private_input' });
  }
  return { outputs, publicInputs, violations, privateInputsRead: read };
}
