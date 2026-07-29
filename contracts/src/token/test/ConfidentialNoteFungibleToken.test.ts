import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import { expectRejection } from '#test-utils/assertions/rejection.js';
import { pureCircuits as core } from '../../../artifacts/MockConfidentialNoteFungibleToken/contract/index.js';
import { ConfidentialNoteFungibleTokenSimulator } from './simulators/ConfidentialNoteFungibleTokenSimulator.js';
import type { Note } from './witnesses/ConfidentialNoteFungibleTokenWitnesses.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A deterministic 32-byte secret key from a label. */
const secretKey = (label: string): Uint8Array => {
  const sk = new Uint8Array(32);
  sk.set(new TextEncoder().encode(label));
  return sk;
};

const ALICE_SK = secretKey('ALICE');
const BOB_SK = secretKey('BOB');
const CAROL_SK = secretKey('CAROL');

// `pk = Hf(sk)`, computed off-circuit through the module's own pure circuit —
// the same derivation a wallet or auditor would run.
const ALICE = core.derivePk(ALICE_SK);
const BOB = core.derivePk(BOB_SK);
const CAROL = core.derivePk(CAROL_SK);

const FIXED_SEED = secretKey('FIXED-NONCE-SEED');

let token: ConfidentialNoteFungibleTokenSimulator;

/** Points the next spend at `note`, spending as the owner of `sk`. */
const spendAs = (sk: Uint8Array, note: Note): void => {
  token.wallet.secretKey = sk;
  token.wallet.inputNote = note;
  token.wallet.pathOverride = undefined;
};

const publicState = () => token.getPublicState();

/** Is `note` committed to `ownerPk` in the tree? */
const isCommitted = async (note: Note, ownerPk: bigint): Promise<boolean> =>
  (await publicState()).Core__commitments.findPathForLeaf(
    core.commitOf(note, ownerPk),
  ) !== undefined;

/** Has `note` been spent (is its nullifier published)? */
const isSpent = async (note: Note): Promise<boolean> =>
  (await publicState()).Core__nullifiers.member(core.nullifierOf(note));

/** Number of leaves inserted so far. */
const commitmentCount = async (): Promise<bigint> =>
  (await publicState()).Core__commitments.firstFree();

/** Number of notes spent so far. */
const nullifierCount = async (): Promise<bigint> =>
  (await publicState()).Core__nullifiers.size();

const pathFor = async (note: Note, ownerPk: bigint) => {
  const path = (await publicState()).Core__commitments.findPathForLeaf(
    core.commitOf(note, ownerPk),
  );
  if (path === undefined) throw new Error('test setup: note not committed');
  return path;
};

