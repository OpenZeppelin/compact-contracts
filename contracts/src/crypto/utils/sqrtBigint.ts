/**
 * Computes the square root of a non-negative bigint using the Newton-Raphson method.
 * This implementation avoids floating-point precision issues inherent in Math.sqrt
 * by performing all calculations with bigint arithmetic, ensuring accuracy for large numbers.
 *
 * @param value - The non-negative bigint to compute the square root of.
 * @returns The floor of the square root of the input value as a bigint.
 * @throws Will throw an error if the input value is negative.
 * @source Adapted from https://stackoverflow.com/a/53684036
 */
export function sqrtBigint(value: bigint): bigint {
  if (value < 0n) {
    throw new Error('square root of negative numbers is not supported');
  }

  if (value < 2n) {
    return value;
  }

  function newtonIteration(n: bigint, x0: bigint): bigint {
    const x1 = (n / x0 + x0) >> 1n;
    if (x0 === x1 || x0 === x1 - 1n) {
      return x0;
    }
    return newtonIteration(n, x1);
  }

  let root = newtonIteration(value, 1n);

  // Ensure we return floor(sqrt(value))
  const rootSquare = root * root;
  if (rootSquare > value) {
    // Adjust downward if x^2 overshoots
    root = root - 1n;
  } else if (rootSquare < value && (root + 1n) * (root + 1n) <= value) {
    // Adjust upward if (x + 1)^2 is still <= value (e.g., for 4n)
    root = root + 1n;
  }

  return root;
}
