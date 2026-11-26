/**
 * Privacy claims for the ConfidentialNoteFungibleTokenFreeze extension, as
 * executable assertions.
 *
 * The probe drives the composed mock (core + freeze) directly so every call
 * keeps its `proofData`:
 *
 *   publicTranscript          the ledger operations the transaction publishes
 *   privateTranscriptOutputs  the witness answers, which stay on the prover
 *
 * The freeze set is public by design. The claims are that a freeze publishes
 * the nullifier and nothing else, that the check on a spend publishes nothing
 * the spend does not publish already, and that no entry point's shape varies
 * with its private inputs. The stated leak is asserted as such: the nullifier
 * a freeze publishes is the one the later spend or seize publishes.
 */

import { readFileSync } from 'node:fs';
import type {
  AlignedValue,
  CircuitContext,
  CircuitResults,
  MerkleTreePathEntry,
  Op,
} from '@midnight-ntwrk/compact-runtime';
import { dummyContractAddress } from '@midnight-ntwrk/compact-runtime';
import {
  CircuitContextManager,
  isLiveBackend,
} from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  pureCircuits as composed,
  type Ledger,
  ledger,
  Contract as MockFreezable,
} from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenFreezable/contract/index.js';
import {
  CustodialConfidentialNoteFungibleTokenWitnesses,
  type CustodialWallet,
  NOTE_SALT,
} from '../../presets/test/witnesses/CustodialConfidentialNoteFungibleTokenWitnesses.js';
import type {
  Identifier,
  Note,
} from './simulators/ConfidentialNoteFungibleTokenFreezableSimulator.js';

// ---------------------------------------------------------------------------
// Probe: the composed mock driven directly, so `proofData` survives
// ---------------------------------------------------------------------------

const secretKey = (label: string): Uint8Array => {
  const sk = new Uint8Array(32);
  sk.set(new TextEncoder().encode(label));
  return sk;
};

const ALICE_SK = secretKey('ALICE');
const ALICE = composed.deriveIdentifier(ALICE_SK, NOTE_SALT);
const BOB = composed.deriveIdentifier(secretKey('BOB'), NOTE_SALT);
const RECOVERY = composed.deriveIdentifier(secretKey('RECOVERY'), NOTE_SALT);

// Planted so two probes derive byte-identical notes.
const SEED = secretKey('DIFFERENTIAL-SEED');

const U128 = 1n << 128n;

/** The mock declares no private state; the wallet carries the secrets. */
type PrivateState = Record<string, never>;

type Trace = {
  transcript: Op<AlignedValue>[];
  privateOutputs: AlignedValue[];
};

/** Block time the probes deploy at, pinned so two runs agree on every input. */
const PROBE_TIME = 0;

class Probe {
  readonly wallet: CustodialWallet;
  private readonly contract: MockFreezable<PrivateState>;
  private readonly manager: CircuitContextManager<PrivateState>;

  private constructor() {
    this.wallet = { secretKey: ALICE_SK, nonceSeed: SEED };
    this.contract = new MockFreezable<PrivateState>(
      CustodialConfidentialNoteFungibleTokenWitnesses<Ledger, PrivateState>(
        this.wallet,
      ),
    );
    this.manager = new CircuitContextManager<PrivateState>(
      this.contract,
      {},
      '0'.repeat(64),
      dummyContractAddress(),
      PROBE_TIME,
      NOTE_SALT,
    );
  }

  static async create(): Promise<Probe> {
    const probe = new Probe();
    await probe.manager.init();
    return probe;
  }

  /** Runs one circuit and keeps the root call's proof data. */
  private async run<T>(
    call: (
      context: CircuitContext<PrivateState>,
    ) => Promise<CircuitResults<PrivateState, T>>,
  ): Promise<[T, Trace]> {
    const { result, context } = await call(this.manager.getContext());
    this.manager.setContext(context);
    const proofData = context.callProofDataTrace.at(-1);
    if (proofData === undefined) {
      throw new Error('probe: circuit produced no proof data');
    }
    return [
      result,
      {
        transcript: proofData.publicTranscript,
        privateOutputs: proofData.privateTranscriptOutputs,
      },
    ];
  }

  actAs(sk: Uint8Array): void {
    this.wallet.secretKey = sk;
  }

  mint(recipientPk: Identifier, value: bigint): Promise<[Note, Trace]> {
    return this.run((ctx) =>
      this.contract.impureCircuits.mint(ctx, recipientPk, value),
    );
  }

