import { describe, expect, it } from 'vitest';
import {
  FIELD_MODULUS,
  fieldAtoms,
  fieldWidths,
  fromFields,
  modField,
  toFields,
} from '../fieldRepr.js';

const bytes = (length: number) => ({
  tag: 'atom' as const,
  value: { tag: 'bytes' as const, length },
});
const field = { tag: 'atom' as const, value: { tag: 'field' as const } };

describe('fieldRepr', () => {
  it('reads a short bytes atom as one little-endian element', () => {
    expect(
      toFields({ value: [Uint8Array.from([1, 2])], alignment: [bytes(8)] }),
    ).toEqual([0x0201n]);
  });

  it('reads an empty atom as 0', () => {
    expect(
      toFields({ value: [new Uint8Array()], alignment: [bytes(8)] }),
    ).toEqual([0n]);
  });

  it('reads a 32-byte atom as byte 31, then bytes 0 to 30', () => {
    const atom = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    const [high, low] = toFields({ value: [atom], alignment: [bytes(32)] });
    expect(high).toBe(32n);
    expect(low).toBe(
      atom.subarray(0, 31).reduceRight((acc, b) => (acc << 8n) | BigInt(b), 0n),
    );
  });

  it('reads a value longer than its declared length in full', () => {
    expect(
      toFields({
        value: [Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 1])],
        alignment: [bytes(8)],
      }),
    ).toEqual([2n ** 64n]);
  });

  it('round-trips through fromFields', () => {
    const alignment = [bytes(1), bytes(16), bytes(32), field];
    const fields = [
      0xffn,
      2n ** 127n,
      0x7fn,
      2n ** 247n + 3n,
      FIELD_MODULUS - 1n,
    ];
    expect(toFields(fromFields(fields, alignment))).toEqual(fields);
  });

  it('rejects an element that does not fit its atom', () => {
    expect(() => fromFields([256n], [bytes(1)])).toThrow('does not fit 8 bits');
    expect(() => fromFields([FIELD_MODULUS], [field])).toThrow(
      'not in the field',
    );
    expect(() => fromFields([1n, 2n], [bytes(1)])).toThrow(
      'alignment holds 1 field elements, got 2',
    );
  });

  it('gives the bit width of each element', () => {
    expect(fieldWidths([bytes(8), bytes(32), field])).toEqual([
      64,
      8,
      248,
      undefined,
    ]);
  });

  it('rejects alignments it cannot read', () => {
    expect(() => fieldWidths([bytes(33)])).toThrow(
      'unsupported alignment atom',
    );
    expect(() =>
      fieldWidths([{ tag: 'atom', value: { tag: 'compress' } }]),
    ).toThrow('unsupported alignment atom');
    expect(() => fieldWidths([{ tag: 'option', value: [] }])).toThrow(
      "unsupported alignment segment 'option'",
    );
    expect(() => toFields({ value: [], alignment: [bytes(1)] })).toThrow(
      'value has 0 atoms but its alignment has 1',
    );
  });

  it('encodes any field element as a field atom', () => {
    const atoms = fieldAtoms([-1n, 2n ** 64n]);
    expect(atoms.alignment).toEqual([field, field]);
    expect(toFields(atoms)).toEqual([FIELD_MODULUS - 1n, 2n ** 64n]);
  });

  it('reduces modulo the field order', () => {
    expect(modField(-1n)).toBe(FIELD_MODULUS - 1n);
    expect(modField(FIELD_MODULUS + 5n)).toBe(5n);
  });
});
