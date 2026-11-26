import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import { expectRejection } from '#test-utils/assertions/rejection.js';
import { pureCircuits as composed } from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenFreezable/contract/index.js';
import { pureCircuits as standalone } from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenFreeze/contract/index.js';
import { NOTE_SALT } from '../../presets/test/witnesses/CustodialConfidentialNoteFungibleTokenWitnesses.js';
import {
  ConfidentialNoteFungibleTokenFreezableSimulator,
  type Identifier,
  type Note,
} from './simulators/ConfidentialNoteFungibleTokenFreezableSimulator.js';
import { ConfidentialNoteFungibleTokenFreezeSimulator } from './simulators/ConfidentialNoteFungibleTokenFreezeSimulator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A deterministic 32-byte value from a label; also Compact's `pad(32, label)`. */
const bytes32 = (label: string): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(label));
  return bytes;
};

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const ERR = {
  frozen: 'ConfidentialNoteFungibleTokenFreeze: note frozen',
  rootNotRecognized: 'ConfidentialNoteFungibleToken: input root not recognized',
  spent: 'ConfidentialNoteFungibleToken: note already spent',
} as const;

const NOTE: Note = { value: 100n, nonce: 7n };
const SAME_NONCE: Note = { value: 5n, nonce: NOTE.nonce };
const OTHER_NONCE: Note = { value: NOTE.value, nonce: NOTE.nonce + 1n };
const NF = standalone.nullifierOf(NOTE);
const UNKNOWN_NF = bytes32('UNKNOWN-NULLIFIER');

/** The frozen set, sorted, in a form `toStrictEqual` compares. */
const frozenOf = (set: Iterable<Uint8Array>): string[] =>
  [...set].map(hex).sort();

// ---------------------------------------------------------------------------
// Standalone module
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenFreeze: standalone', () => {
  let freeze: ConfidentialNoteFungibleTokenFreezeSimulator;

  const frozen = async (): Promise<string[]> =>
    frozenOf((await freeze.getPublicState()).Freeze__frozen);

  beforeEach(async () => {
    freeze = await ConfidentialNoteFungibleTokenFreezeSimulator.create();
  });

  it('should start with no frozen note', async () => {
    expect(await frozen()).toStrictEqual([]);
    expect(await freeze.isFrozen(NF)).toBe(false);
    await freeze.assertNotFrozen(NOTE);
  });

  it('should report a frozen nullifier and leave the set unchanged', async () => {
    await freeze._freeze(NF);
    const before = await frozen();

    expect(await freeze.isFrozen(NF)).toBe(true);
    expect(await freeze.isFrozen(UNKNOWN_NF)).toBe(false);
    expect(await frozen()).toStrictEqual(before);
  });

  it('should reject a note once its nullifier is frozen', async () => {
    await freeze._freeze(NF);

    await expectRejection(freeze.assertNotFrozen(NOTE), ERR.frozen);
  });

  it('should accept the note again after _unfreeze', async () => {
    await freeze._freeze(NF);
    await freeze._unfreeze(NF);

    await freeze.assertNotFrozen(NOTE);
    expect(await freeze.isFrozen(NF)).toBe(false);
  });

  it('should derive the nullifier from the nonce alone', async () => {
    expect(await freeze.nullifierOf(SAME_NONCE)).toStrictEqual(NF);
    expect(await freeze.nullifierOf(OTHER_NONCE)).not.toStrictEqual(NF);
  });

  it('should freeze every note that shares the nonce, whatever its value', async () => {
    await freeze._freeze(NF);

    await expectRejection(freeze.assertNotFrozen(SAME_NONCE), ERR.frozen);
  });

  it('should leave a note with another nonce unfrozen', async () => {
    await freeze._freeze(NF);

    await freeze.assertNotFrozen(OTHER_NONCE);
  });

  it('should freeze one nullifier once however often it is frozen', async () => {
    await freeze._freeze(NF);
    await freeze._freeze(NF);

    expect(await frozen()).toStrictEqual([hex(NF)]);
  });

  it('should unfreeze a twice-frozen note with one _unfreeze', async () => {
    await freeze._freeze(NF);
    await freeze._freeze(NF);
    await freeze._unfreeze(NF);

    expect(await frozen()).toStrictEqual([]);
    await freeze.assertNotFrozen(NOTE);
  });

  it('should accept _unfreeze of a nullifier that is not frozen', async () => {
    await freeze._freeze(UNKNOWN_NF);

    await freeze._unfreeze(NF);

    expect(await frozen()).toStrictEqual([hex(UNKNOWN_NF)]);
  });

  it('should accept a nullifier no note derives', async () => {
    await freeze._freeze(UNKNOWN_NF);

    expect(await frozen()).toStrictEqual([hex(UNKNOWN_NF)]);
    await freeze.assertNotFrozen(NOTE);
  });

  it('should unfreeze one nullifier and keep another frozen', async () => {
    const otherNf = standalone.nullifierOf(OTHER_NONCE);
    await freeze._freeze(NF);
    await freeze._freeze(otherNf);

    await freeze._unfreeze(NF);

    expect(await frozen()).toStrictEqual([hex(otherNf)]);
    await freeze.assertNotFrozen(NOTE);
    await expectRejection(freeze.assertNotFrozen(OTHER_NONCE), ERR.frozen);
  });
});

