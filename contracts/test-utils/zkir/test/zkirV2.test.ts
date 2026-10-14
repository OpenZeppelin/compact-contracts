import { describe, expect, it } from 'vitest';
import { FIELD_MODULUS } from '../fieldRepr.js';
import { evaluate, immediate, parseZkirV2, type ZkirV2 } from '../zkirV2.js';

/**
 * The circuit of `div(a, b)` with `wit_div` returning `(q, r)`, in the form
 * that compactc 0.34.0 writes (inputs a, b; asserts b != 0, r < b and
 * q * b + r == a; output q).
 */
const DIV: ZkirV2 = {
  version: { major: 2, minor: 0 },
  num_inputs: 2,
  instructions: [
    { op: 'constrain_bits', var: 0, bits: 64 },
    { op: 'constrain_bits', var: 1, bits: 64 },
    { op: 'load_imm', imm: '00' },
    { op: 'load_imm', imm: '01' },
    { op: 'test_eq', a: 1, b: 2 },
    { op: 'cond_select', bit: 4, a: 2, b: 3 },
    { op: 'assert', cond: 5 },
    { op: 'private_input', guard: null },
    { op: 'constrain_bits', var: 6, bits: 64 },
    { op: 'private_input', guard: null },
    { op: 'constrain_bits', var: 7, bits: 64 },
    { op: 'less_than', a: 7, b: 1, bits: 64 },
    { op: 'assert', cond: 8 },
    { op: 'mul', a: 6, b: 1 },
    { op: 'add', a: 9, b: 7 },
    { op: 'test_eq', a: 10, b: 0 },
    { op: 'assert', cond: 11 },
    { op: 'output', var: 6 },
  ],
};

describe('zkirV2', () => {
  it('reads little-endian immediates', () => {
    expect(immediate('01')).toBe(1n);
    expect(immediate('0001')).toBe(256n);
    expect(immediate('000000000000000001')).toBe(2n ** 64n);
  });

  it('parses ZKIR v2 and rejects other versions and unknown instructions', () => {
    expect(parseZkirV2(JSON.stringify(DIV)).num_inputs).toBe(2);
    expect(() =>
      parseZkirV2(JSON.stringify({ ...DIV, version: { major: 3, minor: 0 } })),
    ).toThrow('expected a ZKIR v2 circuit');
    expect(() =>
      parseZkirV2(
        JSON.stringify({ ...DIV, instructions: [{ op: 'persistent_hash' }] }),
      ),
    ).toThrow("unsupported ZKIR v2 instruction 'persistent_hash' at 0");
  });

  it('evaluates an honest call with no violation', () => {
    const result = evaluate(DIV, [10n, 3n], [3n, 1n]);
    expect(result.outputs).toEqual([3n]);
    expect(result.violations).toEqual([]);
    expect(result.privateInputsRead).toBe(2);
  });

  it('reports every failed constraint and does not stop', () => {
    // q = 2, r = 5: r < b and q * b + r == a both fail.
    const result = evaluate(DIV, [10n, 3n], [2n, 5n]);
    expect(result.outputs).toEqual([2n]);
    expect(result.violations.map((v) => v.index)).toEqual([12, 16]);
  });

  it('reports a less_than operand above its bit bound', () => {
    const result = evaluate(DIV, [10n, 3n], [3n, 2n ** 64n]);
    expect(result.violations.map((v) => v.op)).toEqual([
      'constrain_bits',
      'less_than',
      'assert',
      'assert',
    ]);
  });

  it('reduces arithmetic modulo the field order', () => {
    const circuit: ZkirV2 = {
      version: { major: 2, minor: 0 },
      num_inputs: 1,
      instructions: [
        { op: 'neg', a: 0 },
        { op: 'copy', var: 1 },
        { op: 'output', var: 2 },
      ],
    };
    expect(evaluate(circuit, [1n], []).outputs).toEqual([FIELD_MODULUS - 1n]);
  });

  it('splits with div_mod_power_of_two and joins with reconstitute_field', () => {
    const circuit: ZkirV2 = {
      version: { major: 2, minor: 0 },
      num_inputs: 1,
      instructions: [
        { op: 'div_mod_power_of_two', var: 0, bits: 8 },
        { op: 'reconstitute_field', divisor: 1, modulus: 2, bits: 8 },
        { op: 'output', var: 1 },
        { op: 'output', var: 2 },
        { op: 'output', var: 3 },
      ],
    };
    expect(evaluate(circuit, [0x1234n], []).outputs).toEqual([
      0x12n,
      0x34n,
      0x1234n,
    ]);
    const bad: ZkirV2 = {
      ...circuit,
      instructions: [
        { op: 'reconstitute_field', divisor: 0, modulus: 0, bits: 8 },
      ],
    };
    expect(evaluate(bad, [256n], []).violations).toEqual([
      { index: 0, op: 'reconstitute_field' },
    ]);
    expect(evaluate(bad, [FIELD_MODULUS - 1n], []).violations).toHaveLength(1);
  });

  it('reads a guarded private input only when the guard is 1', () => {
    const circuit: ZkirV2 = {
      version: { major: 2, minor: 0 },
      num_inputs: 1,
      instructions: [
        { op: 'private_input', guard: 0 },
        { op: 'output', var: 1 },
      ],
    };
    expect(evaluate(circuit, [1n], [7n]).outputs).toEqual([7n]);
    const skipped = evaluate(circuit, [0n], [7n]);
    expect(skipped.outputs).toEqual([0n]);
    expect(skipped.violations).toEqual([{ index: -1, op: 'private_input' }]);
    expect(evaluate(circuit, [0n], []).violations).toEqual([]);
  });

  it('records the public inputs and checks the other constraints', () => {
    const circuit: ZkirV2 = {
      version: { major: 2, minor: 0 },
      num_inputs: 2,
      instructions: [
        { op: 'declare_pub_input', var: 0 },
        { op: 'pi_skip', guard: 0, count: 1 },
        { op: 'constrain_eq', a: 0, b: 1 },
        { op: 'constrain_to_boolean', var: 1 },
      ],
    };
    expect(evaluate(circuit, [1n, 1n], []).publicInputs).toEqual([1n]);
    expect(evaluate(circuit, [1n, 2n], []).violations).toEqual([
      { index: 2, op: 'constrain_eq' },
      { index: 3, op: 'constrain_to_boolean' },
    ]);
  });

  it('rejects an input count or a transcript that does not fit', () => {
    expect(() => evaluate(DIV, [1n], [])).toThrow(
      'circuit takes 2 input elements, got 1',
    );
    expect(() => evaluate(DIV, [10n, 3n], [3n])).toThrow(
      'the circuit reads more than 1 private elements',
    );
    expect(() =>
      evaluate(
        { ...DIV, instructions: [{ op: 'output', var: 9 }] },
        [1n, 2n],
        [],
      ),
    ).toThrow('instruction 0 reads an undefined variable');
    expect(() =>
      evaluate({ ...DIV, instructions: [{ op: 'output' }] }, [1n, 2n], []),
    ).toThrow("instruction 'output' has no numeric field 'var'");
    expect(() =>
      evaluate({ ...DIV, instructions: [{ op: 'hash' }] }, [1n, 2n], []),
    ).toThrow("unsupported ZKIR v2 instruction 'hash'");
  });
});
