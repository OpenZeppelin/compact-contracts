import { ecMulGenerator } from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { expectRejection } from '#test-utils/assertions/rejection.js';
import { pureCircuits as composed } from '../../../../artifacts/MockConfidentialNoteFungibleTokenDelivered/contract/index.js';
import { pureCircuits as delivery } from '../../../../artifacts/MockConfidentialNoteFungibleTokenDelivery/contract/index.js';
import { ConfidentialNoteFungibleTokenDeliveredSimulator } from '../simulators/ConfidentialNoteFungibleTokenDeliveredSimulator.js';
import {
  ConfidentialNoteFungibleTokenDeliverySimulator,
  type Delivery,
} from '../simulators/ConfidentialNoteFungibleTokenDeliverySimulator.js';
import {
  createNoteWallet,
  INSTANCE_SALT,
  type Note,
} from '../witnesses/ConfidentialNoteFungibleTokenWitnesses.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic 32 bytes from a label. */
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

// Recipient scalars and the keys they derive, `encPk = g^ek`.
const EK_ALICE = 111222333444555n;
const EK_BOB = 999888777666555n;
const ENC_ALICE = ecMulGenerator(EK_ALICE);
const ENC_BOB = ecMulGenerator(EK_BOB);

const SLOT = bytes32('spec:out');
const OTHER_SLOT = bytes32('spec:change');
const FIXED_SEED = bytes32('FIXED-DELIVERY-SEED');

const NOTE: Note = { value: 100n, nonce: 7n };

let token: ConfidentialNoteFungibleTokenDeliverySimulator;

/** The feed, newest first. */
const entries = async (): Promise<Delivery[]> => [
  ...(await token.getPublicState()).Delivery__deliveries,
];

const feedLength = async (): Promise<bigint> =>
  (await token.getPublicState()).Delivery__deliveries.length();

/** `recoverNote` as a wallet reads it: a plain note, nothing checked. */
const opened = (entry: Delivery, ek: bigint): Note => {
  const { value, nonce } = delivery.recoverNote(entry, ek);
  return { value, nonce };
};

// ---------------------------------------------------------------------------
// _deliver
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenDelivery: _deliver', () => {
  beforeEach(async () => {
    token = await ConfidentialNoteFungibleTokenDeliverySimulator.create();
  });

  it('should start with an empty feed', async () => {
    const state = await token.getPublicState();
    expect(state.Delivery__deliveries.length()).toBe(0n);
    expect(state.Delivery__deliveries.head().is_some).toBe(false);
  });

  it('should add one entry per call, newest first', async () => {
    await token._deliver(ENC_ALICE, 1n, 11n, SLOT);
    await token._deliver(ENC_ALICE, 2n, 22n, SLOT);

    const feed = await entries();
    expect(await feedLength()).toBe(2n);
    expect(opened(feed[0], EK_ALICE)).toStrictEqual({ value: 2n, nonce: 22n });
    expect(opened(feed[1], EK_ALICE)).toStrictEqual({ value: 1n, nonce: 11n });

    const head = (await token.getPublicState()).Delivery__deliveries.head();
    expect(head.is_some).toBe(true);
    expect(head.value).toStrictEqual(feed[0]);
  });

  it('should leave earlier entries untouched', async () => {
    await token._deliver(ENC_ALICE, NOTE.value, NOTE.nonce, SLOT);
    const [first] = await entries();
    await token._deliver(ENC_BOB, 5n, 55n, OTHER_SLOT);

    expect((await entries())[1]).toStrictEqual(first);
  });

  it('should open to the note under the owner scalar', async () => {
    await token._deliver(ENC_ALICE, NOTE.value, NOTE.nonce, SLOT);
    const [entry] = await entries();

    expect(opened(entry, EK_ALICE)).toStrictEqual(NOTE);
  });

  // The widest inputs force the wrap arm of the pad and the borrow arm of its
  // inverse: a nonce of 2^248 - 1 wraps under every non-zero mask. `head()`
  // is the accessor a wider ciphertext atom breaks.
  it('should open the widest note through head() with both ciphertexts below 2^248', async () => {
    await token._deliver(ENC_ALICE, U128 - 1n, U248 - 1n, SLOT);
    const state = await token.getPublicState();
    const [entry] = [...state.Delivery__deliveries];

    expect(entry.valueCt).toBeLessThan(U248);
    expect(entry.nonceCt).toBeLessThan(U248);
    expect(state.Delivery__deliveries.head().value).toStrictEqual(entry);
    expect(opened(entry, EK_ALICE)).toStrictEqual({
      value: U128 - 1n,
      nonce: U248 - 1n,
    });
  });

  it('should open a zero-value note with a zero nonce', async () => {
    await token._deliver(ENC_ALICE, 0n, 0n, SLOT);
    const [entry] = await entries();

    expect(opened(entry, EK_ALICE)).toStrictEqual({ value: 0n, nonce: 0n });
  });

  it('should not accept a nonce of 2^248', async () => {
    await expectRejection(
      token._deliver(ENC_ALICE, 1n, U248, SLOT),
      'cast from Field or Uint value to smaller Uint value failed',
    );
    expect(await feedLength()).toBe(0n);
  });

  it('should not accept the identity point as the key', async () => {
    await expectRejection(
      token._deliver(ecMulGenerator(0n), 1n, 1n, SLOT),
      'Ecdh: identity pk',
    );
    expect(await feedLength()).toBe(0n);
  });

  // Fresh seeds: the same note twice is two unrelated entries that open to one
  // note. A second delivery creates nothing and invalidates nothing.
  it('should give two deliveries of one note distinct ephemerals', async () => {
    await token._deliver(ENC_ALICE, NOTE.value, NOTE.nonce, SLOT);
    await token._deliver(ENC_ALICE, NOTE.value, NOTE.nonce, SLOT);
    const [second, first] = await entries();

    expect(second.ephemeralPk).not.toStrictEqual(first.ephemeralPk);
    expect(second.valueCt).not.toBe(first.valueCt);
    expect(second.nonceCt).not.toBe(first.nonceCt);
    expect(opened(first, EK_ALICE)).toStrictEqual(NOTE);
    expect(opened(second, EK_ALICE)).toStrictEqual(NOTE);
  });
});

