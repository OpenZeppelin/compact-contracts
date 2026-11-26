/**
 * Privacy claims for the ConfidentialNoteFungibleTokenReview extension, as
 * executable assertions.
 *
 * The probe drives the composed mock (core + review) directly so every call
 * keeps its `proofData`:
 *
 *   publicTranscript          the ledger operations the transaction publishes
 *   privateTranscriptOutputs  the witness answers, which stay on the prover
 *
 * The reviewer key is public by design: the approval check reads it and the
 * record carries it. The claims are that nothing else of the plaintext
 * reaches the transcript, that the shape does not vary with the inputs, and
 * that two runs differing in one input differ only in digests, the key, the
 * ephemeral and the pads.
 *
 * Everything here runs dry.
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
  type Ledger,
  ledger,
  Contract as MockReviewed,
  pureCircuits as reviewed,
} from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenReviewed/contract/index.js';
import {
  CustodialConfidentialNoteFungibleTokenWitnesses,
  type CustodialWallet,
  NOTE_SALT,
} from '../../presets/test/witnesses/CustodialConfidentialNoteFungibleTokenWitnesses.js';
import type {
  Identifier,
  Note,
} from './simulators/ConfidentialNoteFungibleTokenReviewedSimulator.js';

// ---------------------------------------------------------------------------
// Probe: the composed mock driven directly, so `proofData` survives
// ---------------------------------------------------------------------------

const secretKey = (label: string): Uint8Array => {
  const sk = new Uint8Array(32);
  sk.set(new TextEncoder().encode(label));
  return sk;
};

const U128 = 1n << 128n;

const ALICE_SK = secretKey('ALICE');
const BOB_SK = secretKey('BOB');
const ALICE = reviewed.deriveIdentifier(ALICE_SK, NOTE_SALT);
const BOB = reviewed.deriveIdentifier(BOB_SK, NOTE_SALT);

const RS_ONE = 111222333444555n;
const RS_TWO = 999888777666555n;
const REVIEWER_ONE = ecMulGenerator(RS_ONE);
const REVIEWER_TWO = ecMulGenerator(RS_TWO);

// Planted so two probes derive byte-identical notes and ephemerals; the
// differential tests need every input equal except the one under study.
const SEED = secretKey('DIFFERENTIAL-SEED');

// Wide amounts, so no encoding can match a cell index or a flag by chance.
const HOLDING = 987654321987654321987654321n;
const AMOUNT = 123456789123456789123456789n;

/** The mock declares no private state; the wallet carries the secrets. */
type PrivateState = Record<string, never>;

type Trace = {
  transcript: Op<AlignedValue>[];
  privateOutputs: AlignedValue[];
};

/** Block time the probe deploys at, pinned so two runs agree on every input. */
const PROBE_TIME = 0;

/** The composed mock with both reviewer keys approved. */
class Probe {
  readonly wallet: CustodialWallet = {
    secretKey: ALICE_SK,
    nonceSeed: SEED,
  };
  private readonly contract = new MockReviewed<PrivateState>(
    CustodialConfidentialNoteFungibleTokenWitnesses<Ledger, PrivateState>(
      this.wallet,
    ),
  );
  private readonly manager = new CircuitContextManager<PrivateState>(
    this.contract,
    {},
    '0'.repeat(64),
    dummyContractAddress(),
    PROBE_TIME,
    NOTE_SALT,
  );

