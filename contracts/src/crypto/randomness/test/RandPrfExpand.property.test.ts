/**
 * Properties of the RandPrfExpand module over generated tags, slots, contexts
 * and seeds.
 *
 * The unit and compatibility suites state each claim at fixed points. This
 * states them where nobody chose: `derive` equals its flat reference and
 * `PrfExpand.expand` under the witness seed, each of the four inputs alone
 * moves the value, and a zero seed is rejected whatever the other inputs.
 *
 * Runs on either backend. Every wrapper is an impure circuit on its mock, so
 * each call is a transaction on live, and the properties run twice there.
 */

import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { PrfExpandSimulator } from '../../prf/test/simulators/PrfExpandSimulator.js';
import { RandPrfExpandSimulator } from './simulators/RandPrfExpandSimulator.js';

// ---------------------------------------------------------------------------
// Generators, each pinned to the circuit's own type
// ---------------------------------------------------------------------------

// Compact `Field` modulus (BLS12-381 scalar field).
const P =
  52435875175126190479447740508185965837690552500527637822603658699938581184513n;

/** `Bytes<32>`: a tag, a slot, or a `Bytes<32>` context. */
const bytes32 = () => fc.uint8Array({ minLength: 32, maxLength: 32 });

/** A seed `derive` accepts. fast-check biases towards all-zero arrays. */
const seed = () => bytes32().filter((bytes) => bytes.some((b) => b !== 0));

/** A `Field` context in `[0, P - 1]`. */
const field = () => fc.bigInt({ min: 0n, max: P - 1n });

/** Which one of the four inputs a separation property moves. */
const component = () => fc.constantFrom('domain', 'slot', 'context', 'seed');

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const ZERO = new Uint8Array(32);

const PROPERTY_RUNS = isLiveBackend() ? 2 : 100;

let rand: RandPrfExpandSimulator;
let expand: PrfExpandSimulator;

beforeAll(async () => {
  rand = await RandPrfExpandSimulator.create();
  expand = await PrfExpandSimulator.create();
});

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

describe('RandPrfExpand property: layout', () => {
  it('should match the reference and PrfExpand over Bytes<32> for any tag, slot, context and seed', async () => {
    await fc.assert(
      fc.asyncProperty(
        bytes32(),
        bytes32(),
        bytes32(),
        seed(),
        async (d, s, c, k) => {
          await rand.privateState.injectSeed(k);
          const value = await rand.deriveOfBytes(d, s, c);

          expect(value).toStrictEqual(await rand.refDeriveOfBytes(d, s, c, k));
          expect(value).toStrictEqual(await expand.expandOfBytes(d, s, c, k));
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('should match the reference and PrfExpand over Field for any tag, slot, context and seed', async () => {
    await fc.assert(
      fc.asyncProperty(
        bytes32(),
        bytes32(),
        field(),
        seed(),
        async (d, s, c, k) => {
          await rand.privateState.injectSeed(k);
          const value = await rand.deriveOfField(d, s, c);

          expect(value).toStrictEqual(await rand.refDeriveOfField(d, s, c, k));
          expect(value).toStrictEqual(await expand.expandOfField(d, s, c, k));
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
 * a failure names the input that did not separate. The seed is moved through
 * private state, which pins that `derive` reads the witness.
 */
describe('RandPrfExpand property: separation', () => {
  it('should move the value when any one input changes', async () => {
    await fc.assert(
      fc.asyncProperty(
        component(),
        bytes32(),
        bytes32(),
        bytes32(),
        seed(),
        seed(),
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

          await rand.privateState.injectSeed(k);
          const before = await rand.deriveOfBytes(d, s, c);
          await rand.privateState.injectSeed(next.k);

          expect(hex(before)).not.toBe(
            hex(await rand.deriveOfBytes(next.d, next.s, next.c)),
          );
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Zero seed
// ---------------------------------------------------------------------------

describe('RandPrfExpand property: zero seed', () => {
  it('should reject a zero seed for any tag, slot and context', async () => {
    await rand.privateState.injectSeed(ZERO);

    await fc.assert(
      fc.asyncProperty(
        bytes32(),
        bytes32(),
        bytes32(),
        field(),
        async (d, s, c, f) => {
          await expect(rand.deriveOfBytes(d, s, c)).rejects.toThrow(
            'RandPrfExpand: zero seed',
          );
          await expect(rand.deriveOfField(d, s, f)).rejects.toThrow(
            'RandPrfExpand: zero seed',
          );
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });
});
