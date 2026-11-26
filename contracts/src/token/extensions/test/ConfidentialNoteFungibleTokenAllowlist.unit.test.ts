import type { MerkleTreePathEntry } from '@midnight-ntwrk/compact-runtime';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import { expectRejection } from '#test-utils/assertions/rejection.js';
import { pureCircuits as allowlist } from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenAllowlist/contract/index.js';
import { pureCircuits as composed } from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenAllowlisted/contract/index.js';
import { NOTE_SALT } from '../../presets/test/witnesses/CustodialConfidentialNoteFungibleTokenWitnesses.js';
import {
  ConfidentialNoteFungibleTokenAllowlistedSimulator,
  type Note,
} from './simulators/ConfidentialNoteFungibleTokenAllowlistedSimulator.js';
import {
  ConfidentialNoteFungibleTokenAllowlistSimulator,
  type Identifier,
  slotOf,
} from './simulators/ConfidentialNoteFungibleTokenAllowlistSimulator.js';

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

const ZERO = new Uint8Array(32);

/** A key-arm account. */
const keyAccount = (label: string): Identifier => ({
  is_left: true,
  left: bytes32(label),
  right: { bytes: ZERO },
});

/** A contract-arm account. */
const contractAccount = (label: string): Identifier => ({
  is_left: false,
  left: ZERO,
  right: { bytes: bytes32(label) },
});

/** `account` with garbage in its inactive arm. */
const nonCanonical = (account: Identifier): Identifier =>
  account.is_left
    ? { ...account, right: { bytes: bytes32('INACTIVE') } }
    : { ...account, left: bytes32('INACTIVE') };

/** The six members of the removal cases, allowed in this order. */
const MEMBERS = ['M0', 'M1', 'M2', 'M3', 'M4', 'M5'].map(keyAccount);
const OUTSIDER = keyAccount('OUTSIDER');

const ERR = {
  notAllowed: 'ConfidentialNoteFungibleTokenAllowlist: account not allowed',
  zeroAccount: 'ConfidentialNoteFungibleTokenAllowlist: zero account',
  alreadyAllowed:
    'ConfidentialNoteFungibleTokenAllowlist: account already allowed',
  spent: 'ConfidentialNoteFungibleToken: note already spent',
} as const;

/** Any 32 entries: no live leaf has this path. */
const ZERO_PATH: MerkleTreePathEntry[] = Array.from({ length: 32 }, () => ({
  sibling: { field: 0n },
  goes_left: false,
}));

/** `path` with the direction at `level` flipped. */
const flipAt = (
  path: MerkleTreePathEntry[],
  level: number,
): MerkleTreePathEntry[] =>
  path.map((entry, i) =>
    i === level ? { ...entry, goes_left: !entry.goes_left } : entry,
  );

/** 64 calls; on live the project's own timeout applies. */
const FLIPPED_PATH_TIMEOUT = isLiveBackend() ? undefined : 30_000;

let list: ConfidentialNoteFungibleTokenAllowlistSimulator;

/** Every cell the extension publishes, in a form `toStrictEqual` compares. */
const cells = async () => {
  const state = await list.getPublicState();
  return {
    root: state.Allowlist__allowed.root(),
    firstFree: state.Allowlist__allowed.firstFree(),
    history: Array.from({
      [Symbol.iterator]: () => state.Allowlist__allowed.history(),
    }),
    members: [...state.Allowlist__members].map(hex).sort(),
  };
};

const isMember = async (account: Identifier): Promise<boolean> =>
  (await list.getPublicState()).Allowlist__members.member(
    allowlist.leafOf(account),
  );

/** The fresh path of `account`, or undefined when it has no live leaf. */
const freshPath = async (
  account: Identifier,
): Promise<MerkleTreePathEntry[] | undefined> =>
  (await list.getPublicState()).Allowlist__allowed.findPathForLeaf(
    allowlist.leafOf(account),
  )?.path;

