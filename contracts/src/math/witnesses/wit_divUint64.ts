import type { DivResultU64 } from '../types/index.js';

/**
 * @description Computes the quotient and remainder of dividing two 64-bit unsigned integers.
 * @param dividend - The dividend.
 * @param divisor - The divisor.
 * @returns An object containing the quotient and remainder.
 */
export const wit_divUint64 = (
  dividend: bigint,
  divisor: bigint,
): DivResultU64 => {
  const quotient = dividend / divisor;
  const remainder = dividend % divisor;
  return { quotient, remainder };
};
