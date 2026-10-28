/**
 * Privacy claims for the ConfidentialNoteFungibleTokenDelivery extension, as
 * executable assertions rather than prose.
 *
 * The probe drives the composed mock (core + delivery) directly so it can read
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
 * The delivery adds one `pushFront` per output, so layer 3 now also pins which
 * atoms of the entry move: the pads move with the plaintext or the key, the
 * ephemeral moves only with the nonce. Layers 1-3 run dry; the live layer at
 * the foot scans the transaction as the indexer stored it.
 */

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type {
  AlignedValue,
  CircuitResults,
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
  awaitPublishedTxs,
  indexerHead,
} from '#test-utils/harness/publishedTx.js';
import {
  pureCircuits as composed,
  ledger,
  Contract as MockDelivered,
} from '../../../../artifacts/MockConfidentialNoteFungibleTokenDelivered/contract/index.js';
import { ConfidentialNoteFungibleTokenDeliveredSimulator } from '../simulators/ConfidentialNoteFungibleTokenDeliveredSimulator.js';
import {
  ConfidentialNoteFungibleTokenDeliveryWitnesses,
  createDeliveryWallet,
  type DeliveryWallet,
} from '../witnesses/ConfidentialNoteFungibleTokenDeliveryWitnesses.js';
import {
  ConfidentialNoteFungibleTokenWitnesses,
  createNoteWallet,
  INSTANCE_SALT,
  type Note,
  type NoteCommitmentLedger,
  type NoteWallet,
} from '../witnesses/ConfidentialNoteFungibleTokenWitnesses.js';

// ---------------------------------------------------------------------------
// Probe: the composed contract driven directly, so `proofData` survives
// ---------------------------------------------------------------------------

const secretKey = (label: string): Uint8Array => {
  const sk = new Uint8Array(32);
  sk.set(new TextEncoder().encode(label));
  return sk;
};

const U128 = 1n << 128n;
const UINT128_MAX = U128 - 1n;

// Jubjub prime-order subgroup order; valid secret scalars are [1, L-1].
const L =
  6554484396890773809930967563523245729705921265872317281365359162392183254199n;

const ALICE_SK = secretKey('ALICE');
const BOB_SK = secretKey('BOB');
const ALICE = composed.derivePk(ALICE_SK, INSTANCE_SALT);
const BOB = composed.derivePk(BOB_SK, INSTANCE_SALT);

const EK_ALICE = 111222333444555n;
const EK_BOB = 999888777666555n;
const ENC_ALICE = ecMulGenerator(EK_ALICE);
const ENC_BOB = ecMulGenerator(EK_BOB);

// Planted so two probes derive byte-identical notes and ephemerals; the
// differential tests need every input equal except the one under study.
const SEED = secretKey('DIFFERENTIAL-SEED');
const DELIVERY_SEED = secretKey('DIFFERENTIAL-DELIVERY-SEED');

/** The constructor mints this to Alice and delivers it to her key. */
const CTOR_VALUE = 1000n;

/** Neither module declares private state; the wallets carry the secrets. */
type PrivateState = Record<string, never>;

type Trace = {
  transcript: Op<AlignedValue>[];
  privateOutputs: AlignedValue[];
  input: AlignedValue;
  output: AlignedValue;
};

/** Block time the probe deploys at, pinned so two runs agree on every input. */
const PROBE_TIME = 0;

class Probe {
  readonly wallet: NoteWallet = createNoteWallet();
  readonly deliveryWallet: DeliveryWallet = createDeliveryWallet();
  private readonly contract = new MockDelivered<PrivateState>({
    ...ConfidentialNoteFungibleTokenWitnesses<NoteCommitmentLedger>(
      this.wallet,
    ),
    ...ConfidentialNoteFungibleTokenDeliveryWitnesses<
      NoteCommitmentLedger,
      PrivateState
    >(this.deliveryWallet),
  });
  private readonly manager = new CircuitContextManager<PrivateState>(
    this.contract,
    {},
    '0'.repeat(64),
    dummyContractAddress(),
    PROBE_TIME,
    INSTANCE_SALT,
    ALICE,
    ENC_ALICE,
    CTOR_VALUE,
  );

  private constructor() {
    this.wallet.nonceSeed = SEED;
    this.deliveryWallet.deliverySeed = DELIVERY_SEED;
  }