/** The path `slot` would have if it held `account`'s leaf. */
const pathAtSlot = async (
  slot: bigint,
  account: Identifier,
): Promise<MerkleTreePathEntry[]> =>
  (await list.getPublicState()).Allowlist__allowed.pathForLeaf(
    slot,
    allowlist.leafOf(account),
  ).path;

/** `account`'s path in a separate deployment that lists it. */
const foreignPath = async (
  account: Identifier,
): Promise<MerkleTreePathEntry[]> => {
  const other = await ConfidentialNoteFungibleTokenAllowlistSimulator.create();
  await other._allow(account);
  return other.allowPathOf(account);
};

const allowAll = async (accounts: Identifier[]): Promise<void> => {
  for (const account of accounts) {
    await list._allow(account);
  }
};

const pathsOf = (accounts: Identifier[]): Promise<MerkleTreePathEntry[][]> =>
  Promise.all(accounts.map((account) => list.allowPathOf(account)));

// ---------------------------------------------------------------------------
// A fresh deployment
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenAllowlist: a fresh deployment', () => {
  beforeEach(async () => {
    list = await ConfidentialNoteFungibleTokenAllowlistSimulator.create();
  });

  it('should start with no member and no leaf', async () => {
    const state = await list.getPublicState();

    expect(state.Allowlist__members.isEmpty()).toBe(true);
    expect(state.Allowlist__allowed.firstFree()).toBe(0n);
    expect(await freshPath(OUTSIDER)).toBeUndefined();
  });

  it.each([
    { label: 'a zero path', path: async () => ZERO_PATH },
    { label: 'its path in another list', path: () => foreignPath(OUTSIDER) },
  ])('should allow nobody with $label', async ({ path }) => {
    const before = await cells();

    await expectRejection(
      list.assertAllowed(OUTSIDER, await path()),
      ERR.notAllowed,
    );
    expect(await cells()).toStrictEqual(before);
  });

  it.each([
    { label: 'a zero path', path: async () => ZERO_PATH },
    { label: 'its path in another list', path: () => foreignPath(OUTSIDER) },
  ])('should remove nobody with $label', async ({ path }) => {
    const before = await cells();

    await expectRejection(
      list._disallow(OUTSIDER, await path()),
      ERR.notAllowed,
    );
    expect(await cells()).toStrictEqual(before);
  });
});

// ---------------------------------------------------------------------------
// _allow
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenAllowlist: _allow', () => {
  beforeEach(async () => {
    list = await ConfidentialNoteFungibleTokenAllowlistSimulator.create();
  });

  it('should add one leaf at the first free slot and record it as live', async () => {
    await allowAll(MEMBERS.slice(0, 3));

    const state = await list.getPublicState();
    expect(state.Allowlist__allowed.firstFree()).toBe(3n);
    expect(state.Allowlist__members.size()).toBe(3n);
    for (const [slot, account] of MEMBERS.slice(0, 3).entries()) {
      expect(await isMember(account)).toBe(true);
      expect(slotOf(await list.allowPathOf(account))).toBe(BigInt(slot));
    }
  });

  it.each([
    { label: 'the zero key', account: keyAccount('') },
    { label: 'the zero contract', account: contractAccount('') },
    {
      label: 'the zero key with a non-zero inactive arm',
      account: nonCanonical(keyAccount('')),
    },
  ])('should not allow $label', async ({ account }) => {
    const before = await cells();

    await expectRejection(list._allow(account), ERR.zeroAccount);
    expect(await cells()).toStrictEqual(before);
  });

  it.each([
    { label: 'the same account', variant: (a: Identifier) => a },
    { label: 'a non-canonical form of it', variant: nonCanonical },
  ])('should not allow $label twice while it is live', async ({ variant }) => {
    await list._allow(MEMBERS[0]);
    const before = await cells();

    await expectRejection(list._allow(variant(MEMBERS[0])), ERR.alreadyAllowed);
    expect(await cells()).toStrictEqual(before);
  });

  it('should allow a contract-arm account', async () => {
    const vault = contractAccount('VAULT');
    await list._allow(vault);

    await list.assertAllowed(vault, await list.allowPathOf(vault));
    expect(await isMember(vault)).toBe(true);
  });

  it('should keep a key arm and a contract arm with equal bytes apart', async () => {
    const key = keyAccount('SHARED');
    const contract = contractAccount('SHARED');
    await list._allow(key);
    await list._allow(contract);

    expect(await isMember(key)).toBe(true);
    expect(await isMember(contract)).toBe(true);
    expect(slotOf(await list.allowPathOf(key))).toBe(0n);
    expect(slotOf(await list.allowPathOf(contract))).toBe(1n);
  });

  it('should invalidate no path it did not touch', async () => {
    await list._allow(MEMBERS[0]);
    const early = await list.allowPathOf(MEMBERS[0]);
    await allowAll(MEMBERS.slice(1));

    await list.assertAllowed(MEMBERS[0], early);
  });
});

