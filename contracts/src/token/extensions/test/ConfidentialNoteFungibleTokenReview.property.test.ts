/**
 * Stateless properties of the review extension.
 *
 * The unit suite states each claim at hand-picked points. This states the same
 * claims over generated inputs, so they hold where nobody chose, and a failure
 * shrinks to the smallest counterexample.
 *
 * Runs on either backend. `recoverRecord` and `ownerOf` are pure and evaluate
 * locally even on live, so their properties run 100 times anywhere. The
 * `_review` properties deploy the standalone mock, and every call is a
 * transaction on live, so they run twice there.
 */

import { ecMulGenerator } from '@midnight-ntwrk/compact-runtime';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import { pureCircuits as review } from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenReview/contract/index.js';
import {
  ConfidentialNoteFungibleTokenReviewSimulator,
  type Identifier,
  type ReviewRecord,
} from './simulators/ConfidentialNoteFungibleTokenReviewSimulator.js';

// ---------------------------------------------------------------------------
// Generators, each pinned to the circuit's own type
// ---------------------------------------------------------------------------

const U128 = 1n << 128n;
const U248 = 1n << 248n;

// Jubjub prime-order subgroup order; valid secret scalars are [1, L-1].
const L =
  6554484396890773809930967563523245729705921265872317281365359162392183254199n;

const ZERO = new Uint8Array(32);

/** `Uint<128>`, the declared width of a note's value. */
const value = () => fc.bigInt({ min: 0n, max: U128 - 1n });

/** A `Field` nonce in `[0, 2^248)`, the range `_review` accepts. */
const nonce = () => fc.bigInt({ min: 0n, max: U248 - 1n });

/** `Uint<248>`, the declared width of every pad. */
const pad = () => fc.bigInt({ min: 0n, max: U248 - 1n });

/** A `JubjubScalar` in `[1, L-1]`, so `g^scalar` is never the identity. */
const scalar = () => fc.bigInt({ min: 1n, max: L - 1n });

/** Any `JubjubScalar`, zero included: the reviewer side returns for every key. */
const anyScalar = () => fc.bigInt({ min: 0n, max: L - 1n });

/** `Bytes<32>`, the declared width of a slot and of an owner key. */
const bytes32 = () => fc.uint8Array({ minLength: 32, maxLength: 32 });

/** A seed `RandPrfExpand` accepts: any 32 bytes but zero. */
const seed = () => bytes32().filter((bytes) => bytes.some((b) => b !== 0));

/** Any canonical key-arm owner, the zero key included. */
const owner = (): fc.Arbitrary<Identifier> =>
  bytes32().map((bytes) => ({
    is_left: true,
    left: bytes,
    right: { bytes: ZERO },
  }));

/** Any record `_review` could write, and more: any non-identity points, any pads. */
const anyRecord = (): fc.Arbitrary<ReviewRecord> =>
  fc.record({
    reviewerKey: scalar().map((s) => ecMulGenerator(s)),
    ephemeralPk: scalar().map((e) => ecMulGenerator(e)),
    valueCt: pad(),
    nonceCt: pad(),
    ownerLoCt: pad(),
    ownerHiCt: pad(),
  });

/** A little-endian integer from bytes. */
const littleEndian = (bytes: Uint8Array): bigint =>
  bytes.reduceRight((acc, byte) => (acc << 8n) | BigInt(byte), 0n);

const hex = (bytes: Uint8Array): string =>
  `0x${Buffer.from(bytes).toString('hex')}`;

/** The reviewer's filter: keeps a record only if every limb is in range. */
const passesFilter = (r: {
  value: bigint;
  ownerLo: bigint;
  ownerHi: bigint;
}): boolean => r.value < U128 && r.ownerLo < U128 && r.ownerHi < U128;

const PROPERTY_RUNS = isLiveBackend() ? 2 : 25;

let token: ConfidentialNoteFungibleTokenReviewSimulator;