  static async create(): Promise<Probe> {
    const probe = new Probe();
    await probe.manager.init();
    return probe;
  }

  private async run<T>(
    call: () => Promise<CircuitResults<PrivateState, T>>,
  ): Promise<[T, Trace]> {
    const { result, context } = await call();
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
        input: proofData.input,
        output: proofData.output,
      },
    ];
  }

  mint(
    recipientPk: bigint,
    recipientEncPk: { x: bigint; y: bigint },
    value: bigint,
  ): Promise<[[], Trace]> {
    return this.run(() =>
      this.contract.impureCircuits.mint(
        this.manager.getContext(),
        recipientPk,
        recipientEncPk,
        value,
      ),
    );
  }

  transfer(
    recipientPk: bigint,
    recipientEncPk: { x: bigint; y: bigint },
    senderEncPk: { x: bigint; y: bigint },
    value: bigint,
  ): Promise<[[], Trace]> {
    return this.run(() =>
      this.contract.impureCircuits.transfer(
        this.manager.getContext(),
        recipientPk,
        recipientEncPk,
        senderEncPk,
        value,
      ),
    );
  }

  burn(
    senderEncPk: { x: bigint; y: bigint },
    value: bigint,
  ): Promise<[[], Trace]> {
    return this.run(() =>
      this.contract.impureCircuits.burn(
        this.manager.getContext(),
        senderEncPk,
        value,
      ),
    );
  }

  spend(sk: Uint8Array, note: Note): void {
    this.wallet.secretKey = sk;
    this.wallet.inputNote = note;
  }

  get state() {
    return ledger(
      this.manager.getContext().callContext.currentQueryContext.state.state,
    );
  }

  /** The wallet filter: notes `ek` opens that are committed to `pk`, newest first. */
  scan(ek: bigint, pk: bigint): Note[] {
    const state = this.state;
    const notes: Note[] = [];
    for (const entry of state.Delivery__deliveries) {
      const { value, nonce } = composed.recoverNote(entry, ek);
      if (value >= U128) continue;
      const note = { value, nonce };
      const leaf = composed.commitOf(note, pk);
      if (state.Core__commitments.findPathForLeaf(leaf) !== undefined) {
        notes.push(note);
      }
    }
    return notes;
  }

  /** The newest unspent note `ek` and `pk` hold. */
  holding(ek: bigint, pk: bigint): Note {
    const state = this.state;
    const note = this.scan(ek, pk).find(
      (candidate) =>
        !state.Core__nullifiers.member(composed.nullifierOf(candidate)),
    );
    if (note === undefined) {
      throw new Error('probe: no unspent note for that key');
    }
    return note;
  }
}

// ---------------------------------------------------------------------------
// Reading a transcript
// ---------------------------------------------------------------------------

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

/**
 * The runtime stores byte values with trailing zeros stripped, so a 32-byte
 * secret whose tail is padding appears in a transcript under its trimmed form.
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

/** Byte encodings a field-typed secret could plausibly appear as. */
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

/**
 * Digest-width values a transcript publishes. Not an exact 32 bytes: the
 * runtime zero-trims, so a digest beginning `0x00` arrives a byte short.
 */
const DIGEST_MIN_HEX = 56;

/** A published value's width, with every digest counted alike. */
const widthOf = (bytes: string): number =>
  bytes.length >= DIGEST_MIN_HEX ? DIGEST_MIN_HEX : bytes.length;

const sourceOf = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

const EXTENSION_SOURCE = sourceOf(
  '../../extensions/ConfidentialNoteFungibleTokenDelivery.compact',
);
const MOCK_SOURCES = [
  EXTENSION_SOURCE,
  sourceOf('../mocks/MockConfidentialNoteFungibleTokenDelivery.compact'),
  sourceOf('../mocks/MockConfidentialNoteFungibleTokenDelivered.compact'),
];

/** Source lines that are code, not doc comments. */
const codeLines = (source: string): string[] =>
  source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !line.startsWith('*') && !line.startsWith('//'));