// ---------------------------------------------------------------------------
// assertAllowed
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenAllowlist: assertAllowed', () => {
  beforeEach(async () => {
    list = await ConfidentialNoteFungibleTokenAllowlistSimulator.create();
    await allowAll(MEMBERS);
  });

  it('should pass every member with its fresh path and write nothing', async () => {
    const before = await cells();

    for (const account of MEMBERS) {
      await list.assertAllowed(account, await list.allowPathOf(account));
    }
    expect(await cells()).toStrictEqual(before);
  });

  it('should find no path for a non-member', async () => {
    await expect(list.allowPathOf(OUTSIDER)).rejects.toThrow(
      'allowPathOf: leaf not found in tree',
    );
  });

  it.each([
    { label: 'a zero path', path: async () => ZERO_PATH },
    { label: "a member's path", path: () => list.allowPathOf(MEMBERS[2]) },
    { label: 'its path in another list', path: () => foreignPath(OUTSIDER) },
  ])('should not pass a non-member with $label', async ({ path }) => {
    await expectRejection(
      list.assertAllowed(OUTSIDER, await path()),
      ERR.notAllowed,
    );
  });

  it("should not pass a member with another member's path", async () => {
    const path = await list.allowPathOf(MEMBERS[2]);

    await expectRejection(list.assertAllowed(MEMBERS[1], path), ERR.notAllowed);
    await list.assertAllowed(MEMBERS[2], path);
  });

  it('should pass a non-canonical form of a member with its path', async () => {
    const path = await list.allowPathOf(MEMBERS[3]);

    await list.assertAllowed(nonCanonical(MEMBERS[3]), path);
  });

  it("should not pass a contract arm carrying a member's key bytes", async () => {
    const path = await list.allowPathOf(MEMBERS[3]);
    const lookalike: Identifier = {
      is_left: false,
      left: ZERO,
      right: { bytes: MEMBERS[3].left },
    };

    await expectRejection(list.assertAllowed(lookalike, path), ERR.notAllowed);
  });

  it('should keep passing a path fetched before later additions', async () => {
    const early = await list.allowPathOf(MEMBERS[4]);
    await allowAll(['N0', 'N1', 'N2'].map(keyAccount));

    await list.assertAllowed(MEMBERS[4], early);
    expect(await list.allowPathOf(MEMBERS[4])).not.toStrictEqual(early);
  });
});

// ---------------------------------------------------------------------------
// _disallow: removal at index 1, then index 4
// ---------------------------------------------------------------------------

/**
 * Every earlier path fails after any removal, so a removal is shown complete
 * by what the fresh tree holds: the removed member has no path, and the
 * others keep theirs at their old slots. Slots 1 and 4 are asymmetric under
 * the index fold, so a reversed bit order tombstones another slot.
 */
