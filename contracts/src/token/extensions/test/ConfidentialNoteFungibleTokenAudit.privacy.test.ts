/**
 * Privacy claims for the ConfidentialNoteFungibleTokenAudit extension, as
 * executable assertions rather than prose.
 *
 * The probe drives the composed mock (core + audit) directly so it can read
 * `proofData`, the per-call record a real transaction carries:
 *
 *   publicTranscript          the ledger operations the transaction publishes
 *   privateTranscriptOutputs  the witness answers, which stay on the prover
 *
 * Three layers, weakest to strongest, as in the core's suite:
 *
 *   1. no secret's byte encoding appears in the public transcript,
 *   2. the transcript's SHAPE does not vary with the secrets,
 *   3. two runs differing only in a secret differ only in digests and pads.
 *
 * The audit key is public by design: every audited call reads it, so it is a
 * positive control here, never an absent value. The claims are about the
 * transcript, as in the preset's suite.
 */

import { readFileSync } from 'node:fs';
import type {
  AlignedValue,
  CircuitContext,
  CircuitResults,
  JubjubPoint,
  MerkleTreePathEntry,
  Op,
} from '@midnight-ntwrk/compact-runtime';
import {
  bigIntToValue,
  dummyContractAddress,
  ecMulGenerator,
} from '@midnight-ntwrk/compact-runtime';
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
  Contract as MockAudited,
} from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenAudited/contract/index.js';
import {
  CustodialConfidentialNoteFungibleTokenWitnesses,
  type CustodialWallet,
  NOTE_SALT,
} from '../../presets/test/witnesses/CustodialConfidentialNoteFungibleTokenWitnesses.js';
import type {
  Identifier,
  Note,
} from './simulators/ConfidentialNoteFungibleTokenAuditedSimulator.js';

// ---------------------------------------------------------------------------
// Probe: the composed mock driven directly, so `proofData` survives
// ---------------------------------------------------------------------------

const secretKey = (label: string): Uint8Array => {
  const sk = new Uint8Array(32);
  sk.set(new TextEncoder().encode(label));
  return sk;
};

const U128 = 1n << 128n;

// Jubjub prime-order subgroup order; valid secret scalars are [1, L-1].
const L =
  6554484396890773809930967563523245729705921265872317281365359162392183254199n;

const ALICE_SK = secretKey('ALICE');
const BOB_SK = secretKey('BOB');
const ALICE = composed.deriveIdentifier(ALICE_SK, NOTE_SALT);
const BOB = composed.deriveIdentifier(BOB_SK, NOTE_SALT);
const RECOVERY = composed.deriveIdentifier(secretKey('RECOVERY'), NOTE_SALT);

const AUDIT_SCALAR = 111222333444555n;
const AUDIT_KEY = ecMulGenerator(AUDIT_SCALAR);

// Planted so two probes derive byte-identical notes and ephemerals; the
// differential tests need every input equal except the one under study. The
// mock's one seed witness answers the core nonces and the audit ephemerals.
const SEED = secretKey('DIFFERENTIAL-SEED');

// Wide enough that no short published atom matches by chance.
const MINTED = 987654321987654321n;
const SENT = 123456789123456789n;

/** The mock declares no private state; the wallet carries the secrets. */
type PrivateState = Record<string, never>;

type Trace = {
  transcript: Op<AlignedValue>[];
  privateOutputs: AlignedValue[];
};

/** Block time the probe deploys at, pinned so two runs agree on every input. */
const PROBE_TIME = 0;

class Probe {
  readonly wallet: CustodialWallet = {
    secretKey: ALICE_SK,
    nonceSeed: SEED,
  };
  private readonly contract = new MockAudited<PrivateState>(
    CustodialConfidentialNoteFungibleTokenWitnesses<Ledger, PrivateState>(
      this.wallet,
    ),
  );
  private readonly manager: CircuitContextManager<PrivateState>;

  private constructor(auditKey: JubjubPoint) {
    this.manager = new CircuitContextManager<PrivateState>(
      this.contract,
      {},
      '0'.repeat(64),
      dummyContractAddress(),
      PROBE_TIME,
      NOTE_SALT,
      auditKey,
    );
  }

  static async create(auditKey: JubjubPoint = AUDIT_KEY): Promise<Probe> {
    const probe = new Probe(auditKey);
    await probe.manager.init();
    return probe;
  }

