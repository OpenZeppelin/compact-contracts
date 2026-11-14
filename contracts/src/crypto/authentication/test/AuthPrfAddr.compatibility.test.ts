/**
 * Compatibility claims for the AuthPrfAddr module.
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
import { AuthPrfAddrSimulator } from './simulators/AuthPrfAddrSimulator.js';
import { AuthPrfAddrPrivateState } from './witnesses/AuthPrfAddrWitnesses.js';

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

const TAG = bytes32('AuthPrfAddr:account');
const GOLDEN_SK = bytes32('ALICE');
const GOLDEN_SALT = bytes32('SALT');

/** `deriveAccount(GOLDEN_SK, GOLDEN_SALT).left`. */
const GOLDEN_ACCOUNT =
  '0xaf55d489c3c0228cece2bb86074c0bab748bd9e2419f5d1ab06bc1aa7ac6d8db';

const goldenAccount = () => ({
  is_left: true,
  left: fromHex(GOLDEN_ACCOUNT),
  right: { bytes: new Uint8Array(32) },
});

let auth: AuthPrfAddrSimulator;

beforeAll(async () => {
  auth = await AuthPrfAddrSimulator.create({
    privateState: AuthPrfAddrPrivateState.withSecretKey(GOLDEN_SK),
  });
});

// ---------------------------------------------------------------------------
// Layout and golden vector
// ---------------------------------------------------------------------------

describe('AuthPrfAddr compatibility: layout', () => {
  // A flat `[tag, salt, secretKey]`, so equality pins the field order and that
  // the nesting through `PrfAddr` and `PrfCore` is not hashed.
  it('should match a persistentHash over the tag, salt and secret key', async () => {
    const reference = persistentHash(
      new CompactTypeVector(3, new CompactTypeBytes(32)),
      [TAG, GOLDEN_SALT, GOLDEN_SK],
    );

    expect((await auth.deriveAccount(GOLDEN_SK, GOLDEN_SALT)).left).toEqual(
      reference,
    );
  });

  it('should reproduce the pinned account', async () => {
    expect(await auth.deriveAccount(GOLDEN_SK, GOLDEN_SALT)).toEqual(
      goldenAccount(),
    );
  });

  it('should authenticate to the pinned account', async () => {
    expect(await auth.authenticate(GOLDEN_SALT)).toEqual({
      account: goldenAccount(),
    });
  });
});