// ---------------------------------------------------------------------------
// recoverNote
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenDelivery: recoverNote', () => {
  let entry: Delivery;

  beforeEach(async () => {
    token = await ConfidentialNoteFungibleTokenDeliverySimulator.create();
    await token._deliver(ENC_ALICE, NOTE.value, NOTE.nonce, SLOT);
    [entry] = await entries();
  });

  it('should return a pair the wallet filter drops under another scalar', () => {
    const wrong = delivery.recoverNote(entry, EK_BOB);

    expect(wrong.value).toBeGreaterThanOrEqual(U128);
    expect(wrong.nonce).not.toBe(NOTE.nonce);
  });

  // The shared point collapses to the identity; the circuit still returns and
  // the wallet filter still drops the pair.
  it('should return under the zero scalar', () => {
    const wrong = delivery.recoverNote(entry, 0n);

    expect(wrong.value).toBeGreaterThanOrEqual(U128);
    expect(wrong.nonce).not.toBe(NOTE.nonce);
  });

  it('should reject a scalar of the group order at the API boundary', () => {
    expect(() => delivery.recoverNote(entry, L)).toThrow(
      'expected value of type JubjubScalar',
    );
  });

  it('should not open an entry whose ephemeral is the identity', () => {
    const placeholder = { ...entry, ephemeralPk: ecMulGenerator(0n) };

    expect(() => delivery.recoverNote(placeholder, EK_ALICE)).toThrow(
      'ConfidentialNoteFungibleTokenDelivery: identity ephemeral',
    );
  });
});

// ---------------------------------------------------------------------------
// Pads under a reused seed
// ---------------------------------------------------------------------------

/**
 * The ephemeral is `Hf(seed, tag, slot, nonce, encPk)`, so with the seed
 * pinned the nonce, the slot and the key are the inputs left to separate two
 * entries.
 */
