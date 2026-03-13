import { sqrtBigint } from '../utils/sqrtBigint.js';

/**
 * @description Computes the square root of a 64-bit unsigned integer.
 * @param radicand - The value to compute the square root of.
 * @returns The floor of the square root as a 32-bit result.
 */
export const wit_sqrtUint64 = (radicand: bigint): bigint => {
  return sqrtBigint(radicand);
};