/** The trail, newest first. */
const records = async (): Promise<ReviewRecord[]> => [
  ...(await token.getPublicState()).Review__reviewTrail,
];

/** Approves `g^s` and returns it. Approval is idempotent, so runs may repeat a key. */
const approve = async (s: bigint) => {
  const key = ecMulGenerator(s);
  await token._addReviewer(key);
  return key;
};

// ---------------------------------------------------------------------------
// recoverRecord and ownerOf
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenReview property: recoverRecord', () => {
  it('should return four values below 2^248 for any record and scalar, without asserting', () => {
    fc.assert(
      fc.property(anyRecord(), anyScalar(), (record, s) => {
        const r = review.recoverRecord(record, s);

        for (const field of [r.value, r.nonce, r.ownerLo, r.ownerHi]) {
          expect(field).toBeLessThan(U248);
        }
      }),
    );
  }, 60_000);

  it('should not open an identity ephemeral under any scalar, whatever the other fields', () => {
    fc.assert(
      fc.property(anyRecord(), anyScalar(), (record, s) => {
        const placeholder = { ...record, ephemeralPk: ecMulGenerator(0n) };

        expect(() => review.recoverRecord(placeholder, s)).toThrow(
          'ConfidentialNoteFungibleTokenReview: identity ephemeral',
        );
      }),
    );
  }, 60_000);

  it('should join any two little-endian limbs into the canonical key arm of their bytes', () => {
    fc.assert(
      fc.property(bytes32(), (bytes) => {
        const lo = littleEndian(bytes.subarray(0, 16));
        const hi = littleEndian(bytes.subarray(16, 32));

        expect(review.ownerOf(lo, hi)).toStrictEqual({
          is_left: true,
          left: bytes,
          right: { bytes: ZERO },
        });
      }),
    );
  }, 60_000);
});

