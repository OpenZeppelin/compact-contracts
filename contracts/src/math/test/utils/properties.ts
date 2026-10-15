import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { MAX_UINT64, MAX_UINT128 } from './consts.js';

/**
 * Shared settings of the math property tests.
 *
 * The property tests run on the dry backend only, as every property test of
 * this repository: on the live backend each sample is a deployed call with a
 * real proof. The ported specs keep honest live cases for every circuit.
 */

/** Number of samples per property. */
export const RUNS = { numRuns: 64 };

/** Whether the property tests are skipped (live backend). */
export const skipProperties = isLiveBackend();

/** A bigint in `[0, max]` that hits 0, 1, `max - 1` and `max` often. */
export const uintUpTo = (max: bigint): fc.Arbitrary<bigint> =>
  fc.oneof(
    { weight: 1, arbitrary: fc.constantFrom(0n, 1n, max - 1n, max) },
    { weight: 4, arbitrary: fc.bigInt({ min: 0n, max }) },
  );

export const uint64 = uintUpTo(MAX_UINT64);
export const uint128 = uintUpTo(MAX_UINT128);

/** A bigint in `[1, max]`, for a divisor. */
export const nonZeroUpTo = (max: bigint): fc.Arbitrary<bigint> =>
  fc.oneof(
    { weight: 1, arbitrary: fc.constantFrom(1n, 2n, max) },
    { weight: 4, arbitrary: fc.bigInt({ min: 1n, max }) },
  );
