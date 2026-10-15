import { readFileSync } from 'node:fs';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeAll, describe, expect, test } from 'vitest';
import { Uint128Simulator } from './simulators/Uint128Simulator.js';
import { toU128 as u128 } from './utils/oracles.js';

/**
 * Regression for `Uint128.sub(U128)` (midnight-apps #309).
 *
 * A circuit contains both branches of an `if`. A downcast (`as Uint<64>`) in
 * the branch that is not taken still gets a range check. Compilers 0.28.0 to
 * 0.30.0 emit that check without a guard, so the old `sub(U128)` could not be
 * proven when `a.low >= b.low`, and every `Uint128` division failed with it.
 * From 0.31.1 the compiler guards the check: it selects the value with
 * `cond_select` and compares the result with `less_than`. The branchless
 * `sub(U128)` has no downcast in a branch, so it does not depend on that
 * compiler guard. This test fails if a guarded downcast comes back.
 *
 * The shape tests read the ZKIR v2 file that `compile:math` writes. They do
 * not use a backend, so they run on the dry backend only.
 */

const SUB_U128_ZKIR = new URL(
  '../../../artifacts/MockUint128/zkir/subU128.zkir',
  import.meta.url,
);

type Instruction = { op: string } & Record<string, unknown>;
type Zkir = {
  version: { major: number; minor: number };
  num_inputs: number;
  instructions: Instruction[];
};

// Number of variables each ZKIR v2 instruction writes. An instruction that
// is not in this table fails the test, so a new compiler output cannot pass
// with a wrong variable numbering.
const OUTPUTS: Record<string, number> = {
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
  not: 1,
  output: 0,
  pi_skip: 0,
  private_input: 1,
  public_input: 1,
  reconstitute_field: 1,
  test_eq: 1,
};

/**
 * Returns the indexes of the `less_than` instructions that take a
 * `cond_select` result as an operand: the compiler form of a downcast inside
 * a branch.
 */
const guardedDowncasts = (zkir: Zkir): number[] => {
  const producer: string[] = Array(zkir.num_inputs).fill('input');
  const found: number[] = [];
  zkir.instructions.forEach((ins, index) => {
    const outputs = OUTPUTS[ins.op];
    if (outputs === undefined) {
      throw new Error(`unknown ZKIR v2 instruction '${ins.op}' at ${index}`);
    }
    if (ins.op === 'less_than') {
      const a = producer[ins.a as number];
      const b = producer[ins.b as number];
      if (a === 'cond_select' || b === 'cond_select') {
        found.push(index);
      }
    }
    for (let i = 0; i < outputs; i++) {
      producer.push(ins.op);
    }
  });
  return found;
};

describe.skipIf(isLiveBackend())('Uint128.sub(U128) circuit shape', () => {
  let zkir: Zkir;

  beforeAll(() => {
    zkir = JSON.parse(readFileSync(SUB_U128_ZKIR, 'utf8'));
  });

  test('is a ZKIR v2 circuit', () => {
    expect(zkir.version.major).toBe(2);
  });

  test('has no downcast inside a branch', () => {
    expect(guardedDowncasts(zkir)).toEqual([]);
  });
});

// These calls run on both backends. On the live backend each one is a real
// proof, which is the end-to-end check that the inputs that the old dead
// branch made unprovable now prove.
describe('Uint128.sub(U128) values that the old dead branch made unprovable', () => {
  let simulator: Uint128Simulator;

  beforeAll(async () => {
    simulator = await Uint128Simulator.create();
  });

  test('subU128 with a.low >= b.low', async () => {
    // The old `else` branch computed a.low + 2^64 - b.low, which is 2^64 or
    // more here.
    expect(await simulator.subU128(u128(5n), u128(3n))).toEqual(u128(2n));
  });

  test('div(10, 5), which calls sub(U128) with a.low == (q * b).low', async () => {
    expect(await simulator.div(10n, 5n)).toBe(2n);
  });
});
