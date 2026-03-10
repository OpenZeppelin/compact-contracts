import type { U256 } from '../artifacts/Index/contract/index.d.cts';
import { MAX_UINT64 } from './consts';

/**
 * Converts a bigint value to a U256 struct representation.
 *
 * @param value - The bigint value to convert
 * @returns U256 struct with low and high 128-bit components
 */
export const toU256 = (value: bigint): U256 => {
  const lowBigInt = value & ((1n << 128n) - 1n);
  const highBigInt = value >> 128n;
  return {
    low: { low: lowBigInt & MAX_UINT64, high: lowBigInt >> 64n },
    high: { low: highBigInt & MAX_UINT64, high: highBigInt >> 64n },
  };
};

/**
 * Converts a U256 struct back to a bigint value.
 *
 * @param value - The U256 struct to convert
 * @returns The bigint representation
 */
export const fromU256 = (value: U256): bigint => {
  return (
    (value.high.high << 192n) +
    (value.high.low << 128n) +
    (value.low.high << 64n) +
    value.low.low
  );
};

/**
 * Field modulus constant (2^254 - 1)
 */
export const FIELD_MODULUS = 2n ** 254n - 1n;
