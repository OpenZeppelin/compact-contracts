/**
 * Compatibility claims for the PrfAddr module.
 *
 * The hash over `domain`, `salt`, `sk` is wire format: every key a caller
 * derives through `PrfAddr` moves if it changes, and an installed key no
 * longer matches its secret. This suite pins it against a hand-written flat
 * reference, a recorded vector, and the two token keys derived through it.
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
import { PrfAddrSimulator } from './simulators/PrfAddrSimulator.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Deterministic 32 bytes from a label; also Compact's `pad(32, label)`. */
const bytes32 = (label: string): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(label));
  return bytes;
};

/** The Issuer compatibility spec's `ALICE_SK` and `SALT`. */
const ALICE_SK = bytes32('ALICE');
const SALT = bytes32('SALT');

/** The core's `derivePk(ALICE_SK, SALT)`, as its compatibility spec pins it. */
const PINNED_CORE_PK =
  262435359501940701077170570879675701887870845687505442111448399011781289948n;

/** The Issuer's `derivePk(ALICE_SK, SALT)`, as its compatibility spec pins it. */
const PINNED_ISSUER_PK =
  426067052262719536046677308300902963571916559121608027424922956751582302608n;

/** A spec-only tag, so no live key shares these vectors. */
const GOLDEN_DOMAIN = bytes32('Prf:golden');
const GOLDEN_SALT = SALT;
const GOLDEN_SK = ALICE_SK;

const GOLDEN = {
  derivePk:
    61582330137495489329895410001589376037467855049526002101543344025401826675n,
  /** `PrfCore`'s pinned `Bytes<32>` digest over the same inputs. */
  prfCoreDigest:
    '0x731d9ce6c24e82b028c93ca158f2b0c18127c5793a90912b4e28c393b7da229e',
} as const;

const fromHex = (value: string): Uint8Array =>
  new Uint8Array(Buffer.from(value.slice(2), 'hex'));

let addr: PrfAddrSimulator;

beforeAll(async () => {
  addr = await PrfAddrSimulator.create();
});

// ---------------------------------------------------------------------------
// Layout and golden vector
// ---------------------------------------------------------------------------

describe('PrfAddr compatibility: layout', () => {
  // The reference hashes a flat `{ domain, salt, sk }`, so equality pins the
  // field order and that the nesting through `PrfCore` is not hashed.
  it('should match its flat reference', async () => {
    expect(await addr.derivePk(GOLDEN_DOMAIN, GOLDEN_SALT, GOLDEN_SK)).toBe(
      await addr.refDerivePk(GOLDEN_DOMAIN, GOLDEN_SALT, GOLDEN_SK),
    );
  });

  it('should reproduce the pinned key', async () => {
    expect(await addr.derivePk(GOLDEN_DOMAIN, GOLDEN_SALT, GOLDEN_SK)).toBe(
      GOLDEN.derivePk,
    );
    expect(await addr.refDerivePk(GOLDEN_DOMAIN, GOLDEN_SALT, GOLDEN_SK)).toBe(
      GOLDEN.derivePk,
    );
  });

  it("should pin the key as the reduction of PrfCore's pinned digest", () => {
    expect(degradeToTransient(fromHex(GOLDEN.prfCoreDigest))).toBe(
      GOLDEN.derivePk,
    );
  });
});

// ---------------------------------------------------------------------------
// Token keys
// ---------------------------------------------------------------------------

describe('PrfAddr compatibility: token keys', () => {
  // Recorded from the core before it called a shared PRF, so this vector is
  // independent of the module under test.
  it("should derive the core's pinned key under its tag", async () => {
    expect(await addr.derivePk(bytes32('CNFT:pk'), SALT, ALICE_SK)).toBe(
      PINNED_CORE_PK,
    );
  });

  it("should derive the Issuer's pinned key under its tag", async () => {
    expect(await addr.derivePk(bytes32('CNFT:issuer:pk'), SALT, ALICE_SK)).toBe(
      PINNED_ISSUER_PK,
    );
  });
});