describe('ConfidentialNoteFungibleTokenDelivery: pads under a reused seed', () => {
  beforeEach(async () => {
    token = await ConfidentialNoteFungibleTokenDeliverySimulator.create({
      wallet: { deliverySeed: FIXED_SEED },
    });
  });

  it('should repeat the entry when every input repeats', async () => {
    await token._deliver(ENC_ALICE, NOTE.value, NOTE.nonce, SLOT);
    await token._deliver(ENC_ALICE, NOTE.value, NOTE.nonce, SLOT);
    const [second, first] = await entries();

    expect(second).toStrictEqual(first);
  });

  it('should move the ephemeral when only the nonce differs', async () => {
    await token._deliver(ENC_ALICE, NOTE.value, NOTE.nonce, SLOT);
    await token._deliver(ENC_ALICE, NOTE.value, NOTE.nonce + 1n, SLOT);
    const [second, first] = await entries();

    expect(second.ephemeralPk).not.toStrictEqual(first.ephemeralPk);
    expect(opened(first, EK_ALICE)).toStrictEqual(NOTE);
    expect(opened(second, EK_ALICE)).toStrictEqual({
      value: NOTE.value,
      nonce: NOTE.nonce + 1n,
    });
  });

  it('should move the ephemeral when only the slot differs', async () => {
    await token._deliver(ENC_ALICE, NOTE.value, NOTE.nonce, SLOT);
    await token._deliver(ENC_ALICE, NOTE.value, NOTE.nonce, OTHER_SLOT);
    const [second, first] = await entries();

    expect(second.ephemeralPk).not.toStrictEqual(first.ephemeralPk);
    expect(opened(second, EK_ALICE)).toStrictEqual(NOTE);
  });

  // One note to two keys under one slot: nothing links the two entries.
  it('should move the ephemeral when only the key differs', async () => {
    await token._deliver(ENC_ALICE, NOTE.value, NOTE.nonce, SLOT);
    await token._deliver(ENC_BOB, NOTE.value, NOTE.nonce, SLOT);
    const [toBob, toAlice] = await entries();

    expect(toBob.ephemeralPk).not.toStrictEqual(toAlice.ephemeralPk);
    expect(toBob.valueCt).not.toBe(toAlice.valueCt);
    expect(toBob.nonceCt).not.toBe(toAlice.nonceCt);
    expect(opened(toAlice, EK_ALICE)).toStrictEqual(NOTE);
    expect(opened(toBob, EK_BOB)).toStrictEqual(NOTE);
  });
});

// ---------------------------------------------------------------------------
// Composed with the core
// ---------------------------------------------------------------------------

/**
 * The composed mock returns nothing from its circuits: every spec below learns
 * what was created the way a wallet does, by opening `Delivery__deliveries`
 * and keeping the pairs whose commitment is a leaf.
 */