// ---------------------------------------------------------------------------
// _review
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenReview property: _review', () => {
  beforeEach(async () => {
    token = await ConfidentialNoteFungibleTokenReviewSimulator.create();
  });

  it('should open any record in range to its note and owner under the reviewer scalar, for any seed and slot', async () => {
    await fc.assert(
      fc.asyncProperty(
        scalar(),
        owner(),
        value(),
        nonce(),
        bytes32(),
        seed(),
        async (s, o, v, n, slot, reviewSeed) => {
          const key = await approve(s);
          token.wallet.reviewSeed = reviewSeed;
          await token._review(key, o, v, n, slot);
          const [newest] = await records();
          const r = review.recoverRecord(newest, s);

          expect(newest.reviewerKey).toStrictEqual(key);
          expect(r).toStrictEqual({
            value: v,
            nonce: n,
            ownerLo: littleEndian(o.left.subarray(0, 16)),
            ownerHi: littleEndian(o.left.subarray(16, 32)),
          });
          expect(review.ownerOf(r.ownerLo, r.ownerHi)).toStrictEqual(o);
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  }, 60_000);

  it("should return a quadruple the filter drops under any other reviewer's scalar", async () => {
    await fc.assert(
      fc.asyncProperty(
        scalar(),
        scalar(),
        owner(),
        value(),
        nonce(),
        bytes32(),
        async (s, other, o, v, n, slot) => {
          fc.pre(s !== other);
          const key = await approve(s);
          await approve(other);
          await token._review(key, o, v, n, slot);
          const [newest] = await records();
          const wrong = review.recoverRecord(newest, other);

          expect(passesFilter(wrong)).toBe(false);
          expect(wrong.nonce).not.toBe(n);
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Ephemerals under a reused seed
// ---------------------------------------------------------------------------

/**
 * With the seed planted, the slot, the nonce, the key, the value and the
 * owner are what separate two records. Each run repeats its first review to
 * show the seed held.
 */
describe('ConfidentialNoteFungibleTokenReview property: ephemerals under a reused seed', () => {
  beforeEach(async () => {
    token = await ConfidentialNoteFungibleTokenReviewSimulator.create();
  });

  it('should move the ephemeral for any two distinct keys under one seed and note', async () => {
    await fc.assert(
      fc.asyncProperty(
        seed(),
        bytes32(),
        owner(),
        value(),
        nonce(),
        scalar(),
        scalar(),
        async (reviewSeed, slot, o, v, n, first, second) => {
          fc.pre(first !== second);
          const mine = await approve(first);
          const theirs = await approve(second);
          token.wallet.reviewSeed = reviewSeed;
          await token._review(mine, o, v, n, slot);
          await token._review(theirs, o, v, n, slot);
          await token._review(mine, o, v, n, slot);
          const [repeat, other, original] = await records();

          expect(repeat).toStrictEqual(original);
          expect(other.ephemeralPk).not.toStrictEqual(original.ephemeralPk);
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  }, 60_000);

  it('should move the ephemeral for any two distinct owners under one seed, key and slot', async () => {
    await fc.assert(
      fc.asyncProperty(
        seed(),
        scalar(),
        bytes32(),
        value(),
        nonce(),
        owner(),
        owner(),
        async (reviewSeed, s, slot, v, n, first, second) => {
          fc.pre(hex(first.left) !== hex(second.left));
          const key = await approve(s);
          token.wallet.reviewSeed = reviewSeed;
          await token._review(key, first, v, n, slot);
          await token._review(key, second, v, n, slot);
          await token._review(key, first, v, n, slot);
          const [repeat, other, original] = await records();

          expect(repeat).toStrictEqual(original);
          expect(other.ephemeralPk).not.toStrictEqual(original.ephemeralPk);
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  }, 60_000);

  it('should move the ephemeral for any two distinct values under one seed, key and slot', async () => {
    await fc.assert(
      fc.asyncProperty(
        seed(),
        scalar(),
        bytes32(),
        owner(),
        nonce(),
        value(),
        value(),
        async (reviewSeed, s, slot, o, n, v1, v2) => {
          fc.pre(v1 !== v2);
          const key = await approve(s);
          token.wallet.reviewSeed = reviewSeed;
          await token._review(key, o, v1, n, slot);
          await token._review(key, o, v2, n, slot);
          await token._review(key, o, v1, n, slot);
          const [repeat, other, original] = await records();

          expect(repeat).toStrictEqual(original);
          expect(other.ephemeralPk).not.toStrictEqual(original.ephemeralPk);
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  }, 60_000);

  it('should move the ephemeral for any two distinct nonces under one seed, key and slot', async () => {
    await fc.assert(
      fc.asyncProperty(
        seed(),
        scalar(),
        bytes32(),
        owner(),
        value(),
        nonce(),
        nonce(),
        async (reviewSeed, s, slot, o, v, n1, n2) => {
          fc.pre(n1 !== n2);
          const key = await approve(s);
          token.wallet.reviewSeed = reviewSeed;
          await token._review(key, o, v, n1, slot);
          await token._review(key, o, v, n2, slot);
          await token._review(key, o, v, n1, slot);
          const [repeat, other, original] = await records();

          expect(repeat).toStrictEqual(original);
          expect(other.ephemeralPk).not.toStrictEqual(original.ephemeralPk);
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  }, 60_000);

  it('should move the ephemeral for any two distinct slots under one seed, key and note', async () => {
    await fc.assert(
      fc.asyncProperty(
        seed(),
        scalar(),
        owner(),
        value(),
        nonce(),
        bytes32(),
        bytes32(),
        async (reviewSeed, s, o, v, n, slot1, slot2) => {
          fc.pre(hex(slot1) !== hex(slot2));
          const key = await approve(s);
          token.wallet.reviewSeed = reviewSeed;
          await token._review(key, o, v, n, slot1);
          await token._review(key, o, v, n, slot2);
          await token._review(key, o, v, n, slot1);
          const [repeat, other, original] = await records();

          expect(repeat).toStrictEqual(original);
          expect(other.ephemeralPk).not.toStrictEqual(original.ephemeralPk);
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  }, 60_000);
});
