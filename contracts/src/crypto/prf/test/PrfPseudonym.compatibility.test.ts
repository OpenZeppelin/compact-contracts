/**
 * Compatibility claims for the PrfPseudonym module.
 *
 * The hash over `domain`, `salt`, `sk` is wire format: every key a caller
 * derives through `PrfPseudonym` moves if it changes, and an installed key no
 * longer matches its secret. This suite pins it against a hand-written flat
 * reference, a recorded vector, and the token key derived through it.
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
 * PROVENANCE. Every value below was recorded under compiler 0.36.0
 * (language 0.28.0, runtime 0.21.0), the CI compiler.
 */

import { degradeToTransient } from '@midnight-ntwrk/compact-runtime';
import { beforeAll, describe, expect, it } from 'vitest';
import { PrfPseudonymSimulator } from './simulators/PrfPseudonymSimulator.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Deterministic 32 bytes from a label; also Compact's `pad(32, label)`. */
const bytes32 = (label: string): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(label));
  return bytes;
};

/** The core compatibility spec's `ALICE_SK` and `SALT`. */
const ALICE_SK = bytes32('ALICE');
const SALT = bytes32('SALT');

/** The `"CNFT:pk"` key of `ALICE_SK` under `SALT`, reduced to a `Field`. */
const PINNED_CORE_PK =
  262435359501940701077170570879675701887870845687505442111448399011781289948n;

/** A spec-only tag, so no live key shares these vectors. */
const GOLDEN_DOMAIN = bytes32('Prf:golden');
const GOLDEN_SALT = SALT;
const GOLDEN_SALT_TAIL = bytes32('SALT:tail');
const GOLDEN_SK = ALICE_SK;

const GOLDEN = {
  derivePseudonym:
    '0x731d9ce6c24e82b028c93ca158f2b0c18127c5793a90912b4e28c393b7da229e',
  /** `Prf`'s pinned `Bytes<32>` digest over the same inputs. */
  prfDigest:
    '0x731d9ce6c24e82b028c93ca158f2b0c18127c5793a90912b4e28c393b7da229e',
} as const;

/** Lowercase `0x…` rendering, so a failed vector prints readably. */
const hex = (bytes: Uint8Array): string =>
  `0x${Buffer.from(bytes).toString('hex')}`;

let addr: PrfPseudonymSimulator;

beforeAll(async () => {
  addr = await PrfPseudonymSimulator.create();
});

// ---------------------------------------------------------------------------
// Layout and golden vector
// ---------------------------------------------------------------------------

describe('PrfPseudonym compatibility: layout', () => {
  // The reference hashes a flat `{ domain, salt, sk }`, so equality pins the
  // field order and that the nesting through `Prf` is not hashed.
  it('should match its flat reference', async () => {
    expect(
      await addr.derivePseudonym(GOLDEN_DOMAIN, GOLDEN_SALT, GOLDEN_SK),
    ).toStrictEqual(
      await addr.refDerivePk(GOLDEN_DOMAIN, GOLDEN_SALT, GOLDEN_SK),
    );
  });

  it('should match its flat reference for a tuple salt', async () => {
    expect(
      await addr.derivePseudonymOfTuple(
        GOLDEN_DOMAIN,
        [GOLDEN_SALT, GOLDEN_SALT_TAIL],
        GOLDEN_SK,
      ),
    ).toStrictEqual(
      await addr.refDerivePkOfTuple(
        GOLDEN_DOMAIN,
        [GOLDEN_SALT, GOLDEN_SALT_TAIL],
        GOLDEN_SK,
      ),
    );
  });

  it('should reproduce the pinned key', async () => {
    expect(
      hex(await addr.derivePseudonym(GOLDEN_DOMAIN, GOLDEN_SALT, GOLDEN_SK)),
    ).toBe(GOLDEN.derivePseudonym);
    expect(
      hex(await addr.refDerivePk(GOLDEN_DOMAIN, GOLDEN_SALT, GOLDEN_SK)),
    ).toBe(GOLDEN.derivePseudonym);
  });

  it("should pin the pseudonym as Prf's pinned digest", () => {
    expect(GOLDEN.derivePseudonym).toBe(GOLDEN.prfDigest);
  });
});

// ---------------------------------------------------------------------------
// Token keys
// ---------------------------------------------------------------------------

describe('PrfPseudonym compatibility: token keys', () => {
  // Recorded without `PrfPseudonym`, so this vector is independent of the
  // module under test.
  it('should derive the pinned "CNFT:pk" key', async () => {
    expect(
      degradeToTransient(
        await addr.derivePseudonym(bytes32('CNFT:pk'), SALT, ALICE_SK),
      ),
    ).toBe(PINNED_CORE_PK);
  });
});