describe('ConfidentialNoteFungibleTokenAllowlist: _disallow at index 1 and 4', () => {
  let captured: MerkleTreePathEntry[][];

  /** Asserts every account in `live` has a fresh path at its original slot that passes. */
  const expectLiveAtTheirSlots = async (live: number[]): Promise<void> => {
    for (const slot of live) {
      const path = await list.allowPathOf(MEMBERS[slot]);
      expect(slotOf(path)).toBe(BigInt(slot));
      await list.assertAllowed(MEMBERS[slot], path);
    }
  };

  /** Asserts `removed` is gone from the tree and from `_members`. */
  const expectRemoved = async (removed: number): Promise<void> => {
    const account = MEMBERS[removed];
    expect(await freshPath(account)).toBeUndefined();
    await expect(list.allowPathOf(account)).rejects.toThrow(
      'allowPathOf: leaf not found in tree',
    );
    expect(await isMember(account)).toBe(false);
    await expectRejection(
      list.assertAllowed(account, captured[removed]),
      ERR.notAllowed,
    );
    await expectRejection(
      list.assertAllowed(account, await pathAtSlot(BigInt(removed), account)),
      ERR.notAllowed,
    );
  };

  beforeEach(async () => {
    list = await ConfidentialNoteFungibleTokenAllowlistSimulator.create();
    await allowAll(MEMBERS);
    captured = await pathsOf(MEMBERS);
  });

  it('should capture paths that fold to slots 0 to 5', () => {
    expect(captured.map(slotOf)).toStrictEqual([0n, 1n, 2n, 3n, 4n, 5n]);
  });

  it('should remove the member at index 1 and only it', async () => {
    await list._disallow(MEMBERS[1], captured[1]);

    await expectRemoved(1);
    await expectRejection(
      list.assertAllowed(MEMBERS[3], captured[3]),
      ERR.notAllowed,
    );
    await expectLiveAtTheirSlots([0, 2, 3, 4, 5]);

    const state = await list.getPublicState();
    expect(state.Allowlist__members.size()).toBe(5n);
    expect(state.Allowlist__allowed.firstFree()).toBe(6n);
  });

  it('should then remove the member at index 4 with a path fetched after the first removal', async () => {
    await list._disallow(MEMBERS[1], captured[1]);
    const refetched = await pathsOf(MEMBERS.filter((_, i) => i !== 1));
    const pathOf4 = refetched[3];
    expect(slotOf(pathOf4)).toBe(4n);

    await list._disallow(MEMBERS[4], pathOf4);

    await expectRemoved(4);
    await expectRejection(
      list.assertAllowed(MEMBERS[0], refetched[0]),
      ERR.notAllowed,
    );
    await expectLiveAtTheirSlots([0, 2, 3, 5]);

    const state = await list.getPublicState();
    expect(state.Allowlist__members.size()).toBe(4n);
    expect(state.Allowlist__allowed.firstFree()).toBe(6n);
  });

  it('should give two later additions slots 6 and 7 and keep all six live paths valid', async () => {
    await list._disallow(MEMBERS[1], captured[1]);
    await list._disallow(MEMBERS[4], await list.allowPathOf(MEMBERS[4]));
    const added = ['N6', 'N7'].map(keyAccount);
    await allowAll(added);

    const state = await list.getPublicState();
    expect(state.Allowlist__allowed.firstFree()).toBe(8n);
    expect(state.Allowlist__members.size()).toBe(6n);
    expect(slotOf(await list.allowPathOf(added[0]))).toBe(6n);
    expect(slotOf(await list.allowPathOf(added[1]))).toBe(7n);
    await expectLiveAtTheirSlots([0, 2, 3, 5]);
    for (const account of added) {
      await list.assertAllowed(account, await list.allowPathOf(account));
    }
  });

  it('should keep a removal path built before a later addition aimed at the right slot', async () => {
    const pathOf4 = await list.allowPathOf(MEMBERS[4]);
    await list._allow(keyAccount('N6'));

    await list._disallow(MEMBERS[4], pathOf4);

    await expectRemoved(4);
    await expectLiveAtTheirSlots([0, 1, 2, 3, 5]);
  });
});