describe('ConfidentialNoteFungibleTokenDelivery: composed with the core', () => {
  const ALICE_SK = bytes32('ALICE');
  const BOB_SK = bytes32('BOB');
  const ALICE = composed.derivePk(ALICE_SK, INSTANCE_SALT);
  const BOB = composed.derivePk(BOB_SK, INSTANCE_SALT);
  const CTOR_VALUE = 1000n;

  type Found = Note & { spent: boolean };

  let delivered: ConfidentialNoteFungibleTokenDeliveredSimulator;

  /** The wallet filter: opens under `ek`, keeps what is committed to `pk`. */
  const scan = async (ek: bigint, pk: bigint): Promise<Found[]> => {
    const state = await delivered.getPublicState();
    const found: Found[] = [];
    for (const entry of state.Delivery__deliveries) {
      const { value, nonce } = composed.recoverNote(entry, ek);
      if (value >= U128) continue;
      const note = { value, nonce };
      const leaf = composed.commitOf(note, pk);
      if (state.Core__commitments.findPathForLeaf(leaf) === undefined) continue;
      found.push({
        ...note,
        spent: state.Core__nullifiers.member(composed.nullifierOf(note)),
      });
    }
    return found;
  };

  const values = (found: Found[]): [bigint, boolean][] =>
    found.map((note) => [note.value, note.spent]);

  /** The newest unspent note in a scan. */
  const unspent = (found: Found[]): Note => {
    const note = found.find((candidate) => !candidate.spent);
    if (note === undefined) {
      throw new Error('scan found no unspent note');
    }
    return { value: note.value, nonce: note.nonce };
  };

  const spendAs = (sk: Uint8Array, note: Note): void => {
    delivered.wallet.secretKey = sk;
    delivered.wallet.inputNote = note;
    delivered.wallet.pathOverride = undefined;
  };

  const deliveries = async (): Promise<bigint> =>
    (await delivered.getPublicState()).Delivery__deliveries.length();

  /** A deployment whose core and delivery seeds are both planted. */
  const deployReusingSeeds = () =>
    ConfidentialNoteFungibleTokenDeliveredSimulator.create({
      ownerPk: ALICE,
      ownerEncPk: ENC_ALICE,
      value: CTOR_VALUE,
      wallet: { ...createNoteWallet(), nonceSeed: FIXED_SEED },
      deliveryWallet: { deliverySeed: FIXED_SEED },
    });

  beforeEach(async () => {
    delivered = await ConfidentialNoteFungibleTokenDeliveredSimulator.create({
      ownerPk: ALICE,
      ownerEncPk: ENC_ALICE,
      value: CTOR_VALUE,
    });
  });

  it('should deliver the constructor note to its owner alone', async () => {
    expect(await deliveries()).toBe(1n);
    expect(values(await scan(EK_ALICE, ALICE))).toStrictEqual([
      [CTOR_VALUE, false],
    ]);
    expect(await scan(EK_BOB, BOB)).toStrictEqual([]);
  });

  it('should deliver the output to the recipient and the change to the sender', async () => {
    spendAs(ALICE_SK, unspent(await scan(EK_ALICE, ALICE)));
    await delivered.transfer(BOB, ENC_BOB, ENC_ALICE, 300n);

    expect(await deliveries()).toBe(3n);
    expect(values(await scan(EK_ALICE, ALICE))).toStrictEqual([
      [700n, false],
      [CTOR_VALUE, true],
    ]);
    expect(values(await scan(EK_BOB, BOB))).toStrictEqual([[300n, false]]);
  });

  it('should deliver a zero change note when the whole note is sent', async () => {
    spendAs(ALICE_SK, unspent(await scan(EK_ALICE, ALICE)));
    await delivered.transfer(BOB, ENC_BOB, ENC_ALICE, CTOR_VALUE);

    expect(await deliveries()).toBe(3n);
    expect(values(await scan(EK_ALICE, ALICE))).toStrictEqual([
      [0n, false],
      [CTOR_VALUE, true],
    ]);
  });

  it('should deliver a zero change note when the whole note is burned', async () => {
    spendAs(ALICE_SK, unspent(await scan(EK_ALICE, ALICE)));
    await delivered.burn(ENC_ALICE, CTOR_VALUE);

    expect(await deliveries()).toBe(2n);
    expect(values(await scan(EK_ALICE, ALICE))).toStrictEqual([
      [0n, false],
      [CTOR_VALUE, true],
    ]);
  });

  it('should let the recipient spend the note it scanned', async () => {
    spendAs(ALICE_SK, unspent(await scan(EK_ALICE, ALICE)));
    await delivered.transfer(BOB, ENC_BOB, ENC_ALICE, 300n);

    spendAs(BOB_SK, unspent(await scan(EK_BOB, BOB)));
    await delivered.burn(ENC_BOB, 300n);

    expect(values(await scan(EK_BOB, BOB))).toStrictEqual([
      [0n, false],
      [300n, true],
    ]);
  });

  it('should add one entry per output', async () => {
    await delivered.mint(BOB, ENC_BOB, 10n);
    expect(await deliveries()).toBe(2n);

    spendAs(ALICE_SK, unspent(await scan(EK_ALICE, ALICE)));
    await delivered.transfer(BOB, ENC_BOB, ENC_ALICE, 300n);
    expect(await deliveries()).toBe(4n);

    spendAs(BOB_SK, unspent(await scan(EK_BOB, BOB)));
    await delivered.burn(ENC_BOB, 300n);
    expect(await deliveries()).toBe(5n);
  });

  it('should deliver both outputs of a self-transfer to the sender', async () => {
    spendAs(ALICE_SK, unspent(await scan(EK_ALICE, ALICE)));
    await delivered.transfer(ALICE, ENC_ALICE, ENC_ALICE, 300n);

    expect(await deliveries()).toBe(3n);
    expect(values(await scan(EK_ALICE, ALICE))).toStrictEqual([
      [700n, false],
      [300n, false],
      [CTOR_VALUE, true],
    ]);
    expect(await scan(EK_BOB, BOB)).toStrictEqual([]);

    const [, out] = await scan(EK_ALICE, ALICE);
    spendAs(ALICE_SK, { value: out.value, nonce: out.nonce });
    await delivered.burn(ENC_ALICE, 300n);

    expect(values(await scan(EK_ALICE, ALICE))).toStrictEqual([
      [0n, false],
      [700n, false],
      [300n, true],
      [CTOR_VALUE, true],
    ]);
  });

  // The output nonces bind the spent nullifier and the mint recipient, so a
  // reused seed still gives every entry its own ephemeral.
  it('should keep every ephemeral distinct under a reused seed', async () => {
    delivered = await deployReusingSeeds();
    spendAs(ALICE_SK, unspent(await scan(EK_ALICE, ALICE)));
    await delivered.transfer(BOB, ENC_BOB, ENC_ALICE, 300n);
    spendAs(ALICE_SK, unspent(await scan(EK_ALICE, ALICE)));
    await delivered.transfer(BOB, ENC_BOB, ENC_ALICE, 200n);

    const feed = [...(await delivered.getPublicState()).Delivery__deliveries];
    const ephemerals = new Set(
      feed.map(({ ephemeralPk }) => `${ephemeralPk.x}:${ephemeralPk.y}`),
    );
    expect(feed).toHaveLength(5);
    expect(ephemerals.size).toBe(5);
    expect(values(await scan(EK_ALICE, ALICE))).toStrictEqual([
      [500n, false],
      [700n, true],
      [CTOR_VALUE, true],
    ]);
    expect(values(await scan(EK_BOB, BOB))).toStrictEqual([
      [200n, false],
      [300n, false],
    ]);
  });

  // The core refuses the repeated nonce before anything is written, so two
  // committed notes never share a pad.
  it('should not pad a second note when a reused seed repeats a mint', async () => {
    delivered = await deployReusingSeeds();
    await delivered.mint(BOB, ENC_BOB, 10n);

    await expectRejection(
      delivered.mint(BOB, ENC_BOB, 20n),
      'ConfidentialNoteFungibleToken: nonce already issued',
    );
    expect(await deliveries()).toBe(2n);
    expect(values(await scan(EK_BOB, BOB))).toStrictEqual([[10n, false]]);
  });

  // The pairing of `pk` and `encPk` is the composer's. A note committed to one
  // identity and encrypted to another's key is lost to both, and the key
  // holder who opens it still cannot spend it.
  it('should make a note sent to the wrong key undiscoverable, not stealable', async () => {
    await delivered.mint(ALICE, ENC_BOB, 50n);
    const state = await delivered.getPublicState();
    const [entry] = [...state.Delivery__deliveries];
    const { value, nonce } = composed.recoverNote(entry, EK_BOB);
    const note = { value, nonce };

    expect(value).toBe(50n);
    expect(
      state.Core__commitments.findPathForLeaf(composed.commitOf(note, ALICE)),
    ).toBeDefined();
    expect(
      state.Core__commitments.findPathForLeaf(composed.commitOf(note, BOB)),
    ).toBeUndefined();
    expect(await scan(EK_BOB, BOB)).toStrictEqual([]);
    expect(values(await scan(EK_ALICE, ALICE))).toStrictEqual([
      [CTOR_VALUE, false],
    ]);

    spendAs(BOB_SK, note);
    await expectRejection(
      delivered.burn(ENC_BOB, 50n),
      'commitment not found in tree',
    );
  });

  // The planted path is the leaf's real one, so the witness answers and the
  // refusal is the circuit's own leaf check.
  it('should not let the key holder spend a wrong-key note even with its real leaf path', async () => {
    await delivered.mint(ALICE, ENC_BOB, 50n);
    const state = await delivered.getPublicState();
    const [entry] = [...state.Delivery__deliveries];
    const { value, nonce } = composed.recoverNote(entry, EK_BOB);
    const note = { value, nonce };

    spendAs(BOB_SK, note);
    delivered.wallet.pathOverride = state.Core__commitments.findPathForLeaf(
      composed.commitOf(note, ALICE),
    );
    await expectRejection(
      delivered.burn(ENC_BOB, 50n),
      'ConfidentialNoteFungibleToken: path does not match input commitment',
    );
  });
});
