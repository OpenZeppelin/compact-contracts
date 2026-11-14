import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import { expectRejection } from '#test-utils/assertions/rejection.js';
import { pureCircuits as preset } from '../../../../artifacts/token/presets/test/mocks/MockCustodialConfidentialNoteFungibleToken/contract/index.js';
import {
  type Account,
  CustodialConfidentialNoteFungibleTokenSimulator,
  type Note,
} from './simulators/CustodialConfidentialNoteFungibleTokenSimulator.js';
import {
  CustodialConfidentialNoteFungibleTokenWitnesses,
  ISSUER_SALT,
  NOTE_SALT,
} from './witnesses/CustodialConfidentialNoteFungibleTokenWitnesses.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A deterministic 32-byte secret from a label; also Compact's `pad(32, label)`. */
const secretKey = (label: string): Uint8Array => {
  const sk = new Uint8Array(32);
  sk.set(new TextEncoder().encode(label));
  return sk;
};

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const ISSUER_SK = secretKey('ISSUER');
const SUCCESSOR_SK = secretKey('SUCCESSOR');
const MALLORY_SK = secretKey('MALLORY');
const ALICE_SK = secretKey('ALICE');
const BOB_SK = secretKey('BOB');
const ZERO = new Uint8Array(32);

const OTHER_SALT = secretKey('OTHER-SALT');

// Every deployment below uses `ISSUER_SALT` and `NOTE_SALT` unless it says
// otherwise. Issuer ids are accounts under the issuer salt, note keys
// accounts under the note salt.
const ISSUER = preset.deriveAccount(ISSUER_SK, ISSUER_SALT);
const SUCCESSOR = preset.deriveAccount(SUCCESSOR_SK, ISSUER_SALT);
const ALICE = preset.deriveAccount(ALICE_SK, NOTE_SALT);
const BOB = preset.deriveAccount(BOB_SK, NOTE_SALT);

const CONTRACT: Account = {
  is_left: false,
  left: ZERO,
  right: { bytes: secretKey('CONTRACT') },
};
const ZERO_ACCOUNT: Account = {
  is_left: true,
  left: ZERO,
  right: { bytes: ZERO },
};

/** Any 32 entries: the calls under test fail before the path is read. */
const UNUSED_PATH = Array.from({ length: 32 }, () => ({
  sibling: { field: 0n },
  goes_left: false,
}));

const ERR = {
  zeroIssuerSalt:
    'CustodialConfidentialNoteFungibleToken: issuer salt must not be zero',
  zeroNoteSalt:
    'CustodialConfidentialNoteFungibleToken: note salt must not be zero',
  equalSalts: 'CustodialConfidentialNoteFungibleToken: salts must differ',
  contractRecipient:
    'CustodialConfidentialNoteFungibleToken: contract recipient',
  notInitialized:
    'CustodialConfidentialNoteFungibleToken: contract not initialized',
  ownableNotInitialized: 'Ownable: contract not initialized',
  ownableAlreadyInitialized: 'Ownable: contract already initialized',
  invalidInitialOwner: 'Ownable: invalid initial owner',
  invalidNewOwner: 'Ownable: invalid new owner',
  unsafeTransfer: 'Ownable: unsafe ownership transfer',
  notOwner: 'Ownable: caller is not the owner',
  rootNotRecognized: 'ConfidentialNoteFungibleToken: input root not recognized',
} as const;

let token: CustodialConfidentialNoteFungibleTokenSimulator;

const deployAs = (sk: Uint8Array) =>
  CustodialConfidentialNoteFungibleTokenSimulator.create({
    wallet: { secretKey: sk },
  });

/** Every cell the preset publishes, in a form `toStrictEqual` compares. */
const cells = async (sim = token) => {
  const state = await sim.getPublicState();
  return {
    issuerSalt: hex(state.Token__issuerSalt),
    noteSalt: hex(state.Token__noteSalt),
    commitments: state.Token_Core__commitments.firstFree(),
    nullifiers: state.Token_Core__nullifiers.size(),
    issuedNonces: state.Token_Core__issuedNonces.size(),
    initialized: state.Token_Ownable__isInitialized,
    owner: state.Token_Ownable__owner,
  };
};

/** Sets the secret the next call authenticates with. */
const actAs = (sk: Uint8Array): void => {
  token.wallet.secretKey = sk;
};

/** Mints as the issuer. */
const issue = (recipientPk: Account, value: bigint): Promise<Note> => {
  actAs(ISSUER_SK);
  return token.mint(recipientPk, value);
};

