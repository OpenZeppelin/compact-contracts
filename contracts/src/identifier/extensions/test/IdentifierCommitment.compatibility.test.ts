/**
 * Compatibility claims for the IdentifierCommitment module.
 *
 * The committed value `{ domain, publicKey }` and the blinding are wire
 * format: every account commitment a module stores stops matching if they
 * change. This suite pins them against an independent encoding, the runtime's
 * `persistentHash` over `[blinding, domain, publicKey]`, and against a
 * recorded constant.
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
import { IdentifierCommitmentSimulator } from './simulators/IdentifierCommitmentSimulator.js';

/** Deterministic 32 bytes from a label; also Compact's `pad(32, label)`. */
const bytes32 = (label: string): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(label));
  return bytes;
};

/** A spec-only tag, so no live commitment shares this vector. */
const GOLDEN_DOMAIN = bytes32('AccountCommitment:golden');
const GOLDEN_PUBLIC_KEY = bytes32('PUBLIC_KEY');
const GOLDEN_BLINDING = bytes32('BLINDING');

const GOLDEN_COMMITMENT =
  '0x2aac6ca4ce82f78e6404123029790dd4b90658107e6814b557f41cdf752518ec';

/** Lowercase `0x…` rendering, so a failed vector prints readably. */
const hex = (bytes: Uint8Array): string =>
  `0x${Buffer.from(bytes).toString('hex')}`;

/** The layout the module documents, encoded without the module. */
const referenceCommit = (
  domain: Uint8Array,
  publicKey: Uint8Array,
  blinding: Uint8Array,
): Uint8Array =>
  persistentHash(new CompactTypeVector(3, new CompactTypeBytes(32)), [
    blinding,
    domain,
    publicKey,
  ]);

let accountCommitment: IdentifierCommitmentSimulator;

beforeAll(async () => {
  accountCommitment = await IdentifierCommitmentSimulator.create();
});

describe('IdentifierCommitment compatibility', () => {
  it('should hash the blinding, the domain, then the key', async () => {
    expect(
      await accountCommitment.commit(
        GOLDEN_DOMAIN,
        GOLDEN_PUBLIC_KEY,
        GOLDEN_BLINDING,
      ),
    ).toStrictEqual(
      referenceCommit(GOLDEN_DOMAIN, GOLDEN_PUBLIC_KEY, GOLDEN_BLINDING),
    );
  });

  it('should reproduce the pinned commitment', async () => {
    expect(
      hex(
        await accountCommitment.commit(
          GOLDEN_DOMAIN,
          GOLDEN_PUBLIC_KEY,
          GOLDEN_BLINDING,
        ),
      ),
    ).toBe(GOLDEN_COMMITMENT);
  });
});
