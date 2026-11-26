import { ecMulGenerator } from '@midnight-ntwrk/compact-runtime';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import { expectRejection } from '#test-utils/assertions/rejection.js';
import { pureCircuits as review } from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenReview/contract/index.js';
import { pureCircuits as reviewed } from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenReviewed/contract/index.js';
import { NOTE_SALT } from '../../presets/test/witnesses/CustodialConfidentialNoteFungibleTokenWitnesses.js';
import {
  ConfidentialNoteFungibleTokenReviewedSimulator,
  type Note,
} from './simulators/ConfidentialNoteFungibleTokenReviewedSimulator.js';
import {
  ConfidentialNoteFungibleTokenReviewSimulator,
  type Identifier,
  type ReviewRecord,
} from './simulators/ConfidentialNoteFungibleTokenReviewSimulator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic 32 bytes from a label; also Compact's `pad(32, label)`. */
const bytes32 = (label: string): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(label));
  return bytes;
};

const U128 = 1n << 128n;
const U248 = 1n << 248n;

// Jubjub prime-order subgroup order; the bindings accept scalars in [0, L-1].
const L =
  6554484396890773809930967563523245729705921265872317281365359162392183254199n;

const ZERO = new Uint8Array(32);

/** A canonical key-arm owner. */
const keyArm = (bytes: Uint8Array): Identifier => ({
  is_left: true,
  left: bytes,
  right: { bytes: ZERO },
});

