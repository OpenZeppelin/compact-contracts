/**
 * Privacy claims for the ConfidentialNoteFungibleTokenAllowlist extension, as
 * executable assertions.
 *
 * The probes drive the mocks directly so every call keeps its `proofData`:
 *
 *   publicTranscript          the ledger operations the transaction publishes
 *
 * The claims:
 *
 *   1. `assertAllowed` publishes one recognized root and nothing else, so two
 *      members under one root publish byte-identical transcripts,
 *   2. `_allow` publishes the leaf, `_disallow` the root, the leaf and its
 *      index (the stated leaks), and neither publishes the account,
 *   3. a composed `mint`, `transfer` or `burn` has one transcript shape and
 *      width for any member and any amount,
 *   4. the disclose surface of the source is the reviewed one.
 *
 * Leaves are unsalted, so the leaf and the account are linkable by anyone who
 * holds a candidate account. That is a stated leak, not a claim tested here.
 *
 * Everything runs dry: the probes read `proofData`, which the live backend
 * does not return.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type {
  AlignedValue,
  CircuitContext,
  CircuitResults,
  MerkleTreePathEntry,
  Op,
} from '@midnight-ntwrk/compact-runtime';
import {
  bigIntToValue,
  dummyContractAddress,
} from '@midnight-ntwrk/compact-runtime';
import {
  CircuitContextManager,
  isLiveBackend,
} from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  pureCircuits as allowlist,
  Contract as MockAllowlist,
  ledger as standaloneLedger,
} from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenAllowlist/contract/index.js';
import {
  type Ledger as ComposedLedger,
  pureCircuits as composed,
  ledger as composedLedger,
  Contract as MockAllowlisted,
} from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenAllowlisted/contract/index.js';
import {
  CustodialConfidentialNoteFungibleTokenWitnesses,
  type CustodialWallet,
  NOTE_SALT,
} from '../../presets/test/witnesses/CustodialConfidentialNoteFungibleTokenWitnesses.js';
import type { Note } from './simulators/ConfidentialNoteFungibleTokenAllowlistedSimulator.js';
import type { Identifier } from './simulators/ConfidentialNoteFungibleTokenAllowlistSimulator.js';

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/** High-entropy 32 bytes from a label, so no encoding matches by chance. */
const digest32 = (label: string): Uint8Array =>
  new Uint8Array(createHash('sha256').update(label).digest());

const ZERO = new Uint8Array(32);

const keyAccount = (label: string): Identifier => ({
  is_left: true,
  left: digest32(label),
  right: { bytes: ZERO },
});

/** Six members, allowed in this order into slots 0 to 5. */
const MEMBERS = ['M0', 'M1', 'M2', 'M3', 'M4', 'M5'].map(keyAccount);

// Planted so two probes derive byte-identical notes.
const SEED = digest32('DIFFERENTIAL-SEED');

/** Neither mock declares private state. */
type PrivateState = Record<string, never>;

type Trace = Op<AlignedValue>[];

/** Block time the probes deploy at, pinned so two runs agree on every input. */
const PROBE_TIME = 0;

/** Runs one circuit against `manager` and keeps the root call's transcript. */
const runOn = async <T>(
  manager: CircuitContextManager<PrivateState>,
  call: (
    context: CircuitContext<PrivateState>,
  ) => Promise<CircuitResults<PrivateState, T>>,
): Promise<[T, Trace]> => {
  const { result, context } = await call(manager.getContext());
  manager.setContext(context);
  // One entry per call in the tree, depth-first, so the root circuit is last.
  const proofData = context.callProofDataTrace.at(-1);
  if (proofData === undefined) {
    throw new Error('probe: circuit produced no proof data');
  }
  return [result, proofData.publicTranscript];
};

// ---------------------------------------------------------------------------
// Probe: the standalone mock
// ---------------------------------------------------------------------------

class ListProbe {
  private readonly contract = new MockAllowlist<PrivateState>({});
  private readonly manager = new CircuitContextManager<PrivateState>(
    this.contract,
    {},
    '0'.repeat(64),
    dummyContractAddress(),
    PROBE_TIME,
  );

  /** A list holding `accounts`, allowed in order. */
  static async holding(accounts: Identifier[]): Promise<ListProbe> {
    const probe = new ListProbe();
    await probe.manager.init();
    for (const account of accounts) {
      await probe.allow(account);
    }
    return probe;
  }