  transfer(
    recipientPk: Identifier,
    value: bigint,
    note: Note,
    ownerPk: Identifier,
  ): Promise<[[Note, Note], Trace]> {
    return this.run((ctx) =>
      this.contract.impureCircuits.transfer(
        ctx,
        recipientPk,
        value,
        note,
        this.pathOf(note, ownerPk),
      ),
    );
  }

  burn(value: bigint, note: Note, ownerPk: Identifier): Promise<[Note, Trace]> {
    return this.run((ctx) =>
      this.contract.impureCircuits.burn(
        ctx,
        value,
        note,
        this.pathOf(note, ownerPk),
      ),
    );
  }

  seize(
    targetPk: Identifier,
    recoveryPk: Identifier,
    note: Note,
  ): Promise<[Note, Trace]> {
    return this.run((ctx) =>
      this.contract.impureCircuits.seize(
        ctx,
        targetPk,
        recoveryPk,
        note,
        this.pathOf(note, targetPk),
      ),
    );
  }

  freeze(nf: Uint8Array): Promise<[[], Trace]> {
    return this.run((ctx) => this.contract.impureCircuits._freeze(ctx, nf));
  }

  unfreeze(nf: Uint8Array): Promise<[[], Trace]> {
    return this.run((ctx) => this.contract.impureCircuits._unfreeze(ctx, nf));
  }

  isFrozen(nf: Uint8Array): Promise<[boolean, Trace]> {
    return this.run((ctx) => this.contract.impureCircuits.isFrozen(ctx, nf));
  }

  private pathOf(note: Note, ownerPk: Identifier): MerkleTreePathEntry[] {
    const path = this.state.Core__commitments.findPathForLeaf(
      composed.commitOf(note, ownerPk),
    );
    if (path === undefined) {
      throw new Error('probe: note not committed under that key');
    }
    return path.path;
  }

  get state(): Ledger {
    return ledger(
      this.manager.getContext().callContext.currentQueryContext.state.state,
    );
  }
}

/** A probe with a note of `value` minted to alice, acting as alice. */
const aliceHolding = async (value = 100n): Promise<[Probe, Note]> => {
  const probe = await Probe.create();
  const [note] = await probe.mint(ALICE, value);
  probe.actAs(ALICE_SK);
  return [probe, note];
};

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

/** Every byte string appearing anywhere in a transcript or aligned value. */
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
const shapeOf = (transcript: Op<AlignedValue>[]): string[] =>
  transcript.map(opKind);

/**
 * The mock's cell indices, as published: the three core fields, then
 * `Freeze__frozen`. A zero index is published as the empty string.
 */
const CELL = {
  nullifiers: '01',
  frozen: '03',
} as const;

/** The cell an `idx` op addresses, or undefined for any other op. */
const cellOf = (op: Op<AlignedValue>): string | undefined =>
  opKind(op) === 'idx'
    ? bytesIn((op as { idx: { path: unknown[] } }).idx.path[0]).join('')
    : undefined;

/** Whether `op` pushes a key to look up, not a value to store. */
const isKeyPush = (op: Op<AlignedValue> | undefined): boolean =>
  op !== undefined &&
  opKind(op) === 'push' &&
  !(op as { push: { storage: boolean } }).push.storage;

/**
 * The values each keyed access to `cell` publishes: the key pushed after the
 * `idx`, then the result its `popeq` pins. Inserts and removals push no
 * result. The commitment tree's inner `idx` ops push no key, so they drop out.
 */
const accessesOf = (transcript: Op<AlignedValue>[], cell: string): string[][] =>
  transcript.flatMap((op, i) => {
    const following = transcript.slice(i + 1, i + 4);
    if (cellOf(op) !== cell || !isKeyPush(following[0])) return [];
    const popeq = following.find((next) => opKind(next) === 'popeq');
    return [
      [
        ...bytesIn(following[0]),
        ...(following[1] === 'member' && popeq !== undefined
          ? bytesIn(popeq)
          : []),
      ],
    ];
  });

/** Published values the allowed set does not account for. */
const unaccounted = (trace: Trace, allowed: string[]): string[] =>
  bytesIn(trace.transcript).filter((value) => !allowed.includes(value));

/**
 * Digest-width values a transcript publishes. Not an exact 32 bytes: the
 * runtime zero-trims, so a digest whose edge byte is zero arrives a byte short.
 */
const DIGEST_MIN_HEX = 56;

/** A published value's width, with every digest counted alike. */
const widthOf = (bytes: string): number =>
  Math.min(bytes.length, DIGEST_MIN_HEX);

