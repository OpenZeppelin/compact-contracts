/**
 * Stateful invariants of the note core, over generated operation sequences.
 *
 * Neither the functional nor the property suite says anything about a SEQUENCE:
 * that after any interleaving of mint, transfer, and burn, the ledger still agrees
 * with what a wallet believes. So this carries a shadow model of an honest wallet
 * and re-checks it after every step.
 *
 * Conservation is checked per operation, not globally, since the core keeps no
 * supply figure: `transfer` splits the input exactly, `burn` destroys exactly what
 * it was asked to.
 *
 * DRY ONLY. Each operation is a transaction on live, so 20 runs of 6 would be some
 * 120 txs and 90 minutes. Fuzzing is a dry technique here; live covers the same
 * circuits by example.
 */

import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { expectRejection } from '#test-utils/assertions/rejection.js';
import { pureCircuits as core } from '../../../artifacts/MockConfidentialNoteFungibleToken/contract/index.js';
import { ConfidentialNoteFungibleTokenSimulator } from './simulators/ConfidentialNoteFungibleTokenSimulator.js';
import type { Note } from './witnesses/ConfidentialNoteFungibleTokenWitnesses.js';

// ---------------------------------------------------------------------------
// Identities
// ---------------------------------------------------------------------------

const secretKey = (label: string): Uint8Array => {
  const sk = new Uint8Array(32);
  sk.set(new TextEncoder().encode(label));
  return sk;
};

const ALICE_SK = secretKey('ALICE');
const ALICE = core.derivePk(ALICE_SK);
const BOB = core.derivePk(secretKey('BOB'));

// ---------------------------------------------------------------------------
// The operations a sequence is built from
// ---------------------------------------------------------------------------

type Op =
  | { readonly kind: 'mint'; readonly value: bigint }
  | { readonly kind: 'transfer'; readonly pct: bigint }
  | { readonly kind: 'burn'; readonly pct: bigint };

const amount = () => fc.bigInt({ min: 1n, max: 200n });

/**
 * A spend names a PERCENTAGE of the held note, so it scales with the state.
 * Absolutes collapse onto the insufficient-value guard as the change note shrinks
 * (measured: 106 of 223 steps). The range runs past 100 to keep exercising that
 * guard, just not exclusively.
 */
const percentage = () => fc.bigInt({ min: 0n, max: 120n });

/**
 * Spends outweigh mints and every sequence opens with a mint, so the budget goes on
 * real state transitions. Without both, runs were dominated by spends against an
 * empty wallet (measured: 154 of 306 steps), which has its own case in the
 * functional suite.
 */
const opArb: fc.Arbitrary<Op> = fc.oneof(
  {
    arbitrary: fc.record({
      kind: fc.constant('mint' as const),
      value: amount(),
    }),
    weight: 1,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant('transfer' as const),
      pct: percentage(),
    }),
    weight: 2,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant('burn' as const),
      pct: percentage(),
    }),
    weight: 2,
  },
);

/** A sequence that always has something to spend from its second step on. */
const sequence = (maxOps: number): fc.Arbitrary<Op[]> =>
  fc
    .tuple(
      fc.bigInt({ min: 1n, max: 200n }),
      fc.array(opArb, { minLength: 1, maxLength: maxOps }),
    )
    .map(([opening, rest]) => [
      { kind: 'mint' as const, value: opening },
      ...rest,
    ]);