  static async create(): Promise<Probe> {
    const probe = new Probe();
    await probe.manager.init();
    await probe.addReviewer(REVIEWER_ONE);
    await probe.addReviewer(REVIEWER_TWO);
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

  addReviewer(key: JubjubPoint): Promise<[[], Trace]> {
    return this.run((ctx) =>
      this.contract.impureCircuits._addReviewer(ctx, key),
    );
  }

  mint(
    recipientPk: Identifier,
    value: bigint,
    key: JubjubPoint = REVIEWER_ONE,
  ): Promise<[Note, Trace]> {
    return this.run((ctx) =>
      this.contract.impureCircuits.mint(ctx, recipientPk, value, key),
    );
  }

  transfer(
    recipientPk: Identifier,
    value: bigint,
    note: Note,
    key: JubjubPoint = REVIEWER_ONE,
  ): Promise<[[Note, Note], Trace]> {
    return this.run((ctx) =>
      this.contract.impureCircuits.transfer(
        ctx,
        recipientPk,
        value,
        note,
        this.pathOf(note),
        key,
      ),
    );
  }

  burn(
    value: bigint,
    note: Note,
    key: JubjubPoint = REVIEWER_ONE,
  ): Promise<[Note, Trace]> {
    return this.run((ctx) =>
      this.contract.impureCircuits.burn(
        ctx,
        value,
        note,
        this.pathOf(note),
        key,
      ),
    );
  }

  /** The path entries of `note` under the acting secret's note key. */
  private pathOf(note: Note): MerkleTreePathEntry[] {
    const owner = reviewed.deriveIdentifier(this.wallet.secretKey, NOTE_SALT);
    const path = this.state.Core__commitments.findPathForLeaf(
      reviewed.commitOf(note, owner),
    );
    if (path === undefined) {
      throw new Error('probe: note not committed under the acting key');
    }
    return path.path;
  }

  get state(): Ledger {
    return ledger(
      this.manager.getContext().callContext.currentQueryContext.state.state,
    );
  }
}

/** A probe holding a note of `HOLDING` minted to `sk`'s note key, acting as `sk`. */
const holding = async (sk: Uint8Array): Promise<[Probe, Note]> => {
  const probe = await Probe.create();
  const [note] = await probe.mint(
    reviewed.deriveIdentifier(sk, NOTE_SALT),
    HOLDING,
  );
  probe.actAs(sk);
  return [probe, note];
};

const aliceHolding = (): Promise<[Probe, Note]> => holding(ALICE_SK);

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

/** The operation sequence with every operand stripped: the public shape. */
const shapeOf = (transcript: Op<AlignedValue>[]): string[] =>
  transcript.map((op) =>
    typeof op === 'string' ? op : (Object.keys(op as object)[0] ?? '?'),
  );

/** Byte encodings a field-typed value could plausibly appear as. */
const encodingsOf = (value: bigint): string[] => bigIntToValue(value).map(hex);

/** Whether some encoding of `value` is among `published`. */
const appearsIn = (published: string[], value: bigint): boolean =>
  encodingsOf(value).some((encoding) => published.includes(encoding));

/** Asserts no encoding of any secret is among `published`. */
const expectAbsent = (published: string[], secrets: bigint[]): void => {
  for (const secret of secrets) {
    expect(appearsIn(published, secret)).toBe(false);
  }
};

/** Asserts no form of an owner key's bytes is among `published`. */
const expectOwnerAbsent = (published: string[], owner: Identifier): void => {
  expect(published).not.toContain(hex(owner.left));
  expect(published).not.toContain(encoded(owner.left));
};

/**
 * Digest-width values a transcript publishes. Not an exact 32 bytes: the
 * runtime zero-trims, so a digest beginning `0x00` arrives a byte short.
 */
const DIGEST_MIN_HEX = 56;

/** A published value's width, with every digest counted alike. */
const widthOf = (bytes: string): number =>
  Math.min(bytes.length, DIGEST_MIN_HEX);

/** The byte strings that move between two otherwise identical runs. */
const drift = (a: Trace, b: Trace): string[] => {
  const left = bytesIn(a.transcript);
  const right = bytesIn(b.transcript);
  expect(left).toHaveLength(right.length);
  return left.filter((value, i) => value !== right[i]);
};

/**
 * Nothing that moved is the encoding of a secret the runs differed in.
 * Width is a structural bound only: a digest, a coordinate or a pad is at
 * most 32 bytes.
 */
const expectOpaque = (moved: string[], secrets: bigint[]): void => {
  for (const value of moved) {
    expect(value.length).toBeLessThanOrEqual(64);
    for (const secret of secrets) {
      expect(encodingsOf(secret)).not.toContain(value);
    }
  }
};

const expectSameShape = (left: Trace, right: Trace): void => {
  expect(shapeOf(left.transcript)).toStrictEqual(shapeOf(right.transcript));
  expect(bytesIn(left.transcript).map(widthOf)).toStrictEqual(
    bytesIn(right.transcript).map(widthOf),
  );
};

/** The first 16 and last 16 bytes of an owner key, as the record's limbs. */
const limbsOf = (owner: Identifier): bigint[] =>
  [owner.left.subarray(0, 16), owner.left.subarray(16, 32)].map((half) =>
    half.reduceRight((acc, byte) => (acc << 8n) | BigInt(byte), 0n),
  );

const sourceOf = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

const EXTENSION_SOURCE = sourceOf(
  '../ConfidentialNoteFungibleTokenReview.compact',
);
const COMPOSED_SOURCE = sourceOf(
  './mocks/MockConfidentialNoteFungibleTokenReviewed.compact',
);
const SOURCES = [
  EXTENSION_SOURCE,
  sourceOf('./mocks/MockConfidentialNoteFungibleTokenReview.compact'),
  COMPOSED_SOURCE,
];

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

/** Every circuit signature in a source, its wrapped parameters joined. */
const signaturesOf = (source: string): string[] =>
  [
    ...codeLines(source)
      .join(' ')
      .matchAll(/(?:export\s+)?(?:pure\s+)?circuit\s+\w+\s*\([^)]*\)/g),
  ].map(([signature]) => signature.replace(/\s+/g, ' '));