// ---------------------------------------------------------------------------
// What reaches the public transcript
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenDelivery privacy: the public transcript',
  () => {
    it('should not carry the recipient key, the amount or the nonce of a mint', async () => {
      const probe = await Probe.create();
      const [, trace] = await probe.mint(BOB, ENC_BOB, 1000n);
      const [note] = probe.scan(EK_BOB, BOB);
      const published = bytesIn(trace.transcript);

      expectAbsent(published, [ENC_BOB.x, ENC_BOB.y, 1000n, note.nonce, BOB]);
      expect(published).not.toContain(encoded(DELIVERY_SEED));
    });

    // The mirror image: the seed does exist, on the side that never leaves
    // the prover. Without this, a probe that read nothing would pass above.
    it('should carry the delivery seed on the private side only', async () => {
      const probe = await Probe.create();
      const [, trace] = await probe.mint(BOB, ENC_BOB, 1000n);

      expect(bytesIn(trace.privateOutputs)).toContain(encoded(DELIVERY_SEED));
      expect(bytesIn(trace.transcript)).not.toContain(encoded(DELIVERY_SEED));
    });

    // The positive control for the scans above: the pads are what the push
    // publishes, so they must be findable where the secrets were not.
    it('should publish the pads of the entry it pushes', async () => {
      const probe = await Probe.create();
      const [, trace] = await probe.mint(BOB, ENC_BOB, 1000n);
      const [entry] = [...probe.state.Delivery__deliveries];
      const published = bytesIn(trace.transcript);

      expect(appearsIn(published, entry.valueCt)).toBe(true);
      expect(appearsIn(published, entry.nonceCt)).toBe(true);
    });

    it('should not carry the keys, the amount or the nonces of a transfer', async () => {
      const probe = await Probe.create();
      probe.spend(ALICE_SK, probe.holding(EK_ALICE, ALICE));
      const [, trace] = await probe.transfer(BOB, ENC_BOB, ENC_ALICE, 300n);
      const [out] = probe.scan(EK_BOB, BOB);
      const change = probe.holding(EK_ALICE, ALICE);
      const published = bytesIn(trace.transcript);

      expect(change.value).toBe(700n);
      expectAbsent(published, [
        ENC_ALICE.x,
        ENC_ALICE.y,
        ENC_BOB.x,
        ENC_BOB.y,
        300n,
        700n,
        out.nonce,
        change.nonce,
        ALICE,
        BOB,
      ]);
      expect(published).not.toContain(encoded(ALICE_SK));
    });

    it('should not carry the sender key or the amount of a burn', async () => {
      const probe = await Probe.create();
      probe.spend(ALICE_SK, probe.holding(EK_ALICE, ALICE));
      const [, trace] = await probe.burn(ENC_ALICE, 400n);
      const change = probe.holding(EK_ALICE, ALICE);
      const published = bytesIn(trace.transcript);

      expect(change.value).toBe(600n);
      expectAbsent(published, [
        ENC_ALICE.x,
        ENC_ALICE.y,
        400n,
        600n,
        change.nonce,
        ALICE,
      ]);
      expect(published).not.toContain(encoded(ALICE_SK));
    });

    // Constant count per entry point, zero-value change included: the count
    // names the operation, which the entry point already does.
    it('should publish one entry per output', async () => {
      const probe = await Probe.create();
      expect(probe.state.Delivery__deliveries.length()).toBe(1n);

      await probe.mint(BOB, ENC_BOB, 10n);
      expect(probe.state.Delivery__deliveries.length()).toBe(2n);

      probe.spend(ALICE_SK, probe.holding(EK_ALICE, ALICE));
      await probe.transfer(BOB, ENC_BOB, ENC_ALICE, CTOR_VALUE);
      expect(probe.state.Delivery__deliveries.length()).toBe(4n);

      probe.spend(BOB_SK, probe.holding(EK_BOB, BOB));
      await probe.burn(ENC_BOB, CTOR_VALUE);
      expect(probe.state.Delivery__deliveries.length()).toBe(5n);
    });
  },
);