// 32 distinct non-zero bytes, so a swapped limb or a reversed byte order shows.
const OWNER = keyArm(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
const OWNER_LO = 0x100f0e0d0c0b0a090807060504030201n;
const OWNER_HI = 0x201f1e1d1c1b1a191817161514131211n;

const WIDEST_OWNER = keyArm(new Uint8Array(32).fill(0xff));
const OTHER_OWNER = keyArm(bytes32('OTHER-OWNER'));

const CONTRACT_OWNER: Identifier = {
  is_left: false,
  left: ZERO,
  right: { bytes: bytes32('CONTRACT') },
};

/** A key arm whose inactive arm is not the default. */
const NON_CANONICAL_OWNER: Identifier = {
  ...OWNER,
  right: { bytes: bytes32('STRAY') },
};

// Reviewer scalars and the keys they derive, `reviewerKey = g^scalar`.
const RS_ONE = 111222333444555n;
const RS_TWO = 999888777666555n;
const RS_THREE = 123123123123123n;
const REVIEWER_ONE = ecMulGenerator(RS_ONE);
const REVIEWER_TWO = ecMulGenerator(RS_TWO);
const REVIEWER_THREE = ecMulGenerator(RS_THREE);
const IDENTITY = ecMulGenerator(0n);

const SLOT = bytes32('spec:out');
const OTHER_SLOT = bytes32('spec:change');
const FIXED_SEED = bytes32('FIXED-REVIEW-SEED');

const VALUE = 100n;
const NONCE = 7n;

const ERR = {
  identityKey: 'ConfidentialNoteFungibleTokenReview: identity reviewer key',
  notApproved: 'ConfidentialNoteFungibleTokenReview: reviewer not approved',
  contractOwner: 'ConfidentialNoteFungibleTokenReview: contract owner',
  nonCanonical: 'ConfidentialNoteFungibleTokenReview: non-canonical owner',
  identityEphemeral: 'ConfidentialNoteFungibleTokenReview: identity ephemeral',
  nonceWidth: 'cast from Field or Uint value to smaller Uint value failed',
  zeroSeed: 'RandPrfExpand: zero seed',
} as const;

/** What a reviewer keeps: the record opened, nothing checked. */
type Opened = { value: bigint; nonce: bigint; owner: Identifier };

/** The reviewer's filter: keeps a record only if every limb is in range. */
const passesFilter = (r: {
  value: bigint;
  ownerLo: bigint;
  ownerHi: bigint;
}): boolean => r.value < U128 && r.ownerLo < U128 && r.ownerHi < U128;

/** `recoverRecord` then `ownerOf`, as the reviewer's steps 2 to 4 run them. */
const opened = (record: ReviewRecord, scalar: bigint): Opened => {
  const r = review.recoverRecord(record, scalar);
  expect(passesFilter(r)).toBe(true);
  return {
    value: r.value,
    nonce: r.nonce,
    owner: review.ownerOf(r.ownerLo, r.ownerHi),
  };
};

let token: ConfidentialNoteFungibleTokenReviewSimulator;

/** The trail, newest first. */
const trail = async (): Promise<ReviewRecord[]> => [
  ...(await token.getPublicState()).Review__reviewTrail,
];

const trailLength = async (): Promise<bigint> =>
  (await token.getPublicState()).Review__reviewTrail.length();

const isApproved = async (
  key: ReturnType<typeof ecMulGenerator>,
): Promise<boolean> =>
  (await token.getPublicState()).Review__reviewers.member(key);

const registrySize = async (): Promise<bigint> =>
  (await token.getPublicState()).Review__reviewers.size();

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenReview: the registry', () => {
  beforeEach(async () => {
    token = await ConfidentialNoteFungibleTokenReviewSimulator.create();
  });

  it('should start with no approved key and an empty trail', async () => {
    const state = await token.getPublicState();

    expect(state.Review__reviewers.isEmpty()).toBe(true);
    expect(state.Review__reviewTrail.length()).toBe(0n);
    expect(state.Review__reviewTrail.head().is_some).toBe(false);
  });

  it('should approve a key', async () => {
    await token._addReviewer(REVIEWER_ONE);

    expect(await isApproved(REVIEWER_ONE)).toBe(true);
    expect(await isApproved(REVIEWER_TWO)).toBe(false);
    expect(await registrySize()).toBe(1n);
  });

  it('should not approve the identity point', async () => {
    await expectRejection(token._addReviewer(IDENTITY), ERR.identityKey);
    expect(await registrySize()).toBe(0n);
  });

  it('should keep one entry when a key is approved twice', async () => {
    await token._addReviewer(REVIEWER_ONE);
    await token._addReviewer(REVIEWER_ONE);

    expect(await registrySize()).toBe(1n);
  });

  it('should withdraw a key approved twice with one removal', async () => {
    await token._addReviewer(REVIEWER_ONE);
    await token._addReviewer(REVIEWER_ONE);
    await token._removeReviewer(REVIEWER_ONE);

    expect(await isApproved(REVIEWER_ONE)).toBe(false);
    expect(await registrySize()).toBe(0n);
  });

  it('should change nothing when an absent key is removed', async () => {
    await token._addReviewer(REVIEWER_ONE);
    await token._removeReviewer(REVIEWER_TWO);
    await token._removeReviewer(REVIEWER_TWO);

    expect(await isApproved(REVIEWER_ONE)).toBe(true);
    expect(await registrySize()).toBe(1n);
  });

  it('should withdraw one key and keep the others', async () => {
    await token._addReviewer(REVIEWER_ONE);
    await token._addReviewer(REVIEWER_TWO);
    await token._removeReviewer(REVIEWER_ONE);

    expect(await isApproved(REVIEWER_ONE)).toBe(false);
    expect(await isApproved(REVIEWER_TWO)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// _review
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenReview: _review', () => {
  beforeEach(async () => {
    token = await ConfidentialNoteFungibleTokenReviewSimulator.create();
    await token._addReviewer(REVIEWER_ONE);
    await token._addReviewer(REVIEWER_TWO);
  });

  it('should split the owner into little-endian limbs and join them back', async () => {
    await token._review(REVIEWER_ONE, OWNER, VALUE, NONCE, SLOT);
    const [record] = await trail();
    const r = review.recoverRecord(record, RS_ONE);

    expect(r).toStrictEqual({
      value: VALUE,
      nonce: NONCE,
      ownerLo: OWNER_LO,
      ownerHi: OWNER_HI,
    });
    expect(review.ownerOf(r.ownerLo, r.ownerHi)).toStrictEqual(OWNER);
  });

  it('should name the reviewer key on the record', async () => {
    await token._review(REVIEWER_TWO, OWNER, VALUE, NONCE, SLOT);
    const [record] = await trail();

    expect(record.reviewerKey).toStrictEqual(REVIEWER_TWO);
    expect(opened(record, RS_TWO)).toStrictEqual({
      value: VALUE,
      nonce: NONCE,
      owner: OWNER,
    });
  });

  it('should open the widest record through head()', async () => {
    await token._review(REVIEWER_ONE, WIDEST_OWNER, U128 - 1n, U248 - 1n, SLOT);
    const state = await token.getPublicState();
    const [record] = [...state.Review__reviewTrail];

    for (const ct of [
      record.valueCt,
      record.nonceCt,
      record.ownerLoCt,
      record.ownerHiCt,
    ]) {
      expect(ct).toBeLessThan(U248);
    }
    expect(record.ownerLoCt).not.toBe(record.ownerHiCt);
    expect(state.Review__reviewTrail.head().value).toStrictEqual(record);
    expect(opened(record, RS_ONE)).toStrictEqual({
      value: U128 - 1n,
      nonce: U248 - 1n,
      owner: WIDEST_OWNER,
    });
  });

  // Each field has its own pad tag: equal plaintexts must not give equal
  // ciphertexts.
  it('should give four fields with one plaintext four distinct ciphertexts', async () => {
    const bytes = new Uint8Array(32);
    bytes[0] = 5;
    bytes[16] = 5;
    await token._review(REVIEWER_ONE, keyArm(bytes), 5n, 5n, SLOT);
    const [record] = await trail();

    expect(review.recoverRecord(record, RS_ONE)).toStrictEqual({
      value: 5n,
      nonce: 5n,
      ownerLo: 5n,
      ownerHi: 5n,
    });
    expect(
      new Set([
        record.valueCt,
        record.nonceCt,
        record.ownerLoCt,
        record.ownerHiCt,
      ]).size,
    ).toBe(4);
  });

  it('should open a zero-value record with a zero nonce to a zero owner', async () => {
    await token._review(REVIEWER_ONE, keyArm(ZERO), 0n, 0n, SLOT);
    const [record] = await trail();

    expect(opened(record, RS_ONE)).toStrictEqual({
      value: 0n,
      nonce: 0n,
      owner: keyArm(ZERO),
    });
  });

  it('should add one record per call, newest first, and leave earlier ones untouched', async () => {
    await token._review(REVIEWER_ONE, OWNER, 1n, 11n, SLOT);
    const [first] = await trail();
    await token._review(REVIEWER_TWO, OTHER_OWNER, 2n, 22n, OTHER_SLOT);

    const records = await trail();
    expect(records).toHaveLength(2);
    expect(records[1]).toStrictEqual(first);
    expect(opened(records[0], RS_TWO)).toStrictEqual({
      value: 2n,
      nonce: 22n,
      owner: OTHER_OWNER,
    });
    expect(opened(records[1], RS_ONE)).toStrictEqual({
      value: 1n,
      nonce: 11n,
      owner: OWNER,
    });
  });

  it('should accept a nonce of 2^248 - 1 and not 2^248', async () => {
    await token._review(REVIEWER_ONE, OWNER, VALUE, U248 - 1n, SLOT);

    await expectRejection(
      token._review(REVIEWER_ONE, OWNER, VALUE, U248, SLOT),
      ERR.nonceWidth,
    );
    expect(await trailLength()).toBe(1n);
  });

  it('should not accept a zero seed', async () => {
    token.wallet.reviewSeed = ZERO;

    await expectRejection(
      token._review(REVIEWER_ONE, OWNER, VALUE, NONCE, SLOT),
      ERR.zeroSeed,
    );
    expect(await trailLength()).toBe(0n);
  });

  it('should not review to a contract owner', async () => {
    await expectRejection(
      token._review(REVIEWER_ONE, CONTRACT_OWNER, VALUE, NONCE, SLOT),
      ERR.contractOwner,
    );
    expect(await trailLength()).toBe(0n);
  });

  it('should not review to a key arm with a non-default inactive arm', async () => {
    await expectRejection(
      token._review(REVIEWER_ONE, NON_CANONICAL_OWNER, VALUE, NONCE, SLOT),
      ERR.nonCanonical,
    );
    expect(await trailLength()).toBe(0n);
  });

  // A contract arm with stray `left` bytes is also non-canonical.
  it('should check the owner kind before canonical form', async () => {
    await expectRejection(
      token._review(
        REVIEWER_ONE,
        { ...CONTRACT_OWNER, left: bytes32('STRAY') },
        VALUE,
        NONCE,
        SLOT,
      ),
      ERR.contractOwner,
    );
  });

  // Fresh seeds: one note reviewed twice gives two unrelated records.
  it('should give two reviews of one note distinct ephemerals', async () => {
    await token._review(REVIEWER_ONE, OWNER, VALUE, NONCE, SLOT);
    await token._review(REVIEWER_ONE, OWNER, VALUE, NONCE, SLOT);
    const [second, first] = await trail();

    expect(second.ephemeralPk).not.toStrictEqual(first.ephemeralPk);
    expect(opened(second, RS_ONE)).toStrictEqual(opened(first, RS_ONE));
  });
});

// ---------------------------------------------------------------------------
// The approval check
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenReview: the approval check', () => {
  beforeEach(async () => {
    token = await ConfidentialNoteFungibleTokenReviewSimulator.create();
  });

  it('should not review to any key on an empty registry', async () => {
    await expectRejection(
      token._review(REVIEWER_ONE, OWNER, VALUE, NONCE, SLOT),
      ERR.notApproved,
    );
    expect(await trailLength()).toBe(0n);
  });

  it.each([
    { label: 'a key never added', key: REVIEWER_THREE },
    { label: 'the identity point', key: IDENTITY },
  ])('should not review to $label', async ({ key }) => {
    await token._addReviewer(REVIEWER_ONE);

    await expectRejection(
      token._review(key, OWNER, VALUE, NONCE, SLOT),
      ERR.notApproved,
    );
    expect(await trailLength()).toBe(0n);
  });

  it('should check approval before the owner', async () => {
    await expectRejection(
      token._review(REVIEWER_THREE, CONTRACT_OWNER, VALUE, NONCE, SLOT),
      ERR.notApproved,
    );
  });

  it('should not review to a removed key and still open its earlier records', async () => {
    await token._addReviewer(REVIEWER_ONE);
    await token._review(REVIEWER_ONE, OWNER, VALUE, NONCE, SLOT);
    await token._removeReviewer(REVIEWER_ONE);

    await expectRejection(
      token._review(REVIEWER_ONE, OWNER, VALUE, NONCE + 1n, SLOT),
      ERR.notApproved,
    );
    const records = await trail();
    expect(records).toHaveLength(1);
    expect(opened(records[0], RS_ONE)).toStrictEqual({
      value: VALUE,
      nonce: NONCE,
      owner: OWNER,
    });
  });

  it('should review to a key approved again after removal', async () => {
    await token._addReviewer(REVIEWER_ONE);
    await token._removeReviewer(REVIEWER_ONE);
    await token._addReviewer(REVIEWER_ONE);

    await token._review(REVIEWER_ONE, OWNER, VALUE, NONCE, SLOT);
    expect(await trailLength()).toBe(1n);
  });
});