// ---------------------------------------------------------------------------
// _disallow: fails closed
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenAllowlist: _disallow fails closed', () => {
  beforeEach(async () => {
    list = await ConfidentialNoteFungibleTokenAllowlistSimulator.create();
    await allowAll(MEMBERS);
  });

  /** Asserts `_disallow(account, path)` fails and leaves the ledger as it was. */
  const expectRefused = async (
    account: Identifier,
    path: MerkleTreePathEntry[],
  ): Promise<void> => {
    const before = await cells();
    await expectRejection(list._disallow(account, path), ERR.notAllowed);
    expect(await cells()).toStrictEqual(before);
  };

  it('should not remove a non-member with a zero path', async () => {
    await expectRefused(OUTSIDER, ZERO_PATH);
  });

  it("should not remove a non-member with a member's path", async () => {
    await expectRefused(OUTSIDER, await list.allowPathOf(MEMBERS[2]));
  });

  it("should not remove a member with another member's path", async () => {
    const path = await list.allowPathOf(MEMBERS[2]);

    await expectRefused(MEMBERS[3], path);
    await list._disallow(MEMBERS[2], path);
    expect(await isMember(MEMBERS[2])).toBe(false);
  });

  it('should not remove a member with its path from before another removal', async () => {
    const stale = await list.allowPathOf(MEMBERS[3]);
    await list._disallow(MEMBERS[1], await list.allowPathOf(MEMBERS[1]));

    await expectRefused(MEMBERS[3], stale);
    await list._disallow(MEMBERS[3], await list.allowPathOf(MEMBERS[3]));
    expect(await isMember(MEMBERS[3])).toBe(false);
  });

  it('should not remove a member twice', async () => {
    const path = await list.allowPathOf(MEMBERS[1]);
    await list._disallow(MEMBERS[1], path);

    await expectRefused(MEMBERS[1], path);
    await expectRefused(MEMBERS[1], await pathAtSlot(1n, MEMBERS[1]));
  });

  // Any single flipped direction moves the computed root off every recognized
  // one, so a crafted path can neither prove membership nor pick another slot.
  it(
    'should reject a fresh path with one direction flipped, at every level',
    async () => {
      const path = await list.allowPathOf(MEMBERS[4]);
      const before = await cells();

      for (let level = 0; level < path.length; level++) {
        const crafted = flipAt(path, level);
        await expectRejection(
          list.assertAllowed(MEMBERS[4], crafted),
          ERR.notAllowed,
        );
        await expectRejection(
          list._disallow(MEMBERS[4], crafted),
          ERR.notAllowed,
        );
      }
      expect(await cells()).toStrictEqual(before);

      await list._disallow(MEMBERS[4], path);
      expect(await isMember(MEMBERS[4])).toBe(false);
    },
    FLIPPED_PATH_TIMEOUT,
  );
});

// ---------------------------------------------------------------------------
// Re-allowing a removed account
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenAllowlist: re-allowing a removed account', () => {
  beforeEach(async () => {
    list = await ConfidentialNoteFungibleTokenAllowlistSimulator.create();
    await allowAll(MEMBERS);
    await list._disallow(MEMBERS[1], await list.allowPathOf(MEMBERS[1]));
  });

  it('should take a new slot and leave the old one empty', async () => {
    await list._allow(MEMBERS[1]);

    const path = await list.allowPathOf(MEMBERS[1]);
    expect(slotOf(path)).toBe(6n);
    await list.assertAllowed(MEMBERS[1], path);
    await expectRejection(
      list.assertAllowed(MEMBERS[1], await pathAtSlot(1n, MEMBERS[1])),
      ERR.notAllowed,
    );
    expect((await list.getPublicState()).Allowlist__allowed.firstFree()).toBe(
      7n,
    );
  });

  it('should be removed again by one _disallow', async () => {
    await list._allow(MEMBERS[1]);
    await list._disallow(MEMBERS[1], await list.allowPathOf(MEMBERS[1]));

    expect(await freshPath(MEMBERS[1])).toBeUndefined();
    expect(await isMember(MEMBERS[1])).toBe(false);
    expect((await list.getPublicState()).Allowlist__members.size()).toBe(5n);
  });
});