const expectSameShape = (left: Trace, right: Trace): void => {
  expect(shapeOf(left.transcript)).toStrictEqual(shapeOf(right.transcript));
  expect(bytesIn(left.transcript).map(widthOf)).toStrictEqual(
    bytesIn(right.transcript).map(widthOf),
  );
};

const anyBytes32 = () => fc.uint8Array({ minLength: 32, maxLength: 32 });

const anyRecipient = () =>
  anyBytes32().map((sk) => composed.deriveIdentifier(sk, NOTE_SALT));

const sourceOf = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

const EXTENSION_SOURCE = sourceOf(
  '../ConfidentialNoteFungibleTokenFreeze.compact',
);
const COMPOSED_SOURCE = sourceOf(
  './mocks/MockConfidentialNoteFungibleTokenFreezable.compact',
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
// What a freeze publishes
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenFreeze privacy: the freeze mutators',
  () => {
    it.each([
      {
        circuit: '_freeze',
        call: (probe: Probe, nf: Uint8Array) => probe.freeze(nf),
      },
      {
        circuit: '_unfreeze',
        call: (probe: Probe, nf: Uint8Array) => probe.unfreeze(nf),
      },
    ])(
      'should publish the nullifier and nothing else in $circuit',
      async ({ call }) => {
        const [probe, note] = await aliceHolding();
        const nf = composed.nullifierOf(note);
        await probe.freeze(nf);

        const [, trace] = await call(probe, nf);

        expect(accessesOf(trace.transcript, CELL.frozen)).toStrictEqual([
          [encoded(nf)],
        ]);
        expect(unaccounted(trace, [CELL.frozen, encoded(nf)])).toStrictEqual(
          [],
        );
        expect(trace.privateOutputs).toStrictEqual([]);
      },
    );

    // The value, nonce, owner and leaf of the note never reach the call, so
    // the allow-list above already excludes them. This pins it for any note.
    it('should publish no owner, value, nonce or leaf of the frozen note', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigInt({ min: 1n, max: U128 - 1n }),
          anyRecipient(),
          async (value, owner) => {
            const probe = await Probe.create();
            const [note] = await probe.mint(owner, value);
            const nf = composed.nullifierOf(note);
            const [, trace] = await probe.freeze(nf);

            expect(bytesIn(trace.transcript)).toStrictEqual([
              CELL.frozen,
              encoded(nf),
            ]);
          },
        ),
        { numRuns: 10 },
      );
    }, 60_000);

    it('should publish the queried nullifier and the answer in isFrozen', async () => {
      const [probe, note] = await aliceHolding();
      const nf = composed.nullifierOf(note);
      await probe.freeze(nf);

      const [frozen, trace] = await probe.isFrozen(nf);

      expect(frozen).toBe(true);
      expect(accessesOf(trace.transcript, CELL.frozen)).toStrictEqual([
        [encoded(nf), '01'],
      ]);
      expect(
        unaccounted(trace, [CELL.frozen, encoded(nf), '01']),
      ).toStrictEqual([]);
      expect(shapeOf(trace.transcript)).not.toContain('ins');
      expect(shapeOf(trace.transcript)).not.toContain('rem');
    });
  },
);

// ---------------------------------------------------------------------------
// What the check on a spend publishes
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenFreeze privacy: the check on a spend',
  () => {
    it.each([
      {
        circuit: 'transfer',
        spend: (probe: Probe, note: Note) =>
          probe.transfer(BOB, 30n, note, ALICE),
      },
      {
        circuit: 'burn',
        spend: (probe: Probe, note: Note) => probe.burn(30n, note, ALICE),
      },
    ])(
      'should read the nullifier the core inserts and nothing else in a $circuit',
      async ({ spend }) => {
        const [probe, note] = await aliceHolding();
        const nf = encoded(composed.nullifierOf(note));

        const [, trace] = await spend(probe, note);

        // One lookup of `_frozen`: the nullifier, answered "not frozen".
        expect(accessesOf(trace.transcript, CELL.frozen)).toStrictEqual([
          [nf, ''],
        ]);
        // The core's double-spend check, then its insert, carry the same value.
        expect(accessesOf(trace.transcript, CELL.nullifiers)).toStrictEqual([
          [nf, ''],
          [nf],
        ]);
      },
    );

    it('should not touch the frozen set in a seize', async () => {
      const [probe, note] = await aliceHolding();
      await probe.freeze(composed.nullifierOf(note));

      const [, trace] = await probe.seize(ALICE, RECOVERY, note);

      expect(accessesOf(trace.transcript, CELL.frozen)).toStrictEqual([]);
    });

    it('should not touch the frozen set in a mint', async () => {
      const probe = await Probe.create();

      const [, trace] = await probe.mint(ALICE, 100n);

      expect(accessesOf(trace.transcript, CELL.frozen)).toStrictEqual([]);
    });
  },
);

