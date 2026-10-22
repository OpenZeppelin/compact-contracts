import { OUTPUTS, type ZkirV2 } from './zkirV2.js';

/**
 * Static coverage check of the witness results in a ZKIR v2 circuit.
 *
 * Each `private_input` instruction writes one element of a witness result.
 * For each of them, this check finds:
 *
 *   - the `constrain_bits` widths that the circuit applies to the variable
 *     directly (the range check of the declared type), and
 *   - whether the variable reaches a sink: an `assert`, a `constrain_eq`, a
 *     `constrain_to_boolean`, a public input or a circuit output, through any
 *     chain of instructions.
 *
 * A private input that reaches no sink is free: the relation accepts every
 * value of it within its range. This is a coverage signal. It does not prove
 * that a constrained value is bound to the inputs. The relation tests with
 * coherent forgeries prove that.
 */

/** The coverage of one `private_input` instruction. */
export type PrivateInputCoverage = {
  /** Position of the element in the private transcript (0 for the first read). */
  position: number;
  /** Index of the `private_input` instruction. */
  instruction: number;
  /** The variable that the instruction writes. */
  variable: number;
  /** The `constrain_bits` widths applied to the variable itself. */
  bits: number[];
  /** Whether the variable reaches an assertion, a public input or an output. */
  reachesSink: boolean;
};

const READS: Readonly<Record<string, readonly string[]>> = {
  add: ['a', 'b'],
  assert: ['cond'],
  cond_select: ['bit', 'a', 'b'],
  constrain_bits: ['var'],
  constrain_eq: ['a', 'b'],
  constrain_to_boolean: ['var'],
  copy: ['var'],
  declare_pub_input: ['var'],
  div_mod_power_of_two: ['var'],
  less_than: ['a', 'b'],
  load_imm: [],
  mul: ['a', 'b'],
  neg: ['a'],
  output: ['var'],
  pi_skip: ['guard'],
  private_input: ['guard'],
  reconstitute_field: ['divisor', 'modulus'],
  test_eq: ['a', 'b'],
};

const SINKS: ReadonlySet<string> = new Set([
  'assert',
  'constrain_eq',
  'constrain_to_boolean',
  'declare_pub_input',
  'output',
]);

/** Returns the coverage of every `private_input` instruction of `zkir`. */
export function witnessCoverage(zkir: ZkirV2): PrivateInputCoverage[] {
  // For each variable, the set of private input positions it depends on.
  const deps: Set<number>[] = Array.from(
    { length: zkir.num_inputs },
    () => new Set<number>(),
  );
  const coverage: PrivateInputCoverage[] = [];
  const reached = new Set<number>();

  zkir.instructions.forEach((ins, index) => {
    const reads = READS[ins.op];
    const writes = OUTPUTS[ins.op];
    if (reads === undefined || writes === undefined) {
      throw new Error(
        `unsupported ZKIR v2 instruction '${ins.op}' at ${index}`,
      );
    }
    const inputs = new Set<number>();
    for (const key of reads) {
      const variable = ins[key];
      if (variable === null || variable === undefined) {
        continue;
      }
      for (const position of deps[variable as number]) {
        inputs.add(position);
      }
    }
    if (SINKS.has(ins.op)) {
      for (const position of inputs) {
        reached.add(position);
      }
    }
    if (ins.op === 'constrain_bits') {
      const match = coverage.find((entry) => entry.variable === ins.var);
      match?.bits.push(ins.bits as number);
    }
    if (ins.op === 'private_input') {
      const position = coverage.length;
      coverage.push({
        position,
        instruction: index,
        variable: deps.length,
        bits: [],
        reachesSink: false,
      });
      inputs.add(position);
    }
    for (let i = 0; i < writes; i++) {
      deps.push(new Set(inputs));
    }
  });

  return coverage.map((entry) => ({
    ...entry,
    reachesSink: reached.has(entry.position),
  }));
}

/** Returns the transcript positions of the private inputs that reach no sink. */
export function freePrivateInputs(zkir: ZkirV2): number[] {
  return witnessCoverage(zkir)
    .filter((entry) => !entry.reachesSink)
    .map((entry) => entry.position);
}