  allow(account: Identifier): Promise<[[], Trace]> {
    return runOn(this.manager, (ctx) =>
      this.contract.impureCircuits._allow(ctx, account),
    );
  }

  check(account: Identifier): Promise<[[], Trace]> {
    const path = this.pathOf(account);
    return runOn(this.manager, (ctx) =>
      this.contract.impureCircuits.assertAllowed(ctx, account, path),
    );
  }

  disallow(account: Identifier): Promise<[[], Trace]> {
    const path = this.pathOf(account);
    return runOn(this.manager, (ctx) =>
      this.contract.impureCircuits._disallow(ctx, account, path),
    );
  }

  get state() {
    return standaloneLedger(
      this.manager.getContext().callContext.currentQueryContext.state.state,
    );
  }

  private pathOf(account: Identifier): MerkleTreePathEntry[] {
    const path = this.state.Allowlist__allowed.findPathForLeaf(
      allowlist.leafOf(account),
    );
    if (path === undefined) throw new Error('probe: account not listed');
    return path.path;
  }
}

// ---------------------------------------------------------------------------
// Probe: the composed mock
// ---------------------------------------------------------------------------

const secretOf = (label: string): Uint8Array => digest32(`sk:${label}`);
const HOLDERS = ['alice', 'bob', 'carol'] as const;
type Holder = (typeof HOLDERS)[number];
const accountOf = (holder: Holder): Identifier =>
  composed.deriveIdentifier(secretOf(holder), NOTE_SALT);

class TokenProbe {
  readonly wallet: CustodialWallet = {
    secretKey: secretOf('alice'),
    nonceSeed: SEED,
  };
  private readonly contract = new MockAllowlisted<PrivateState>(
    CustodialConfidentialNoteFungibleTokenWitnesses<
      ComposedLedger,
      PrivateState
    >(this.wallet),
  );
  private readonly manager = new CircuitContextManager<PrivateState>(
    this.contract,
    {},
    '0'.repeat(64),
    dummyContractAddress(),
    PROBE_TIME,
    NOTE_SALT,
  );

  /** A deployment listing the three holders. */
  static async create(): Promise<TokenProbe> {
    const probe = new TokenProbe();
    await probe.manager.init();
    for (const holder of HOLDERS) {
      await runOn(probe.manager, (ctx) =>
        probe.contract.impureCircuits._allow(ctx, accountOf(holder)),
      );
    }
    return probe;
  }

  /** A deployment where `holder` holds a note of `value`, acting as `holder`. */
  static async holding(
    holder: Holder,
    value: bigint,
  ): Promise<[TokenProbe, Note]> {
    const probe = await TokenProbe.create();
    const [note] = await probe.mint(accountOf(holder), value);
    probe.wallet.secretKey = secretOf(holder);
    return [probe, note];
  }

  mint(recipient: Identifier, value: bigint): Promise<[Note, Trace]> {
    const allowPath = this.allowPathOf(recipient);
    return runOn(this.manager, (ctx) =>
      this.contract.impureCircuits.mint(ctx, recipient, value, allowPath),
    );
  }

  transfer(
    owner: Holder,
    recipient: Holder,
    value: bigint,
    note: Note,
  ): Promise<[[Note, Note], Trace]> {
    const args = [
      accountOf(recipient),
      value,
      note,
      this.notePathOf(note, accountOf(owner)),
      this.allowPathOf(accountOf(owner)),
      this.allowPathOf(accountOf(recipient)),
    ] as const;
    return runOn(this.manager, (ctx) =>
      this.contract.impureCircuits.transfer(ctx, ...args),
    );
  }

  burn(owner: Holder, value: bigint, note: Note): Promise<[Note, Trace]> {
    const notePath = this.notePathOf(note, accountOf(owner));
    const allowPath = this.allowPathOf(accountOf(owner));
    return runOn(this.manager, (ctx) =>
      this.contract.impureCircuits.burn(ctx, value, note, notePath, allowPath),
    );
  }

  get state(): ComposedLedger {
    return composedLedger(
      this.manager.getContext().callContext.currentQueryContext.state.state,
    );
  }

  private allowPathOf(account: Identifier): MerkleTreePathEntry[] {
    const path = this.state.Allowlist__allowed.findPathForLeaf(
      composed.leafOf(account),
    );
    if (path === undefined) throw new Error('probe: account not listed');
    return path.path;
  }

  private notePathOf(note: Note, owner: Identifier): MerkleTreePathEntry[] {
    const path = this.state.Core__commitments.findPathForLeaf(
      composed.commitOf(note, owner),
    );
    if (path === undefined) throw new Error('probe: note not committed');
    return path.path;
  }
}

