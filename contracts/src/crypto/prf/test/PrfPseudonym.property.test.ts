/**
 * Properties of the PrfPseudonym module over generated tags, salts and
 * secrets.
 *
 * The unit and compatibility suites state each claim at fixed points. This
 * states them where nobody chose: `derivePseudonym` equals its flat
 * reference and the `Prf` digest over `{ domain, salt }`, a tuple salt hashes
 * as its flat fields, and each of the three inputs alone moves the pseudonym.
 *
 * Runs on either backend. Every wrapper is an impure circuit on its mock, so
 * each call is a transaction on live, and the properties run twice there.
 */

import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { PrfPseudonymSimulator } from './simulators/PrfPseudonymSimulator.js';
import { PrfSimulator } from './simulators/PrfSimulator.js';

// ---------------------------------------------------------------------------
// Generators, each pinned to the circuit's own type
// ---------------------------------------------------------------------------

/** `Bytes<32>`: a tag, a salt or a secret. */
const bytes32 = () => fc.uint8Array({ minLength: 32, maxLength: 32 });

/** Which one of the three inputs a separation property moves. */
const component = () => fc.constantFrom('domain', 'salt', 'sk');

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const PROPERTY_RUNS = isLiveBackend() ? 2 : 100;

let addr: PrfPseudonymSimulator;
let prf: PrfSimulator;

beforeAll(async () => {
  addr = await PrfPseudonymSimulator.create();
  prf = await PrfSimulator.create();
});

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

describe('PrfPseudonym property: layout', () => {
  it('should match the reference for any tag, salt and secret', async () => {
    await fc.assert(
      fc.asyncProperty(bytes32(), bytes32(), bytes32(), async (d, s, k) => {
        expect(await addr.derivePseudonym(d, s, k)).toStrictEqual(
          await addr.refDerivePk(d, s, k),
        );
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('should equal the Prf digest for any tag, salt and secret', async () => {
    await fc.assert(
      fc.asyncProperty(bytes32(), bytes32(), bytes32(), async (d, s, k) => {
        expect(await addr.derivePseudonym(d, s, k)).toStrictEqual(
          await prf.evaluateOfBytes(d, s, k),
        );
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('should match the reference for any tag, tuple salt and secret', async () => {
    await fc.assert(
      fc.asyncProperty(
        bytes32(),
        fc.tuple(bytes32(), bytes32()),
        bytes32(),
        async (d, s, k) => {
          expect(await addr.derivePseudonymOfTuple(d, s, k)).toStrictEqual(
            await addr.refDerivePkOfTuple(d, s, k),
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
 * Each run draws two values for one input and holds the other two fixed, so a
 * failure names the input that did not separate.
 */
describe('PrfPseudonym property: separation', () => {
  it('should move the pseudonym when any one input changes', async () => {
    await fc.assert(
      fc.asyncProperty(
        component(),
        bytes32(),
        bytes32(),
        bytes32(),
        bytes32(),
        async (moved, d, s, k, other) => {
          fc.pre(hex(other) !== hex({ domain: d, salt: s, sk: k }[moved]));
          const next = {
            d: moved === 'domain' ? other : d,
            s: moved === 'salt' ? other : s,
            k: moved === 'sk' ? other : k,
          };

          expect(hex(await addr.derivePseudonym(d, s, k))).not.toBe(
            hex(await addr.derivePseudonym(next.d, next.s, next.k)),
          );
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });
});
