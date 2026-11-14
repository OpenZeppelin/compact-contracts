/**
 * Compatibility claims for the PrfExpand module.
 *
 * The preimage `{ { domain, slot, context }, seed }` is wire format: every
 * value a caller derives through `PrfExpand` moves if it changes. This suite
 * pins it two ways. Each wrapper must equal a hand-written reference that
 * hashes a flat struct without calling `PrfExpand`, and every output must
 * equal a recorded constant.
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
 * PROVENANCE. The golden vectors were computed with the runtime's
 * `persistentHash` over the flat preimage, and the flat-preimage reference
 * circuits reproduce them.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { PrfExpandSimulator } from './simulators/PrfExpandSimulator.js';

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

const GOLDEN = {
  expandOfBytes:
    '0x84d78513599b1b62e2462b2398b16364c5d14233c9a2ee13493885d6f694d5bc',
  expandOfField:
    '0x9f468138603b6fb964594c60bd686debbf11af7d5e70b79e110c65abd3cbfcf4',
} as const;

/** Lowercase `0x…` rendering, so a failed vector prints readably. */
const hex = (bytes: Uint8Array): string =>
  `0x${Buffer.from(bytes).toString('hex')}`;

let prf: PrfExpandSimulator;

beforeAll(async () => {
  prf = await PrfExpandSimulator.create();
});

// ---------------------------------------------------------------------------
// Nesting
// ---------------------------------------------------------------------------

/**
 * The wrappers hash `{ { domain, slot, context }, seed }` through `PrfCore`.
 * The references hash a flat `{ domain, slot, context, seed }` under other
 * struct names. Equality pins the field order with the seed last, and that
 * neither nesting nor struct names are hashed.
 */
describe('PrfExpand compatibility: nesting', () => {
  it('should hash a nested Bytes<32> context as its flat preimage', async () => {
    expect(
      await prf.expandOfBytes(
        GOLDEN_DOMAIN,
        GOLDEN_SLOT,
        GOLDEN_BYTES_CONTEXT,
        GOLDEN_SEED,
      ),
    ).toStrictEqual(
      await prf.refExpandOfBytes(
        GOLDEN_DOMAIN,
        GOLDEN_SLOT,
        GOLDEN_BYTES_CONTEXT,
        GOLDEN_SEED,
      ),
    );
  });

  it('should hash a nested Field context as its flat preimage', async () => {
    expect(
      await prf.expandOfField(
        GOLDEN_DOMAIN,
        GOLDEN_SLOT,
        GOLDEN_FIELD_CONTEXT,
        GOLDEN_SEED,
      ),
    ).toStrictEqual(
      await prf.refExpandOfField(
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

describe('PrfExpand compatibility: golden vectors', () => {
  it('should reproduce the pinned value over Bytes<32>', async () => {
    expect(
      hex(
        await prf.expandOfBytes(
          GOLDEN_DOMAIN,
          GOLDEN_SLOT,
          GOLDEN_BYTES_CONTEXT,
          GOLDEN_SEED,
        ),
      ),
    ).toBe(GOLDEN.expandOfBytes);
    expect(
      hex(
        await prf.refExpandOfBytes(
          GOLDEN_DOMAIN,
          GOLDEN_SLOT,
          GOLDEN_BYTES_CONTEXT,
          GOLDEN_SEED,
        ),
      ),
    ).toBe(GOLDEN.expandOfBytes);
  });

  it('should reproduce the pinned value over Field', async () => {
    expect(
      hex(
        await prf.expandOfField(
          GOLDEN_DOMAIN,
          GOLDEN_SLOT,
          GOLDEN_FIELD_CONTEXT,
          GOLDEN_SEED,
        ),
      ),
    ).toBe(GOLDEN.expandOfField);
    expect(
      hex(
        await prf.refExpandOfField(
          GOLDEN_DOMAIN,
          GOLDEN_SLOT,
          GOLDEN_FIELD_CONTEXT,
          GOLDEN_SEED,
        ),
      ),
    ).toBe(GOLDEN.expandOfField);
  });
});