// ---------------------------------------------------------------------------
// Deployment baseline
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleToken: initial state', () => {
  beforeEach(async () => {
    token = await ConfidentialNoteFungibleTokenSimulator.create();
  });

  it('should start with an empty commitment tree', async () => {
    const ledger = await publicState();
    expect(ledger.Core__commitments.firstFree()).toBe(0n);
    expect(ledger.Core__commitments.isFull()).toBe(false);
  });

  it('should start with an empty nullifier set', async () => {
    const ledger = await publicState();
    expect(ledger.Core__nullifiers.isEmpty()).toBe(true);
    expect(ledger.Core__nullifiers.size()).toBe(0n);
  });

  // The core holds no roles and no init flag: value creation is available on a
  // fresh deployment, and the composing contract is what gates it.
  it('should mint on a fresh deployment with no initialization', async () => {
    const note = await token._mint(ALICE, 100n);
    expect(await isCommitted(note, ALICE)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// _mint
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleToken: _mint', () => {
  beforeEach(async () => {
    token = await ConfidentialNoteFungibleTokenSimulator.create();
  });

  it('should publish exactly one commitment and no nullifier', async () => {
    const note = await token._mint(ALICE, 100n);

    expect(await commitmentCount()).toBe(1n);
    expect(await nullifierCount()).toBe(0n);
    expect(await isCommitted(note, ALICE)).toBe(true);
    expect(await isSpent(note)).toBe(false);
  });

  it('should return the requested value with a non-zero nonce', async () => {
    const note = await token._mint(ALICE, 100n);

    expect(note.value).toBe(100n);
    expect(note.nonce).not.toBe(0n);
  });

  it('should not commit the note to any other owner', async () => {
    const note = await token._mint(ALICE, 100n);
    expect(await isCommitted(note, BOB)).toBe(false);
  });

  it('should derive a distinct nonce per mint', async () => {
    const first = await token._mint(ALICE, 100n);
    const second = await token._mint(ALICE, 100n);

    expect(second.nonce).not.toBe(first.nonce);
    expect(await commitmentCount()).toBe(2n);
  });

  // Ungated by design: no secret is read, so any caller mints to any pk. The
  // composing contract is responsible for the issuer gate.
  it('should mint without reading the caller secret', async () => {
    token.wallet.secretKey = BOB_SK;
    const note = await token._mint(ALICE, 100n);

    expect(await isCommitted(note, ALICE)).toBe(true);
    expect(await isCommitted(note, BOB)).toBe(false);
  });

  it('should mint a zero-value note that is spendable padding', async () => {
    const note = await token._mint(ALICE, 0n);
    expect(note.value).toBe(0n);
    expect(await isCommitted(note, ALICE)).toBe(true);

    spendAs(ALICE_SK, note);
    await token.burn(0n);
    expect(await isSpent(note)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// freshNonce (nonce hygiene)
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleToken: freshNonce', () => {
  beforeEach(async () => {
    token = await ConfidentialNoteFungibleTokenSimulator.create();
  });

  it('should derive unpredictable nonces from the default fresh randomness', async () => {
    const first = await token._mint(ALICE, 100n);
    const second = await token._mint(ALICE, 100n);

    expect(second.nonce).not.toBe(first.nonce);
    expect(core.nullifierOf(second)).not.toEqual(core.nullifierOf(first));
  });

  // Why `wit_NonceRandomness` must return a fresh secret seed per call: a reused
  // seed re-derives the same note, and the two share one nullifier, so spending
  // either one burns both.
  it('should collapse two mints into one spendable note when the seed is reused', async () => {
    token.wallet.nonceSeed = FIXED_SEED;
    const first = await token._mint(ALICE, 100n);
    const second = await token._mint(ALICE, 100n);

    expect(second).toStrictEqual(first);
    expect(await commitmentCount()).toBe(2n);

    spendAs(ALICE_SK, first);
    await token.burn(100n);

    expect(await isSpent(second)).toBe(true);
    token.wallet.inputNote = second;
    await expect(token.burn(100n)).rejects.toThrow(
      'ConfidentialNoteFungibleToken: note already spent',
    );
  });
});

// ---------------------------------------------------------------------------
// _mintNote
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleToken: _mintNote', () => {
  beforeEach(async () => {
    token = await ConfidentialNoteFungibleTokenSimulator.create();
  });

  it('should commit a caller-built note with a caller-chosen nonce', async () => {
    const note = { value: 42n, nonce: 12345n };
    await token._mintNote(note, ALICE);

    expect(await isCommitted(note, ALICE)).toBe(true);
    expect(await commitmentCount()).toBe(1n);
  });

  it('should commit distinct leaves for equal notes to distinct owners', async () => {
    const forAlice = await token._mint(ALICE, 100n);
    const sameValueForBob = { value: 100n, nonce: forAlice.nonce };
    await token._mintNote(sameValueForBob, BOB);

    expect(core.commitOf(forAlice, ALICE)).not.toEqual(
      core.commitOf(sameValueForBob, BOB),
    );
    expect(await isCommitted(forAlice, ALICE)).toBe(true);
    expect(await isCommitted(sameValueForBob, BOB)).toBe(true);
  });

  // The tree is append-only and does not deduplicate; single-spend is the
  // nullifier set's job, not the tree's.
  it('should append a duplicate leaf when the same note is minted twice', async () => {
    const note = { value: 42n, nonce: 12345n };
    await token._mintNote(note, ALICE);
    await token._mintNote(note, ALICE);

    expect(await commitmentCount()).toBe(2n);
  });
});

// ---------------------------------------------------------------------------
// commitOf
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleToken: commitOf', () => {
  it('should commit to value, nonce, and owner together', () => {
    const note = { value: 100n, nonce: 7n };
    const commitment = core.commitOf(note, ALICE);

    expect(core.commitOf({ value: 101n, nonce: 7n }, ALICE)).not.toEqual(
      commitment,
    );
    expect(core.commitOf({ value: 100n, nonce: 8n }, ALICE)).not.toEqual(
      commitment,
    );
    expect(core.commitOf(note, BOB)).not.toEqual(commitment);
    expect(core.commitOf({ value: 100n, nonce: 7n }, ALICE)).toEqual(
      commitment,
    );
  });
});

