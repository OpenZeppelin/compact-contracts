/**
 * Properties of the HashCommitment module over generated tags, messages and
 * randomness.
 *
 * The unit and compatibility suites state each claim at fixed points. This
 * states them where nobody chose: each wrapper equals both of its references,
 * and each of the three inputs alone moves the commitment.
 *
 * Runs on either backend. Every wrapper is an impure circuit on
 * `MockHashCommitment`, so each call is a transaction on live, and the
 * properties run twice there.
 */

import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { HashCommitmentSimulator } from './simulators/HashCommitmentSimulator.js';

// ---------------------------------------------------------------------------
// Generators, each pinned to the circuit's own type
// ---------------------------------------------------------------------------

// Compact `Field` modulus (BLS12-381 scalar field).
const P =
  52435875175126190479447740508185965837690552500527637822603658699938581184513n;

/** `Bytes<32>`: a tag, the randomness, or a `Bytes<32>` message. */
const bytes32 = () => fc.uint8Array({ minLength: 32, maxLength: 32 });

/** A `Field` message in `[0, P - 1]`. */
const field = () => fc.bigInt({ min: 0n, max: P - 1n });

/** Which one of the three inputs a separation property moves. */
const component = () => fc.constantFrom('domain', 'message', 'randomness');

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const PROPERTY_RUNS = isLiveBackend() ? 2 : 100;

let commitment: HashCommitmentSimulator;

beforeAll(async () => {
  commitment = await HashCommitmentSimulator.create();
});

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

describe('HashCommitment property: layout', () => {
  it('should match both references over Bytes<32> for any tag, message and randomness', async () => {
    await fc.assert(
      fc.asyncProperty(bytes32(), bytes32(), bytes32(), async (d, m, r) => {
        const digest = await commitment.commitOfBytes(d, m, r);

        expect(digest).toStrictEqual(
          await commitment.refCommitOfBytes(d, m, r),
        );
        expect(digest).toStrictEqual(await commitment.refHashOfBytes(d, m, r));
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('should match both references over Field for any tag, message and randomness', async () => {
    await fc.assert(
      fc.asyncProperty(bytes32(), field(), bytes32(), async (d, m, r) => {
        const digest = await commitment.commitOfField(d, m, r);

        expect(digest).toStrictEqual(
          await commitment.refCommitOfField(d, m, r),
        );
        expect(digest).toStrictEqual(await commitment.refHashOfField(d, m, r));
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Separation
// ---------------------------------------------------------------------------

/**
 * Each run draws two values for one input and holds the other two fixed, so a
 * failure names the input that did not separate.
 */
describe('HashCommitment property: separation', () => {
  it('should move the commitment over Bytes<32> when any one input changes', async () => {
    await fc.assert(
      fc.asyncProperty(
        component(),
        bytes32(),
        bytes32(),
        bytes32(),
        bytes32(),
        async (moved, d, m, r, other) => {
          fc.pre(
            hex(other) !== hex({ domain: d, message: m, randomness: r }[moved]),
          );
          const next = {
            d: moved === 'domain' ? other : d,
            m: moved === 'message' ? other : m,
            r: moved === 'randomness' ? other : r,
          };

          expect(hex(await commitment.commitOfBytes(d, m, r))).not.toBe(
            hex(await commitment.commitOfBytes(next.d, next.m, next.r)),
          );
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('should move the commitment over Field when any one input changes', async () => {
    await fc.assert(
      fc.asyncProperty(
        component(),
        bytes32(),
        field(),
        bytes32(),
        bytes32(),
        field(),
        async (moved, d, m, r, otherBytes, otherField) => {
          fc.pre(
            moved === 'message'
              ? otherField !== m
              : hex(otherBytes) !== hex(moved === 'domain' ? d : r),
          );
          const next = {
            d: moved === 'domain' ? otherBytes : d,
            m: moved === 'message' ? otherField : m,
            r: moved === 'randomness' ? otherBytes : r,
          };

          expect(hex(await commitment.commitOfField(d, m, r))).not.toBe(
            hex(await commitment.commitOfField(next.d, next.m, next.r)),
          );
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });
});
