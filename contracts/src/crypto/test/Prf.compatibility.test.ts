/**
 * Compatibility claims for the Prf module.
 *
 * The layout `{domain, input, key}` is wire format: every key a caller derives
 * through `Prf` moves if it changes, and the other suites compare `Prf` only
 * against itself. This suite pins it two ways. Each wrapper must equal a
 * hand-written reference that hashes its own struct without calling `Prf`, and
 * every output must equal a recorded constant, one of which `Prf` did not
 * produce: the core's `derivePk` vector, recorded before the core adopted it.
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
 * PROVENANCE. The four golden vectors were recorded from the `ref*` circuits
 * under compiler 0.36.0 (language 0.28.0, runtime 0.21.0), the CI compiler.
 */

import { degradeToTransient } from '@midnight-ntwrk/compact-runtime';
import { beforeAll, describe, expect, it } from 'vitest';
import { PrfSimulator } from './simulators/PrfSimulator.js';

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

/** `derivePk(ALICE_SK, SALT)` on the core, as its compatibility spec pins it. */
const PINNED_CORE_PK =
  262435359501940701077170570879675701887870845687505442111448399011781289948n;

/** A spec-only tag, so no live key shares these vectors. */
const GOLDEN_DOMAIN = bytes32('Prf:golden');
const GOLDEN_BYTES_INPUT = SALT;
/** The largest `Field`, so the input's encoding runs at full width. */
const GOLDEN_FIELD_INPUT = P - 1n;
const GOLDEN_KEY = ALICE_SK;

const GOLDEN = {
  prfOfBytes:
    '0x731d9ce6c24e82b028c93ca158f2b0c18127c5793a90912b4e28c393b7da229e',
  prfFieldOfBytes:
    61582330137495489329895410001589376037467855049526002101543344025401826675n,
  prfOfField:
    '0xb2ec706e65635c890d3e93a954b79f79a1054b53f00f409f9e68f2412a988f73',
  prfFieldOfField:
    253709334970801246570604830039685997110020800190125133867520963714919492786n,
} as const;

/** Lowercase `0x…` rendering, so a failed vector prints readably. */
const hex = (bytes: Uint8Array): string =>
  `0x${Buffer.from(bytes).toString('hex')}`;

const fromHex = (value: string): Uint8Array =>
  new Uint8Array(Buffer.from(value.slice(2), 'hex'));

let prf: PrfSimulator;

beforeAll(async () => {
  prf = await PrfSimulator.create();
});

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * The references hash `RefBytesPreimage` and `RefFieldPreimage`, structs with
 * the `Prf` field order under other names. Equality pins the order and shows
 * the struct name is not hashed.
 */
describe('Prf compatibility: layout', () => {
  it('should match its reference for prf over Bytes<32>', async () => {
    expect(
      await prf.prfOfBytes(GOLDEN_DOMAIN, GOLDEN_BYTES_INPUT, GOLDEN_KEY),
    ).toStrictEqual(
      await prf.refPrfOfBytes(GOLDEN_DOMAIN, GOLDEN_BYTES_INPUT, GOLDEN_KEY),
    );
  });

  it('should match its reference for prfField over Bytes<32>', async () => {
    expect(
      await prf.prfFieldOfBytes(GOLDEN_DOMAIN, GOLDEN_BYTES_INPUT, GOLDEN_KEY),
    ).toBe(
      await prf.refPrfFieldOfBytes(
        GOLDEN_DOMAIN,
        GOLDEN_BYTES_INPUT,
        GOLDEN_KEY,
      ),
    );
  });

  it('should match its reference for prf over Field', async () => {
    expect(
      await prf.prfOfField(GOLDEN_DOMAIN, GOLDEN_FIELD_INPUT, GOLDEN_KEY),
    ).toStrictEqual(
      await prf.refPrfOfField(GOLDEN_DOMAIN, GOLDEN_FIELD_INPUT, GOLDEN_KEY),
    );
  });

  it('should match its reference for prfField over Field', async () => {
    expect(
      await prf.prfFieldOfField(GOLDEN_DOMAIN, GOLDEN_FIELD_INPUT, GOLDEN_KEY),
    ).toBe(
      await prf.refPrfFieldOfField(
        GOLDEN_DOMAIN,
        GOLDEN_FIELD_INPUT,
        GOLDEN_KEY,
      ),
    );
  });

  // Recorded from the core before it called `Prf`, so this vector is
  // independent of the module under test.
  it("should reproduce the core's pinned derivePk vector under its tag", async () => {
    expect(await prf.prfFieldOfBytes(bytes32('CNFT:pk'), SALT, ALICE_SK)).toBe(
      PINNED_CORE_PK,
    );
  });
});

// ---------------------------------------------------------------------------
// Golden vectors
// ---------------------------------------------------------------------------

describe('Prf compatibility: golden vectors', () => {
  it('should reproduce the pinned prf digest over Bytes<32>', async () => {
    expect(
      hex(await prf.prfOfBytes(GOLDEN_DOMAIN, GOLDEN_BYTES_INPUT, GOLDEN_KEY)),
    ).toBe(GOLDEN.prfOfBytes);
    expect(
      hex(
        await prf.refPrfOfBytes(GOLDEN_DOMAIN, GOLDEN_BYTES_INPUT, GOLDEN_KEY),
      ),
    ).toBe(GOLDEN.prfOfBytes);
  });

  it('should reproduce the pinned prfField value over Bytes<32>', async () => {
    expect(
      await prf.prfFieldOfBytes(GOLDEN_DOMAIN, GOLDEN_BYTES_INPUT, GOLDEN_KEY),
    ).toBe(GOLDEN.prfFieldOfBytes);
    expect(
      await prf.refPrfFieldOfBytes(
        GOLDEN_DOMAIN,
        GOLDEN_BYTES_INPUT,
        GOLDEN_KEY,
      ),
    ).toBe(GOLDEN.prfFieldOfBytes);
  });

  it('should reproduce the pinned prf digest over Field', async () => {
    expect(
      hex(await prf.prfOfField(GOLDEN_DOMAIN, GOLDEN_FIELD_INPUT, GOLDEN_KEY)),
    ).toBe(GOLDEN.prfOfField);
    expect(
      hex(
        await prf.refPrfOfField(GOLDEN_DOMAIN, GOLDEN_FIELD_INPUT, GOLDEN_KEY),
      ),
    ).toBe(GOLDEN.prfOfField);
  });

  it('should reproduce the pinned prfField value over Field', async () => {
    expect(
      await prf.prfFieldOfField(GOLDEN_DOMAIN, GOLDEN_FIELD_INPUT, GOLDEN_KEY),
    ).toBe(GOLDEN.prfFieldOfField);
    expect(
      await prf.refPrfFieldOfField(
        GOLDEN_DOMAIN,
        GOLDEN_FIELD_INPUT,
        GOLDEN_KEY,
      ),
    ).toBe(GOLDEN.prfFieldOfField);
  });

  it('should pin each prfField vector as the reduction of its prf vector', () => {
    expect(degradeToTransient(fromHex(GOLDEN.prfOfBytes))).toBe(
      GOLDEN.prfFieldOfBytes,
    );
    expect(degradeToTransient(fromHex(GOLDEN.prfOfField))).toBe(
      GOLDEN.prfFieldOfField,
    );
  });
});