// ---------------------------------------------------------------------------
// burn
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleToken: burn', () => {
  let input: Note;

  beforeEach(async () => {
    token = await ConfidentialNoteFungibleTokenSimulator.create();
    input = await token._mint(ALICE, 100n);
    spendAs(ALICE_SK, input);
  });

  it('should spend the note and re-issue only the change', async () => {
    const change = await token.burn(30n);

    expect(change.value).toBe(70n);
    expect(await isCommitted(change, ALICE)).toBe(true);
    expect(await isSpent(input)).toBe(true);
    expect(await commitmentCount()).toBe(2n); // the mint plus the change
    expect(await nullifierCount()).toBe(1n);
  });

  it('should leave a zero-value change note when the whole note is burned', async () => {
    const change = await token.burn(100n);

    expect(change.value).toBe(0n);
    expect(await isCommitted(change, ALICE)).toBe(true);
  });

  it('should let the owner spend the change', async () => {
    const change = await token.burn(30n);

    spendAs(ALICE_SK, change);
    const [out] = await token.transfer(BOB, 70n);

    expect(out.value).toBe(70n);
    expect(await isCommitted(out, BOB)).toBe(true);
  });

  it('should not burn more than the note holds', async () => {
    await expect(token.burn(101n)).rejects.toThrow(
      'ConfidentialNoteFungibleToken: insufficient note value',
    );
  });

  it('should not burn the same note twice', async () => {
    await token.burn(30n);
    spendAs(ALICE_SK, input);

    await expect(token.burn(30n)).rejects.toThrow(
      'ConfidentialNoteFungibleToken: note already spent',
    );
  });

  it('should not let anyone other than the owner burn', async () => {
    spendAs(BOB_SK, input);

    await expectRejection(
      token.burn(30n),
      'wit_Path: commitment not found in tree',
    );
  });
});

// ---------------------------------------------------------------------------
// _spenderPk
// ---------------------------------------------------------------------------

// Impure but NOT provable: each reads a witness yet touches no ledger state, so
// its public transcript is empty, compactc registers no on-chain operation and
// emits no verifier key (`ProvableCircuits` in the generated artifact lists 7 of
// the 9 impure circuits). Callable in-circuit only, which is how `burn` and
// `transfer` use them, so the live backend has no transaction to submit.
describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleToken: _spenderPk',
  () => {
    let input: Note;

    beforeEach(async () => {
      token = await ConfidentialNoteFungibleTokenSimulator.create();
      input = await token._mint(ALICE, 100n);
      spendAs(ALICE_SK, input);
    });

    it('should derive the caller pk in-circuit exactly as derivePk does', async () => {
      token.wallet.secretKey = ALICE_SK;
      expect(await token._spenderPk()).toEqual(ALICE);
    });
  },
);

