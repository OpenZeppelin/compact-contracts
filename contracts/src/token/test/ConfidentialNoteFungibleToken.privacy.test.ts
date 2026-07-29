/**
 * Privacy claims for the ConfidentialNoteFungibleToken core, as executable
 * assertions rather than prose.
 *
 * The functional suite asks what a circuit did. This one asks what the chain
 * gets to see: it drives the contract directly so it can read `proofData`, the
 * per-call record a real transaction carries.
 *
 *   publicTranscript        the ledger operations the transaction publishes
 *   privateTranscriptOutputs  the witness answers, which stay on the prover
 *
 * Three layers, weakest to strongest:
 *
 *   1. no secret's byte encoding appears in the public transcript,
 *   2. the transcript's SHAPE does not vary with the secrets,
 *   3. two runs differing only in a secret differ only in hash digests.
 *
 * Layer 3 is the one that catches a value-dependent branch, the classic leak in
 * a Compact circuit: the branch bit shows up as a different operation sequence
 * even when no value is ever disclosed.
 *
 * Layers 1-3 run dry, because `proofData` is produced by the in-memory path. A
 * fourth layer runs LIVE and is the ground truth the others stand in for: the
 * serialized transaction as the indexer stored it, scanned for the same
 * secrets. Run it with `MIDNIGHT_BACKEND=live`; see the live describe below for
 * why the scan uses high-entropy secrets.
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
} from '@midnight-ntwrk/compact-runtime';
import {
  CircuitContextManager,
  isLiveBackend,
} from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  awaitPublishedTxs,
  indexerHead,
} from '#test-utils/harness/publishedTx.js';
import {
  pureCircuits as core,
  ledger,
  Contract as MockCore,
} from '../../../artifacts/MockConfidentialNoteFungibleToken/contract/index.js';
import { ConfidentialNoteFungibleTokenSimulator } from './simulators/ConfidentialNoteFungibleTokenSimulator.js';
import {
  ConfidentialNoteFungibleTokenWitnesses,
  createNoteWallet,
  type Note,
  type NoteWallet,
} from './witnesses/ConfidentialNoteFungibleTokenWitnesses.js';

// ---------------------------------------------------------------------------
// Probe: the contract driven directly, so `proofData` survives the call
// ---------------------------------------------------------------------------

const secretKey = (label: string): Uint8Array => {
  const sk = new Uint8Array(32);
  sk.set(new TextEncoder().encode(label));
  return sk;
};

const ALICE_SK = secretKey('ALICE');
const BOB_SK = secretKey('BOB');
const ALICE = core.derivePk(ALICE_SK);
const BOB = core.derivePk(BOB_SK);

// Planted so two probes derive byte-identical notes; the differential tests
// need every input equal except the one secret under study.
const SEED = secretKey('DIFFERENTIAL-SEED');

/** The core declares no private state; the wallet carries the secrets. */
type PrivateState = Record<string, never>;

type Trace = {
  transcript: Op<AlignedValue>[];
  privateOutputs: AlignedValue[];
  input: AlignedValue;
  output: AlignedValue;
};

class Probe {
  readonly wallet: NoteWallet;
  private readonly contract;
  private readonly manager;

  constructor() {
    this.wallet = createNoteWallet();
    this.wallet.nonceSeed = SEED;
    this.contract = new MockCore(
      ConfidentialNoteFungibleTokenWitnesses(this.wallet),
    );
    this.manager = new CircuitContextManager(
      this.contract,
      {},
      '0'.repeat(64),
      dummyContractAddress(),
    );
  }

