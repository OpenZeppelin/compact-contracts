/**
 * Compatibility claims for the AuthPrfPseudonym module.
 *
 * The hash over the tag, `salt`, `secretKey` is wire format: every stored
 * account moves if it changes, and its holder no longer passes a check
 * against it. This suite pins it against a `persistentHash` reference written
 * here and a recorded vector.
 *
 * A FAILURE HERE IS NOT A TEST TO FIX, in order of likelihood:
 *
 *   1. Revert. Most failures are accidental.
 *   2. Accept deliberately. Pre-release nothing is deployed to break.
 *      Regenerate in the same commit and say so.
 *   3. Post-release, it is a breaking change needing a migration.
 *
 * Never regenerate a value without deciding which of the three it is.
 */

import {
  CompactTypeBytes,
  CompactTypeVector,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { beforeAll, describe, expect, it } from 'vitest';
import { AuthPrfPseudonymSimulator } from './simulators/AuthPrfPseudonymSimulator.js';
import { AuthPrfPseudonymPrivateState } from './witnesses/AuthPrfPseudonymWitnesses.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Deterministic 32 bytes from a label; also Compact's `pad(32, label)`. */
const bytes32 = (label: string): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(label));
  return bytes;
};

const fromHex = (value: string): Uint8Array =>
  new Uint8Array(Buffer.from(value.slice(2), 'hex'));

const TAG = bytes32('AuthPrfPseudonym:identifier');
const GOLDEN_SK = bytes32('ALICE');
const GOLDEN_SALT = bytes32('SALT');

/** `deriveIdentifier(GOLDEN_SK, GOLDEN_SALT).left`. */
const GOLDEN_ACCOUNT =
  '0xb0d976468fe705dd047a9a088de6db65ea11414fcdc60681fb8fc66b4ab50cc6';

const goldenAccount = () => ({
  is_left: true,
  left: fromHex(GOLDEN_ACCOUNT),
  right: { bytes: new Uint8Array(32) },
});

let auth: AuthPrfPseudonymSimulator;

beforeAll(async () => {
  auth = await AuthPrfPseudonymSimulator.create({
    privateState: AuthPrfPseudonymPrivateState.withSecretKey(GOLDEN_SK),
  });
});

// ---------------------------------------------------------------------------
// Layout and golden vector
// ---------------------------------------------------------------------------

describe('AuthPrfPseudonym compatibility: layout', () => {
  // A flat `[tag, salt, secretKey]`, so equality pins the field order and that
  // the nesting through `PrfPseudonym` and `Prf` is not hashed.
  it('should match a persistentHash over the tag, salt and secret key', async () => {
    const reference = persistentHash(
      new CompactTypeVector(3, new CompactTypeBytes(32)),
      [TAG, GOLDEN_SALT, GOLDEN_SK],
    );

    expect((await auth.deriveIdentifier(GOLDEN_SK, GOLDEN_SALT)).left).toEqual(
      reference,
    );
  });

  it('should reproduce the pinned account', async () => {
    expect(await auth.deriveIdentifier(GOLDEN_SK, GOLDEN_SALT)).toEqual(
      goldenAccount(),
    );
  });

  it('should authenticate to the pinned account', async () => {
    expect(await auth.authenticate(GOLDEN_SALT)).toEqual({
      identifier: goldenAccount(),
    });
  });
});