// ---------------------------------------------------------------------------
// Reading a transcript
// ---------------------------------------------------------------------------

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

/** The runtime stores byte values with trailing zeros stripped. */
const encoded = (bytes: Uint8Array): string => {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return hex(bytes.subarray(0, end));
};

/** Every byte string appearing anywhere in a transcript. */
const bytesIn = (node: unknown, found: string[] = []): string[] => {
  if (node instanceof Uint8Array) {
    found.push(hex(node));
  } else if (Array.isArray(node)) {
    for (const child of node) bytesIn(child, found);
  } else if (node !== null && typeof node === 'object') {
    for (const child of Object.values(node)) bytesIn(child, found);
  }
  return found;
};

const opKind = (op: Op<AlignedValue>): string =>
  typeof op === 'string' ? op : (Object.keys(op as object)[0] ?? '?');

/** The operation sequence with every operand stripped: the public shape. */
const shapeOf = (transcript: Trace): string[] => transcript.map(opKind);

/** Encodings a field value can take in a transcript. */
const encodingsOf = (value: bigint): string[] => bigIntToValue(value).map(hex);

const appearsIn = (published: string[], value: bigint): boolean =>
  encodingsOf(value).some((encoding) => published.includes(encoding));

/** The atoms an account is published as, beyond its flag. */
const accountAtoms = (account: Identifier): string[] =>
  [encoded(account.left), encoded(account.right.bytes)].filter(
    (atom) => atom !== '',
  );

const expectAccountAbsent = (trace: Trace, account: Identifier): void => {
  const published = bytesIn(trace);
  for (const atom of accountAtoms(account)) {
    expect(published).not.toContain(atom);
  }
};

/**
 * Digest-width values a transcript publishes. Not an exact 32 bytes: the
 * runtime zero-trims, so a digest ending in `0x00` arrives a byte short.
 */
const DIGEST_MIN_HEX = 56;

const widthOf = (bytes: string): number =>
  Math.min(bytes.length, DIGEST_MIN_HEX);

/** The byte strings that move between two runs of equal length. */
const drift = (a: Trace, b: Trace): string[] => {
  const left = bytesIn(a);
  const right = bytesIn(b);
  expect(left).toHaveLength(right.length);
  return left.filter((value, i) => value !== right[i]);
};

const expectSameShape = (left: Trace, right: Trace): void => {
  expect(shapeOf(left)).toStrictEqual(shapeOf(right));
  expect(bytesIn(left).map(widthOf)).toStrictEqual(bytesIn(right).map(widthOf));
};

const sourceOf = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

const EXTENSION_SOURCE = sourceOf(
  '../ConfidentialNoteFungibleTokenAllowlist.compact',
);
const COMPOSED_SOURCE = sourceOf(
  './mocks/MockConfidentialNoteFungibleTokenAllowlisted.compact',
);

/** Source lines with doc and line comments dropped. */
const codeLines = (source: string): string[] =>
  source
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        !line.startsWith('*') &&
        !line.startsWith('/*') &&
        !line.startsWith('//'),
    );

// ---------------------------------------------------------------------------
// The membership check
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenAllowlist privacy: the membership check',
  () => {
    it('should publish the root it proves against', async () => {
      const probe = await ListProbe.holding(MEMBERS);
      const root = probe.state.Allowlist__allowed.root().field;
      const [, trace] = await probe.check(MEMBERS[3]);

      expect(appearsIn(bytesIn(trace), root)).toBe(true);
    });

    it('should not publish the account or its leaf', async () => {
      const probe = await ListProbe.holding(MEMBERS);
      const [, trace] = await probe.check(MEMBERS[3]);

      expectAccountAbsent(trace, MEMBERS[3]);
      expect(bytesIn(trace)).not.toContain(hex(allowlist.leafOf(MEMBERS[3])));
      expect(bytesIn(trace)).not.toContain(
        encoded(allowlist.leafOf(MEMBERS[3])),
      );
    });

    it('should write nothing', async () => {
      const probe = await ListProbe.holding(MEMBERS);
      const [, trace] = await probe.check(MEMBERS[3]);

      expect(shapeOf(trace)).not.toContain('ins');
    });

    // The slot is the position the proof hides: members at 1 and 4 differ in
    // every bit the fold reads, and still publish the same bytes.
    it('should publish byte-identical transcripts for the members at slots 1 and 4', async () => {
      const probe = await ListProbe.holding(MEMBERS);
      const [, first] = await probe.check(MEMBERS[1]);
      const [, second] = await probe.check(MEMBERS[4]);

      expect(drift(first, second)).toStrictEqual([]);
    });

    it('should publish byte-identical transcripts for any two members under one root', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uniqueArray(fc.string({ minLength: 1, maxLength: 8 }), {
            minLength: 3,
            maxLength: 7,
          }),
          fc.nat(),
          fc.nat(),
          async (labels, i, j) => {
            const members = labels.map(keyAccount);
            const probe = await ListProbe.holding(members);
            const [, first] = await probe.check(members[i % members.length]);
            const [, second] = await probe.check(members[j % members.length]);

            expect(drift(first, second)).toStrictEqual([]);
          },
        ),
        { numRuns: 10 },
      );
    }, 120_000);
  },
);