  private run<T>(call: () => CircuitResults<PrivateState, T>): [T, Trace] {
    const { result, context, proofData } = call();
    this.manager.setContext(context);
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

  mint(recipientPk: bigint, value: bigint): [Note, Trace] {
    return this.run(() =>
      this.contract.impureCircuits._mint(
        this.manager.getContext(),
        recipientPk,
        value,
      ),
    );
  }

  transfer(recipientPk: bigint, value: bigint): [[Note, Note], Trace] {
    return this.run(() =>
      this.contract.impureCircuits.transfer(
        this.manager.getContext(),
        recipientPk,
        value,
      ),
    );
  }

  burn(value: bigint): [Note, Trace] {
    return this.run(() =>
      this.contract.impureCircuits.burn(this.manager.getContext(), value),
    );
  }

  consumeNote(ownerPk: bigint): [Note, Trace] {
    return this.run(() =>
      this.contract.impureCircuits._consumeNote(
        this.manager.getContext(),
        ownerPk,
      ),
    );
  }

  spend(sk: Uint8Array, note: Note): void {
    this.wallet.secretKey = sk;
    this.wallet.inputNote = note;
  }

  get state() {
    return ledger(this.manager.getContext().currentQueryContext.state.state);
  }
}

// ---------------------------------------------------------------------------
// Reading a transcript
// ---------------------------------------------------------------------------

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

/**
 * The runtime stores byte values with trailing zeros stripped, so a 32-byte
 * secret whose tail is padding appears in a transcript under its trimmed form.
 * Searching for the padded form would pass vacuously.
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

/**
 * The digest-width values a transcript publishes: hashes, roots, nullifiers.
 *
 * NOT an exact 32 bytes. The runtime zero-trims leading zero bytes, so a digest
 * beginning `0x00` arrives 31 bytes wide, roughly one time in 256. Filtering on
 * exactly 64 hex characters therefore drops real digests at random, which is how
 * this layer became flaky once its inputs were generated rather than chosen.
 *
 * The bound below keeps every plausibly-trimmed digest while still excluding the
 * small tags and indices a transcript also carries: misclassifying a digest now
 * needs five leading zero bytes, about one in a trillion.
 */
const DIGEST_MIN_HEX = 56;

const digestsIn = (trace: Trace): string[] =>
  bytesIn(trace.transcript).filter((b) => b.length >= DIGEST_MIN_HEX);

const CORE_SOURCE = readFileSync(
  new URL('../ConfidentialNoteFungibleToken.compact', import.meta.url),
  'utf8',
);

// ---------------------------------------------------------------------------
// What reaches the public transcript
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleToken privacy: the public transcript',
  () => {
    // The tree stores the hash of the leaf, so even the commitment stays off
    // the wire: the transaction carries one opaque digest, and only a holder
    // who can rebuild the note can recognise it.
    it('should publish one opaque digest per mint, not the commitment itself', () => {
      const probe = new Probe();
      const [note, trace] = probe.mint(ALICE, 1000n);
      const commitment = core.commitOf(note, ALICE);

      expect(bytesIn(trace.transcript)).not.toContain(hex(commitment));
      expect(digestsIn(trace)).toHaveLength(1);
      // The note really was committed, so the assertions above are not vacuous.
      expect(
        probe.state.Core__commitments.findPathForLeaf(commitment) !== undefined,
      ).toBe(true);
    });

    it('should not carry the minted amount', () => {
      const probe = new Probe();
      const [, trace] = probe.mint(ALICE, 1000n);
      const published = bytesIn(trace.transcript);

      for (const encoding of encodingsOf(1000n)) {
        expect(published).not.toContain(encoding);
      }
    });

    it('should not carry the note nonce or the owner identity', () => {
      const probe = new Probe();
      const [note, trace] = probe.mint(ALICE, 1000n);
      const published = bytesIn(trace.transcript);

      for (const encoding of encodingsOf(note.nonce)) {
        expect(published).not.toContain(encoding);
      }
      for (const encoding of encodingsOf(ALICE)) {
        expect(published).not.toContain(encoding);
      }
    });

    it('should not carry the spend secret of a burn', () => {
      const probe = new Probe();
      const [note] = probe.mint(ALICE, 1000n);
      probe.spend(ALICE_SK, note);
      const [, trace] = probe.burn(400n);
      const published = bytesIn(trace.transcript);

      expect(published).not.toContain(encoded(ALICE_SK));
      for (const encoding of encodingsOf(400n)) {
        expect(published).not.toContain(encoding);
      }
    });

    // The mirror image of the checks above: the secrets do exist, on the side
    // that never leaves the prover. Without this, a probe that simply failed to
    // read anything would satisfy every `not.toContain` above.
    it('should carry the spend secret on the private side only', () => {
      const probe = new Probe();
      const [note] = probe.mint(ALICE, 1000n);
      probe.spend(ALICE_SK, note);
      const [, trace] = probe.burn(400n);

      expect(bytesIn(trace.privateOutputs)).toContain(encoded(ALICE_SK));
      expect(bytesIn(trace.transcript)).not.toContain(encoded(ALICE_SK));
    });

    it('should publish the nullifier of a spent note', () => {
      const probe = new Probe();
      const [note] = probe.mint(ALICE, 1000n);
      probe.spend(ALICE_SK, note);
      const [, trace] = probe.burn(400n);

      expect(bytesIn(trace.transcript)).toContain(hex(core.nullifierOf(note)));
    });

    it('should publish exactly two commitments and one nullifier per transfer', () => {
      const probe = new Probe();
      const [note] = probe.mint(ALICE, 1000n);
      const before = probe.state;
      probe.spend(ALICE_SK, note);
      probe.transfer(BOB, 300n);
      const after = probe.state;

      expect(after.Core__commitments.firstFree()).toBe(
        before.Core__commitments.firstFree() + 2n,
      );
      expect(after.Core__nullifiers.size()).toBe(
        before.Core__nullifiers.size() + 1n,
      );
    });
  },
);

