/**
 * Compatibility claims for the ConfidentialNoteFungibleTokenUtils module.
 *
 * The three tags and each preimage layout are wire format: a holder rebuilds a
 * commitment and derives a nullifier to spend, and a moved digest orphans every
 * note. This suite pins them three ways. Each wrapper must equal a reference
 * circuit that hashes a flat struct through the standard library, and a
 * TypeScript reference over the runtime's `persistentCommit` and
 * `persistentHash`. Every output must equal a recorded constant.
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
 * PROVENANCE. Every value below was recorded under compiler 0.36.0 (CI,
 * language 0.28.0, runtime 0.21.0). They equal the vectors the core and preset
 * compatibility suites pin through their own mocks, and the TypeScript
 * reference reproduces each.
 *
 * Recorded, not asserted: a pinned `compiler-version` would fail on a toolchain
 * bump with nothing broken. The enforceable pin is
 * `.github/actions/setup/action.yml`. On a toolchain bump, rebuild under both
 * compilers and diff instead of assuming.
 */

import {
  type CompactType,
  CompactTypeBoolean,
  CompactTypeBytes,
  CompactTypeField,
  CompactTypeUnsignedInteger,
  persistentCommit,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type Account,
  ConfidentialNoteFungibleTokenUtilsSimulator,
  type Note,
} from './simulators/ConfidentialNoteFungibleTokenUtilsSimulator.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Deterministic 32 bytes from a label; also Compact's `pad(32, label)`. */
const bytes32 = (label: string): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(label));
  return bytes;
};

/** Lowercase `0x…` rendering, so a failed vector prints readably. */
const hex = (bytes: Uint8Array): string =>
  `0x${Buffer.from(bytes).toString('hex')}`;

const fromHex = (value: string): Uint8Array =>
  Uint8Array.from(Buffer.from(value.slice(2), 'hex'));

/** A `Field` as its 32 little-endian bytes, its `Bytes<32>` cast. */
const fieldToBytes = (value: bigint): Uint8Array => {
  const bytes = new Uint8Array(32);
  let rest = value;
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return bytes;
};

/** The core and preset suites' note, so the pins match theirs. */
const NOTE: Note = { value: 100n, nonce: 7n };

/** The core suite's `Field` owner key for Alice. */
const FIELD_KEY =
  262435359501940701077170570879675701887870845687505442111448399011781289948n;

/** The preset suite's account for Alice, `deriveAccount(ALICE_SK, SALT)`. */
const ACCOUNT: Account = {
  is_left: true,
  left: fromHex(
    '0xaf55d489c3c0228cece2bb86074c0bab748bd9e2419f5d1ab06bc1aa7ac6d8db',
  ),
  right: { bytes: new Uint8Array(32) },
};

const GOLDEN = {
  commitOfField:
    '0x068859b75b0836a669483ca2bf97928e347d0226f7b21ae2d484bf2f86982003',
  commitOfEither:
    '0xc544609033d9b69f5679dd94712dab1349fc7a51908059b21ba3a3f10d9bbdf8',
  nullifierOf:
    '0xfb3222fcc782cf98276a6d821788f1b81a78aa14aca248290de1fda823c30f17',
  issuedTagOf:
    '0x27eaf0b7591acabab03a7b8f370edb87ced140a090678267592a272a812ae9e1',
} as const;

// ---------------------------------------------------------------------------
// TypeScript reference
// ---------------------------------------------------------------------------

/** A struct or tuple as Compact hashes it: its fields' encodings in order. */
const fields = (...types: CompactType<unknown>[]): CompactType<unknown[]> => ({
  alignment: () => types.flatMap((type) => type.alignment()),
  toValue: (values) => types.flatMap((type, i) => type.toValue(values[i])),
  fromValue: (value) => types.map((type) => type.fromValue(value)),
});

const BYTES_32 = new CompactTypeBytes(32);
const UINT_128 = new CompactTypeUnsignedInteger((1n << 128n) - 1n, 16);
/** `{ is_left, left, right: { bytes } }`. */
const ACCOUNT_TYPE = fields(CompactTypeBoolean, BYTES_32, fields(BYTES_32));

/** `persistentCommit` over `{ tag, value, pk }` under the nonce's bytes. */
const referenceCommit = (
  keyType: CompactType<unknown>,
  note: Note,
  pk: unknown,
): Uint8Array =>
  persistentCommit(
    fields(BYTES_32, UINT_128, keyType),
    [bytes32('CNFT:commitment'), note.value, pk],
    fieldToBytes(note.nonce),
  );

/** `persistentHash` over `{ tag, nonce }`. */
const referencePrf = (tag: string, note: Note): Uint8Array =>
  persistentHash(fields(BYTES_32, CompactTypeField), [
    bytes32(tag),
    note.nonce,
  ]);