  private async run<T>(
    call: (
      context: CircuitContext<PrivateState>,
    ) => Promise<CircuitResults<PrivateState, T>>,
  ): Promise<[T, Trace]> {
    const { result, context } = await call(this.manager.getContext());
    this.manager.setContext(context);
    // One entry per call in the tree, depth-first, so the root circuit is last.
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

  /** Spends `note` as the acting secret, whose note key owns it. */
  transfer(
    recipientPk: Identifier,
    value: bigint,
    note: Note,
  ): Promise<[[Note, Note], Trace]> {
    return this.run((ctx) =>
      this.contract.impureCircuits.transfer(
        ctx,
        recipientPk,
        value,
        note,
        this.pathOf(note, this.actingKey()),
      ),
    );
  }

  burn(value: bigint, note: Note): Promise<[Note, Trace]> {
    return this.run((ctx) =>
      this.contract.impureCircuits.burn(
        ctx,
        value,
        note,
        this.pathOf(note, this.actingKey()),
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

  setAuditKey(key: JubjubPoint): Promise<[[], Trace]> {
    return this.run((ctx) =>
      this.contract.impureCircuits._setAuditKey(ctx, key),
    );
  }

  private actingKey(): Identifier {
    return composed.deriveIdentifier(this.wallet.secretKey, NOTE_SALT);
  }

  private pathOf(note: Note, owner: Identifier): MerkleTreePathEntry[] {
    const path = this.state.Core__commitments.findPathForLeaf(
      composed.commitOf(note, owner),
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

/** A probe with `MINTED` minted to alice, acting as alice. */
const aliceHolding = async (auditKey?: JubjubPoint): Promise<[Probe, Note]> => {
  const probe = await Probe.create(auditKey);
  const [note] = await probe.mint(ALICE, MINTED);
  probe.actAs(ALICE_SK);
  return [probe, note];
};

// ---------------------------------------------------------------------------
// Reading a transcript
// ---------------------------------------------------------------------------

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

/**
 * The runtime stores byte values with trailing zeros stripped, so a 32-byte
 * value whose tail is padding appears in a transcript under its trimmed form.
 */
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

/** Byte encodings a field-typed secret could plausibly appear as. */
const encodingsOf = (value: bigint): string[] => bigIntToValue(value).map(hex);

/** Whether some encoding of `value` is among `published`. */
const appearsIn = (published: string[], value: bigint): boolean =>
  encodingsOf(value).some((encoding) => published.includes(encoding));

/** `bytes` read as a little-endian integer. */
const littleEndian = (bytes: Uint8Array): bigint =>
  bytes.reduceRight((acc, byte) => (acc << 8n) | BigInt(byte), 0n);

/** Every form an owner could leak as: its key bytes, both ways, and its limbs. */
const ownerForms = (owner: Identifier): string[] => [
  hex(owner.left),
  encoded(owner.left),
  ...encodingsOf(littleEndian(owner.left.subarray(0, 16))),
  ...encodingsOf(littleEndian(owner.left.subarray(16, 32))),
];

/** Asserts no encoding of any secret value or owner is among `published`. */
const expectAbsent = (
  published: string[],
  values: bigint[],
  owners: Identifier[] = [],
): void => {
  for (const value of values) {
    expect(appearsIn(published, value)).toBe(false);
  }
  for (const owner of owners) {
    for (const form of ownerForms(owner)) {
      expect(published).not.toContain(form);
    }
  }
};

/**
 * Digest-width values a transcript publishes. Not an exact 32 bytes: the
 * runtime zero-trims, so a digest beginning `0x00` arrives a byte short.
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

/** The byte strings that move between two otherwise identical runs. */
const drift = (a: Trace, b: Trace): string[] => {
  const left = bytesIn(a.transcript);
  const right = bytesIn(b.transcript);
  expect(left).toHaveLength(right.length);
  return left.filter((value, i) => value !== right[i]);
};

/**
 * Nothing that moved is the encoding of a secret the runs differed in.
 * Width is a structural bound only: a digest or a pad is at most 32 bytes.
 */
const expectOpaque = (
  moved: string[],
  values: bigint[],
  owners: Identifier[] = [],
): void => {
  for (const value of moved) {
    expect(value.length).toBeLessThanOrEqual(64);
  }
  expectAbsent(moved, values, owners);
};

const sourceOf = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

const EXTENSION_SOURCE = sourceOf(
  '../ConfidentialNoteFungibleTokenAudit.compact',
);
const STANDALONE_SOURCE = sourceOf(
  './mocks/MockConfidentialNoteFungibleTokenAudit.compact',
);
const COMPOSED_SOURCE = sourceOf(
  './mocks/MockConfidentialNoteFungibleTokenAudited.compact',
);

/** Source lines that are code, not doc or line comments. */
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

/** Every circuit signature, with wrapped parameter lists joined onto one line. */
const signaturesOf = (source: string): string[] =>
  [
    ...codeLines(source)
      .join(' ')
      .matchAll(/((?:export\s+)?(?:pure\s+)?circuit\s+\w+\s*\([^)]*\))/g),
  ].map(([signature]) => signature.replace(/\s+/g, ' '));

// ---------------------------------------------------------------------------
// What reaches the public transcript
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenAudit privacy: the public transcript',
  () => {
    it('should not carry the owner, the amount, the nonce or the seed of a mint', async () => {
      const probe = await Probe.create();
      const [note, trace] = await probe.mint(BOB, MINTED);
      const published = bytesIn(trace.transcript);

      expectAbsent(published, [MINTED, note.nonce], [BOB]);
      expect(published).not.toContain(encoded(SEED));
    });

    // The mirror image: the seed does exist, on the side that never leaves
    // the prover. Without this, a probe that read nothing would pass above.
    it('should carry the seed on the private side only', async () => {
      const probe = await Probe.create();
      const [, trace] = await probe.mint(BOB, MINTED);

      expect(bytesIn(trace.privateOutputs)).toContain(encoded(SEED));
      expect(bytesIn(trace.transcript)).not.toContain(encoded(SEED));
    });

    // The positive controls: the key read and the pushed record are public by
    // design, so they must be findable where the secrets were not.
    it('should publish the audit key it reads and the record it pushes', async () => {
      const probe = await Probe.create();
      const [, t] = await probe.mint(BOB, MINTED);
      const [record] = [...probe.state.Audit__auditTrail];
      const published = bytesIn(t.transcript);

      for (const value of [
        AUDIT_KEY.x,
        AUDIT_KEY.y,
        record.ephemeralPk.x,
        record.ephemeralPk.y,
        record.valueCt,
        record.nonceCt,
        record.ownerLoCt,
        record.ownerHiCt,
      ]) {
        expect(appearsIn(published, value)).toBe(true);
      }
    });

    it('should not carry the owners, the amounts or the nonces of a transfer', async () => {
      const [probe, note] = await aliceHolding();
      const [[out, change], t] = await probe.transfer(BOB, SENT, note);
      const published = bytesIn(t.transcript);

      expectAbsent(
        published,
        [SENT, MINTED - SENT, out.nonce, change.nonce],
        [ALICE, BOB],
      );
      expect(published).not.toContain(encoded(ALICE_SK));
      expect(bytesIn(t.privateOutputs)).toContain(encoded(ALICE_SK));
    });

    it('should not carry the owner, the amount or the change nonce of a burn', async () => {
      const [probe, note] = await aliceHolding();
      const [change, t] = await probe.burn(SENT, note);
      const published = bytesIn(t.transcript);

      expectAbsent(published, [SENT, MINTED - SENT, change.nonce], [ALICE]);
      expect(published).not.toContain(encoded(ALICE_SK));
    });

    it('should not carry the target, the recovery key, the value or the new nonce of a seize', async () => {
      const [probe, note] = await aliceHolding();
      const [seized, t] = await probe.seize(ALICE, RECOVERY, note);
      const published = bytesIn(t.transcript);

      expectAbsent(published, [MINTED, seized.nonce], [ALICE, RECOVERY]);
    });

    // Constant count per entry point, zero-value change included: the count
    // names the operation, which the entry point already does.
    it('should publish one record per output', async () => {
      const probe = await Probe.create();
      const [note] = await probe.mint(ALICE, MINTED);
      expect(probe.state.Audit__auditTrail.length()).toBe(1n);

      probe.actAs(ALICE_SK);
      const [[out]] = await probe.transfer(BOB, MINTED, note);
      expect(probe.state.Audit__auditTrail.length()).toBe(3n);

      probe.actAs(BOB_SK);
      const [zero] = await probe.burn(MINTED, out);
      expect(probe.state.Audit__auditTrail.length()).toBe(4n);

      await probe.seize(BOB, RECOVERY, zero);
      expect(probe.state.Audit__auditTrail.length()).toBe(5n);
    });
  },
);

// ---------------------------------------------------------------------------
// What a call writes
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenAudit privacy: what a call writes',
  () => {
    const cellsOf = (state: Ledger) => ({
      initialized: state.Audit__isInitialized,
      key: state.Audit__auditKey,
      records: [...state.Audit__auditTrail],
      leaves: state.Core__commitments.firstFree(),
      nullifiers: state.Core__nullifiers.size(),
      issuedNonces: state.Core__issuedNonces.size(),
    });

    it('should move only the key on rotation', async () => {
      const [probe] = await aliceHolding();
      const before = cellsOf(probe.state);
      const next = ecMulGenerator(999888777666555n);
      await probe.setAuditKey(next);

      expect(cellsOf(probe.state)).toStrictEqual({ ...before, key: next });
    });

    it('should leave the flag and the key untouched on mint, transfer, burn and seize', async () => {
      const [probe, note] = await aliceHolding();
      const before = cellsOf(probe.state);

      const [[out, change]] = await probe.transfer(BOB, SENT, note);
      probe.actAs(BOB_SK);
      await probe.burn(1n, out);
      await probe.seize(ALICE, RECOVERY, change);
      await probe.mint(BOB, 5n);

      const after = cellsOf(probe.state);
      expect(after.initialized).toBe(before.initialized);
      expect(after.key).toStrictEqual(before.key);
    });
  },
);

// ---------------------------------------------------------------------------
// Indistinguishability: the shape does not depend on the secrets
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenAudit privacy: indistinguishability',
  () => {
    const mintTrace = async (
      recipientPk: Identifier,
      value: bigint,
      auditKey?: JubjubPoint,
    ): Promise<Trace> => {
      const probe = await Probe.create(auditKey);
      return (await probe.mint(recipientPk, value))[1];
    };

    /** Alice spends a fresh note of `MINTED`: `value` to the recipient. */
    const transferTrace = async (
      recipientPk: Identifier,
      value: bigint,
    ): Promise<[Trace, Note, Note]> => {
      const [probe, note] = await aliceHolding();
      const [[out, change], t] = await probe.transfer(recipientPk, value, note);
      return [t, out, change];
    };

    const burnTrace = async (value: bigint): Promise<Trace> => {
      const [probe, note] = await aliceHolding();
      return (await probe.burn(value, note))[1];
    };

    const seizeTrace = async (recoveryPk: Identifier): Promise<Trace> => {
      const [probe, note] = await aliceHolding();
      return (await probe.seize(ALICE, recoveryPk, note))[1];
    };

    // Generated rather than chosen, so no hand-picked pair can hide a leak.
    // Run counts stay small: each case drives two full circuit executions.
    const anyAmount = () => fc.bigInt({ min: 0n, max: U128 - 1n });
    const payableAmount = () => fc.bigInt({ min: 0n, max: MINTED });
    const anyScalar = () => fc.bigInt({ min: 1n, max: L - 1n });
    const anyOwner = () =>
      fc
        .uint8Array({ minLength: 32, maxLength: 32 })
        .map((sk) => composed.deriveIdentifier(sk, NOTE_SALT));

    it('should mint with the same transcript shape and widths for any amount and recipient', async () => {
      await fc.assert(
        fc.asyncProperty(
          anyAmount(),
          anyOwner(),
          anyAmount(),
          anyOwner(),
          async (a, first, b, second) => {
            expectSameShape(
              await mintTrace(first, a),
              await mintTrace(second, b),
            );
          },
        ),
        { numRuns: 10 },
      );
    }, 60_000);

    it('should transfer with the same transcript shape and widths for any amount and recipient', async () => {
      await fc.assert(
        fc.asyncProperty(
          payableAmount(),
          anyOwner(),
          payableAmount(),
          anyOwner(),
          async (a, first, b, second) => {
            const [left] = await transferTrace(first, a);
            const [right] = await transferTrace(second, b);
            expectSameShape(left, right);
          },
        ),
        { numRuns: 8 },
      );
    }, 60_000);

    it('should burn with the same transcript shape and widths for any amount', async () => {
      await fc.assert(
        fc.asyncProperty(payableAmount(), payableAmount(), async (a, b) => {
          expectSameShape(await burnTrace(a), await burnTrace(b));
        }),
        { numRuns: 8 },
      );
    }, 60_000);

    /** A probe holding a fresh note of `MINTED` minted to `sk`'s note key, acting as `sk`. */
    const holding = async (sk: Uint8Array): Promise<[Probe, Note]> => {
      const probe = await Probe.create();
      const [note] = await probe.mint(
        composed.deriveIdentifier(sk, NOTE_SALT),
        MINTED,
      );
      probe.actAs(sk);
      return [probe, note];
    };

    const anySecret = () =>
      fc
        .uint8Array({ minLength: 32, maxLength: 32 })
        .filter((sk) => sk.some((byte) => byte !== 0));

    // The change record names the spender: its shape must not vary with who
    // spends.
    it('should transfer and burn with the same transcript shape and widths for any holder', async () => {
      await fc.assert(
        fc.asyncProperty(anySecret(), anySecret(), async (a, b) => {
          const [probeA, noteA] = await holding(a);
          const [probeB, noteB] = await holding(b);
          expectSameShape(
            (await probeA.transfer(BOB, SENT, noteA))[1],
            (await probeB.transfer(BOB, SENT, noteB))[1],
          );

          const [burnerA, heldA] = await holding(a);
          const [burnerB, heldB] = await holding(b);
          expectSameShape(
            (await burnerA.burn(SENT, heldA))[1],
            (await burnerB.burn(SENT, heldB))[1],
          );
        }),
        { numRuns: 6 },
      );
    }, 60_000);

    it('should seize with the same transcript shape and widths for any recovery key', async () => {
      await fc.assert(
        fc.asyncProperty(anyOwner(), anyOwner(), async (first, second) => {
          expectSameShape(await seizeTrace(first), await seizeTrace(second));
        }),
        { numRuns: 8 },
      );
    }, 60_000);

    // The mint nonce binds the recipient only, so the issued tag stays. The
    // ephemeral binds the amount: the leaf, both coordinates of `E` and the
    // four pads move.
    it('should move only the leaf, the ephemeral and the four pads when the minted amount differs', async () => {
      await fc.assert(
        fc.asyncProperty(anyAmount(), anyAmount(), async (a, b) => {
          fc.pre(a !== b);

          const moved = drift(await mintTrace(BOB, a), await mintTrace(BOB, b));

          expect(moved).toHaveLength(7);
          expectOpaque(moved, [a, b], [BOB]);
        }),
        { numRuns: 10 },
      );
    }, 60_000);

    // The recipient is in the nonce's context: the issued tag (read, then
    // inserted) moves too.
    it('should move only the tag, the leaf, the ephemeral and the four pads when the recipient differs', async () => {
      await fc.assert(
        fc.asyncProperty(anyOwner(), anyOwner(), async (first, second) => {
          fc.pre(hex(first.left) !== hex(second.left));

          const moved = drift(
            await mintTrace(first, 100n),
            await mintTrace(second, 100n),
          );

          expect(moved).toHaveLength(9);
          expectOpaque(moved, [100n], [first, second]);
        }),
        { numRuns: 10 },
      );
    }, 60_000);

    // The key read moves (both coordinates), and with it `E` and the pads.
    // The note, its leaf and its tag stay.
    it('should move only the key read, the ephemeral and the four pads when the audit key differs', async () => {
      await fc.assert(
        fc.asyncProperty(anyScalar(), anyScalar(), async (first, second) => {
          fc.pre(first !== second);

          const moved = drift(
            await mintTrace(BOB, 100n, ecMulGenerator(first)),
            await mintTrace(BOB, 100n, ecMulGenerator(second)),
          );

          expect(moved).toHaveLength(8);
          expectOpaque(moved, [100n], [BOB]);
        }),
        { numRuns: 10 },
      );
    }, 60_000);

    // Neither output nonce binds the amount, so both tags stay. Each ephemeral
    // binds its note's value, so each leg moves its leaf, its ephemeral and
    // its four pads.
    it('should move only the two leaves, the two ephemerals and the eight pads when the transfer amount differs', async () => {
      await fc.assert(
        fc.asyncProperty(payableAmount(), payableAmount(), async (a, b) => {
          fc.pre(a !== b);

          const [left, outA, changeA] = await transferTrace(BOB, a);
          const [right] = await transferTrace(BOB, b);
          const moved = drift(left, right);

          expect(moved).toHaveLength(14);
          expectOpaque(
            moved,
            [a, b, MINTED - a, MINTED - b, outA.nonce, changeA.nonce],
            [ALICE, BOB],
          );
        }),
        { numRuns: 8 },
      );
    }, 60_000);

    // Only the recipient's leg moves. The change leg does not, so a watcher
    // cannot tell from the sender's side that the recipient changed.
    it('should move only the recipient leg when the transfer recipient differs', async () => {
      await fc.assert(
        fc.asyncProperty(
          payableAmount(),
          anyOwner(),
          anyOwner(),
          async (value, first, second) => {
            fc.pre(hex(first.left) !== hex(second.left));

            const [left] = await transferTrace(first, value);
            const [right] = await transferTrace(second, value);
            const moved = drift(left, right);

            expect(moved).toHaveLength(9);
            expectOpaque(moved, [value], [ALICE, first, second]);
          },
        ),
        { numRuns: 8 },
      );
    }, 60_000);

    it('should publish byte-identical transcripts for identical inputs', async () => {
      const [left] = await transferTrace(BOB, SENT);
      const [right] = await transferTrace(BOB, SENT);

      expect(drift(left, right)).toStrictEqual([]);
    });
  },
);

// ---------------------------------------------------------------------------
// The disclose surface
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenAudit privacy: the disclose surface',
  () => {
    // Every crossing of the privacy boundary is one `disclose()`. Pinning the
    // exact set means a new one fails a test instead of relying on review.
    it('should disclose only at the two reviewed sites', () => {
      const sites = codeLines(EXTENSION_SOURCE).filter((line) =>
        line.includes('disclose('),
      );

      expect(sites).toStrictEqual([
        '_auditKey = disclose(newAuditKey);',
        '_auditTrail.pushFront(disclose(record));',
      ]);
    });

    it('should not disclose a witness value directly', () => {
      expect(EXTENSION_SOURCE).not.toMatch(/disclose\(\s*wit_/);
    });

    it('should declare only the flag, the key and the trail', () => {
      const ledgerFields = codeLines(EXTENSION_SOURCE).filter((line) =>
        /^export (sealed )?ledger /.test(line),
      );

      expect(ledgerFields).toStrictEqual([
        'export ledger _isInitialized: Boolean;',
        'export ledger _auditKey: JubjubPoint;',
        'export ledger _auditTrail: List<AuditRecord>;',
      ]);
    });

    // Asserts span two lines, so the scan joins the code into one string.
    it('should fail every assert with a fixed message under the module prefix', () => {
      const code = codeLines(EXTENSION_SOURCE).join('\n');
      const calls = code.match(/\bassert\(/g) ?? [];
      const messages = [
        ...code.matchAll(/\bassert\([^;]*?,\s*"([^"]*)"\s*\);/g),
      ].map(([, message]) => message);

      expect(calls).toHaveLength(6);
      expect(messages).toStrictEqual([
        'ConfidentialNoteFungibleTokenAudit: identity audit key',
        'ConfidentialNoteFungibleTokenAudit: identity ephemeral',
        'ConfidentialNoteFungibleTokenAudit: contract owner',
        'ConfidentialNoteFungibleTokenAudit: non-canonical owner',
        'ConfidentialNoteFungibleTokenAudit: contract not initialized',
        'ConfidentialNoteFungibleTokenAudit: contract already initialized',
      ]);
    });

    // A conditional push would make the record count a private predicate's
    // shadow. The standalone mock's constructor branches on `inits` by design.
    it.each([
      { source: 'the extension', code: EXTENSION_SOURCE },
      { source: 'the composed mock', code: COMPOSED_SOURCE },
    ])('should keep $source free of branches and loops', ({ code }) => {
      const branching = codeLines(code).filter(
        (line) => /\bif\s*\(/.test(line) || /\bfor\s*\(/.test(line),
      );

      expect(branching).toStrictEqual([]);
    });

    // `auditScalar` never enters an on-chain circuit: the only circuit taking
    // a scalar is pure, in the extension and in both mocks.
    it.each([
      { source: 'the extension', code: EXTENSION_SOURCE },
      { source: 'the standalone mock', code: STANDALONE_SOURCE },
      { source: 'the composed mock', code: COMPOSED_SOURCE },
    ])(
      'should take the audit scalar in pure recoverRecord only, in $source',
      ({ code }) => {
        const scalarCircuits = signaturesOf(code).filter((signature) =>
          signature.includes('JubjubScalar'),
        );

        expect(scalarCircuits).toHaveLength(1);
        expect(scalarCircuits[0]).toMatch(
          /^export pure circuit recoverRecord\(/,
        );
      },
    );
  },
);