// ---------------------------------------------------------------------------
// Indistinguishability: the shape does not depend on the secrets
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleToken privacy: indistinguishability',
  () => {
    /** A transfer of `value` to `recipientPk`, from an identical starting note. */
    const transferTrace = (recipientPk: bigint, value: bigint): Trace => {
      const probe = new Probe();
      const [note] = probe.mint(ALICE, 1000n);
      probe.spend(ALICE_SK, note);
      return probe.transfer(recipientPk, value)[1];
    };

    const mintTrace = (recipientPk: bigint, value: bigint): Trace => {
      const probe = new Probe();
      return probe.mint(recipientPk, value)[1];
    };

    /**
     * Inputs are GENERATED here rather than chosen.
     *
     * These claims are the ones a hand-picked pair is weakest at: a planted
     * `disclose(value)` survived this layer once because both probes happened to
     * mint the same amount. Generating both sides of every comparison removes
     * that whole class of coincidence.
     *
     * Run counts are small on purpose. Each case drives two full circuit
     * executions, so a default 100 runs would add tens of seconds to a suite
     * that is otherwise instant.
     */
    const UINT128_MAX = (1n << 128n) - 1n;

    /**
     * Any `Uint<128>`. Spanning the full width matters: an amount that leaked
     * would most likely surface as a CHANGE IN BYTE LENGTH, which only shows up
     * when the generated values straddle encoding boundaries.
     */
    const anyAmount = () => fc.bigInt({ min: 0n, max: UINT128_MAX });

    /** An amount the 1000-value input note below can actually pay. */
    const payableAmount = () => fc.bigInt({ min: 0n, max: 1000n });

    /** A recipient, derived from a generated secret so it is a valid `Field`. */
    const anyRecipientPk = () =>
      fc
        .uint8Array({ minLength: 32, maxLength: 32 })
        .map((sk) => core.derivePk(sk));

    it('should mint with the same transcript shape for any amount', () => {
      fc.assert(
        fc.property(anyAmount(), anyAmount(), (a, b) => {
          expect(shapeOf(mintTrace(ALICE, a).transcript)).toStrictEqual(
            shapeOf(mintTrace(ALICE, b).transcript),
          );
        }),
        { numRuns: 15 },
      );
    });

    it('should transfer with the same transcript shape for any amount', () => {
      fc.assert(
        fc.property(payableAmount(), payableAmount(), (a, b) => {
          expect(shapeOf(transferTrace(BOB, a).transcript)).toStrictEqual(
            shapeOf(transferTrace(BOB, b).transcript),
          );
        }),
        { numRuns: 10 },
      );
    });

    it('should transfer with the same transcript shape for any recipient', () => {
      fc.assert(
        fc.property(anyRecipientPk(), anyRecipientPk(), (first, second) => {
          expect(shapeOf(transferTrace(first, 300n).transcript)).toStrictEqual(
            shapeOf(transferTrace(second, 300n).transcript),
          );
        }),
        { numRuns: 10 },
      );
    });

    it('should transfer with the same transcript length for any amount', () => {
      fc.assert(
        fc.property(payableAmount(), payableAmount(), (a, b) => {
          const left = bytesIn(transferTrace(BOB, a).transcript);
          const right = bytesIn(transferTrace(BOB, b).transcript);

          expect(left.length).toBe(right.length);
          expect(left.map((bytes) => bytes.length)).toStrictEqual(
            right.map((bytes) => bytes.length),
          );
        }),
        { numRuns: 10 },
      );
    });

    /** The byte strings that move between two otherwise identical runs. */
    const drift = (a: Trace, b: Trace): string[] => {
      const left = bytesIn(a.transcript);
      const right = bytesIn(b.transcript);
      expect(left).toHaveLength(right.length);
      return left.filter((value, i) => value !== right[i]);
    };

    /**
     * Nothing that moved is anything but an opaque digest.
     *
     * The substantive claim is the non-containment: whatever moved is not the
     * encoding of any secret the two runs differed in. Width is only a
     * structural sanity bound, and deliberately not an equality: a digest whose
     * leading byte is zero is published one byte shorter, so requiring exactly
     * 64 hex characters would fail on roughly one draw in 256.
     */
    const expectOpaque = (moved: string[], secrets: bigint[]): void => {
      for (const value of moved) {
        expect(value.length).toBeLessThanOrEqual(64);
        for (const secret of secrets) {
          expect(encodingsOf(secret)).not.toContain(value);
        }
      }
    };

    it('should move only one digest when the minted amount differs', () => {
      fc.assert(
        fc.property(anyAmount(), anyAmount(), (a, b) => {
          fc.pre(a !== b);

          const moved = drift(mintTrace(ALICE, a), mintTrace(ALICE, b));

          expect(moved).toHaveLength(1);
          expectOpaque(moved, [a, b, ALICE]);
        }),
        { numRuns: 15 },
      );
    });

    it('should move only one digest when the mint recipient differs', () => {
      fc.assert(
        fc.property(
          payableAmount(),
          anyRecipientPk(),
          anyRecipientPk(),
          (value, first, second) => {
            fc.pre(first !== second);

            const moved = drift(
              mintTrace(first, value),
              mintTrace(second, value),
            );

            expect(moved).toHaveLength(1);
            expectOpaque(moved, [value, first, second]);
          },
        ),
        { numRuns: 15 },
      );
    });

    // The strongest claim in the file. Two transfers of wildly different
    // amounts publish byte-identical transactions except for the two output
    // leaf digests, and those are hashes.
    it('should move only the two output digests when the amount differs', () => {
      fc.assert(
        fc.property(payableAmount(), payableAmount(), (a, b) => {
          fc.pre(a !== b);

          const probeA = new Probe();
          const [inputA] = probeA.mint(ALICE, 1000n);
          probeA.spend(ALICE_SK, inputA);
          const [notesA, traceA] = probeA.transfer(BOB, a);

          const probeB = new Probe();
          const [inputB] = probeB.mint(ALICE, 1000n);
          probeB.spend(ALICE_SK, inputB);
          const [notesB, traceB] = probeB.transfer(BOB, b);

          // Same starting note, so the spend half of the transaction is
          // identical.
          expect(inputA).toStrictEqual(inputB);
          // Sanity: the two runs really did carry different amounts.
          expect(notesA[0].value).not.toBe(notesB[0].value);

          const moved = drift(traceA, traceB);
          expect(moved).toHaveLength(2); // the output note and the change note
          expectOpaque(moved, [
            a,
            b,
            notesA[0].nonce,
            notesA[1].nonce,
            ALICE,
            BOB,
          ]);
        }),
        { numRuns: 10 },
      );
    });

    // Only the recipient's own digest moves. The change note's digest does not,
    // so a watcher cannot even tell that the recipient changed.
    it('should move only one digest when the recipient differs', () => {
      fc.assert(
        fc.property(
          payableAmount(),
          anyRecipientPk(),
          anyRecipientPk(),
          (value, first, second) => {
            fc.pre(first !== second);

            const probeA = new Probe();
            const [inputA] = probeA.mint(ALICE, 1000n);
            probeA.spend(ALICE_SK, inputA);
            const [, traceA] = probeA.transfer(first, value);

            const probeB = new Probe();
            const [inputB] = probeB.mint(ALICE, 1000n);
            probeB.spend(ALICE_SK, inputB);
            const [, traceB] = probeB.transfer(second, value);

            const moved = drift(traceA, traceB);
            expect(moved).toHaveLength(1);
            expectOpaque(moved, [value, ALICE, first, second]);
          },
        ),
        { numRuns: 10 },
      );
    });

    // The nullifier depends on the nonce alone, so a caller who never held the
    // owner's secret publishes the same one. That is what makes an owner spend
    // and a clawback mutually exclusive, and why nonces are spend-critical.
    it('should publish the same nullifier whoever consumes the note', () => {
      const probeA = new Probe();
      const [note] = probeA.mint(ALICE, 1000n);
      probeA.spend(ALICE_SK, note);
      const [, traceA] = probeA.consumeNote(ALICE);

      // A second deployment, same note, consumed by a caller holding Bob's
      // secret and naming Alice as the owner: the ungated clawback path.
      const probeB = new Probe();
      probeB.mint(ALICE, 1000n);
      probeB.spend(BOB_SK, note);
      const [, traceB] = probeB.consumeNote(ALICE);

      const nullifier = hex(core.nullifierOf(note));
      expect(bytesIn(traceA.transcript)).toContain(nullifier);
      expect(bytesIn(traceB.transcript)).toContain(nullifier);
      expect(drift(traceA, traceB)).toStrictEqual([]);
    });
  },
);