// ---------------------------------------------------------------------------
// recoverRecord
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenReview: recoverRecord', () => {
  let record: ReviewRecord;

  beforeEach(async () => {
    token = await ConfidentialNoteFungibleTokenReviewSimulator.create();
    await token._addReviewer(REVIEWER_ONE);
    await token._addReviewer(REVIEWER_TWO);
    await token._review(REVIEWER_ONE, OWNER, VALUE, NONCE, SLOT);
    [record] = await trail();
  });

  it("should return a quadruple the filter drops under another approved reviewer's scalar", () => {
    const wrong = review.recoverRecord(record, RS_TWO);

    expect(passesFilter(wrong)).toBe(false);
    expect(wrong.nonce).not.toBe(NONCE);
  });

  it('should return a quadruple the filter drops under the zero scalar', () => {
    const wrong = review.recoverRecord(record, 0n);

    expect(passesFilter(wrong)).toBe(false);
    expect(wrong.nonce).not.toBe(NONCE);
  });

  it('should reject a scalar of the group order at the API boundary', () => {
    expect(() => review.recoverRecord(record, L)).toThrow(
      'expected value of type JubjubScalar',
    );
  });

  it('should not open a record whose ephemeral is the identity', () => {
    const placeholder = { ...record, ephemeralPk: IDENTITY };

    expect(() => review.recoverRecord(placeholder, RS_ONE)).toThrow(
      ERR.identityEphemeral,
    );
  });

  it('should not check the reviewer key field', () => {
    const relabelled = { ...record, reviewerKey: REVIEWER_TWO };

    expect(review.recoverRecord(relabelled, RS_ONE)).toStrictEqual(
      review.recoverRecord(record, RS_ONE),
    );
  });
});

