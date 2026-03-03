/**
 * @description Represents a 128-bit unsigned integer as two 64-bit components.
 */
export type U128 = {
  low: bigint;
  high: bigint;
};

/**
 * @description Represents a 256-bit unsigned integer as two U128 components.
 */
export type U256 = {
  low: U128;
  high: U128;
};

/**
 * @description Division result for 64-bit operations.
 */
export type DivResultU64 = {
  quotient: bigint;
  remainder: bigint;
};

/**
 * @description Division result for 128-bit operations (U128 struct).
 */
export type DivResultU128 = {
  quotient: U128;
  remainder: U128;
};

/**
 * @description Division result for 256-bit operations (U256 struct).
 */
export type DivResultU256 = {
  quotient: U256;
  remainder: U256;
};
