import { describe, expect, it } from 'vitest';
import { freePrivateInputs, witnessCoverage } from '../witnessCoverage.js';
import type { ZkirV2 } from '../zkirV2.js';

/**
 * A split of input 0 into (high, low) as `Uint128.toU128` does, with two
 * extra results that only get a range check (the free fields).
 */
const SPLIT: ZkirV2 = {
  version: { major: 2, minor: 0 },
  num_inputs: 1,
  instructions: [
    { op: 'private_input', guard: null }, // 1: high
    { op: 'constrain_bits', var: 1, bits: 64 },
    { op: 'private_input', guard: null }, // 2: free
    { op: 'constrain_bits', var: 2, bits: 64 },
    { op: 'private_input', guard: null }, // 3: low
    { op: 'constrain_bits', var: 3, bits: 64 },
    { op: 'private_input', guard: null }, // 4: free
    { op: 'constrain_bits', var: 4, bits: 64 },
    { op: 'load_imm', imm: '000000000000000001' }, // 5
    { op: 'mul', a: 1, b: 5 }, // 6
    { op: 'add', a: 6, b: 3 }, // 7
    { op: 'test_eq', a: 7, b: 0 }, // 8
    { op: 'assert', cond: 8 },
    { op: 'output', var: 3 },
  ],
};

describe('witnessCoverage', () => {
  it('finds the range checks and the sinks of each private input', () => {
    expect(witnessCoverage(SPLIT)).toEqual([
      {
        position: 0,
        instruction: 0,
        variable: 1,
        bits: [64],
        reachesSink: true,
      },
      {
        position: 1,
        instruction: 2,
        variable: 2,
        bits: [64],
        reachesSink: false,
      },
      {
        position: 2,
        instruction: 4,
        variable: 3,
        bits: [64],
        reachesSink: true,
      },
      {
        position: 3,
        instruction: 6,
        variable: 4,
        bits: [64],
        reachesSink: false,
      },
    ]);
    expect(freePrivateInputs(SPLIT)).toEqual([1, 3]);
  });

  it('follows a value through a public input and a guard', () => {
    const circuit: ZkirV2 = {
      version: { major: 2, minor: 0 },
      num_inputs: 0,
      instructions: [
        { op: 'private_input', guard: null }, // 0
        { op: 'declare_pub_input', var: 0 },
        { op: 'private_input', guard: 0 }, // 1
        { op: 'output', var: 1 },
        { op: 'private_input', guard: null }, // 2: no range check, no sink
      ],
    };
    expect(
      witnessCoverage(circuit).map((e) => [e.bits, e.reachesSink]),
    ).toEqual([
      [[], true],
      [[], true],
      [[], false],
    ]);
  });

  it('rejects an unknown instruction', () => {
    expect(() =>
      witnessCoverage({ ...SPLIT, instructions: [{ op: 'hash' }] }),
    ).toThrow("unsupported ZKIR v2 instruction 'hash' at 0");
  });
});