// Generated rather than chosen, so no hand-picked pair can hide a leak. Run
// counts stay small: each case drives two full circuit executions.
const anyAmount = () => fc.bigInt({ min: 0n, max: U128 - 1n });
const payableAmount = () => fc.bigInt({ min: 0n, max: HOLDING });
const anySecret = () =>
  fc
    .uint8Array({ minLength: 32, maxLength: 32 })
    .filter((sk) => sk.some((byte) => byte !== 0));
const anyRecipient = () =>
  fc
    .uint8Array({ minLength: 32, maxLength: 32 })
    .map((sk) => reviewed.deriveIdentifier(sk, NOTE_SALT));

// ---------------------------------------------------------------------------
// What reaches the public transcript
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenReview privacy: the public transcript',
  () => {
    it('should not carry the owner, the amount or the nonce of a mint', async () => {
      const probe = await Probe.create();
      const [note, trace] = await probe.mint(BOB, AMOUNT);
      const published = bytesIn(trace.transcript);

      expectAbsent(published, [AMOUNT, note.nonce, ...limbsOf(BOB)]);
      expectOwnerAbsent(published, BOB);
      expect(published).not.toContain(encoded(SEED));
    });

    // The positive control for the scan above: the key is public by design.
    it('should carry the reviewer key, in the approval read and the record', async () => {
      const probe = await Probe.create();
      const [, trace] = await probe.mint(BOB, AMOUNT);
      const published = bytesIn(trace.transcript);

      for (const coordinate of [REVIEWER_ONE.x, REVIEWER_ONE.y]) {
        const hits = published.filter((value) =>
          encodingsOf(coordinate).includes(value),
        );
        expect(hits).toHaveLength(2);
      }
      expectAbsent(published, [REVIEWER_TWO.x, REVIEWER_TWO.y]);
    });

    it('should publish the pads of the record it pushes', async () => {
      const probe = await Probe.create();
      const [, trace] = await probe.mint(BOB, AMOUNT);
      const [record] = [...probe.state.Review__reviewTrail];
      const published = bytesIn(trace.transcript);

      for (const ct of [
        record.valueCt,
        record.nonceCt,
        record.ownerLoCt,
        record.ownerHiCt,
      ]) {
        expect(appearsIn(published, ct)).toBe(true);
      }
    });

    it('should carry the seed on the private side only', async () => {
      const probe = await Probe.create();
      const [, trace] = await probe.mint(BOB, AMOUNT);

      expect(bytesIn(trace.privateOutputs)).toContain(encoded(SEED));
      expect(bytesIn(trace.transcript)).not.toContain(encoded(SEED));
    });

    it('should not carry the owners, the amounts or the nonces of a transfer', async () => {
      const [probe, note] = await aliceHolding();
      const [[out, change], trace] = await probe.transfer(BOB, AMOUNT, note);
      const published = bytesIn(trace.transcript);

      expect(change.value).toBe(HOLDING - AMOUNT);
      expectAbsent(published, [
        HOLDING,
        AMOUNT,
        HOLDING - AMOUNT,
        note.nonce,
        out.nonce,
        change.nonce,
        ...limbsOf(ALICE),
        ...limbsOf(BOB),
      ]);
      expectOwnerAbsent(published, ALICE);
      expectOwnerAbsent(published, BOB);
      expect(published).not.toContain(encoded(ALICE_SK));
    });

    it('should not carry the owner, the amounts or the nonces of a burn', async () => {
      const [probe, note] = await aliceHolding();
      const [change, trace] = await probe.burn(AMOUNT, note);
      const published = bytesIn(trace.transcript);

      expect(change.value).toBe(HOLDING - AMOUNT);
      expectAbsent(published, [
        HOLDING,
        AMOUNT,
        HOLDING - AMOUNT,
        note.nonce,
        change.nonce,
        ...limbsOf(ALICE),
      ]);
      expectOwnerAbsent(published, ALICE);
      expect(published).not.toContain(encoded(ALICE_SK));
    });
  },
);