// ---------------------------------------------------------------------------
// leafOf
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenAllowlist: leafOf', () => {
  it('should ignore the inactive arm', () => {
    for (const account of [keyAccount('A'), contractAccount('A')]) {
      expect(allowlist.leafOf(nonCanonical(account))).toStrictEqual(
        allowlist.leafOf(account),
      );
    }
  });

  it('should tell a key arm from a contract arm with equal bytes', () => {
    expect(allowlist.leafOf(keyAccount('A'))).not.toStrictEqual(
      allowlist.leafOf(contractAccount('A')),
    );
  });

  it('should agree between the standalone and the composed mock', () => {
    for (const account of [keyAccount('A'), contractAccount('A')]) {
      expect(composed.leafOf(account)).toStrictEqual(allowlist.leafOf(account));
    }
  });
});

// ---------------------------------------------------------------------------
// Composed with the core
// ---------------------------------------------------------------------------

/**
 * Every check fails with the same message, so each rejection below is paired
 * with the call that passes once the one input under test is corrected.
 */
describe('ConfidentialNoteFungibleTokenAllowlist: composed with the core', () => {
  const ALICE_SK = bytes32('ALICE');
  const BOB_SK = bytes32('BOB');
  const CAROL_SK = bytes32('CAROL');
  const MALLORY_SK = bytes32('MALLORY');
  const ALICE = composed.deriveIdentifier(ALICE_SK, NOTE_SALT);
  const BOB = composed.deriveIdentifier(BOB_SK, NOTE_SALT);
  const CAROL = composed.deriveIdentifier(CAROL_SK, NOTE_SALT);
  const MALLORY = composed.deriveIdentifier(MALLORY_SK, NOTE_SALT);

  let token: ConfidentialNoteFungibleTokenAllowlistedSimulator;
  let note: Note;

  const actAs = (sk: Uint8Array): void => {
    token.wallet.secretKey = sk;
  };

  /** Every cell the mock publishes, in a form `toStrictEqual` compares. */
  const state = async () => {
    const s = await token.getPublicState();
    return {
      commitments: s.Core__commitments.firstFree(),
      nullifiers: s.Core__nullifiers.size(),
      issuedNonces: s.Core__issuedNonces.size(),
      allowRoot: s.Allowlist__allowed.root(),
      allowFirstFree: s.Allowlist__allowed.firstFree(),
      members: [...s.Allowlist__members].map(hex).sort(),
    };
  };

  const isCommitted = async (n: Note, ownerPk: Identifier): Promise<boolean> =>
    (await token.getPublicState()).Core__commitments.findPathForLeaf(
      composed.commitOf(n, ownerPk),
    ) !== undefined;

  /** Asserts `call` fails the allowlist and leaves the ledger as it was. */
  const expectNotAllowed = async (call: () => Promise<unknown>) => {
    const before = await state();
    await expectRejection(call(), ERR.notAllowed);
    expect(await state()).toStrictEqual(before);
  };

  beforeEach(async () => {
    token = await ConfidentialNoteFungibleTokenAllowlistedSimulator.create();
    for (const account of [ALICE, BOB, CAROL]) {
      await token._allow(account);
    }
    note = await token.mint(ALICE, 100n, await token.allowPathOf(ALICE));
    actAs(ALICE_SK);
  });

  describe('mint', () => {
    it('should mint to a listed recipient', async () => {
      expect(note.value).toBe(100n);
      expect(await isCommitted(note, ALICE)).toBe(true);
    });

    it.each([
      { label: 'a zero path', path: async () => ZERO_PATH },
      { label: "a member's path", path: () => token.allowPathOf(BOB) },
    ])('should not mint to a non-member with $label', async ({ path }) => {
      const allowPath = await path();
      await expectNotAllowed(() => token.mint(MALLORY, 10n, allowPath));
    });

    it('should find no commitment path for a note never minted', async () => {
      await expect(
        token.pathOf({ value: 1n, nonce: 1n }, ALICE),
      ).rejects.toThrow('pathOf: commitment not found in tree');
    });
  });

  describe('transfer', () => {
    it('should move value between two members', async () => {
      const [out, change] = await token.transfer(
        BOB,
        30n,
        note,
        await token.pathOf(note, ALICE),
        await token.allowPathOf(ALICE),
        await token.allowPathOf(BOB),
      );

      expect(out.value).toBe(30n);
      expect(change.value).toBe(70n);
      expect(await isCommitted(out, BOB)).toBe(true);
      expect(await isCommitted(change, ALICE)).toBe(true);
    });

    it.each([
      { label: 'a zero path', path: async () => ZERO_PATH },
      { label: "a member's path", path: () => token.allowPathOf(BOB) },
    ])('should not transfer to a non-member with $label', async ({ path }) => {
      const notePath = await token.pathOf(note, ALICE);
      const spenderPath = await token.allowPathOf(ALICE);
      const recipientPath = await path();

      await expectNotAllowed(() =>
        token.transfer(
          MALLORY,
          30n,
          note,
          notePath,
          spenderPath,
          recipientPath,
        ),
      );
      await token.transfer(
        BOB,
        30n,
        note,
        notePath,
        spenderPath,
        await token.allowPathOf(BOB),
      );
    });

    // Only the acting secret differs from the passing call, so the spender
    // check is the one that fired.
    it("should not let a non-member spend with a member's path", async () => {
      const notePath = await token.pathOf(note, ALICE);
      const alicePath = await token.allowPathOf(ALICE);
      const bobPath = await token.allowPathOf(BOB);
      actAs(MALLORY_SK);

      await expectNotAllowed(() =>
        token.transfer(BOB, 30n, note, notePath, alicePath, bobPath),
      );
      actAs(ALICE_SK);
      await token.transfer(BOB, 30n, note, notePath, alicePath, bobPath);
    });

    it("should not let a member spend with another member's path", async () => {
      const notePath = await token.pathOf(note, ALICE);
      const bobPath = await token.allowPathOf(BOB);

      await expectNotAllowed(() =>
        token.transfer(BOB, 30n, note, notePath, bobPath, bobPath),
      );
      await token.transfer(
        BOB,
        30n,
        note,
        notePath,
        await token.allowPathOf(ALICE),
        bobPath,
      );
    });

    it('should not spend one note twice', async () => {
      const notePath = await token.pathOf(note, ALICE);
      const alicePath = await token.allowPathOf(ALICE);
      const bobPath = await token.allowPathOf(BOB);
      await token.transfer(BOB, 30n, note, notePath, alicePath, bobPath);
      const before = await state();

      await expectRejection(
        token.transfer(BOB, 30n, note, notePath, alicePath, bobPath),
        ERR.spent,
      );
      await expectRejection(
        token.burn(30n, note, notePath, alicePath),
        ERR.spent,
      );
      expect(await state()).toStrictEqual(before);
    });
  });

  describe('burn', () => {
    it('should burn for a listed spender', async () => {
      const change = await token.burn(
        30n,
        note,
        await token.pathOf(note, ALICE),
        await token.allowPathOf(ALICE),
      );

      expect(change.value).toBe(70n);
      expect(await isCommitted(change, ALICE)).toBe(true);
    });

    it("should not burn with another member's path", async () => {
      const notePath = await token.pathOf(note, ALICE);
      const bobPath = await token.allowPathOf(BOB);

      await expectNotAllowed(() => token.burn(30n, note, notePath, bobPath));
      await token.burn(30n, note, notePath, await token.allowPathOf(ALICE));
    });
  });

  describe('after a removal', () => {
    let carolNote: Note;
    let stale: Record<'alice' | 'bob' | 'carol', MerkleTreePathEntry[]>;

    beforeEach(async () => {
      carolNote = await token.mint(CAROL, 50n, await token.allowPathOf(CAROL));
      stale = {
        alice: await token.allowPathOf(ALICE),
        bob: await token.allowPathOf(BOB),
        carol: await token.allowPathOf(CAROL),
      };
      await token._disallow(CAROL, stale.carol);
    });

    it('should leave the removed member no path', async () => {
      await expect(token.allowPathOf(CAROL)).rejects.toThrow(
        'allowPathOf: leaf not found in tree',
      );
    });

    /**
     * Carol's two candidate paths: the one she held before her removal, and
     * the current tree's path for her old slot (index 2).
     */
    const carolPaths = async (): Promise<MerkleTreePathEntry[][]> => {
      const atSlot = (
        await token.getPublicState()
      ).Allowlist__allowed.pathForLeaf(2n, composed.leafOf(CAROL)).path;
      expect(slotOf(atSlot)).toBe(2n);
      return [stale.carol, atSlot];
    };

    it('should not let the removed member spend', async () => {
      const notePath = await token.pathOf(carolNote, CAROL);
      const alicePath = await token.allowPathOf(ALICE);
      actAs(CAROL_SK);

      for (const carolPath of await carolPaths()) {
        await expectNotAllowed(() =>
          token.transfer(ALICE, 10n, carolNote, notePath, carolPath, alicePath),
        );
        await expectNotAllowed(() =>
          token.burn(10n, carolNote, notePath, carolPath),
        );
      }
    });

    it('should not let the removed member receive', async () => {
      const notePath = await token.pathOf(note, ALICE);
      const alicePath = await token.allowPathOf(ALICE);

      for (const carolPath of await carolPaths()) {
        await expectNotAllowed(() => token.mint(CAROL, 10n, carolPath));
        await expectNotAllowed(() =>
          token.transfer(CAROL, 10n, note, notePath, alicePath, carolPath),
        );
      }
    });

    it('should fail the other members on their earlier paths', async () => {
      const notePath = await token.pathOf(note, ALICE);

      await expectNotAllowed(() =>
        token.transfer(BOB, 10n, note, notePath, stale.alice, stale.bob),
      );
      await expectNotAllowed(() => token.mint(BOB, 10n, stale.bob));
    });

    it('should let the other members go on with fresh paths', async () => {
      const [out] = await token.transfer(
        BOB,
        10n,
        note,
        await token.pathOf(note, ALICE),
        await token.allowPathOf(ALICE),
        await token.allowPathOf(BOB),
      );
      actAs(BOB_SK);
      const change = await token.burn(
        10n,
        out,
        await token.pathOf(out, BOB),
        await token.allowPathOf(BOB),
      );

      expect(change.value).toBe(0n);
      await token.mint(ALICE, 5n, await token.allowPathOf(ALICE));
    });
  });
});

// ---------------------------------------------------------------------------
// Fallback witnesses
// ---------------------------------------------------------------------------

// `_create` skips `create`'s wiring, so the factory's fallback wallet answers:
// a fresh random secret that matches no listed account.
describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenAllowlist: fallback witnesses',
  () => {
    it('should fall back to a fresh random secret without explicit witnesses', async () => {
      const alice = composed.deriveIdentifier(bytes32('ALICE'), NOTE_SALT);
      const bare =
        (await ConfidentialNoteFungibleTokenAllowlistedSimulator._create([
          NOTE_SALT,
        ])) as ConfidentialNoteFungibleTokenAllowlistedSimulator;
      await bare._allow(alice);
      const alicePath = await bare.allowPathOf(alice);
      const note = await bare.mint(alice, 100n, alicePath);

      await expectRejection(
        bare.burn(30n, note, await bare.pathOf(note, alice), alicePath),
        ERR.notAllowed,
      );
    });
  },
);
