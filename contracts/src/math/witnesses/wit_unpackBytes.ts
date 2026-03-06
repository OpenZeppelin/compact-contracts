/**
 * @description Unpacks a byte array into a vector of bytes (little-endian).
 * Used by Pack<N>.unpack for any N (e.g. Pack mock and tests).
 * @param bytes - The byte array to unpack.
 * @returns A vector of bytes where element 0 is the LSB.
 */
export const wit_unpackBytes = (bytes: Uint8Array): bigint[] =>
  Array.from(bytes, (b) => BigInt(b));
