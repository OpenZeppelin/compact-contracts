/**
 * @description Unpacks a 64-bit unsigned integer into 8 bytes (little-endian).
 * This is the witness for Uint64.toUnpackedBytes.
 * @param value - The 64-bit value to unpack.
 * @returns A vector of 8 bytes [b0, b1, b2, b3, b4, b5, b6, b7] where b0 is the LSB.
 */
export const wit_uint64ToUnpackedBytes = (
  value: bigint,
): [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] => {
  const mask = 0xffn;
  const b0 = value & mask;
  const b1 = (value >> 8n) & mask;
  const b2 = (value >> 16n) & mask;
  const b3 = (value >> 24n) & mask;
  const b4 = (value >> 32n) & mask;
  const b5 = (value >> 40n) & mask;
  const b6 = (value >> 48n) & mask;
  const b7 = (value >> 56n) & mask;
  return [b0, b1, b2, b3, b4, b5, b6, b7];
};