// ---------------------------------------------------------------------------
// Composed with the core
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenFreeze: composed with the core', () => {
  const ALICE_SK = bytes32('ALICE');
  const BOB_SK = bytes32('BOB');
  const RECOVERY_SK = bytes32('RECOVERY');
  const ALICE = composed.deriveIdentifier(ALICE_SK, NOTE_SALT);
  const BOB = composed.deriveIdentifier(BOB_SK, NOTE_SALT);
  const RECOVERY = composed.deriveIdentifier(RECOVERY_SK, NOTE_SALT);

  let token: ConfidentialNoteFungibleTokenFreezableSimulator;
  let note: Note;

  /** Every cell the mock publishes, in a form `toStrictEqual` compares. */
  const cells = async () => {
    const state = await token.getPublicState();
    return {
      commitments: state.Core__commitments.firstFree(),
      nullifiers: frozenOf(state.Core__nullifiers),
      issuedNonces: state.Core__issuedNonces.size(),
      frozen: frozenOf(state.Freeze__frozen),
    };
  };

  /** Sets the secret the next spend authenticates with. */
  const actAs = (sk: Uint8Array): void => {
    token.wallet.secretKey = sk;
  };

  const isCommitted = async (n: Note, ownerPk: Identifier): Promise<boolean> =>
    (await token.getPublicState()).Core__commitments.findPathForLeaf(
      composed.commitOf(n, ownerPk),
    ) !== undefined;

  const isSpent = async (n: Note): Promise<boolean> =>
    (await token.getPublicState()).Core__nullifiers.member(
      composed.nullifierOf(n),
    );

  const isFrozen = async (n: Note): Promise<boolean> =>
    (await token.getPublicState()).Freeze__frozen.member(
      composed.nullifierOf(n),
    );

  const freezeNote = (n: Note): Promise<[]> =>
    token._freeze(composed.nullifierOf(n));

  const seize = async (n: Note, targetPk: Identifier = ALICE): Promise<Note> =>
    token.seize(targetPk, RECOVERY, n, await token.pathOf(n, targetPk));

  beforeEach(async () => {
    token = await ConfidentialNoteFungibleTokenFreezableSimulator.create();
    note = await token.mint(ALICE, 100n);
    actAs(ALICE_SK);
  });

  describe('a frozen note', () => {
    beforeEach(async () => {
      await freezeNote(note);
    });

    it('should hold against its owner and pass to the recovery key through seize', async () => {
      const path = await token.pathOf(note, ALICE);
      const before = await cells();

      await expectRejection(token.transfer(BOB, 30n, note, path), ERR.frozen);
      await expectRejection(token.burn(30n, note, path), ERR.frozen);
      expect(await cells()).toStrictEqual(before);

      const seized = await token.seize(ALICE, RECOVERY, note, path);
      actAs(RECOVERY_SK);
      await token.burn(100n, seized, await token.pathOf(seized, RECOVERY));

      expect(await isSpent(note)).toBe(true);
      expect(await isSpent(seized)).toBe(true);
    });

    it('should not be transferred by its owner and leave the ledger unchanged', async () => {
      const path = await token.pathOf(note, ALICE);
      const before = await cells();

      await expectRejection(token.transfer(BOB, 30n, note, path), ERR.frozen);
      expect(await cells()).toStrictEqual(before);
    });

    it('should not be burned by its owner and leave the ledger unchanged', async () => {
      const path = await token.pathOf(note, ALICE);
      const before = await cells();

      await expectRejection(token.burn(30n, note, path), ERR.frozen);
      expect(await cells()).toStrictEqual(before);
    });

    // The freeze check runs before the core, so it decides even a spend the
    // core would also reject.
    it('should fail on the freeze before the value check', async () => {
      await expectRejection(
        token.burn(101n, note, await token.pathOf(note, ALICE)),
        ERR.frozen,
      );
    });

    it('should be seized into a note of its value for the recovery key', async () => {
      const before = await cells();

      const seized = await seize(note);

      expect(seized.value).toBe(note.value);
      expect(await isCommitted(seized, RECOVERY)).toBe(true);
      expect(await isCommitted(seized, ALICE)).toBe(false);
      expect(await isSpent(note)).toBe(true);
      expect(await cells()).toStrictEqual({
        ...before,
        commitments: before.commitments + 1n,
        nullifiers: [hex(composed.nullifierOf(note))],
        issuedNonces: before.issuedNonces + 1n,
      });
    });

    it('should let the recovery key holder spend the seized note', async () => {
      const seized = await seize(note);
      actAs(RECOVERY_SK);

      const [out, change] = await token.transfer(
        BOB,
        40n,
        seized,
        await token.pathOf(seized, RECOVERY),
      );

      expect(out.value).toBe(40n);
      expect(change.value).toBe(60n);
      expect(await isCommitted(out, BOB)).toBe(true);
      expect(await isSpent(seized)).toBe(true);
    });

    it('should not freeze the seized note', async () => {
      const seized = await seize(note);

      expect(await isFrozen(seized)).toBe(false);
      expect(await token.isFrozen(composed.nullifierOf(seized))).toBe(false);
    });

    it('should keep the nullifier of a seized note in the frozen set', async () => {
      await seize(note);

      expect(await isFrozen(note)).toBe(true);
      expect(await isSpent(note)).toBe(true);
    });

    it('should be spent by its owner after _unfreeze', async () => {
      await token._unfreeze(composed.nullifierOf(note));

      const [out, change] = await token.transfer(
        BOB,
        30n,
        note,
        await token.pathOf(note, ALICE),
      );

      expect(await isCommitted(out, BOB)).toBe(true);
      expect(await isCommitted(change, ALICE)).toBe(true);
      expect(await isSpent(note)).toBe(true);
    });

    it('should not block another note of the same owner', async () => {
      const other = await token.mint(ALICE, 50n);

      const change = await token.burn(
        20n,
        other,
        await token.pathOf(other, ALICE),
      );

      expect(change.value).toBe(30n);
      expect(await isSpent(other)).toBe(true);
      expect(await isSpent(note)).toBe(false);
    });
  });

  describe('the nullifier', () => {
    it('should derive the nullifier a burn adds to the core', async () => {
      const nf = await token.nullifierOf(note);
      await token.burn(100n, note, await token.pathOf(note, ALICE));

      expect(nf).toStrictEqual(standalone.nullifierOf(note));
      expect((await cells()).nullifiers).toStrictEqual([hex(nf)]);
    });

    it('should hold one value in the frozen set and the spent set after a seize', async () => {
      await freezeNote(note);
      await seize(note);
      const state = await cells();

      expect(state.frozen).toStrictEqual(state.nullifiers);
    });

    it('should report the frozen state through isFrozen', async () => {
      const nf = composed.nullifierOf(note);
      expect(await token.isFrozen(nf)).toBe(false);

      await token._freeze(nf);

      expect(await token.isFrozen(nf)).toBe(true);
    });
  });

  describe('seize', () => {
    it('should conserve the value of an unfrozen note', async () => {
      const seized = await seize(note);

      expect(seized.value).toBe(note.value);
      expect(await isCommitted(seized, RECOVERY)).toBe(true);
      expect(await isSpent(note)).toBe(true);
    });

    it('should not seize a spent note', async () => {
      const path = await token.pathOf(note, ALICE);
      await token.burn(100n, note, path);
      const before = await cells();

      await expectRejection(
        token.seize(ALICE, RECOVERY, note, path),
        ERR.spent,
      );
      expect(await cells()).toStrictEqual(before);
    });

    it('should not seize a note under a target it is not committed to', async () => {
      const path = await token.pathOf(note, ALICE);

      await expectRejection(
        token.seize(BOB, RECOVERY, note, path),
        ERR.rootNotRecognized,
      );
    });
  });

  describe('spends of unfrozen notes', () => {
    it('should not freeze the outputs of a transfer', async () => {
      const [out, change] = await token.transfer(
        BOB,
        30n,
        note,
        await token.pathOf(note, ALICE),
      );

      expect(await isFrozen(out)).toBe(false);
      expect(await isFrozen(change)).toBe(false);
      expect((await cells()).frozen).toStrictEqual([]);
    });

    it('should let a spend pass while another nullifier is frozen', async () => {
      await token._freeze(UNKNOWN_NF);

      await token.burn(10n, note, await token.pathOf(note, ALICE));

      expect(await isSpent(note)).toBe(true);
    });

    it('should accept a freeze of a spent note and change nothing else', async () => {
      await token.burn(100n, note, await token.pathOf(note, ALICE));
      const before = await cells();

      await freezeNote(note);

      expect(await cells()).toStrictEqual({
        ...before,
        frozen: [hex(composed.nullifierOf(note))],
      });
    });

    it('should accept a freeze of an unknown nullifier and change nothing else', async () => {
      const before = await cells();

      await token._freeze(UNKNOWN_NF);

      expect(await cells()).toStrictEqual({
        ...before,
        frozen: [hex(UNKNOWN_NF)],
      });
    });
  });

  it('should find no commitment path for a note never minted', async () => {
    await expect(token.pathOf({ value: 1n, nonce: 1n }, ALICE)).rejects.toThrow(
      'pathOf: commitment not found in tree',
    );
  });
});

// ---------------------------------------------------------------------------
// Fallback witnesses
// ---------------------------------------------------------------------------

// `_create` skips `create`'s wiring, so the factory's fallback wallet answers:
// a fresh random secret that owns no leaf.
describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenFreeze: fallback witnesses',
  () => {
    it('should fall back to a fresh random secret without explicit witnesses', async () => {
      const alice = composed.deriveIdentifier(bytes32('ALICE'), NOTE_SALT);
      const bare =
        (await ConfidentialNoteFungibleTokenFreezableSimulator._create([
          NOTE_SALT,
        ])) as ConfidentialNoteFungibleTokenFreezableSimulator;
      const note = await bare.mint(alice, 100n);

      await expectRejection(
        bare.burn(30n, note, await bare.pathOf(note, alice)),
        ERR.rootNotRecognized,
      );
    });
  },
);