// ---------------------------------------------------------------------------
// Indistinguishability: the shape does not depend on the inputs
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenReview privacy: indistinguishability',
  () => {
    const mintTrace = async (
      recipientPk: Identifier,
      value: bigint,
      key: JubjubPoint = REVIEWER_ONE,
    ): Promise<Trace> =>
      (await (await Probe.create()).mint(recipientPk, value, key))[1];

    const transferTrace = async (
      recipientPk: Identifier,
      value: bigint,
      key: JubjubPoint = REVIEWER_ONE,
    ): Promise<Trace> => {
      const [probe, note] = await aliceHolding();
      return (await probe.transfer(recipientPk, value, note, key))[1];
    };

    const burnTrace = async (
      value: bigint,
      key: JubjubPoint = REVIEWER_ONE,
    ): Promise<Trace> => {
      const [probe, note] = await aliceHolding();
      return (await probe.burn(value, note, key))[1];
    };

    it('should mint with the same transcript shape and widths for any amount and recipient', async () => {
      await fc.assert(
        fc.asyncProperty(
          anyAmount(),
          anyRecipient(),
          anyAmount(),
          anyRecipient(),
          async (a, first, b, second) => {
            expectSameShape(
              await mintTrace(first, a),
              await mintTrace(second, b),
            );
          },
        ),
        { numRuns: 8 },
      );
    }, 60_000);

    it('should transfer with the same transcript shape and widths for any amount and recipient', async () => {
      await fc.assert(
        fc.asyncProperty(
          payableAmount(),
          anyRecipient(),
          payableAmount(),
          anyRecipient(),
          async (a, first, b, second) => {
            expectSameShape(
              await transferTrace(first, a),
              await transferTrace(second, b),
            );
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

    it('should transfer and burn with the same transcript shape and widths for any holder', async () => {
      await fc.assert(
        fc.asyncProperty(anySecret(), anySecret(), async (a, b) => {
          const [probeA, noteA] = await holding(a);
          const [probeB, noteB] = await holding(b);
          expectSameShape(
            (await probeA.transfer(BOB, AMOUNT, noteA))[1],
            (await probeB.transfer(BOB, AMOUNT, noteB))[1],
          );

          const [burnerA, heldA] = await holding(a);
          const [burnerB, heldB] = await holding(b);
          expectSameShape(
            (await burnerA.burn(AMOUNT, heldA))[1],
            (await burnerB.burn(AMOUNT, heldB))[1],
          );
        }),
        { numRuns: 6 },
      );
    }, 60_000);

    it('should transfer with the same transcript shape and widths for either reviewer', async () => {
      expectSameShape(
        await transferTrace(BOB, AMOUNT, REVIEWER_ONE),
        await transferTrace(BOB, AMOUNT, REVIEWER_TWO),
      );
    });

    // Same recipient and seed give the same nonce. The ephemeral binds the
    // amount, so it moves and all four pads move with it.
    it('should move only the leaf, the ephemeral and the four pads when the minted amount differs', async () => {
      await fc.assert(
        fc.asyncProperty(anyAmount(), anyAmount(), async (a, b) => {
          fc.pre(a !== b);

          const moved = drift(await mintTrace(BOB, a), await mintTrace(BOB, b));

          expect(moved).toHaveLength(7);
          expectOpaque(moved, [a, b, ...limbsOf(BOB)]);
        }),
        { numRuns: 8 },
      );
    }, 60_000);

    // The key is read by the approval check and written in the record, and it
    // is in the ephemeral's preimage: both copies of the key, the ephemeral
    // and the four pads move. The note does not.
    it('should move only the key, the ephemeral and the four pads when the reviewer differs', async () => {
      const moved = drift(
        await mintTrace(BOB, AMOUNT, REVIEWER_ONE),
        await mintTrace(BOB, AMOUNT, REVIEWER_TWO),
      );

      expect(moved).toHaveLength(10);
      expectOpaque(moved, [AMOUNT, ...limbsOf(BOB)]);
    });

    // Neither output nonce binds the amount. Each ephemeral binds its note's
    // value, so each leg moves its leaf, its ephemeral and its four pads.
    it('should move only the two leaves, the two ephemerals and the eight pads when the transfer amount differs', async () => {
      await fc.assert(
        fc.asyncProperty(payableAmount(), payableAmount(), async (a, b) => {
          fc.pre(a !== b);

          const moved = drift(
            await transferTrace(BOB, a),
            await transferTrace(BOB, b),
          );

          expect(moved).toHaveLength(14);
          expectOpaque(moved, [
            a,
            b,
            HOLDING - a,
            HOLDING - b,
            ...limbsOf(ALICE),
            ...limbsOf(BOB),
          ]);
        }),
        { numRuns: 8 },
      );
    }, 60_000);

    // Only the recipient's leg moves: its nonce tag, read and then inserted,
    // its leaf, its ephemeral and its four pads. The change leg does not.
    it('should move only the recipient leg when the recipient differs', async () => {
      await fc.assert(
        fc.asyncProperty(
          anyRecipient(),
          anyRecipient(),
          async (first, second) => {
            fc.pre(hex(first.left) !== hex(second.left));

            const moved = drift(
              await transferTrace(first, AMOUNT),
              await transferTrace(second, AMOUNT),
            );

            expect(moved).toHaveLength(9);
            expectOpaque(moved, [
              AMOUNT,
              ...limbsOf(first),
              ...limbsOf(second),
            ]);
          },
        ),
        { numRuns: 8 },
      );
    }, 60_000);

    it('should publish byte-identical transcripts for identical inputs', async () => {
      const moved = drift(
        await transferTrace(BOB, AMOUNT),
        await transferTrace(BOB, AMOUNT),
      );

      expect(moved).toStrictEqual([]);
    });
  },
);

// ---------------------------------------------------------------------------
// The disclose surface
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenReview privacy: the disclose surface',
  () => {
    // Every crossing of the privacy boundary is one `disclose()`. Pinning the
    // exact set means a new one fails a test instead of relying on review.
    it('should disclose only at the four reviewed sites', () => {
      const sites = codeLines(EXTENSION_SOURCE).filter((line) =>
        line.includes('disclose('),
      );

      expect(sites).toStrictEqual([
        '_reviewers.insert(disclose(reviewerKey));',
        '_reviewers.remove(disclose(reviewerKey));',
        'assert(_reviewers.member(disclose(reviewerKey)),',
        '_reviewTrail.pushFront(disclose(record));',
      ]);
    });

    it('should not disclose a witness value directly', () => {
      for (const source of SOURCES) {
        expect(source).not.toMatch(/disclose\(\s*wit_/);
      }
    });

    it('should write no public state outside the registry and the trail', () => {
      const ledgerFields = codeLines(EXTENSION_SOURCE).filter((line) =>
        /^export (sealed )?ledger /.test(line),
      );

      expect(ledgerFields).toStrictEqual([
        'export ledger _reviewers: Set<JubjubPoint>;',
        'export ledger _reviewTrail: List<ReviewRecord>;',
      ]);
    });

    // Asserts span two lines, so the scan joins the code into one string.
    it('should fail every assert with a fixed message under the module prefix', () => {
      const code = codeLines(EXTENSION_SOURCE).join('\n');
      const calls = code.match(/\bassert\(/g) ?? [];
      const messages = [
        ...code.matchAll(/\bassert\([^;]*?,\s*"([^"]*)"\s*\);/g),
      ].map(([, message]) => message);

      expect(calls).toHaveLength(5);
      expect(messages).toStrictEqual([
        'ConfidentialNoteFungibleTokenReview: identity reviewer key',
        'ConfidentialNoteFungibleTokenReview: reviewer not approved',
        'ConfidentialNoteFungibleTokenReview: identity ephemeral',
        'ConfidentialNoteFungibleTokenReview: contract owner',
        'ConfidentialNoteFungibleTokenReview: non-canonical owner',
      ]);
    });

    // A conditional push would make the record count a private predicate's
    // shadow. The pads' two `?:` live in `math/UintN`.
    it('should keep the extension and both mocks free of branches and loops', () => {
      for (const source of SOURCES) {
        const branching = codeLines(source).filter(
          (line) => /\bif\s*\(/.test(line) || /\bfor\s*\(/.test(line),
        );

        expect(branching).toStrictEqual([]);
      }
    });

    it('should review every output of the composed mock unconditionally', () => {
      const reviews = codeLines(COMPOSED_SOURCE).filter((line) =>
        line.startsWith('Review__review('),
      );

      expect(reviews).toHaveLength(4);
    });

    // The scalar never enters an on-chain circuit: the only circuit taking
    // one is pure `recoverRecord`, in the extension and in both mocks.
    it('should take the reviewer scalar in pure recoverRecord only', () => {
      for (const source of SOURCES) {
        const scalarCircuits = signaturesOf(source).filter((signature) =>
          signature.includes('JubjubScalar'),
        );

        expect(scalarCircuits).toHaveLength(1);
        expect(scalarCircuits[0]).toMatch(
          /^export pure circuit recoverRecord\(/,
        );
      }
    });
  },
);
