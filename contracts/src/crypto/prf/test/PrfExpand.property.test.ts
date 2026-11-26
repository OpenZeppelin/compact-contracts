/**
 * Properties of the PrfExpand module over generated tags, slots, contexts and
 * seeds.
 *
 * The unit and compatibility suites state each claim at fixed points. This
 * states them where nobody chose: each wrapper equals its flat reference, and
 * each of the four inputs alone moves the output.
 *
 * Runs on either backend. Every wrapper is an impure circuit on
 * `MockPrfExpand`, so each call is a transaction on live, and the properties
 * run twice there.
 */

import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { PrfExpandSimulator } from './simulators/PrfExpandSimulator.js';

// ---------------------------------------------------------------------------
// Generators, each pinned to the circuit's own type
// ---------------------------------------------------------------------------

// Compact `Field` modulus (BLS12-381 scalar field).
const P =
  52435875175126190479447740508185965837690552500527637822603658699938581184513n;

/** `Bytes<32>`: a tag, a slot, a seed, or a `Bytes<32>` context. */
const bytes32 = () => fc.uint8Array({ minLength: 32, maxLength: 32 });

/** A `Field` context in `[0, P - 1]`. */
const field = () => fc.bigInt({ min: 0n, max: P - 1n });

/** Which one of the four inputs a separation property moves. */
const component = () => fc.constantFrom('domain', 'slot', 'context', 'seed');

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const PROPERTY_RUNS = isLiveBackend() ? 2 : 100;

let prf: PrfExpandSimulator;

beforeAll(async () => {
  prf = await PrfExpandSimulator.create();
});

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

describe('PrfExpand property: layout', () => {
  it('should match the reference over Bytes<32> for any tag, slot, context and seed', async () => {
    await fc.assert(
      fc.asyncProperty(
        bytes32(),
        bytes32(),
        bytes32(),
        bytes32(),
        async (d, s, c, k) => {
          expect(await prf.expandOfBytes(d, s, c, k)).toStrictEqual(
            await prf.refExpandOfBytes(d, s, c, k),
          );
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('should match the reference over Field for any tag, slot, context and seed', async () => {
    await fc.assert(
      fc.asyncProperty(
        bytes32(),
        bytes32(),
        field(),
        bytes32(),
        async (d, s, c, k) => {
          expect(await prf.expandOfField(d, s, c, k)).toStrictEqual(
            await prf.refExpandOfField(d, s, c, k),
          );
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Separation
// ---------------------------------------------------------------------------

/**
 * Each run draws two values for one input and holds the other three fixed, so
 * a failure names the input that did not separate.
 */
describe('PrfExpand property: separation', () => {
  it('should move the value over Bytes<32> when any one input changes', async () => {
    await fc.assert(
      fc.asyncProperty(
        component(),
        bytes32(),
        bytes32(),
        bytes32(),
        bytes32(),
        bytes32(),
        async (moved, d, s, c, k, other) => {
          fc.pre(
            hex(other) !==
              hex({ domain: d, slot: s, context: c, seed: k }[moved]),
          );
          const next = {
            d: moved === 'domain' ? other : d,
            s: moved === 'slot' ? other : s,
            c: moved === 'context' ? other : c,
            k: moved === 'seed' ? other : k,
          };

          expect(hex(await prf.expandOfBytes(d, s, c, k))).not.toBe(
            hex(await prf.expandOfBytes(next.d, next.s, next.c, next.k)),
          );
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('should move the value over Field when any one input changes', async () => {
    await fc.assert(
      fc.asyncProperty(
        component(),
        bytes32(),
        bytes32(),
        field(),
        bytes32(),
        bytes32(),
        field(),
        async (moved, d, s, c, k, otherBytes, otherField) => {
          fc.pre(
            moved === 'context'
              ? otherField !== c
              : hex(otherBytes) !== hex({ domain: d, slot: s, seed: k }[moved]),
          );
          const next = {
            d: moved === 'domain' ? otherBytes : d,
            s: moved === 'slot' ? otherBytes : s,
            c: moved === 'context' ? otherField : c,
            k: moved === 'seed' ? otherBytes : k,
          };

          expect(hex(await prf.expandOfField(d, s, c, k))).not.toBe(
            hex(await prf.expandOfField(next.d, next.s, next.c, next.k)),
          );
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });
});