/** The wallet's belief about the world, maintained independently of the ledger. */
interface Model {
  commitments: bigint;
  spends: bigint;
  /** Every note spent so far, kept whole so a replay can be re-presented. */
  spentNotes: Note[];
  /** What ALICE can spend next; undefined until the first mint. */
  held: Note | undefined;
  /** Notes transferred out to BOB, which ALICE can no longer touch. */
  bobNotes: Note[];
}

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleToken: invariants under generated op sequences',
  () => {
    let token: ConfidentialNoteFungibleTokenSimulator;

    const publicState = () => token.getPublicState();

    const commitmentCount = async (): Promise<bigint> =>
      (await publicState()).Core__commitments.firstFree();

    const nullifierCount = async (): Promise<bigint> =>
      (await publicState()).Core__nullifiers.size();

    const isSpent = async (note: Note): Promise<boolean> =>
      (await publicState()).Core__nullifiers.member(core.nullifierOf(note));

    const isCommitted = async (note: Note, ownerPk: bigint): Promise<boolean> =>
      (await publicState()).Core__commitments.findPathForLeaf(
        core.commitOf(note, ownerPk),
      ) !== undefined;

    /** Points the next spend at `note`, as the owner of `sk`. */
    const spendAs = (sk: Uint8Array, note: Note): void => {
      token.wallet.secretKey = sk;
      token.wallet.inputNote = note;
      token.wallet.pathOverride = undefined;
    };

    /** Re-checks every invariant that must hold after each operation. */
    const checkInvariants = async (model: Model): Promise<void> => {
      expect(await commitmentCount()).toBe(model.commitments);
      expect(await nullifierCount()).toBe(model.spends);

      // A nullifier set only ever grows: nothing un-spends.
      for (const spent of model.spentNotes) {
        expect(await isSpent(spent)).toBe(true);
      }
      // The note the wallet believes it holds really is committed to it.
      if (model.held !== undefined) {
        expect(await isCommitted(model.held, ALICE)).toBe(true);
        expect(await isSpent(model.held)).toBe(false);
      }
    };

    /** Applies one operation to both the contract and the model. */
    const step = async (op: Op, model: Model): Promise<void> => {
      if (op.kind === 'mint') {
        const minted = await token._mint(ALICE, op.value);

        expect(minted.value).toBe(op.value);
        model.commitments += 1n;
        model.held = minted;
        return;
      }

      // Unreachable: every sequence opens with a mint. Spending an empty wallet
      // has its own named case in the functional suite.
      const input = model.held;
      if (input === undefined) {
        throw new Error('invariants: sequence generator failed to seed a note');
      }

      spendAs(ALICE_SK, input);
      // Resolve the percentage against what is actually held. Integer division,
      // so a small note plus a small percentage legitimately yields a zero-value
      // spend, which the module treats as spendable padding.
      const value = (input.value * op.pct) / 100n;

      if (value > input.value) {
        // The guard, reached by generated amounts rather than a chosen one.
        await expectRejection(
          op.kind === 'transfer'
            ? token.transfer(BOB, value)
            : token.burn(value),
          'ConfidentialNoteFungibleToken: insufficient note value',
        );
        return;
      }

      if (op.kind === 'transfer') {
        const [out, change] = await token.transfer(BOB, value);

        // Conservation: the input is split exactly, nothing created or lost.
        expect(out.value + change.value).toBe(input.value);
        expect(out.value).toBe(value);
        model.commitments += 2n;
        model.bobNotes.push(out);
        model.held = change;
      } else {
        const change = await token.burn(value);

        // Conservation: exactly `op.value` destroyed, the rest re-issued.
        expect(change.value).toBe(input.value - value);
        model.commitments += 1n;
        model.held = change;
      }

      model.spends += 1n;
      model.spentNotes.push(input);
    };

    it('should keep the ledger consistent with the model after every step', async () => {
      await fc.assert(
        fc.asyncProperty(sequence(6), async (ops) => {
          token = await ConfidentialNoteFungibleTokenSimulator.create();
          const model: Model = {
            commitments: 0n,
            spends: 0n,
            spentNotes: [],
            held: undefined,
            bobNotes: [],
          };

          for (const op of ops) {
            await step(op, model);
            await checkInvariants(model);
          }

          // Recipient notes are committed to BOB and remain unspent: ALICE
          // never had the means to spend them.
          for (const note of model.bobNotes) {
            expect(await isCommitted(note, BOB)).toBe(true);
            expect(await isSpent(note)).toBe(false);
          }
        }),
        { numRuns: 20 },
      );
    });

    it('should never let a spent note be spent again', async () => {
      await fc.assert(
        fc.asyncProperty(sequence(5), async (ops) => {
          token = await ConfidentialNoteFungibleTokenSimulator.create();
          const model: Model = {
            commitments: 0n,
            spends: 0n,
            spentNotes: [],
            held: undefined,
            bobNotes: [],
          };

          for (const op of ops) {
            await step(op, model);
          }
          fc.pre(model.spends > 0n);

          // Re-present the FIRST note the sequence spent, verbatim. Using the
          // exact note matters: its commitment is still in the tree, so the
          // call reaches the nullifier check instead of failing earlier on a
          // missing path, which would prove nothing about double spending.
          const replayed = model.spentNotes[0] as Note;
          spendAs(ALICE_SK, replayed);

          await expectRejection(
            token.burn(0n),
            'ConfidentialNoteFungibleToken: note already spent',
          );
        }),
        { numRuns: 15 },
      );
    });
  },
);
