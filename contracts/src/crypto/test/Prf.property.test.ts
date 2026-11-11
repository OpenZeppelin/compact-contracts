/**
 * Properties of the Prf module over generated tags, inputs and keys.
 *
 * The unit and compatibility suites state each claim at fixed points. This
 * states them where nobody chose: each wrapper equals its reference, `prfField`
 * is the reduction of `prf`, and each of the three inputs alone moves the
 * output.
 *
 * Runs on either backend. Every wrapper is an impure circuit on `MockPrf`, so
 * each call is a transaction on live, and the properties run twice there.
 */

import { degradeToTransient } from '@midnight-ntwrk/compact-runtime';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { PrfSimulator } from './simulators/PrfSimulator.js';

// ---------------------------------------------------------------------------
// Generators, each pinned to the circuit's own type
// ---------------------------------------------------------------------------

// Compact `Field` modulus (BLS12-381 scalar field).
const P =
  52435875175126190479447740508185965837690552500527637822603658699938581184513n;

/** `Bytes<32>`: a tag, a key, or a `Bytes<32>` input. */
const bytes32 = () => fc.uint8Array({ minLength: 32, maxLength: 32 });

/** A `Field` input in `[0, P - 1]`. */
const field = () => fc.bigInt({ min: 0n, max: P - 1n });

/** Which one of the three inputs a separation property moves. */
const component = () => fc.constantFrom('domain', 'input', 'key');

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const PROPERTY_RUNS = isLiveBackend() ? 2 : 100;

let prf: PrfSimulator;

beforeAll(async () => {
  prf = await PrfSimulator.create();
});

// ---------------------------------------------------------------------------
// Layout and reduction
// ---------------------------------------------------------------------------

describe('Prf property: layout and reduction', () => {
  it('should match the references over Bytes<32> for any tag, input and key', async () => {
    await fc.assert(
      fc.asyncProperty(bytes32(), bytes32(), bytes32(), async (d, i, k) => {
        expect(await prf.prfOfBytes(d, i, k)).toStrictEqual(
          await prf.refPrfOfBytes(d, i, k),
        );
        expect(await prf.prfFieldOfBytes(d, i, k)).toBe(
          await prf.refPrfFieldOfBytes(d, i, k),
        );
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('should match the references over Field for any tag, input and key', async () => {
    await fc.assert(
      fc.asyncProperty(bytes32(), field(), bytes32(), async (d, i, k) => {
        expect(await prf.prfOfField(d, i, k)).toStrictEqual(
          await prf.refPrfOfField(d, i, k),
        );
        expect(await prf.prfFieldOfField(d, i, k)).toBe(
          await prf.refPrfFieldOfField(d, i, k),
        );
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('should reduce prf to prfField over Bytes<32> for any tag, input and key', async () => {
    await fc.assert(
      fc.asyncProperty(bytes32(), bytes32(), bytes32(), async (d, i, k) => {
        expect(await prf.prfFieldOfBytes(d, i, k)).toBe(
          degradeToTransient(await prf.prfOfBytes(d, i, k)),
        );
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('should reduce prf to prfField over Field for any tag, input and key', async () => {
    await fc.assert(
      fc.asyncProperty(bytes32(), field(), bytes32(), async (d, i, k) => {
        expect(await prf.prfFieldOfField(d, i, k)).toBe(
          degradeToTransient(await prf.prfOfField(d, i, k)),
        );
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
describe('Prf property: separation', () => {
  it('should move both outputs over Bytes<32> when any one input changes', async () => {
    await fc.assert(
      fc.asyncProperty(
        component(),
        bytes32(),
        bytes32(),
        bytes32(),
        bytes32(),
        async (moved, d, i, k, other) => {
          fc.pre(hex(other) !== hex({ domain: d, input: i, key: k }[moved]));
          const next = {
            d: moved === 'domain' ? other : d,
            i: moved === 'input' ? other : i,
            k: moved === 'key' ? other : k,
          };

          expect(hex(await prf.prfOfBytes(d, i, k))).not.toBe(
            hex(await prf.prfOfBytes(next.d, next.i, next.k)),
          );
          expect(await prf.prfFieldOfBytes(d, i, k)).not.toBe(
            await prf.prfFieldOfBytes(next.d, next.i, next.k),
          );
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('should move both outputs over Field when any one input changes', async () => {
    await fc.assert(
      fc.asyncProperty(
        component(),
        bytes32(),
        field(),
        bytes32(),
        bytes32(),
        field(),
        async (moved, d, i, k, otherBytes, otherField) => {
          fc.pre(
            moved === 'input'
              ? otherField !== i
              : hex(otherBytes) !== hex(moved === 'domain' ? d : k),
          );
          const next = {
            d: moved === 'domain' ? otherBytes : d,
            i: moved === 'input' ? otherField : i,
            k: moved === 'key' ? otherBytes : k,
          };

          expect(hex(await prf.prfOfField(d, i, k))).not.toBe(
            hex(await prf.prfOfField(next.d, next.i, next.k)),
          );
          expect(await prf.prfFieldOfField(d, i, k)).not.toBe(
            await prf.prfFieldOfField(next.d, next.i, next.k),
          );
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });
});