const isCommitted = async (note: Note, ownerPk: Account): Promise<boolean> =>
  (await token.getPublicState()).Token_Core__commitments.findPathForLeaf(
    preset.commitOf(note, ownerPk),
  ) !== undefined;

const isSpent = async (note: Note): Promise<boolean> =>
  (await token.getPublicState()).Token_Core__nullifiers.member(
    preset.nullifierOf(note),
  );

// ---------------------------------------------------------------------------
// initialize
// ---------------------------------------------------------------------------

describe('CustodialConfidentialNoteFungibleToken: initialize', () => {
  it('should store both salts and the issuer', async () => {
    token = await deployAs(ISSUER_SK);

    expect(await cells()).toStrictEqual({
      issuerSalt: hex(ISSUER_SALT),
      noteSalt: hex(NOTE_SALT),
      commitments: 0n,
      nullifiers: 0n,
      issuedNonces: 0n,
      initialized: true,
      owner: ISSUER,
    });
  });

  it('should not accept a zero issuer salt', async () => {
    await expectRejection(
      CustodialConfidentialNoteFungibleTokenSimulator.create({
        issuer: ISSUER,
        issuerSalt: ZERO,
      }),
      ERR.zeroIssuerSalt,
    );
  });

  it('should not accept a zero note salt', async () => {
    await expectRejection(
      CustodialConfidentialNoteFungibleTokenSimulator.create({
        issuer: ISSUER,
        noteSalt: ZERO,
      }),
      ERR.zeroNoteSalt,
    );
  });

  it('should not accept equal salts', async () => {
    await expectRejection(
      CustodialConfidentialNoteFungibleTokenSimulator.create({
        issuer: ISSUER,
        noteSalt: ISSUER_SALT,
      }),
      ERR.equalSalts,
    );
  });

  it('should not accept a zero issuer', async () => {
    await expectRejection(
      CustodialConfidentialNoteFungibleTokenSimulator.create({
        issuer: ZERO_ACCOUNT,
      }),
      ERR.invalidInitialOwner,
    );
  });

  it('should not accept a contract address as the issuer', async () => {
    await expectRejection(
      CustodialConfidentialNoteFungibleTokenSimulator.create({
        issuer: CONTRACT,
      }),
      ERR.unsafeTransfer,
    );
  });

  it('should not initialize twice', async () => {
    await expectRejection(
      CustodialConfidentialNoteFungibleTokenSimulator.create({
        issuer: ISSUER,
        inits: 2n,
      }),
      ERR.ownableAlreadyInitialized,
    );
  });

  it('should leave both salts and the owner unset without initialize', async () => {
    token = await CustodialConfidentialNoteFungibleTokenSimulator.create({
      inits: 0n,
    });
    const state = await cells();

    expect(state.issuerSalt).toBe(hex(ZERO));
    expect(state.noteSalt).toBe(hex(ZERO));
    expect(state.initialized).toBe(false);
    expect(state.owner.left).toStrictEqual(ZERO);
  });
});

// ---------------------------------------------------------------------------
// Before initialize
// ---------------------------------------------------------------------------

describe('CustodialConfidentialNoteFungibleToken: before initialize', () => {
  const NOTE: Note = { value: 100n, nonce: 1n };

  beforeEach(async () => {
    token = await CustodialConfidentialNoteFungibleTokenSimulator.create({
      wallet: { secretKey: ALICE_SK },
      inits: 0n,
    });
  });

  it('should not transfer', async () => {
    await expectRejection(
      token.transfer(BOB, 30n, NOTE, UNUSED_PATH),
      ERR.notInitialized,
    );
  });

  it('should not burn', async () => {
    await expectRejection(
      token.burn(30n, NOTE, UNUSED_PATH),
      ERR.notInitialized,
    );
  });

  it('should not mint, failing in the owner check', async () => {
    actAs(ISSUER_SK);

    await expectRejection(token.mint(ALICE, 100n), ERR.ownableNotInitialized);
  });

  it('should not hand over the issuer role', async () => {
    actAs(ISSUER_SK);

    await expectRejection(
      token.transferOwnership(SUCCESSOR),
      ERR.ownableNotInitialized,
    );
  });

  it('should not read the owner', async () => {
    await expectRejection(token.owner(), ERR.ownableNotInitialized);
  });

  it('should still derive accounts', async () => {
    expect(await token.deriveAccount(ALICE_SK, NOTE_SALT)).toStrictEqual(ALICE);
  });
});

// ---------------------------------------------------------------------------
// The two salts
// ---------------------------------------------------------------------------