// ---------------------------------------------------------------------------
// The stated leaks of the list edits
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenAllowlist privacy: the list edits',
  () => {
    it('should publish the leaf and not the account on _allow', async () => {
      const probe = await ListProbe.holding(MEMBERS.slice(0, 2));
      const [, trace] = await probe.allow(MEMBERS[2]);

      expect(bytesIn(trace)).toContain(hex(allowlist.leafOf(MEMBERS[2])));
      expectAccountAbsent(trace, MEMBERS[2]);
    });

    it('should publish the root, the leaf and the slot and not the account on _disallow', async () => {
      const probe = await ListProbe.holding(MEMBERS);
      const root = probe.state.Allowlist__allowed.root().field;
      const [, trace] = await probe.disallow(MEMBERS[4]);
      const published = bytesIn(trace);

      expect(appearsIn(published, root)).toBe(true);
      expect(published).toContain(hex(allowlist.leafOf(MEMBERS[4])));
      expect(published).toContain('04');
      expectAccountAbsent(trace, MEMBERS[4]);
    });

    // Same list, so the root and the tombstone are equal: what moves is the
    // leaf and the slot, nothing else.
    it('should move only the leaf and the slot between two removals', async () => {
      const [, atOne] = await (await ListProbe.holding(MEMBERS)).disallow(
        MEMBERS[1],
      );
      const [, atFour] = await (await ListProbe.holding(MEMBERS)).disallow(
        MEMBERS[4],
      );
      const leafOne = hex(allowlist.leafOf(MEMBERS[1]));

      const moved = drift(atOne, atFour);
      expect(moved.length).toBeGreaterThan(0);
      for (const value of moved) {
        expect([leafOne, '01']).toContain(value);
      }
      expect(moved).toContain(leafOne);
      expect(moved).toContain('01');
    });
  },
);

// ---------------------------------------------------------------------------
// Composed with the core: the shape does not depend on the member or amount
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenAllowlist privacy: composed with the core',
  () => {
    const holder = () => fc.constantFrom(...HOLDERS);
    const amount = () => fc.bigInt({ min: 0n, max: (1n << 128n) - 1n });
    const payable = () => fc.bigInt({ min: 0n, max: 100n });

    it('should mint with the same transcript shape and widths for any member and amount', async () => {
      await fc.assert(
        fc.asyncProperty(
          holder(),
          amount(),
          holder(),
          amount(),
          async (a, x, b, y) => {
            const [, left] = await (await TokenProbe.create()).mint(
              accountOf(a),
              x,
            );
            const [, right] = await (await TokenProbe.create()).mint(
              accountOf(b),
              y,
            );

            expectSameShape(left, right);
          },
        ),
        { numRuns: 8 },
      );
    }, 120_000);

    it('should transfer with the same transcript shape and widths for any members and amount', async () => {
      await fc.assert(
        fc.asyncProperty(
          holder(),
          holder(),
          payable(),
          holder(),
          holder(),
          payable(),
          async (fromA, toA, x, fromB, toB, y) => {
            const [probeA, noteA] = await TokenProbe.holding(fromA, 100n);
            const [, left] = await probeA.transfer(fromA, toA, x, noteA);
            const [probeB, noteB] = await TokenProbe.holding(fromB, 100n);
            const [, right] = await probeB.transfer(fromB, toB, y, noteB);

            expectSameShape(left, right);
          },
        ),
        { numRuns: 8 },
      );
    }, 120_000);

    it('should burn with the same transcript shape and widths for any member and amount', async () => {
      await fc.assert(
        fc.asyncProperty(
          holder(),
          payable(),
          holder(),
          payable(),
          async (a, x, b, y) => {
            const [probeA, noteA] = await TokenProbe.holding(a, 100n);
            const [, left] = await probeA.burn(a, x, noteA);
            const [probeB, noteB] = await TokenProbe.holding(b, 100n);
            const [, right] = await probeB.burn(b, y, noteB);

            expectSameShape(left, right);
          },
        ),
        { numRuns: 8 },
      );
    }, 120_000);

    it("should not publish the spender's or the recipient's account or leaf in a transfer", async () => {
      const [probe, note] = await TokenProbe.holding('alice', 100n);
      const [, trace] = await probe.transfer('alice', 'bob', 30n, note);
      const published = bytesIn(trace);

      for (const holderName of ['alice', 'bob'] as const) {
        const account = accountOf(holderName);
        expectAccountAbsent(trace, account);
        expect(published).not.toContain(hex(composed.leafOf(account)));
      }
      expect(published).not.toContain(encoded(secretOf('alice')));
    });
  },
);