// ---------------------------------------------------------------------------
// Indistinguishability: the shape does not depend on the secrets
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenDelivery privacy: indistinguishability',
  () => {
    const mintTrace = async (
      recipientPk: bigint,
      recipientEncPk: { x: bigint; y: bigint },
      value: bigint,
    ): Promise<Trace> => {
      const probe = await Probe.create();
      return (await probe.mint(recipientPk, recipientEncPk, value))[1];
    };

    /** Alice spends the constructor note: `value` to the recipient, change to her key. */
    const transferTrace = async (
      recipientPk: bigint,
      recipientEncPk: { x: bigint; y: bigint },
      value: bigint,
    ): Promise<Trace> => {
      const probe = await Probe.create();
      probe.spend(ALICE_SK, probe.holding(EK_ALICE, ALICE));
      return (
        await probe.transfer(recipientPk, recipientEncPk, ENC_ALICE, value)
      )[1];
    };

    // Generated rather than chosen, so no hand-picked pair can hide a leak.
    // Run counts stay small: each case drives two full circuit executions.
    const anyAmount = () => fc.bigInt({ min: 0n, max: UINT128_MAX });
    const payableAmount = () => fc.bigInt({ min: 0n, max: CTOR_VALUE });
    const anyScalar = () => fc.bigInt({ min: 1n, max: L - 1n });
    const anyRecipientPk = () =>
      fc
        .uint8Array({ minLength: 32, maxLength: 32 })
        .map((sk) => composed.derivePk(sk, INSTANCE_SALT));

    it('should mint with the same transcript shape for any amount', async () => {
      await fc.assert(
        fc.asyncProperty(anyAmount(), anyAmount(), async (a, b) => {
          expect(
            shapeOf((await mintTrace(BOB, ENC_BOB, a)).transcript),
          ).toStrictEqual(
            shapeOf((await mintTrace(BOB, ENC_BOB, b)).transcript),
          );
        }),
        { numRuns: 10 },
      );
    }, 60_000);

    it('should mint with the same transcript shape for any recipient key', async () => {
      await fc.assert(
        fc.asyncProperty(anyScalar(), anyScalar(), async (first, second) => {
          expect(
            shapeOf(
              (await mintTrace(BOB, ecMulGenerator(first), 100n)).transcript,
            ),
          ).toStrictEqual(
            shapeOf(
              (await mintTrace(BOB, ecMulGenerator(second), 100n)).transcript,
            ),
          );
        }),
        { numRuns: 10 },
      );
    }, 60_000);

    it('should transfer with the same transcript shape for any amount', async () => {
      await fc.assert(
        fc.asyncProperty(payableAmount(), payableAmount(), async (a, b) => {
          expect(
            shapeOf((await transferTrace(BOB, ENC_BOB, a)).transcript),
          ).toStrictEqual(
            shapeOf((await transferTrace(BOB, ENC_BOB, b)).transcript),
          );
        }),
        { numRuns: 8 },
      );
    }, 60_000);

    it('should transfer with the same transcript length and widths for any amount', async () => {
      await fc.assert(
        fc.asyncProperty(payableAmount(), payableAmount(), async (a, b) => {
          const left = bytesIn(
            (await transferTrace(BOB, ENC_BOB, a)).transcript,
          );
          const right = bytesIn(
            (await transferTrace(BOB, ENC_BOB, b)).transcript,
          );

          expect(left.length).toBe(right.length);
          expect(left.map(widthOf)).toStrictEqual(right.map(widthOf));
        }),
        { numRuns: 8 },
      );
    }, 60_000);

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
    const expectOpaque = (moved: string[], secrets: bigint[]): void => {
      for (const value of moved) {
        expect(value.length).toBeLessThanOrEqual(64);
        for (const secret of secrets) {
          expect(encodingsOf(secret)).not.toContain(value);
        }
      }
    };

    // Same recipient and seed give the same nonce, hence the same tag and the
    // same ephemeral: only the leaf digest and the value pad can move.
    it('should move only the leaf digest and the value pad when the minted amount differs', async () => {
      await fc.assert(
        fc.asyncProperty(anyAmount(), anyAmount(), async (a, b) => {
          fc.pre(a !== b);

          const moved = drift(
            await mintTrace(BOB, ENC_BOB, a),
            await mintTrace(BOB, ENC_BOB, b),
          );

          expect(moved).toHaveLength(2);
          expectOpaque(moved, [a, b, BOB, ENC_BOB.x, ENC_BOB.y]);
        }),
        { numRuns: 10 },
      );
    }, 60_000);

    // The key is in the ephemeral's preimage, so both coordinates of `E`
    // move, and the shared point moves both pads; the leaf stays.
    it('should move only the ephemeral and the two pads when the recipient key differs', async () => {
      await fc.assert(
        fc.asyncProperty(anyScalar(), anyScalar(), async (first, second) => {
          fc.pre(first !== second);
          const firstKey = ecMulGenerator(first);
          const secondKey = ecMulGenerator(second);

          const moved = drift(
            await mintTrace(BOB, firstKey, 100n),
            await mintTrace(BOB, secondKey, 100n),
          );

          expect(moved).toHaveLength(4);
          expectOpaque(moved, [
            100n,
            BOB,
            firstKey.x,
            firstKey.y,
            secondKey.x,
            secondKey.y,
          ]);
        }),
        { numRuns: 10 },
      );
    }, 60_000);

    // Both output nonces bind the spent nullifier, not the amount, so the two
    // ephemerals and both nonce pads stay. The two leaves and the two value
    // pads are all that moves.
    it('should move only the two leaves and the two value pads when the transfer amount differs', async () => {
      await fc.assert(
        fc.asyncProperty(payableAmount(), payableAmount(), async (a, b) => {
          fc.pre(a !== b);

          const probeA = await Probe.create();
          probeA.spend(ALICE_SK, probeA.holding(EK_ALICE, ALICE));
          const [, traceA] = await probeA.transfer(BOB, ENC_BOB, ENC_ALICE, a);

          const probeB = await Probe.create();
          probeB.spend(ALICE_SK, probeB.holding(EK_ALICE, ALICE));
          const [, traceB] = await probeB.transfer(BOB, ENC_BOB, ENC_ALICE, b);

          const [outA] = probeA.scan(EK_BOB, BOB);
          const [outB] = probeB.scan(EK_BOB, BOB);
          expect(outA.value).toBe(a);
          expect(outB.value).toBe(b);

          const moved = drift(traceA, traceB);
          expect(moved).toHaveLength(4);
          expectOpaque(moved, [
            a,
            b,
            outA.nonce,
            probeA.holding(EK_ALICE, ALICE).nonce,
            ALICE,
            BOB,
            ENC_ALICE.x,
            ENC_ALICE.y,
            ENC_BOB.x,
            ENC_BOB.y,
          ]);
        }),
        { numRuns: 8 },
      );
    }, 60_000);

    // Only the recipient's leg moves: its leaf (the identity), its ephemeral
    // and its two pads (the key). The change leg does not, so a watcher cannot
    // tell that the recipient changed from the sender's side of the transaction.
    it('should move only the recipient leg when the recipient differs', async () => {
      await fc.assert(
        fc.asyncProperty(
          payableAmount(),
          anyRecipientPk(),
          anyRecipientPk(),
          anyScalar(),
          anyScalar(),
          async (value, firstPk, secondPk, firstEk, secondEk) => {
            fc.pre(firstPk !== secondPk && firstEk !== secondEk);
            const firstKey = ecMulGenerator(firstEk);
            const secondKey = ecMulGenerator(secondEk);

            const moved = drift(
              await transferTrace(firstPk, firstKey, value),
              await transferTrace(secondPk, secondKey, value),
            );

            expect(moved).toHaveLength(5);
            expectOpaque(moved, [
              value,
              ALICE,
              firstPk,
              secondPk,
              firstKey.x,
              firstKey.y,
              secondKey.x,
              secondKey.y,
            ]);
          },
        ),
        { numRuns: 8 },
      );
    }, 60_000);

    it('should publish byte-identical transcripts for identical inputs', async () => {
      const moved = drift(
        await transferTrace(BOB, ENC_BOB, 300n),
        await transferTrace(BOB, ENC_BOB, 300n),
      );

      expect(moved).toStrictEqual([]);
    });
  },
);