// ---------------------------------------------------------------------------
// Ephemerals under a reused seed
// ---------------------------------------------------------------------------

/**
 * The ephemeral is `RandPrfExpand.derive(tag, slot, [nonce, key, value,
 * owner])`, so with the seed pinned these five inputs are what separate two
 * records.
 */
describe('ConfidentialNoteFungibleTokenReview: ephemerals under a reused seed', () => {
  beforeEach(async () => {
    token = await ConfidentialNoteFungibleTokenReviewSimulator.create({
      wallet: { reviewSeed: FIXED_SEED },
    });
    await token._addReviewer(REVIEWER_ONE);
    await token._addReviewer(REVIEWER_TWO);
  });

  it('should repeat the record when every input repeats', async () => {
    await token._review(REVIEWER_ONE, OWNER, VALUE, NONCE, SLOT);
    await token._review(REVIEWER_ONE, OWNER, VALUE, NONCE, SLOT);
    const [second, first] = await trail();

    expect(second).toStrictEqual(first);
  });

  it.each([
    {
      input: 'slot',
      key: REVIEWER_ONE,
      owner: OWNER,
      value: VALUE,
      nonce: NONCE,
      slot: OTHER_SLOT,
    },
    {
      input: 'nonce',
      key: REVIEWER_ONE,
      owner: OWNER,
      value: VALUE,
      nonce: NONCE + 1n,
      slot: SLOT,
    },
    {
      input: 'reviewer key',
      key: REVIEWER_TWO,
      owner: OWNER,
      value: VALUE,
      nonce: NONCE,
      slot: SLOT,
    },
    {
      input: 'value',
      key: REVIEWER_ONE,
      owner: OWNER,
      value: VALUE + 1n,
      nonce: NONCE,
      slot: SLOT,
    },
    {
      input: 'owner',
      key: REVIEWER_ONE,
      owner: OTHER_OWNER,
      value: VALUE,
      nonce: NONCE,
      slot: SLOT,
    },
  ])(
    'should move the ephemeral when only the $input differs',
    async ({ key, owner, value, nonce, slot }) => {
      await token._review(REVIEWER_ONE, OWNER, VALUE, NONCE, SLOT);
      await token._review(key, owner, value, nonce, slot);
      const [second, first] = await trail();

      expect(second.ephemeralPk).not.toStrictEqual(first.ephemeralPk);
      expect(
        opened(second, key === REVIEWER_ONE ? RS_ONE : RS_TWO),
      ).toStrictEqual({ value, nonce, owner });
    },
  );

  it('should give one note to two reviewers unrelated records', async () => {
    await token._review(REVIEWER_ONE, OWNER, VALUE, NONCE, SLOT);
    await token._review(REVIEWER_TWO, OWNER, VALUE, NONCE, SLOT);
    const [toTwo, toOne] = await trail();

    expect(toTwo.ephemeralPk).not.toStrictEqual(toOne.ephemeralPk);
    expect(toTwo.valueCt).not.toBe(toOne.valueCt);
    expect(toTwo.nonceCt).not.toBe(toOne.nonceCt);
    expect(passesFilter(review.recoverRecord(toOne, RS_TWO))).toBe(false);
    expect(passesFilter(review.recoverRecord(toTwo, RS_ONE))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Composed with the core
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenReview: composed with the core', () => {
  const ALICE_SK = bytes32('ALICE');
  const BOB_SK = bytes32('BOB');
  const ALICE = reviewed.deriveIdentifier(ALICE_SK, NOTE_SALT);
  const BOB = reviewed.deriveIdentifier(BOB_SK, NOTE_SALT);

  let composed: ConfidentialNoteFungibleTokenReviewedSimulator;

  type Found = { note: Note; owner: Identifier };

  /**
   * The reviewer's scan: keeps the records addressed to its key that open to a
   * committed leaf, newest first.
   */
  const scan = async (
    key: ReturnType<typeof ecMulGenerator>,
    scalar: bigint,
  ): Promise<Found[]> => {
    const state = await composed.getPublicState();
    const found: Found[] = [];
    for (const record of state.Review__reviewTrail) {
      if (record.reviewerKey.x !== key.x || record.reviewerKey.y !== key.y) {
        continue;
      }
      const r = reviewed.recoverRecord(record, scalar);
      if (!passesFilter(r)) continue;
      const note = { value: r.value, nonce: r.nonce };
      const owner = reviewed.ownerOf(r.ownerLo, r.ownerHi);
      const leaf = reviewed.commitOf(note, owner);
      if (state.Core__commitments.findPathForLeaf(leaf) === undefined) continue;
      found.push({ note, owner });
    }
    return found;
  };

  /** Records any scalar opens to a leaf, whatever key they name. */
  const leavesOpenedBy = async (scalar: bigint): Promise<number> => {
    const state = await composed.getPublicState();
    let count = 0;
    for (const record of state.Review__reviewTrail) {
      const r = reviewed.recoverRecord(record, scalar);
      if (!passesFilter(r)) continue;
      const leaf = reviewed.commitOf(
        { value: r.value, nonce: r.nonce },
        reviewed.ownerOf(r.ownerLo, r.ownerHi),
      );
      if (state.Core__commitments.findPathForLeaf(leaf) !== undefined) count++;
    }
    return count;
  };

  /** Every cell the composition publishes, in a form `toStrictEqual` compares. */
  const cells = async () => {
    const state = await composed.getPublicState();
    return {
      commitments: state.Core__commitments.firstFree(),
      nullifiers: state.Core__nullifiers.size(),
      issuedNonces: state.Core__issuedNonces.size(),
      reviewers: state.Review__reviewers.size(),
      records: state.Review__reviewTrail.length(),
    };
  };

  const actAs = (sk: Uint8Array): void => {
    composed.wallet.secretKey = sk;
  };

  beforeEach(async () => {
    composed = await ConfidentialNoteFungibleTokenReviewedSimulator.create();
    await composed._addReviewer(REVIEWER_ONE);
    await composed._addReviewer(REVIEWER_TWO);
  });

  it('should review a mint to the named reviewer', async () => {
    const note = await composed.mint(ALICE, 100n, REVIEWER_ONE);

    expect((await cells()).records).toBe(1n);
    expect(await scan(REVIEWER_ONE, RS_ONE)).toStrictEqual([
      { note, owner: ALICE },
    ]);
    expect(await leavesOpenedBy(RS_TWO)).toBe(0);
  });

  it('should review both outputs of a transfer, the change to the spender', async () => {
    const note = await composed.mint(ALICE, 100n, REVIEWER_ONE);
    actAs(ALICE_SK);
    const [out, change] = await composed.transfer(
      BOB,
      30n,
      note,
      await composed.pathOf(note, ALICE),
      REVIEWER_TWO,
    );

    expect((await cells()).records).toBe(3n);
    expect(await scan(REVIEWER_TWO, RS_TWO)).toStrictEqual([
      { note: change, owner: ALICE },
      { note: out, owner: BOB },
    ]);
    expect(await scan(REVIEWER_ONE, RS_ONE)).toStrictEqual([
      { note, owner: ALICE },
    ]);
  });

  it('should review a zero change when the whole note is sent', async () => {
    const note = await composed.mint(ALICE, 100n, REVIEWER_ONE);
    actAs(ALICE_SK);
    const [, change] = await composed.transfer(
      BOB,
      100n,
      note,
      await composed.pathOf(note, ALICE),
      REVIEWER_ONE,
    );

    expect(change.value).toBe(0n);
    expect((await cells()).records).toBe(3n);
    expect((await scan(REVIEWER_ONE, RS_ONE))[0]).toStrictEqual({
      note: change,
      owner: ALICE,
    });
  });

  it('should review the zero change of a full burn', async () => {
    const note = await composed.mint(ALICE, 100n, REVIEWER_ONE);
    actAs(ALICE_SK);
    const change = await composed.burn(
      100n,
      note,
      await composed.pathOf(note, ALICE),
      REVIEWER_TWO,
    );

    expect(change.value).toBe(0n);
    expect((await cells()).records).toBe(2n);
    expect(await scan(REVIEWER_TWO, RS_TWO)).toStrictEqual([
      { note: change, owner: ALICE },
    ]);
  });

  it('should add one record per output: mint 1, transfer 2, burn 1', async () => {
    const note = await composed.mint(ALICE, 100n, REVIEWER_ONE);
    expect((await cells()).records).toBe(1n);

    actAs(ALICE_SK);
    const [out] = await composed.transfer(
      BOB,
      30n,
      note,
      await composed.pathOf(note, ALICE),
      REVIEWER_ONE,
    );
    expect((await cells()).records).toBe(3n);

    actAs(BOB_SK);
    await composed.burn(
      10n,
      out,
      await composed.pathOf(out, BOB),
      REVIEWER_ONE,
    );
    expect((await cells()).records).toBe(4n);
  });

  it("should let the reviewer find every output it reviewed and the holder's spent status", async () => {
    const note = await composed.mint(ALICE, 100n, REVIEWER_ONE);
    actAs(ALICE_SK);
    await composed.transfer(
      BOB,
      30n,
      note,
      await composed.pathOf(note, ALICE),
      REVIEWER_ONE,
    );
    const state = await composed.getPublicState();

    const found = await scan(REVIEWER_ONE, RS_ONE);
    expect(found).toHaveLength(3);
    expect(
      found.map(({ note: n }) =>
        state.Core__nullifiers.member(reviewed.nullifierOf(n)),
      ),
    ).toStrictEqual([false, false, true]);
  });

  it('should find no commitment path for a note never minted', async () => {
    await expect(
      composed.pathOf({ value: 1n, nonce: 1n }, ALICE),
    ).rejects.toThrow('pathOf: commitment not found in tree');
  });

  // The pads are malleable: a shifted ciphertext opens to a shifted plaintext
  // that passes the range filter. The commitment lookup drops it.
  it('should drop a tampered record at the commitment check', async () => {
    const note = await composed.mint(ALICE, 100n, REVIEWER_ONE);
    const state = await composed.getPublicState();
    const [record] = [...state.Review__reviewTrail];
    const isLeaf = (r: ReturnType<typeof reviewed.recoverRecord>): boolean =>
      state.Core__commitments.findPathForLeaf(
        reviewed.commitOf(
          { value: r.value, nonce: r.nonce },
          reviewed.ownerOf(r.ownerLo, r.ownerHi),
        ),
      ) !== undefined;
    const shifted = (ct: bigint): bigint => (ct + 1n) % U248;
    const genuine = reviewed.recoverRecord(record, RS_ONE);

    expect(isLeaf(genuine)).toBe(true);

    const value = reviewed.recoverRecord(
      { ...record, valueCt: shifted(record.valueCt) },
      RS_ONE,
    );
    expect(passesFilter(value)).toBe(true);
    expect(value.value).toBe(note.value + 1n);
    expect(isLeaf(value)).toBe(false);

    const owner = reviewed.recoverRecord(
      { ...record, ownerLoCt: shifted(record.ownerLoCt) },
      RS_ONE,
    );
    expect(passesFilter(owner)).toBe(true);
    expect(owner.ownerLo).toBe(genuine.ownerLo + 1n);
    expect(isLeaf(owner)).toBe(false);

    const ephemeral = reviewed.recoverRecord(
      { ...record, ephemeralPk: ecMulGenerator(42n) },
      RS_ONE,
    );
    expect(passesFilter(ephemeral)).toBe(false);
  });

  describe('a call naming an unapproved key', () => {
    let note: Note;

    beforeEach(async () => {
      note = await composed.mint(ALICE, 100n, REVIEWER_ONE);
      actAs(ALICE_SK);
    });

    it('should not mint', async () => {
      const before = await cells();

      await expectRejection(
        composed.mint(BOB, 10n, REVIEWER_THREE),
        ERR.notApproved,
      );
      expect(await cells()).toStrictEqual(before);
    });

    it('should not transfer', async () => {
      const path = await composed.pathOf(note, ALICE);
      const before = await cells();

      await expectRejection(
        composed.transfer(BOB, 30n, note, path, REVIEWER_THREE),
        ERR.notApproved,
      );
      expect(await cells()).toStrictEqual(before);
    });

    it('should not burn', async () => {
      const path = await composed.pathOf(note, ALICE);
      const before = await cells();

      await expectRejection(
        composed.burn(30n, note, path, REVIEWER_THREE),
        ERR.notApproved,
      );
      expect(await cells()).toStrictEqual(before);
    });

    it('should not spend with a key removed since the note was minted', async () => {
      await composed._removeReviewer(REVIEWER_ONE);
      const path = await composed.pathOf(note, ALICE);
      const before = await cells();

      await expectRejection(
        composed.transfer(BOB, 30n, note, path, REVIEWER_ONE),
        ERR.notApproved,
      );
      expect(await cells()).toStrictEqual(before);
      expect(await scan(REVIEWER_ONE, RS_ONE)).toStrictEqual([
        { note, owner: ALICE },
      ]);
    });
  });

  describe('a recipient the review cannot record', () => {
    it.each([
      {
        label: 'a contract recipient',
        recipient: CONTRACT_OWNER,
        err: ERR.contractOwner,
      },
      {
        label: 'a non-canonical recipient',
        recipient: NON_CANONICAL_OWNER,
        err: ERR.nonCanonical,
      },
    ])('should not mint to $label', async ({ recipient, err }) => {
      const before = await cells();

      await expectRejection(composed.mint(recipient, 10n, REVIEWER_ONE), err);
      expect(await cells()).toStrictEqual(before);
    });

    it.each([
      {
        label: 'a contract recipient',
        recipient: CONTRACT_OWNER,
        err: ERR.contractOwner,
      },
      {
        label: 'a non-canonical recipient',
        recipient: NON_CANONICAL_OWNER,
        err: ERR.nonCanonical,
      },
    ])('should not transfer to $label', async ({ recipient, err }) => {
      const note = await composed.mint(ALICE, 100n, REVIEWER_ONE);
      actAs(ALICE_SK);
      const path = await composed.pathOf(note, ALICE);
      const before = await cells();

      await expectRejection(
        composed.transfer(recipient, 30n, note, path, REVIEWER_ONE),
        err,
      );
      expect(await cells()).toStrictEqual(before);
    });
  });
});

// ---------------------------------------------------------------------------
// Fallback witnesses
// ---------------------------------------------------------------------------

// `_create` skips `create`'s wiring, so the factory's fallback wallet answers
// the seed witness with a fresh random seed.
describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenReview: fallback witnesses',
  () => {
    it('should review through the fallback witnesses in the standalone mock', async () => {
      const bare = await ConfidentialNoteFungibleTokenReviewSimulator._create(
        [],
      );
      await bare.circuits.impure._addReviewer(REVIEWER_ONE);
      await bare.circuits.impure._review(
        REVIEWER_ONE,
        OWNER,
        VALUE,
        NONCE,
        SLOT,
      );
      const [record] = [...(await bare.getPublicState()).Review__reviewTrail];

      expect(review.recoverRecord(record, RS_ONE)).toStrictEqual({
        value: VALUE,
        nonce: NONCE,
        ownerLo: OWNER_LO,
        ownerHi: OWNER_HI,
      });
    });

    it('should review through the fallback witnesses in the composed mock', async () => {
      const bare = await ConfidentialNoteFungibleTokenReviewedSimulator._create(
        [NOTE_SALT],
      );
      await bare.circuits.impure._addReviewer(REVIEWER_ONE);
      const note = await bare.circuits.impure.mint(OWNER, 10n, REVIEWER_ONE);
      const [record] = [...(await bare.getPublicState()).Review__reviewTrail];

      expect(reviewed.recoverRecord(record, RS_ONE)).toStrictEqual({
        ...note,
        ownerLo: OWNER_LO,
        ownerHi: OWNER_HI,
      });
    });
  },
);