// ---------------------------------------------------------------------------
// derivePk
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleToken: derivePk', () => {
  it('should derive the same pk for the same secret', () => {
    expect(core.derivePk(ALICE_SK)).toEqual(ALICE);
  });

  it('should derive distinct pks for distinct secrets', () => {
    expect(new Set([ALICE, BOB, CAROL]).size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// _inputNote
// ---------------------------------------------------------------------------

// Impure but NOT provable: each reads a witness yet touches no ledger state, so
// its public transcript is empty, compactc registers no on-chain operation and
// emits no verifier key (`ProvableCircuits` in the generated artifact lists 7 of
// the 9 impure circuits). Callable in-circuit only, which is how `burn` and
// `transfer` use them, so the live backend has no transaction to submit.
describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleToken: _inputNote',
  () => {
    let input: Note;

    beforeEach(async () => {
      token = await ConfidentialNoteFungibleTokenSimulator.create();
      input = await token._mint(ALICE, 100n);
      spendAs(ALICE_SK, input);
    });

    it('should read the input note the next spend will consume', async () => {
      expect(await token._inputNote()).toStrictEqual(input);
    });
  },
);

// ---------------------------------------------------------------------------
// _burn: the conserving building block
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleToken: _burn', () => {
  let input: Note;

  beforeEach(async () => {
    token = await ConfidentialNoteFungibleTokenSimulator.create();
    input = await token._mint(ALICE, 100n);
    spendAs(ALICE_SK, input);
  });

  it('should accept a burn that conserves value', async () => {
    const change = { value: 70n, nonce: 222n };
    await token._burn(ALICE, 30n, change);

    expect(await isCommitted(change, ALICE)).toBe(true);
    expect(await isSpent(input)).toBe(true);
    expect(await commitmentCount()).toBe(2n);
  });

  it('should not accept a burn whose change does not conserve value', async () => {
    await expect(
      token._burn(ALICE, 30n, { value: 71n, nonce: 222n }),
    ).rejects.toThrow(
      'ConfidentialNoteFungibleToken: burn does not conserve value',
    );
  });
});

// ---------------------------------------------------------------------------
// _consumeNote
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleToken: _consumeNote', () => {
  let input: Note;

  beforeEach(async () => {
    token = await ConfidentialNoteFungibleTokenSimulator.create();
    input = await token._mint(ALICE, 100n);
    spendAs(ALICE_SK, input);
  });

  it('should publish the nullifier and return the consumed note', async () => {
    expect(await token._consumeNote(ALICE)).toStrictEqual(input);

    expect(await isSpent(input)).toBe(true);
    expect(await nullifierCount()).toBe(1n);
    expect(await commitmentCount()).toBe(1n); // nothing re-issued
  });

  it('should not consume the same note twice', async () => {
    await token._consumeNote(ALICE);
    spendAs(ALICE_SK, input);

    await expect(token._consumeNote(ALICE)).rejects.toThrow(
      'ConfidentialNoteFungibleToken: note already spent',
    );
  });

  it('should not consume a note whose commitment is not in the tree', async () => {
    spendAs(ALICE_SK, { value: 100n, nonce: 999n });

    await expectRejection(
      token._consumeNote(ALICE),
      'wit_Path: commitment not found in tree',
    );
  });

  it('should not consume a note under an owner pk it was not committed to', async () => {
    await expectRejection(
      token._consumeNote(BOB),
      'wit_Path: commitment not found in tree',
    );
  });

  // No authorization: whoever knows a note and its owner pk can nullify it.
  // This is the primitive an extension turns into escrow-free clawback, and the
  // reason nonces must stay secret.
  it('should consume a note for a caller who holds no owner secret', async () => {
    token.wallet.secretKey = BOB_SK;
    token.wallet.inputNote = input;

    expect(await token._consumeNote(ALICE)).toStrictEqual(input);
    expect(await isSpent(input)).toBe(true);
  });

  it('should consume a zero-value note', async () => {
    const padding = await token._mint(ALICE, 0n);
    spendAs(ALICE_SK, padding);

    expect(await token._consumeNote(ALICE)).toStrictEqual(padding);
    expect(await isSpent(padding)).toBe(true);
  });

  // A proof is built against the tree the wallet last saw. Later inserts move
  // the root, and the historical root set is what keeps such a proof valid.
  it('should accept a proof against a stale root', async () => {
    const stalePath = await pathFor(input, ALICE);
    const staleRoot = (await publicState()).Core__commitments.root();

    await token._mint(CAROL, 5n); // moves the tree on
    expect((await publicState()).Core__commitments.root()).not.toStrictEqual(
      staleRoot,
    );

    token.wallet.pathOverride = stalePath;
    expect(await token._consumeNote(ALICE)).toStrictEqual(input);
    expect(await isSpent(input)).toBe(true);
  });

  it('should not accept a path whose leaf is not the input commitment', async () => {
    const other = await token._mint(ALICE, 7n);
    const otherPath = await pathFor(other, ALICE);

    token.wallet.inputNote = input;
    token.wallet.pathOverride = otherPath;

    await expect(token._consumeNote(ALICE)).rejects.toThrow(
      'ConfidentialNoteFungibleToken: path does not match input commitment',
    );
  });

  it('should not accept a path rooted in a tree this contract never had', async () => {
    const foreign = await ConfidentialNoteFungibleTokenSimulator.create();
    const foreignNote = await foreign._mint(ALICE, 100n);
    const foreignPath = (
      await foreign.getPublicState()
    ).Core__commitments.findPathForLeaf(core.commitOf(foreignNote, ALICE));

    token.wallet.inputNote = foreignNote;
    token.wallet.pathOverride = foreignPath;

    await expect(token._consumeNote(ALICE)).rejects.toThrow(
      'ConfidentialNoteFungibleToken: input root not recognized',
    );
  });
});

