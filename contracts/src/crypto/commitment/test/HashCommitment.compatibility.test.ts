/**
 * Compatibility claims for the HashCommitment module.
 *
 * The committed value `{ domain, message }` and the randomness are wire
 * format: every commitment a caller stores through `HashCommitment` stops
 * opening if they change. This suite pins them three ways. Each wrapper must
 * equal a `persistentCommit` reference over a flat struct, and a
 * `persistentHash` reference over `{ randomness, domain, message }`, the
 * layout the module documents. Every output must equal a recorded constant.
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
 * `persistentHash` over `{ randomness, domain, message }`, and both reference
 * circuits reproduce them.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { HashCommitmentSimulator } from './simulators/HashCommitmentSimulator.js';

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

/** A spec-only tag, so no live commitment shares these vectors. */
const GOLDEN_DOMAIN = bytes32('Commitment:golden');
const GOLDEN_BYTES_MESSAGE = bytes32('MESSAGE');
/** The largest `Field`, so the message's encoding runs at full width. */
const GOLDEN_FIELD_MESSAGE = P - 1n;
const GOLDEN_RANDOMNESS = bytes32('RANDOMNESS');

const GOLDEN = {
  commitOfBytes:
    '0x9e6a43f6707b98e82439cdc01830d4ccf4f4abd3ed2506733b627cc6d2c95723',
  commitOfField:
    '0x71f93219b4a4de9115d95773fe6506477953126789b8d1a07c7e050fa2e55e7e',
} as const;

/** Lowercase `0x…` rendering, so a failed vector prints readably. */
const hex = (bytes: Uint8Array): string =>
  `0x${Buffer.from(bytes).toString('hex')}`;

/** A `Field` as its 32 little-endian bytes. */
const fieldToBytes = (value: bigint): Uint8Array => {
  const bytes = new Uint8Array(32);
  let rest = value;
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return bytes;
};

let commitment: HashCommitmentSimulator;

beforeAll(async () => {
  commitment = await HashCommitmentSimulator.create();
});

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * The wrappers commit to `Tagged<M> { domain, message }`. The `persistentCommit`
 * references commit to a flat struct under another name, and the
 * `persistentHash` references hash the randomness first, then the tag, then
 * the message.
 */
describe('HashCommitment compatibility: layout', () => {
  it('should commit a Bytes<32> message as its flat persistentCommit reference', async () => {
    expect(
      await commitment.commitOfBytes(
        GOLDEN_DOMAIN,
        GOLDEN_BYTES_MESSAGE,
        GOLDEN_RANDOMNESS,
      ),
    ).toStrictEqual(
      await commitment.refCommitOfBytes(
        GOLDEN_DOMAIN,
        GOLDEN_BYTES_MESSAGE,
        GOLDEN_RANDOMNESS,
      ),
    );
  });

  it('should commit a Field message as its flat persistentCommit reference', async () => {
    expect(
      await commitment.commitOfField(
        GOLDEN_DOMAIN,
        GOLDEN_FIELD_MESSAGE,
        GOLDEN_RANDOMNESS,
      ),
    ).toStrictEqual(
      await commitment.refCommitOfField(
        GOLDEN_DOMAIN,
        GOLDEN_FIELD_MESSAGE,
        GOLDEN_RANDOMNESS,
      ),
    );
  });

  it('should hash the randomness, the tag, then a Bytes<32> message', async () => {
    expect(
      await commitment.commitOfBytes(
        GOLDEN_DOMAIN,
        GOLDEN_BYTES_MESSAGE,
        GOLDEN_RANDOMNESS,
      ),
    ).toStrictEqual(
      await commitment.refHashOfBytes(
        GOLDEN_DOMAIN,
        GOLDEN_BYTES_MESSAGE,
        GOLDEN_RANDOMNESS,
      ),
    );
  });

  it('should hash the randomness, the tag, then a Field message', async () => {
    expect(
      await commitment.commitOfField(
        GOLDEN_DOMAIN,
        GOLDEN_FIELD_MESSAGE,
        GOLDEN_RANDOMNESS,
      ),
    ).toStrictEqual(
      await commitment.refHashOfField(
        GOLDEN_DOMAIN,
        GOLDEN_FIELD_MESSAGE,
        GOLDEN_RANDOMNESS,
      ),
    );
  });

  // The caller duty "one message type per tag": types are not hashed, only
  // the bytes of their fields.
  it('should commit a Field message and its Bytes<32> encoding to the same digest', async () => {
    expect(
      await commitment.commitOfField(
        GOLDEN_DOMAIN,
        GOLDEN_FIELD_MESSAGE,
        GOLDEN_RANDOMNESS,
      ),
    ).toStrictEqual(
      await commitment.commitOfBytes(
        GOLDEN_DOMAIN,
        fieldToBytes(GOLDEN_FIELD_MESSAGE),
        GOLDEN_RANDOMNESS,
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Golden vectors
// ---------------------------------------------------------------------------

describe('HashCommitment compatibility: golden vectors', () => {
  it('should reproduce the pinned commitment over Bytes<32>', async () => {
    expect(
      hex(
        await commitment.commitOfBytes(
          GOLDEN_DOMAIN,
          GOLDEN_BYTES_MESSAGE,
          GOLDEN_RANDOMNESS,
        ),
      ),
    ).toBe(GOLDEN.commitOfBytes);
    expect(
      hex(
        await commitment.refCommitOfBytes(
          GOLDEN_DOMAIN,
          GOLDEN_BYTES_MESSAGE,
          GOLDEN_RANDOMNESS,
        ),
      ),
    ).toBe(GOLDEN.commitOfBytes);
    expect(
      hex(
        await commitment.refHashOfBytes(
          GOLDEN_DOMAIN,
          GOLDEN_BYTES_MESSAGE,
          GOLDEN_RANDOMNESS,
        ),
      ),
    ).toBe(GOLDEN.commitOfBytes);
  });

  it('should reproduce the pinned commitment over Field', async () => {
    expect(
      hex(
        await commitment.commitOfField(
          GOLDEN_DOMAIN,
          GOLDEN_FIELD_MESSAGE,
          GOLDEN_RANDOMNESS,
        ),
      ),
    ).toBe(GOLDEN.commitOfField);
    expect(
      hex(
        await commitment.refCommitOfField(
          GOLDEN_DOMAIN,
          GOLDEN_FIELD_MESSAGE,
          GOLDEN_RANDOMNESS,
        ),
      ),
    ).toBe(GOLDEN.commitOfField);
    expect(
      hex(
        await commitment.refHashOfField(
          GOLDEN_DOMAIN,
          GOLDEN_FIELD_MESSAGE,
          GOLDEN_RANDOMNESS,
        ),
      ),
    ).toBe(GOLDEN.commitOfField);
  });
});