describe('CustodialConfidentialNoteFungibleToken: the two salts', () => {
  beforeEach(async () => {
    token = await deployAs(ISSUER_SK);
  });

  it('should make the issuer the account of its secret under the issuer salt', async () => {
    expect(await token.owner()).toStrictEqual(
      await token.deriveAccount(ISSUER_SK, ISSUER_SALT),
    );
  });

  it("should keep the issuer's note key apart from its issuer id", async () => {
    const noteKey = await token.deriveAccount(ISSUER_SK, NOTE_SALT);

    expect(noteKey).not.toStrictEqual(ISSUER);
    expect(noteKey).not.toStrictEqual(await token.owner());
  });

  it('should let a holder spend a note minted to its account under the note salt', async () => {
    const note = await issue(ALICE, 100n);
    actAs(ALICE_SK);

    await token.transfer(BOB, 30n, note, await token.pathOf(note, ALICE));

    expect(await isSpent(note)).toBe(true);
  });

  it('should not let a holder spend a note minted to its account under the issuer salt', async () => {
    const wrongKey = preset.deriveAccount(ALICE_SK, ISSUER_SALT);
    const note = await issue(wrongKey, 100n);
    actAs(ALICE_SK);

    await expectRejection(
      token.transfer(BOB, 30n, note, await token.pathOf(note, wrongKey)),
      ERR.rootNotRecognized,
    );
    expect(await isSpent(note)).toBe(false);
  });

  it('should not let the issuer mint when its id was derived under the note salt', async () => {
    token = await CustodialConfidentialNoteFungibleTokenSimulator.create({
      wallet: { secretKey: ISSUER_SK },
      issuer: preset.deriveAccount(ISSUER_SK, NOTE_SALT),
    });

    await expectRejection(token.mint(ALICE, 100n), ERR.notOwner);
  });

  it('should let the issuer mint under another issuer salt with its id derived under that salt', async () => {
    token = await CustodialConfidentialNoteFungibleTokenSimulator.create({
      wallet: { secretKey: ISSUER_SK },
      issuerSalt: OTHER_SALT,
    });

    expect(await token.owner()).toStrictEqual(
      preset.deriveAccount(ISSUER_SK, OTHER_SALT),
    );
    expect(await token.owner()).not.toStrictEqual(ISSUER);
    await expect(token.mint(ALICE, 100n)).resolves.toMatchObject({
      value: 100n,
    });
  });
});

// ---------------------------------------------------------------------------
// mint
// ---------------------------------------------------------------------------

describe('CustodialConfidentialNoteFungibleToken: mint', () => {
  beforeEach(async () => {
    token = await deployAs(ISSUER_SK);
  });

  it('should mint for the issuer', async () => {
    const note = await token.mint(ALICE, 100n);

    expect(note.value).toBe(100n);
    expect(await isCommitted(note, ALICE)).toBe(true);
    expect(await isSpent(note)).toBe(false);
    const state = await cells();
    expect(state.commitments).toBe(1n);
    expect(state.issuedNonces).toBe(1n);
  });

  it('should not commit the note to any other key', async () => {
    const note = await token.mint(ALICE, 100n);

    expect(await isCommitted(note, BOB)).toBe(false);
  });

  it.each([
    { label: 'another secret', sk: MALLORY_SK },
    { label: "a holder's secret", sk: ALICE_SK },
    { label: 'the zero secret', sk: ZERO },
  ])(
    'should not mint for $label and leave the ledger unchanged',
    async ({ sk }) => {
      const before = await cells();
      actAs(sk);

      await expectRejection(token.mint(ALICE, 100n), ERR.notOwner);
      expect(await cells()).toStrictEqual(before);
    },
  );

  // The gate consumes nothing; the core's issued-nonce set is what makes each
  // mint single-use.
  it('should mint twice in a row with one secret', async () => {
    const first = await token.mint(ALICE, 100n);
    const second = await token.mint(ALICE, 100n);

    expect(second.nonce).not.toBe(first.nonce);
    const state = await cells();
    expect(state.commitments).toBe(2n);
    expect(state.issuedNonces).toBe(2n);
  });

  it('should not mint to a contract recipient', async () => {
    const before = await cells();

    await expectRejection(token.mint(CONTRACT, 100n), ERR.contractRecipient);
    expect(await cells()).toStrictEqual(before);
  });

  it('should check the issuer before the recipient', async () => {
    actAs(MALLORY_SK);

    await expectRejection(token.mint(CONTRACT, 100n), ERR.notOwner);
  });
});