// ---------------------------------------------------------------------------
// nullifierOf
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleToken: nullifierOf', () => {
  // The design decision behind escrow-free clawback: the nullifier preimage is
  // the nonce alone, so every party that learns a nonce derives the same
  // nullifier and races the owner for the single spend.
  it('should derive the nullifier from the nonce alone, ignoring value and owner', () => {
    const nullifier = core.nullifierOf({ value: 100n, nonce: 7n });

    expect(core.nullifierOf({ value: 999n, nonce: 7n })).toEqual(nullifier);
    expect(core.nullifierOf({ value: 100n, nonce: 8n })).not.toEqual(nullifier);
  });

  it('should not equate a commitment with a nullifier for the same note', () => {
    const note = { value: 100n, nonce: 7n };
    expect(core.commitOf(note, ALICE)).not.toEqual(core.nullifierOf(note));
  });
});

// ---------------------------------------------------------------------------
// transfer
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleToken: transfer', () => {
  let input: Note;

  beforeEach(async () => {
    token = await ConfidentialNoteFungibleTokenSimulator.create();
    input = await token._mint(ALICE, 100n);
    spendAs(ALICE_SK, input);
  });

  it('should split the input into a recipient note and change, conserving value', async () => {
    const [out, change] = await token.transfer(BOB, 30n);

    expect(out.value).toBe(30n);
    expect(change.value).toBe(70n);
    expect(out.value + change.value).toBe(input.value);
  });

  it('should commit the output to the recipient and the change to the sender', async () => {
    const [out, change] = await token.transfer(BOB, 30n);

    expect(await isCommitted(out, BOB)).toBe(true);
    expect(await isCommitted(change, ALICE)).toBe(true);
    expect(await isCommitted(out, ALICE)).toBe(false);
    expect(await isCommitted(change, BOB)).toBe(false);
  });

  it('should publish one nullifier and two commitments', async () => {
    await token.transfer(BOB, 30n);

    expect(await commitmentCount()).toBe(3n); // the mint plus two outputs
    expect(await nullifierCount()).toBe(1n);
    expect(await isSpent(input)).toBe(true);
  });

  it('should give the output and the change distinct nonces', async () => {
    const [out, change] = await token.transfer(BOB, 30n);
    expect(out.nonce).not.toBe(change.nonce);
  });

  // Both nonces come from one witness call, so they must be separated by their
  // slot tag rather than by the randomness itself.
  it('should keep the output and change nonces distinct under a reused seed', async () => {
    token.wallet.nonceSeed = FIXED_SEED;
    const [out, change] = await token.transfer(BOB, 30n);

    expect(out.nonce).not.toBe(change.nonce);
  });

  it('should let the recipient spend what it received', async () => {
    const [out] = await token.transfer(BOB, 30n);

    spendAs(BOB_SK, out);
    const [onward, bobChange] = await token.transfer(CAROL, 10n);

    expect(onward.value).toBe(10n);
    expect(bobChange.value).toBe(20n);
    expect(await isSpent(out)).toBe(true);
    expect(await isCommitted(onward, CAROL)).toBe(true);
  });

  it('should leave a zero-value change note when the whole note is sent', async () => {
    const [out, change] = await token.transfer(BOB, 100n);

    expect(out.value).toBe(100n);
    expect(change.value).toBe(0n);
    expect(await isCommitted(change, ALICE)).toBe(true);
  });

  it('should send to the sender itself', async () => {
    const [out, change] = await token.transfer(ALICE, 30n);

    expect(await isCommitted(out, ALICE)).toBe(true);
    expect(await isCommitted(change, ALICE)).toBe(true);
    expect(await nullifierCount()).toBe(1n);
  });

  it('should not send more than the note holds', async () => {
    await expect(token.transfer(BOB, 101n)).rejects.toThrow(
      'ConfidentialNoteFungibleToken: insufficient note value',
    );
  });

  it('should not spend the same note twice', async () => {
    await token.transfer(BOB, 30n);
    spendAs(ALICE_SK, input);

    await expect(token.transfer(BOB, 30n)).rejects.toThrow(
      'ConfidentialNoteFungibleToken: note already spent',
    );
  });

  it('should not spend a note that was never committed', async () => {
    spendAs(ALICE_SK, { value: 100n, nonce: 999n });

    await expectRejection(
      token.transfer(BOB, 30n),
      'wit_Path: commitment not found in tree',
    );
  });

  // Ownership is enforced by the commitment: a non-owner's pk hashes to a leaf
  // that is not in the tree, so no membership proof exists.
  it('should not let anyone other than the owner spend', async () => {
    spendAs(BOB_SK, input);

    await expectRejection(
      token.transfer(CAROL, 30n),
      'wit_Path: commitment not found in tree',
    );
    expect(await isSpent(input)).toBe(false);
  });

  it('should leave the ledger untouched when a transfer reverts', async () => {
    const before = await commitmentCount();

    await expect(token.transfer(BOB, 101n)).rejects.toThrow();

    expect(await commitmentCount()).toBe(before);
    expect(await nullifierCount()).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
// _transfer: the conserving building block
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleToken: _transfer', () => {
  let input: Note;

  beforeEach(async () => {
    token = await ConfidentialNoteFungibleTokenSimulator.create();
    input = await token._mint(ALICE, 100n);
    spendAs(ALICE_SK, input);
  });

  // How a composing contract spends: it builds both output notes itself (its
  // emission policy owns the nonces) and the core checks conservation.
  it('should accept caller-built notes that conserve value', async () => {
    const out = { value: 30n, nonce: 111n };
    const change = { value: 70n, nonce: 222n };

    await token._transfer(ALICE, BOB, out, change);

    expect(await isCommitted(out, BOB)).toBe(true);
    expect(await isCommitted(change, ALICE)).toBe(true);
    expect(await isSpent(input)).toBe(true);
  });

  it('should not accept outputs that destroy value', async () => {
    await expect(
      token._transfer(
        ALICE,
        BOB,
        { value: 30n, nonce: 111n },
        { value: 69n, nonce: 222n },
      ),
    ).rejects.toThrow(
      'ConfidentialNoteFungibleToken: transfer does not conserve value',
    );
  });

  it('should not accept outputs that inflate value', async () => {
    await expect(
      token._transfer(
        ALICE,
        BOB,
        { value: 30n, nonce: 111n },
        { value: 71n, nonce: 222n },
      ),
    ).rejects.toThrow(
      'ConfidentialNoteFungibleToken: transfer does not conserve value',
    );
  });

  it('should leave the ledger untouched when conservation fails', async () => {
    const before = await commitmentCount();

    await expect(
      token._transfer(
        ALICE,
        BOB,
        { value: 30n, nonce: 111n },
        { value: 71n, nonce: 222n },
      ),
    ).rejects.toThrow();

    expect(await commitmentCount()).toBe(before);
    expect(await nullifierCount()).toBe(0n);
    expect(await isSpent(input)).toBe(false);
  });
});