// ---------------------------------------------------------------------------
// The disclose surface
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenAllowlist privacy: the disclose surface',
  () => {
    // The root twice, the leaf four times, the slot once.
    it('should disclose only at the reviewed sites', () => {
      const sites = codeLines(EXTENSION_SOURCE).filter((line) =>
        line.includes('disclose('),
      );

      expect(sites).toStrictEqual([
        'assert(_allowed.checkRoot(disclose(rootOf(leafOf(account), path))),',
        'assert(!_members.member(disclose(leaf)),',
        '_members.insert(disclose(leaf));',
        '_allowed.insert(disclose(leaf));',
        'assert(_allowed.checkRoot(disclose(rootOf(leaf, path))),',
        '_allowed.insertIndexDefault(disclose(index));',
        '_members.remove(disclose(leaf));',
      ]);
    });

    it('should not disclose a witness value directly', () => {
      expect(EXTENSION_SOURCE).not.toMatch(/disclose\(\s*wit_/);
    });

    it('should assert only the reviewed reasons', () => {
      const reasons = [
        ...EXTENSION_SOURCE.matchAll(
          /"ConfidentialNoteFungibleTokenAllowlist: ([^"]+)"/g,
        ),
      ].map(([, reason]) => reason);

      expect(reasons).toStrictEqual([
        'account not allowed',
        'zero account',
        'account already allowed',
        'account not allowed',
      ]);
    });

    it('should write no public state outside the tree and the member set', () => {
      const ledgerFields = codeLines(EXTENSION_SOURCE).filter((line) =>
        /^export (sealed )?ledger /.test(line),
      );

      expect(ledgerFields).toStrictEqual([
        'export ledger _allowed: HistoricMerkleTree<depth, Bytes<32>>;',
        'export ledger _members: Set<Bytes<32>>;',
      ]);
    });

    // The fold's two `?:` arms are both `Field` arithmetic, so neither is a
    // ledger branch.
    it.each([
      { label: 'the extension', source: EXTENSION_SOURCE },
      { label: 'the composed mock', source: COMPOSED_SOURCE },
    ])('should keep $label free of branches and loops', ({ source }) => {
      const branching = codeLines(source).filter(
        (line) => /\bif\s*\(/.test(line) || /\bfor\s*\(/.test(line),
      );

      expect(branching).toStrictEqual([]);
    });

    // Tombstone first: a reset that ran first would keep the pre-removal root.
    it('should tombstone the slot before resetting the history', () => {
      const lines = codeLines(EXTENSION_SOURCE);
      const tombstone = lines.indexOf(
        '_allowed.insertIndexDefault(disclose(index));',
      );
      const reset = lines.indexOf('_allowed.resetHistory();');

      expect(tombstone).toBeGreaterThan(-1);
      expect(reset).toBe(tombstone + 1);
    });

    it('should check the policy accounts unconditionally in the composed mock', () => {
      const checks = codeLines(COMPOSED_SOURCE).filter((line) =>
        line.includes('Allowlist_assertAllowed('),
      );

      expect(checks).toStrictEqual([
        'Allowlist_assertAllowed(recipientPk, recipientAllowPath);',
        'Allowlist_assertAllowed(caller.identifier, spenderAllowPath);',
        'Allowlist_assertAllowed(recipientPk, recipientAllowPath);',
        'Allowlist_assertAllowed(caller.identifier, spenderAllowPath);',
      ]);
    });
  },
);