// ---------------------------------------------------------------------------
// transfer
// ---------------------------------------------------------------------------

describe('CustodialConfidentialNoteFungibleToken: transfer', () => {
  let note: Note;

  beforeEach(async () => {
    token = await deployAs(ISSUER_SK);
    note = await issue(ALICE, 100n);
    actAs(ALICE_SK);
  });

  it("should spend the caller's note into a recipient note and change", async () => {
    const [out, change] = await token.transfer(
      BOB,
      30n,
      note,
      await token.pathOf(note, ALICE),
    );

    expect(out.value).toBe(30n);
    expect(change.value).toBe(70n);
    expect(await isCommitted(out, BOB)).toBe(true);
    expect(await isCommitted(change, ALICE)).toBe(true);
    expect(await isSpent(note)).toBe(true);
  });

  it('should let the recipient spend the received note', async () => {
    const [out] = await token.transfer(
      BOB,
      30n,
      note,
      await token.pathOf(note, ALICE),
    );
    actAs(BOB_SK);

    const [back] = await token.transfer(
      ALICE,
      10n,
      out,
      await token.pathOf(out, BOB),
    );

    expect(await isCommitted(back, ALICE)).toBe(true);
    expect(await isSpent(out)).toBe(true);
  });

  it.each([
    { label: 'another secret', sk: MALLORY_SK },
    { label: "the issuer's secret", sk: ISSUER_SK },
  ])(
    "should not let $label spend the note with its owner's path",
    async ({ sk }) => {
      const path = await token.pathOf(note, ALICE);
      const before = await cells();
      actAs(sk);

      await expectRejection(
        token.transfer(BOB, 30n, note, path),
        ERR.rootNotRecognized,
      );
      expect(await cells()).toStrictEqual(before);
    },
  );

  it('should find no path for the note under a key it is not committed to', async () => {
    await expect(token.pathOf(note, BOB)).rejects.toThrow(
      'pathOf: commitment not found in tree',
    );
  });

  it('should not transfer to a contract recipient', async () => {
    const path = await token.pathOf(note, ALICE);
    const before = await cells();

    await expectRejection(
      token.transfer(CONTRACT, 30n, note, path),
      ERR.contractRecipient,
    );
    expect(await cells()).toStrictEqual(before);
  });
});

// ---------------------------------------------------------------------------
// burn
// ---------------------------------------------------------------------------

describe('CustodialConfidentialNoteFungibleToken: burn', () => {
  let note: Note;

  beforeEach(async () => {
    token = await deployAs(ISSUER_SK);
    note = await issue(ALICE, 100n);
    actAs(ALICE_SK);
  });

  it('should burn the value and return the change to the caller', async () => {
    const change = await token.burn(30n, note, await token.pathOf(note, ALICE));

    expect(change.value).toBe(70n);
    expect(await isCommitted(change, ALICE)).toBe(true);
    expect(await isSpent(note)).toBe(true);
  });

  it.each([
    { label: 'another secret', sk: MALLORY_SK },
    { label: "the issuer's secret", sk: ISSUER_SK },
  ])(
    "should not let $label burn the note with its owner's path",
    async ({ sk }) => {
      const path = await token.pathOf(note, ALICE);
      const before = await cells();
      actAs(sk);

      await expectRejection(token.burn(30n, note, path), ERR.rootNotRecognized);
      expect(await cells()).toStrictEqual(before);
    },
  );
});

// ---------------------------------------------------------------------------
// transferOwnership: handing the issuer role over
// ---------------------------------------------------------------------------

