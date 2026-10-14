import type { AlignedValue, Alignment } from '@midnight-ntwrk/compact-runtime';

/**
 * Field representation of the values in a proof preimage.
 *
 * A ZKIR v2 relation reads its inputs, its outputs and the witness results as
 * elements of the BLS12-381 scalar field. The proof preimage carries them as
 * `AlignedValue`s. This module converts between the two forms for the atoms
 * that the compiled contracts of this repository use:
 *
 *   - `bytes` of length 1 to 31: one element, the little-endian integer.
 *   - `bytes` of length 32: two elements, byte 31 first, then the
 *     little-endian integer of bytes 0 to 30 (the compiler splits a
 *     `Bytes<32>` value at bit 248).
 *   - `field`: one element, the little-endian integer.
 *
 * The relation check reads only the field elements, so a value with a
 * different alignment but the same elements gives the same result.
 * {@link fieldAtoms} uses this to encode values that do not fit their
 * declared type, for example a forged witness result above `2^64 - 1`.
 */

/** The order of the BLS12-381 scalar field. */
export const FIELD_MODULUS =
  0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;

/** Reduces `value` into the range `[0, FIELD_MODULUS)`. */
export const modField = (value: bigint): bigint =>
  ((value % FIELD_MODULUS) + FIELD_MODULUS) % FIELD_MODULUS;

const bytesToBigint = (bytes: Uint8Array): bigint => {
  let result = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result;
};

const bigintToBytes = (value: bigint): Uint8Array => {
  const bytes: number[] = [];
  for (let rest = value; rest > 0n; rest >>= 8n) {
    bytes.push(Number(rest & 0xffn));
  }
  return Uint8Array.from(bytes);
};

/**
 * Returns the number of bits that each field element of `alignment` can hold
 * under its declared type, in the order of {@link toFields}. A `field` atom
 * has no bit bound and gives `undefined`.
 */
export function fieldWidths(alignment: Alignment): (number | undefined)[] {
  return alignment.flatMap((segment) => {
    if (segment.tag !== 'atom') {
      throw new Error(`unsupported alignment segment '${segment.tag}'`);
    }
    const atom = segment.value;
    if (atom.tag === 'field') {
      return [undefined];
    }
    if (atom.tag === 'bytes' && atom.length <= 31) {
      return [atom.length * 8];
    }
    if (atom.tag === 'bytes' && atom.length === 32) {
      return [8, 248];
    }
    throw new Error(`unsupported alignment atom ${JSON.stringify(atom)}`);
  });
}

/** Returns the field elements of `value`, in the order the relation reads them. */
export function toFields(value: AlignedValue): bigint[] {
  if (value.value.length !== value.alignment.length) {
    throw new Error(
      `value has ${value.value.length} atoms but its alignment has ${value.alignment.length}`,
    );
  }
  // Rejects every alignment that the code below cannot read.
  fieldWidths(value.alignment);
  return value.alignment.flatMap((segment, index) => {
    const atom = value.value[index];
    if (
      segment.tag === 'atom' &&
      segment.value.tag === 'bytes' &&
      segment.value.length === 32
    ) {
      const full = new Uint8Array(32);
      full.set(atom.subarray(0, 32));
      return [BigInt(full[31]), bytesToBigint(full.subarray(0, 31))];
    }
    return [bytesToBigint(atom)];
  });
}

/**
 * Builds an `AlignedValue` with the field elements `fields` in the shape of
 * `alignment`. Each element must fit the bit width of its atom.
 */
export function fromFields(
  fields: readonly bigint[],
  alignment: Alignment,
): AlignedValue {
  const widths = fieldWidths(alignment);
  if (widths.length !== fields.length) {
    throw new Error(
      `alignment holds ${widths.length} field elements, got ${fields.length}`,
    );
  }
  fields.forEach((field, index) => {
    const width = widths[index];
    if (field < 0n || field >= FIELD_MODULUS) {
      throw new Error(`field element ${field} is not in the field`);
    }
    if (width !== undefined && field >= 1n << BigInt(width)) {
      throw new Error(`field element ${field} does not fit ${width} bits`);
    }
  });
  let next = 0;
  const value = alignment.map((segment) => {
    if (
      segment.tag === 'atom' &&
      segment.value.tag === 'bytes' &&
      segment.value.length === 32
    ) {
      const full = new Uint8Array(32);
      full.set(bigintToBytes(fields[next + 1]));
      full[31] = Number(fields[next]);
      next += 2;
      return full;
    }
    return bigintToBytes(fields[next++]);
  });
  return { value, alignment };
}

/**
 * Encodes field elements as one `field` atom each. The relation reads the
 * same elements as from the declared alignment, and an element can take any
 * field value.
 */
export function fieldAtoms(fields: readonly bigint[]): AlignedValue {
  return {
    value: fields.map((field) => bigintToBytes(modField(field))),
    alignment: fields.map(() => ({
      tag: 'atom' as const,
      value: { tag: 'field' as const },
    })),
  };
}