const accountValue = (pk: Account): unknown[] => [
  pk.is_left,
  pk.left,
  [pk.right.bytes],
];

let utils: ConfidentialNoteFungibleTokenUtilsSimulator;

beforeAll(async () => {
  utils = await ConfidentialNoteFungibleTokenUtilsSimulator.create();
});

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * The module commits to `{ tag, [value, pk] }` through `HashCommitment` and
 * hashes `{ tag, nonce }` through `PrfCore`. The reference circuits commit or
 * hash a flat struct, so equality pins the field order and that neither
 * nesting nor struct names are hashed.
 */
describe('ConfidentialNoteFungibleTokenUtils compatibility: layout', () => {
  it('should commit at a Field key as its flat reference', async () => {
    expect(await utils.commitOfField(NOTE, FIELD_KEY)).toStrictEqual(
      await utils.refCommitOfField(NOTE, FIELD_KEY),
    );
  });

  it('should commit at an Either key as its flat reference', async () => {
    expect(await utils.commitOfEither(NOTE, ACCOUNT)).toStrictEqual(
      await utils.refCommitOfEither(NOTE, ACCOUNT),
    );
  });

  it('should nullify as its flat reference', async () => {
    expect(await utils.nullifierOf(NOTE)).toStrictEqual(
      await utils.refNullifierOf(NOTE),
    );
  });

  it('should tag as its flat reference', async () => {
    expect(await utils.issuedTagOf(NOTE)).toStrictEqual(
      await utils.refIssuedTagOf(NOTE),
    );
  });
});

// ---------------------------------------------------------------------------
// Key encoding
// ---------------------------------------------------------------------------

/**
 * The key's type is not hashed, only its encoding. Two key types commit one
 * note to the same digest exactly when their encodings are the same bytes.
 */
describe('ConfidentialNoteFungibleTokenUtils compatibility: key encoding', () => {
  it('should commit a Field key and its Bytes<32> cast to the same digest', async () => {
    const digest = await utils.commitOfField(NOTE, FIELD_KEY);

    expect(digest).toStrictEqual(
      await utils.refCommitOfFieldBytes(NOTE, FIELD_KEY),
    );
    expect(digest).toStrictEqual(
      referenceCommit(BYTES_32, NOTE, fieldToBytes(FIELD_KEY)),
    );
  });

  // The Either encoding adds the flag and the `right` bytes around `left`.
  it('should commit a Field key and an Either key holding its cast to distinct digests', async () => {
    const holdingCast: Account = {
      is_left: true,
      left: fieldToBytes(FIELD_KEY),
      right: { bytes: new Uint8Array(32) },
    };

    expect(hex(await utils.commitOfField(NOTE, FIELD_KEY))).not.toBe(
      hex(await utils.commitOfEither(NOTE, holdingCast)),
    );
  });
});

// ---------------------------------------------------------------------------
// Golden vectors
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenUtils compatibility: golden vectors', () => {
  it('should reproduce the pinned commitment at a Field key', async () => {
    expect(hex(await utils.commitOfField(NOTE, FIELD_KEY))).toBe(
      GOLDEN.commitOfField,
    );
    expect(hex(await utils.refCommitOfField(NOTE, FIELD_KEY))).toBe(
      GOLDEN.commitOfField,
    );
    expect(hex(referenceCommit(CompactTypeField, NOTE, FIELD_KEY))).toBe(
      GOLDEN.commitOfField,
    );
  });

  it('should reproduce the pinned commitment at an Either key', async () => {
    expect(hex(await utils.commitOfEither(NOTE, ACCOUNT))).toBe(
      GOLDEN.commitOfEither,
    );
    expect(hex(await utils.refCommitOfEither(NOTE, ACCOUNT))).toBe(
      GOLDEN.commitOfEither,
    );
    expect(
      hex(referenceCommit(ACCOUNT_TYPE, NOTE, accountValue(ACCOUNT))),
    ).toBe(GOLDEN.commitOfEither);
  });

  it('should reproduce the pinned nullifier', async () => {
    expect(hex(await utils.nullifierOf(NOTE))).toBe(GOLDEN.nullifierOf);
    expect(hex(await utils.refNullifierOf(NOTE))).toBe(GOLDEN.nullifierOf);
    expect(hex(referencePrf('CNFT:nullifier', NOTE))).toBe(GOLDEN.nullifierOf);
  });

  it('should reproduce the pinned issued tag', async () => {
    expect(hex(await utils.issuedTagOf(NOTE))).toBe(GOLDEN.issuedTagOf);
    expect(hex(await utils.refIssuedTagOf(NOTE))).toBe(GOLDEN.issuedTagOf);
    expect(hex(referencePrf('CNFT:issued', NOTE))).toBe(GOLDEN.issuedTagOf);
  });
});
