/**
 * Compatibility claims for the PrfCore module.
 *
 * The preimage `{input, key}` is wire format: every output a caller derives
 * through `PrfCore` moves if it changes, and the other suites compare
 * `PrfCore` only against itself. This suite pins it two ways. Each wrapper
 * must equal a hand-written reference that hashes a flat struct without
 * calling `PrfCore`, and every output must equal a recorded constant.
 *
 * A FAILURE HERE IS NOT A TEST TO FIX, in order of likelihood:
 *
 *   1. Revert. Most failures are accidental.
 *   2. Accept deliberately. Pre-release nothing is deployed to break.
 *      Regenerate in the same commit and say so.
 *   3. Post-release, it is a breaking change needing a migration.
 *
 * Never regenerate a value without deciding which of the three it is.
 *
 * PROVENANCE. The golden vectors were recorded from flat-preimage reference
 * circuits under compiler 0.36.0 (language 0.28.0, runtime 0.21.0), the CI
 * compiler.
 */

import { degradeToTransient } from '@midnight-ntwrk/compact-runtime';
import { beforeAll, describe, expect, it } from 'vitest';
import { PrfCoreSimulator } from './simulators/PrfCoreSimulator.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Deterministic 32 bytes from a label. */
const bytes32 = (label: string): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(label));
  return bytes;
};

// Compact `Field` modulus (BLS12-381 scalar field).
const P =
  52435875175126190479447740508185965837690552500527637822603658699938581184513n;

/** The core compatibility spec's fixtures: `secretKey('ALICE')` and `SALT`. */
const ALICE_SK = bytes32('ALICE');
const SALT = bytes32('SALT');

/** A spec-only tag, so no live key shares these vectors. */
const GOLDEN_DOMAIN = bytes32('Prf:golden');
const GOLDEN_BYTES_INPUT = SALT;
/** The largest `Field`, so the input's encoding runs at full width. */
const GOLDEN_FIELD_INPUT = P - 1n;
const GOLDEN_KEY = ALICE_SK;

const GOLDEN = {
  evaluateOfBytes:
    '0x731d9ce6c24e82b028c93ca158f2b0c18127c5793a90912b4e28c393b7da229e',
  evaluateOfField:
    '0xb2ec706e65635c890d3e93a954b79f79a1054b53f00f409f9e68f2412a988f73',
  evaluateReducedOfField:
    253709334970801246570604830039685997110020800190125133867520963714919492786n,
} as const;

/** Lowercase `0x…` rendering, so a failed vector prints readably. */
const hex = (bytes: Uint8Array): string =>
  `0x${Buffer.from(bytes).toString('hex')}`;

const fromHex = (value: string): Uint8Array =>
  new Uint8Array(Buffer.from(value.slice(2), 'hex'));

let prf: PrfCoreSimulator;

beforeAll(async () => {
  prf = await PrfCoreSimulator.create();
});

// ---------------------------------------------------------------------------
// Nesting
// ---------------------------------------------------------------------------

/**
 * The wrappers hash `{ { domain, input }, key }`. The references hash a flat
 * `{ domain, input, key }` under other struct names. Equality pins that
 * neither nesting nor struct names are hashed, which `PrfAddr` relies on.
 */
describe('PrfCore compatibility: nesting', () => {
  it('should hash a nested Bytes<32> input as its flat preimage', async () => {
    expect(
      await prf.evaluateOfBytes(GOLDEN_DOMAIN, GOLDEN_BYTES_INPUT, GOLDEN_KEY),
    ).toStrictEqual(
      await prf.refEvaluateOfBytes(
        GOLDEN_DOMAIN,
        GOLDEN_BYTES_INPUT,
        GOLDEN_KEY,
      ),
    );
  });

  it('should hash a nested Field input as its flat preimage', async () => {
    expect(
      await prf.evaluateOfField(GOLDEN_DOMAIN, GOLDEN_FIELD_INPUT, GOLDEN_KEY),
    ).toStrictEqual(
      await prf.refEvaluateOfField(
        GOLDEN_DOMAIN,
        GOLDEN_FIELD_INPUT,
        GOLDEN_KEY,
      ),
    );
  });

  it('should reduce a nested Field input as its flat preimage', async () => {
    expect(
      await prf.evaluateReducedOfField(
        GOLDEN_DOMAIN,
        GOLDEN_FIELD_INPUT,
        GOLDEN_KEY,
      ),
    ).toBe(
      await prf.refEvaluateReducedOfField(
        GOLDEN_DOMAIN,
        GOLDEN_FIELD_INPUT,
        GOLDEN_KEY,
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Golden vectors
// ---------------------------------------------------------------------------

describe('PrfCore compatibility: golden vectors', () => {
  it('should reproduce the pinned digest over Bytes<32>', async () => {
    expect(
      hex(
        await prf.evaluateOfBytes(
          GOLDEN_DOMAIN,
          GOLDEN_BYTES_INPUT,
          GOLDEN_KEY,
        ),
      ),
    ).toBe(GOLDEN.evaluateOfBytes);
    expect(
      hex(
        await prf.refEvaluateOfBytes(
          GOLDEN_DOMAIN,
          GOLDEN_BYTES_INPUT,
          GOLDEN_KEY,
        ),
      ),
    ).toBe(GOLDEN.evaluateOfBytes);
  });

  it('should reproduce the pinned digest over Field', async () => {
    expect(
      hex(
        await prf.evaluateOfField(
          GOLDEN_DOMAIN,
          GOLDEN_FIELD_INPUT,
          GOLDEN_KEY,
        ),
      ),
    ).toBe(GOLDEN.evaluateOfField);
    expect(
      hex(
        await prf.refEvaluateOfField(
          GOLDEN_DOMAIN,
          GOLDEN_FIELD_INPUT,
          GOLDEN_KEY,
        ),
      ),
    ).toBe(GOLDEN.evaluateOfField);
  });

  it('should reproduce the pinned reduction over Field', async () => {
    expect(
      await prf.evaluateReducedOfField(
        GOLDEN_DOMAIN,
        GOLDEN_FIELD_INPUT,
        GOLDEN_KEY,
      ),
    ).toBe(GOLDEN.evaluateReducedOfField);
    expect(
      await prf.refEvaluateReducedOfField(
        GOLDEN_DOMAIN,
        GOLDEN_FIELD_INPUT,
        GOLDEN_KEY,
      ),
    ).toBe(GOLDEN.evaluateReducedOfField);
  });

  it('should pin the Field reduction as the reduction of its digest', () => {
    expect(degradeToTransient(fromHex(GOLDEN.evaluateOfField))).toBe(
      GOLDEN.evaluateReducedOfField,
    );
  });
});