// ---------------------------------------------------------------------------
// The disclose surface
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenDelivery privacy: the disclose surface',
  () => {
    // Every crossing of the privacy boundary is one `disclose()`. Pinning the
    // exact set means a new one fails a test instead of relying on review.
    it('should disclose only at the reviewed site', () => {
      const sites = codeLines(EXTENSION_SOURCE).filter((line) =>
        line.includes('disclose('),
      );

      expect(sites).toStrictEqual([
        '_deliveries.pushFront(disclose(delivery));',
      ]);
    });

    it('should not disclose a witness value directly', () => {
      expect(EXTENSION_SOURCE).not.toMatch(/disclose\(\s*wit_/);
    });

    it('should write no public state outside the deliveries list', () => {
      const ledgerFields = codeLines(EXTENSION_SOURCE).filter((line) =>
        /^export (sealed )?ledger /.test(line),
      );

      expect(ledgerFields).toStrictEqual([
        'export ledger _deliveries: List<Delivery>;',
      ]);
    });

    // A conditional push would make the entry count a private predicate's
    // shadow. The pads' two `?:` live in `math/UintN`, both arms `Field`
    // arithmetic.
    it('should keep the extension free of branches and loops', () => {
      const branching = codeLines(EXTENSION_SOURCE).filter(
        (line) => /\bif\s*\(/.test(line) || /\bfor\s*\(/.test(line),
      );

      expect(branching).toStrictEqual([]);
    });

    // `ekScalar` never enters an on-chain circuit: the only circuit taking a
    // scalar is pure, in the extension and in both mocks.
    it('should take the recipient scalar in pure circuits only', () => {
      for (const source of MOCK_SOURCES) {
        const scalarCircuits = codeLines(source).filter(
          (line) => line.includes('circuit') && line.includes('JubjubScalar'),
        );

        expect(scalarCircuits.length).toBeGreaterThan(0);
        for (const line of scalarCircuits) {
          expect(line).toMatch(/^export pure circuit recoverNote\(/);
        }
      }
    });
  },
);

// ---------------------------------------------------------------------------
// Ground truth: the transaction as the chain stored it
// ---------------------------------------------------------------------------

/**
 * Secrets are high-entropy so a short encoding cannot match proof bytes by
 * chance, and there is no differential layer: two real transactions differ in
 * proofs, fees and wallet nonces whatever the circuit does. See the core's
 * suite for both arguments. Run single-worker (`MIDNIGHT_LIVE_WORKERS=1`).
 */
describe.runIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenDelivery privacy: the published transaction',
  () => {
    const liveSecret = (): Uint8Array => new Uint8Array(randomBytes(32));

    // ~15 bytes of entropy, inside Uint<128> and too wide to appear by chance.
    const liveAmount = (): bigint =>
      BigInt(`0x${Buffer.from(randomBytes(15)).toString('hex')}`);

    const liveScalar = (): bigint =>
      (BigInt(`0x${Buffer.from(randomBytes(31)).toString('hex')}`) % (L - 1n)) +
      1n;

    it('should not publish the recipient key, the amount or the nonce of a mint', async () => {
      const ownerPk = composed.derivePk(liveSecret(), INSTANCE_SALT);
      const token =
        await ConfidentialNoteFungibleTokenDeliveredSimulator.create({
          ownerPk,
          ownerEncPk: ecMulGenerator(liveScalar()),
          value: 1n,
        });
      const ek = liveScalar();
      const encPk = ecMulGenerator(ek);
      const recipientPk = composed.derivePk(liveSecret(), INSTANCE_SALT);
      const amount = liveAmount();

      const from = await indexerHead();
      await token.mint(recipientPk, encPk, amount);
      const published = await awaitPublishedTxs(
        from,
        token._backend.contractAddress,
        { entryPoint: 'mint' },
      );

      expect(published.length).toBeGreaterThan(0);
      const wire = published.map((tx) => tx.raw.toLowerCase()).join('');
      const [entry] = [...(await token.getPublicState()).Delivery__deliveries];
      const note = composed.recoverNote(entry, ek);
      expect(note.value).toBe(amount);

      for (const secret of [
        encPk.x,
        encPk.y,
        amount,
        note.nonce,
        recipientPk,
      ]) {
        for (const encoding of encodingsOf(secret)) {
          expect(wire).not.toContain(encoding);
        }
      }
      // The positive control: the pads are public by design.
      expect(encodingsOf(entry.valueCt).some((e) => wire.includes(e))).toBe(
        true,
      );
    });

    it('should leave the deliveries list in the published state', async () => {
      const ownerPk = composed.derivePk(liveSecret(), INSTANCE_SALT);
      const token =
        await ConfidentialNoteFungibleTokenDeliveredSimulator.create({
          ownerPk,
          ownerEncPk: ecMulGenerator(liveScalar()),
          value: liveAmount(),
        });
      await token.mint(
        composed.derivePk(liveSecret(), INSTANCE_SALT),
        ecMulGenerator(liveScalar()),
        liveAmount(),
      );

      const state = await token.getPublicState();
      expect(Object.keys(state).sort()).toStrictEqual([
        'Core__commitments',
        'Core__instanceSalt',
        'Core__isInitialized',
        'Core__issuedNonces',
        'Core__nullifiers',
        'Delivery__deliveries',
      ]);
      expect(state.Delivery__deliveries.length()).toBe(2n);
      expect(state.Core__commitments.firstFree()).toBe(2n);
    });
  },
);
