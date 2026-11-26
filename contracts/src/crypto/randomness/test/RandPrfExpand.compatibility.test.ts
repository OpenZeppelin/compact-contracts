/**
 * Compatibility claims for the RandPrfExpand module.
 *
 * `derive` is `PrfExpand.expand` keyed by the witness seed, and its value is
 * wire format: every nonce or scalar a caller derives through it moves if the
 * layout changes. This suite pins it against a hand-written flat reference
 * that takes the seed as an argument, and against recorded constants.
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
 * PROVENANCE. The inputs and golden vectors are the PrfExpand compatibility
 * spec's: one seed, one layout, one value.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { RandPrfExpandSimulator } from './simulators/RandPrfExpandSimulator.js';
import { RandPrfExpandPrivateState } from './witnesses/RandPrfExpandWitnesses.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Deterministic 32 bytes from a label; also Compact's `pad(32, label)`. */
const bytes32 = (label: string): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(label));
  return bytes;
};

// Compact `Field` modulus (BLS12-381 scalar field).
const P =
  52435875175126190479447740508185965837690552500527637822603658699938581184513n;

/** A spec-only tag, so no live value shares these vectors. */
const GOLDEN_DOMAIN = bytes32('Prf:golden');
const GOLDEN_SLOT = bytes32('Prf:slot');
const GOLDEN_BYTES_CONTEXT = bytes32('CONTEXT');
/** The largest `Field`, so the context's encoding runs at full width. */
const GOLDEN_FIELD_CONTEXT = P - 1n;
const GOLDEN_SEED = bytes32('SEED');

/** `PrfExpand`'s pinned values over the same inputs and seed. */
const GOLDEN = {
  deriveOfBytes:
    '0x84d78513599b1b62e2462b2398b16364c5d14233c9a2ee13493885d6f694d5bc',
  deriveOfField:
    '0x9f468138603b6fb964594c60bd686debbf11af7d5e70b79e110c65abd3cbfcf4',
} as const;

/** Lowercase `0x…` rendering, so a failed vector prints readably. */
const hex = (bytes: Uint8Array): string =>
  `0x${Buffer.from(bytes).toString('hex')}`;

let rand: RandPrfExpandSimulator;

beforeAll(async () => {
  rand = await RandPrfExpandSimulator.create({
    privateState: RandPrfExpandPrivateState.withSeed(GOLDEN_SEED),
  });
});

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * The reference hashes a flat `{ domain, slot, context, seed }` with the seed
 * passed in, so equality pins that `derive` keys `PrfExpand` with the witness
 * seed and adds nothing to the preimage.
 */
describe('RandPrfExpand compatibility: layout', () => {
  it('should match its flat reference over Bytes<32>', async () => {
    expect(
      await rand.deriveOfBytes(
        GOLDEN_DOMAIN,
        GOLDEN_SLOT,
        GOLDEN_BYTES_CONTEXT,
      ),
    ).toStrictEqual(
      await rand.refDeriveOfBytes(
        GOLDEN_DOMAIN,
        GOLDEN_SLOT,
        GOLDEN_BYTES_CONTEXT,
        GOLDEN_SEED,
      ),
    );
  });

  it('should match its flat reference over Field', async () => {
    expect(
      await rand.deriveOfField(
        GOLDEN_DOMAIN,
        GOLDEN_SLOT,
        GOLDEN_FIELD_CONTEXT,
      ),
    ).toStrictEqual(
      await rand.refDeriveOfField(
        GOLDEN_DOMAIN,
        GOLDEN_SLOT,
        GOLDEN_FIELD_CONTEXT,
        GOLDEN_SEED,
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Golden vectors
// ---------------------------------------------------------------------------

describe('RandPrfExpand compatibility: golden vectors', () => {
  it('should reproduce the pinned value over Bytes<32>', async () => {
    expect(
      hex(
        await rand.deriveOfBytes(
          GOLDEN_DOMAIN,
          GOLDEN_SLOT,
          GOLDEN_BYTES_CONTEXT,
        ),
      ),
    ).toBe(GOLDEN.deriveOfBytes);
    expect(
      hex(
        await rand.refDeriveOfBytes(
          GOLDEN_DOMAIN,
          GOLDEN_SLOT,
          GOLDEN_BYTES_CONTEXT,
          GOLDEN_SEED,
        ),
      ),
    ).toBe(GOLDEN.deriveOfBytes);
  });

  it('should reproduce the pinned value over Field', async () => {
    expect(
      hex(
        await rand.deriveOfField(
          GOLDEN_DOMAIN,
          GOLDEN_SLOT,
          GOLDEN_FIELD_CONTEXT,
        ),
      ),
    ).toBe(GOLDEN.deriveOfField);
    expect(
      hex(
        await rand.refDeriveOfField(
          GOLDEN_DOMAIN,
          GOLDEN_SLOT,
          GOLDEN_FIELD_CONTEXT,
          GOLDEN_SEED,
        ),
      ),
    ).toBe(GOLDEN.deriveOfField);
  });
});