// ---------------------------------------------------------------------------
// The stated leak
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenFreeze privacy: the stated leak',
  () => {
    it('should publish at the freeze the nullifier a later seize inserts', async () => {
      const [probe, note] = await aliceHolding();
      const [, frozen] = await probe.freeze(composed.nullifierOf(note));

      const [, seized] = await probe.seize(ALICE, RECOVERY, note);

      const [[published]] = accessesOf(frozen.transcript, CELL.frozen);
      expect(accessesOf(seized.transcript, CELL.nullifiers)).toContainEqual([
        published,
      ]);
    });

    it('should publish at the freeze the nullifier a later spend inserts', async () => {
      const [probe, note] = await aliceHolding();
      const nf = composed.nullifierOf(note);
      const [, frozen] = await probe.freeze(nf);
      await probe.unfreeze(nf);

      const [, spent] = await probe.burn(30n, note, ALICE);

      const [[published]] = accessesOf(frozen.transcript, CELL.frozen);
      expect(accessesOf(spent.transcript, CELL.nullifiers)).toContainEqual([
        published,
      ]);
    });
  },
);

// ---------------------------------------------------------------------------
// Indistinguishability: the shape does not depend on the private inputs
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenFreeze privacy: indistinguishability',
  () => {
    const anyAmount = () => fc.bigInt({ min: 0n, max: U128 - 1n });
    const anyHolding = () => fc.bigInt({ min: 1n, max: U128 - 1n });

    const mintTrace = async (
      recipient: Identifier,
      value: bigint,
    ): Promise<Trace> =>
      (await (await Probe.create()).mint(recipient, value))[1];

    /** Alice spends a note of `held`; `pct` percent goes to `recipient`. */
    const transferTrace = async (
      recipient: Identifier,
      held: bigint,
      pct: bigint,
    ): Promise<Trace> => {
      const [probe, note] = await aliceHolding(held);
      return (
        await probe.transfer(recipient, (held * pct) / 100n, note, ALICE)
      )[1];
    };

    const burnTrace = async (held: bigint, pct: bigint): Promise<Trace> => {
      const [probe, note] = await aliceHolding(held);
      return (await probe.burn((held * pct) / 100n, note, ALICE))[1];
    };

    const seizeTrace = async (
      held: bigint,
      recovery: Identifier,
    ): Promise<Trace> => {
      const [probe, note] = await aliceHolding(held);
      return (await probe.seize(ALICE, recovery, note))[1];
    };

    const freezeTrace = async (nf: Uint8Array): Promise<Trace> =>
      (await (await Probe.create()).freeze(nf))[1];

    const pct = () => fc.bigInt({ min: 0n, max: 100n });

    it('should mint with the same transcript shape and widths for any amount and recipient', async () => {
      await fc.assert(
        fc.asyncProperty(
          anyRecipient(),
          anyAmount(),
          anyRecipient(),
          anyAmount(),
          async (toA, a, toB, b) => {
            expectSameShape(await mintTrace(toA, a), await mintTrace(toB, b));
          },
        ),
        { numRuns: 10 },
      );
    }, 60_000);

    it('should transfer with the same transcript shape and widths for any note, amount and recipient', async () => {
      await fc.assert(
        fc.asyncProperty(
          anyRecipient(),
          anyHolding(),
          pct(),
          anyRecipient(),
          anyHolding(),
          pct(),
          async (toA, heldA, pctA, toB, heldB, pctB) => {
            expectSameShape(
              await transferTrace(toA, heldA, pctA),
              await transferTrace(toB, heldB, pctB),
            );
          },
        ),
        { numRuns: 10 },
      );
    }, 60_000);

    it('should burn with the same transcript shape and widths for any note and amount', async () => {
      await fc.assert(
        fc.asyncProperty(
          anyHolding(),
          pct(),
          anyHolding(),
          pct(),
          async (heldA, pctA, heldB, pctB) => {
            expectSameShape(
              await burnTrace(heldA, pctA),
              await burnTrace(heldB, pctB),
            );
          },
        ),
        { numRuns: 10 },
      );
    }, 60_000);

    it('should seize with the same transcript shape and widths for any note and recovery key', async () => {
      await fc.assert(
        fc.asyncProperty(
          anyHolding(),
          anyRecipient(),
          anyHolding(),
          anyRecipient(),
          async (heldA, recA, heldB, recB) => {
            expectSameShape(
              await seizeTrace(heldA, recA),
              await seizeTrace(heldB, recB),
            );
          },
        ),
        { numRuns: 10 },
      );
    }, 60_000);

    it('should freeze with the same transcript shape and widths for any nullifier', async () => {
      await fc.assert(
        fc.asyncProperty(anyHolding(), anyHolding(), async (nonceA, nonceB) => {
          expectSameShape(
            await freezeTrace(
              composed.nullifierOf({ value: 1n, nonce: nonceA }),
            ),
            await freezeTrace(
              composed.nullifierOf({ value: 1n, nonce: nonceB }),
            ),
          );
        }),
        { numRuns: 10 },
      );
    }, 60_000);

    // A frozen note cannot be spent, so the only spend a pending freeze can
    // shadow is one of an unfrozen note. Freezing another note moves nothing.
    it('should transfer with the same transcript while another note is frozen', async () => {
      const [quiet, quietNote] = await aliceHolding();
      const [busy, busyNote] = await aliceHolding();
      const [other] = await busy.mint(BOB, 5n);
      await busy.freeze(composed.nullifierOf(other));
      await quiet.mint(BOB, 5n);

      const [, left] = await quiet.transfer(BOB, 30n, quietNote, ALICE);
      const [, right] = await busy.transfer(BOB, 30n, busyNote, ALICE);

      expect(shapeOf(left.transcript)).toStrictEqual(shapeOf(right.transcript));
    });
  },
);