// ---------------------------------------------------------------------------
// The disclose surface
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleToken privacy: the disclose surface',
  () => {
    // Every crossing of the privacy boundary is one `disclose()`. Pinning the
    // exact set means a new one fails a test instead of relying on review to
    // catch it. Update this list only with a reviewed justification.
    const EXPECTED_DISCLOSURES = [
      // to public state
      '_commitments.insert(disclose(commitOf(note, ownerPk)));',
      'const root = disclose(merkleTreePathRoot<32, Bytes<32>>(path));',
      'assert(!_nullifiers.member(disclose(nf)),',
      '_nullifiers.insert(disclose(nf));',
      // to the local caller only, across the exported-circuit boundary
      'return disclose(note);',
      'return disclose(changeNote);',
      'return [disclose(outNote), disclose(changeNote)];',
    ];

    it('should disclose only at the reviewed sites', () => {
      const sites = CORE_SOURCE.split('\n')
        .map((line) => line.trim())
        .filter((line) => line.includes('disclose(') && !line.startsWith('*'));

      expect(new Set(sites)).toStrictEqual(new Set(EXPECTED_DISCLOSURES));
    });

    it('should not disclose a witness value directly', () => {
      // `disclose(wit_...)` would publish a secret verbatim. Every legitimate
      // disclosure above publishes a hash, a root, or a locally-returned note.
      expect(CORE_SOURCE).not.toMatch(/disclose\(\s*wit_/);
    });

    it('should write no public state outside the tree and the nullifier set', () => {
      const ledgerFields = CORE_SOURCE.split('\n')
        .filter((line) => line.trim().startsWith('export ledger'))
        .map((line) => line.trim());

      expect(ledgerFields).toStrictEqual([
        'export ledger _commitments: HistoricMerkleTree<32, Bytes<32>>;',
        'export ledger _nullifiers: Set<Bytes<32>>;',
      ]);
    });
  },
);