describe('CustodialConfidentialNoteFungibleToken: transferOwnership', () => {
  beforeEach(async () => {
    token = await deployAs(ISSUER_SK);
  });

  it('should set the owner and nothing else', async () => {
    const before = await cells();

    await token.transferOwnership(SUCCESSOR);

    expect(await cells()).toStrictEqual({ ...before, owner: SUCCESSOR });
    expect(await token.owner()).toStrictEqual(SUCCESSOR);
  });

  it('should move minting to the new issuer', async () => {
    await token.transferOwnership(SUCCESSOR);

    await expectRejection(token.mint(ALICE, 100n), ERR.notOwner);
    actAs(SUCCESSOR_SK);
    await expect(token.mint(ALICE, 100n)).resolves.toMatchObject({
      value: 100n,
    });
  });

  it('should let the new issuer hand the role back', async () => {
    await token.transferOwnership(SUCCESSOR);
    actAs(SUCCESSOR_SK);
    await token.transferOwnership(ISSUER);

    expect(await token.owner()).toStrictEqual(ISSUER);
    await expectRejection(token.mint(ALICE, 100n), ERR.notOwner);
    actAs(ISSUER_SK);
    await token.mint(ALICE, 100n);
  });

  it('should keep the issuer when handed to the current id', async () => {
    const before = await cells();

    await token.transferOwnership(ISSUER);

    expect(await cells()).toStrictEqual(before);
    await token.mint(ALICE, 100n);
  });

  it('should not accept a zero id', async () => {
    const before = await cells();

    await expectRejection(
      token.transferOwnership(ZERO_ACCOUNT),
      ERR.invalidNewOwner,
    );
    expect(await cells()).toStrictEqual(before);
  });

  it('should not accept a contract address', async () => {
    const before = await cells();

    await expectRejection(
      token.transferOwnership(CONTRACT),
      ERR.unsafeTransfer,
    );
    expect(await cells()).toStrictEqual(before);
  });

  it.each([
    { label: 'another secret', sk: MALLORY_SK },
    { label: "a holder's secret", sk: ALICE_SK },
  ])(
    'should not let $label hand over and leave the ledger unchanged',
    async ({ sk }) => {
      const before = await cells();
      actAs(sk);

      await expectRejection(
        token.transferOwnership(preset.deriveAccount(sk, ISSUER_SALT)),
        ERR.notOwner,
      );
      expect(await cells()).toStrictEqual(before);
    },
  );

  it('should leave holder notes spendable', async () => {
    const note = await issue(ALICE, 100n);
    await token.transferOwnership(SUCCESSOR);
    actAs(ALICE_SK);

    await token.burn(100n, note, await token.pathOf(note, ALICE));

    expect(await isSpent(note)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pure views
// ---------------------------------------------------------------------------

describe('CustodialConfidentialNoteFungibleToken: pure views', () => {
  beforeEach(async () => {
    token = await deployAs(ISSUER_SK);
  });

  it('should commit to the leaf the tree holds', async () => {
    const note = await token.mint(ALICE, 100n);
    const leaf = await token.commitOf(note, ALICE);

    expect(leaf).toStrictEqual(preset.commitOf(note, ALICE));
    expect(
      (await token.getPublicState()).Token_Core__commitments.findPathForLeaf(
        leaf,
      ),
    ).toBeDefined();
  });

  it('should nullify to the value a spend publishes', async () => {
    const note = await token.mint(ALICE, 100n);
    const nullifier = await token.nullifierOf(note);
    actAs(ALICE_SK);

    await token.burn(100n, note, await token.pathOf(note, ALICE));

    expect(nullifier).toStrictEqual(preset.nullifierOf(note));
    expect(
      (await token.getPublicState()).Token_Core__nullifiers.member(nullifier),
    ).toBe(true);
  });

  it('should derive the same account through the simulator and off-chain', async () => {
    expect(await token.deriveAccount(BOB_SK, NOTE_SALT)).toStrictEqual(BOB);
  });
});

// ---------------------------------------------------------------------------
// Simulator wiring
// ---------------------------------------------------------------------------

describe('CustodialConfidentialNoteFungibleToken: simulator wiring', () => {
  it('should key a default deployment to a fresh wallet', async () => {
    token = await CustodialConfidentialNoteFungibleTokenSimulator.create();

    expect(await token.owner()).toStrictEqual(
      preset.deriveAccount(token.wallet.secretKey, ISSUER_SALT),
    );
    await token.mint(ALICE, 1n);
  });

  it('should answer from explicit witnesses and leave the wallet disconnected', async () => {
    token = await CustodialConfidentialNoteFungibleTokenSimulator.create({
      witnesses: CustodialConfidentialNoteFungibleTokenWitnesses({
        secretKey: ISSUER_SK,
      }),
      issuer: ISSUER,
    });
    token.wallet.secretKey = MALLORY_SK;

    await expect(token.mint(ALICE, 1n)).resolves.toMatchObject({ value: 1n });
  });

  // `_create` skips `create`'s wiring, so the factory's fallback wallet
  // answers: a fresh random secret that matches no id a spec chose.
  describe.skipIf(isLiveBackend())('fallback witnesses', () => {
    it('should fall back to a fresh random secret without explicit witnesses', async () => {
      const bare =
        await CustodialConfidentialNoteFungibleTokenSimulator._create([
          ISSUER,
          ISSUER_SALT,
          NOTE_SALT,
          1n,
        ]);

      await expectRejection(bare.circuits.impure.mint(ALICE, 1n), ERR.notOwner);
    });
  });
});