// ---------------------------------------------------------------------------
// The disclose surface
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenFreeze privacy: the disclose surface',
  () => {
    it('should disclose only at the four reviewed sites', () => {
      const sites = codeLines(EXTENSION_SOURCE).filter((line) =>
        line.includes('disclose('),
      );

      expect(sites).toStrictEqual([
        'return _frozen.member(disclose(nf));',
        'assert(!_frozen.member(disclose(nullifierOf(note))), "ConfidentialNoteFungibleTokenFreeze: note frozen");',
        '_frozen.insert(disclose(nf));',
        '_frozen.remove(disclose(nf));',
      ]);
    });

    it('should not disclose a witness value directly', () => {
      expect(EXTENSION_SOURCE).not.toMatch(/disclose\(\s*wit_/);
    });

    it('should fail its one assert with a fixed message under the module prefix', () => {
      const code = codeLines(EXTENSION_SOURCE).join('\n');
      const messages = [
        ...code.matchAll(/\bassert\([^;]*?,\s*"([^"]*)"\s*\);/g),
      ].map(([, message]) => message);

      expect(code.match(/\bassert\(/g) ?? []).toHaveLength(1);
      expect(messages).toStrictEqual([
        'ConfidentialNoteFungibleTokenFreeze: note frozen',
      ]);
    });

    it('should write no public state outside the frozen set', () => {
      const ledgerFields = codeLines(EXTENSION_SOURCE).filter((line) =>
        /^export (sealed )?ledger /.test(line),
      );

      expect(ledgerFields).toStrictEqual([
        'export ledger _frozen: Set<Bytes<32>>;',
      ]);
    });

    it.each([
      { file: 'the extension', source: EXTENSION_SOURCE },
      { file: 'the composed mock', source: COMPOSED_SOURCE },
    ])('should keep $file free of branches and loops', ({ source }) => {
      const branching = codeLines(source).filter(
        (line) => /\bif\s*\(/.test(line) || /\bfor\s*\(/.test(line),
      );

      expect(branching).toStrictEqual([]);
    });

    // A check under a condition, or on a path that does not spend, would make
    // the presence of the lookup a private predicate's shadow.
    it('should check the freeze unconditionally on the two owner spends only', () => {
      const bodies = codeLines(COMPOSED_SOURCE)
        .join('\n')
        .split(/^export (?:pure )?circuit /m)
        .slice(1);
      const checked = bodies
        .filter((body) => body.includes('Freeze_assertNotFrozen('))
        .map((body) => body.slice(0, body.indexOf('(')));

      expect(checked).toStrictEqual(['transfer', 'burn']);
      for (const body of bodies.filter((b) =>
        b.includes('Freeze_assertNotFrozen('),
      )) {
        expect(body).toContain('Freeze_assertNotFrozen(note);');
      }
    });
  },
);