// ---------------------------------------------------------------------------
// Ground truth: the transaction as the chain stored it
// ---------------------------------------------------------------------------

/**
 * The layers above read `proofData`, a faithful preimage of the transaction.
 * This one reads the transaction itself, fetched back from the indexer, and
 * asks the same question of the bytes a real observer receives.
 *
 * Two things shape how these tests are written:
 *
 * - SECRETS MUST BE HIGH-ENTROPY. A serialized transaction is a large blob of
 *   proof bytes. Searching it for a short encoding (a `1000n` amount is two
 *   bytes) finds a match by coincidence, so a naive scan fails on a contract
 *   that leaks nothing. Every secret below is long enough that an accidental
 *   hit is negligible: 32-byte keys, a 15-byte amount.
 * - NO DIFFERENTIAL LAYER. Two real transactions differ in their proofs, fees,
 *   and wallet nonces no matter what the circuit does, so the byte-identical
 *   comparison that makes layer 3 strong cannot work here. Layer 3 stays dry;
 *   this layer is presence-scanning plus published state.
 *
 * Run single-worker (`MIDNIGHT_LIVE_WORKERS=1`): the scan reads every
 * transaction in the block window, and a concurrent spec's transactions would
 * be swept in with them.
 */
describe.runIf(isLiveBackend())(
  'ConfidentialNoteFungibleToken privacy: the published transaction',
  () => {
    // 32 random bytes: no padding to trim, nothing to collide with.
    const liveSecret = (): Uint8Array => new Uint8Array(randomBytes(32));

    // ~15 bytes of entropy, comfortably inside Uint<128> and far too wide to
    // turn up in a proof blob by chance.
    const liveAmount = (): bigint =>
      BigInt(`0x${Buffer.from(randomBytes(15)).toString('hex')}`);

    let token: ConfidentialNoteFungibleTokenSimulator;

    beforeEach(async () => {
      token = await ConfidentialNoteFungibleTokenSimulator.create();
    });

    it('should not publish the amount, the nonce, or the owner in the transaction', async () => {
      const ownerSk = liveSecret();
      const ownerPk = core.derivePk(ownerSk);
      const amount = liveAmount();

      const from = await indexerHead();
      const note = await token._mint(ownerPk, amount);
      const published = await awaitPublishedTxs(from);

      expect(published.length).toBeGreaterThan(0);
      const wire = published.map((tx) => tx.raw.toLowerCase()).join('');

      for (const encoding of encodingsOf(amount)) {
        expect(wire).not.toContain(encoding);
      }
      for (const encoding of encodingsOf(note.nonce)) {
        expect(wire).not.toContain(encoding);
      }
      for (const encoding of encodingsOf(ownerPk)) {
        expect(wire).not.toContain(encoding);
      }
      expect(wire).not.toContain(encoded(ownerSk));
      // The commitment is hashed into the tree, so not even that reaches the
      // wire in recognisable form.
      expect(wire).not.toContain(hex(core.commitOf(note, ownerPk)));
    });

    it('should not publish the spend secret of a transfer', async () => {
      const senderSk = liveSecret();
      const senderPk = core.derivePk(senderSk);
      const recipientPk = core.derivePk(liveSecret());
      const amount = liveAmount();

      const note = await token._mint(senderPk, amount);
      token.wallet.secretKey = senderSk;
      token.wallet.inputNote = note;

      const from = await indexerHead();
      const [out] = await token.transfer(recipientPk, amount);
      const published = await awaitPublishedTxs(from);
      const wire = published.map((tx) => tx.raw.toLowerCase()).join('');

      expect(wire).not.toContain(encoded(senderSk));
      for (const encoding of encodingsOf(recipientPk)) {
        expect(wire).not.toContain(encoding);
      }
      for (const encoding of encodingsOf(out.nonce)) {
        expect(wire).not.toContain(encoding);
      }
      for (const encoding of encodingsOf(amount)) {
        expect(wire).not.toContain(encoding);
      }
    });

    it('should publish the nullifier of the spent note', async () => {
      const ownerSk = liveSecret();
      const ownerPk = core.derivePk(ownerSk);
      const amount = liveAmount();

      const note = await token._mint(ownerPk, amount);
      token.wallet.secretKey = ownerSk;
      token.wallet.inputNote = note;

      const from = await indexerHead();
      await token.burn(amount);
      const published = await awaitPublishedTxs(from);
      const wire = published.map((tx) => tx.raw.toLowerCase()).join('');

      // The positive control: the scan above is only meaningful if this scan
      // can find something. A nullifier is public by design.
      expect(wire).toContain(hex(core.nullifierOf(note)));
    });

    it('should leave only the tree and the nullifier set in the published state', async () => {
      const ownerSk = liveSecret();
      const ownerPk = core.derivePk(ownerSk);

      const note = await token._mint(ownerPk, liveAmount());
      token.wallet.secretKey = ownerSk;
      token.wallet.inputNote = note;
      await token.transfer(core.derivePk(liveSecret()), 1n);

      const state = await token.getPublicState();
      expect(Object.keys(state).sort()).toStrictEqual([
        'Core__commitments',
        'Core__nullifiers',
      ]);
      expect(state.Core__commitments.firstFree()).toBe(3n);
      expect(state.Core__nullifiers.size()).toBe(1n);
    });

    // A KNOWN, ACCEPTED LEAK, asserted so it stays a decision rather than a
    // surprise: the ledger records which entry point a transaction called, so
    // an observer learns a transfer happened, just not its amount or parties.
    it('should publish the entry point, making the operation type public', async () => {
      const ownerSk = liveSecret();
      const ownerPk = core.derivePk(ownerSk);

      const note = await token._mint(ownerPk, liveAmount());
      token.wallet.secretKey = ownerSk;
      token.wallet.inputNote = note;

      const from = await indexerHead();
      await token.burn(1n);
      const published = await awaitPublishedTxs(from);

      const entryPoints = published.flatMap((tx) =>
        tx.calls.map((call) => call.entryPoint),
      );
      expect(entryPoints.length).toBeGreaterThan(0);
      expect(entryPoints.every((point) => point.length > 0)).toBe(true);
    });
  },
);
