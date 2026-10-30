/**
 * Stateful invariants of the core + delivery composition, over generated
 * operation sequences.
 *
 * Neither the unit nor the property suite says anything about an arbitrary
 * SEQUENCE: that after any interleaving of mint, transfer, and burn between two
 * parties, each party's wallet scan of the whole feed finds exactly the notes a
 * shadow model holds for it, and the feed has only grown at its head.
 *
 * The composed circuits return nothing, so the model learns each note the way
 * a wallet does, by opening the entries an op added with the intended party's
 * key. Conservation is checked per operation on those notes, as in the core's
 * suite.
 *
 * DRY ONLY. Each operation is a transaction on live, so 20 runs of 6 would be
 * some 120 txs. Live covers the same circuits by example in the unit suite.
 */

import {
  ecMulGenerator,
  type JubjubPoint,
} from '@midnight-ntwrk/compact-runtime';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { expectRejection } from '#test-utils/assertions/rejection.js';
import {
  pureCircuits as composed,
  type Delivery_Delivery as Delivery,
  type Ledger,
} from '../../../../artifacts/MockConfidentialNoteFungibleTokenDelivered/contract/index.js';
import { ConfidentialNoteFungibleTokenDeliveredSimulator } from '../simulators/ConfidentialNoteFungibleTokenDeliveredSimulator.js';
import {
  INSTANCE_SALT,
  type Note,
} from '../witnesses/ConfidentialNoteFungibleTokenWitnesses.js';

// ---------------------------------------------------------------------------
// Parties
// ---------------------------------------------------------------------------

type Name = 'ALICE' | 'BOB';

interface Party {
  readonly sk: Uint8Array;
  readonly pk: bigint;
  readonly ek: bigint;
  readonly encPk: JubjubPoint;
}

const party = (label: Name, ek: bigint): Party => {
  const sk = new Uint8Array(32);
  sk.set(new TextEncoder().encode(label));
  return {
    sk,
    pk: composed.derivePk(sk, INSTANCE_SALT),
    ek,
    encPk: ecMulGenerator(ek),
  };
};

const PARTIES: Record<Name, Party> = {
  ALICE: party('ALICE', 111222333444555n),
  BOB: party('BOB', 999888777666555n),
};

const NAMES: readonly Name[] = ['ALICE', 'BOB'];

const other = (name: Name): Name => (name === 'ALICE' ? 'BOB' : 'ALICE');

const U128 = 1n << 128n;

// ---------------------------------------------------------------------------
// The operations a sequence is built from
// ---------------------------------------------------------------------------

type Op =
  | { readonly kind: 'mint'; readonly to: Name; readonly value: bigint }
  | { readonly kind: 'transfer'; readonly actor: Name; readonly pct: bigint }
  | { readonly kind: 'burn'; readonly actor: Name; readonly pct: bigint };

const anyParty = () => fc.constantFrom(...NAMES);

const amount = () => fc.bigInt({ min: 1n, max: 200n });

/**
 * A spend names a PERCENTAGE of the spent note, so it scales with the state.
 * Past 100 it reaches the insufficient-value guard.
 */
const percentage = () => fc.bigInt({ min: 0n, max: 120n });

/** Spends outweigh mints, as in the core's suite. */
const opArb: fc.Arbitrary<Op> = fc.oneof(
  {
    arbitrary: fc.record({
      kind: fc.constant('mint' as const),
      to: anyParty(),
      value: amount(),
    }),
    weight: 1,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant('transfer' as const),
      actor: anyParty(),
      pct: percentage(),
    }),
    weight: 2,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant('burn' as const),
      actor: anyParty(),
      pct: percentage(),
    }),
    weight: 2,
  },
);

/** The constructor's opening amount, then the ops. */
const sequence = (maxOps: number): fc.Arbitrary<[bigint, Op[]]> =>
  fc.tuple(amount(), fc.array(opArb, { minLength: 1, maxLength: maxOps }));

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/** A note as a wallet scan reports it. */
type Found = Note & { spent: boolean };

/** What the two wallets believe, learned only from the entries each op added. */
interface Model {
  /** Outputs created so far; the feed holds one entry per output. */
  outputs: bigint;
  /** Each party's notes, newest first, the order a scan finds them in. */
  notes: Record<Name, Found[]>;
  /** Spent notes in spend order, with their owners, for the replay. */
  spent: { owner: Name; note: Note }[];
}

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenDelivery: invariants under generated op sequences',
  () => {
    let delivered: ConfidentialNoteFungibleTokenDeliveredSimulator;

    /** The feed, newest first. */
    const entries = async (): Promise<Delivery[]> => [
      ...(await delivered.getPublicState()).Delivery__deliveries,
    ];

    /** `recoverNote` as a wallet reads it: a plain note, nothing checked. */
    const open = (entry: Delivery, name: Name): Note => {
      const { value, nonce } = composed.recoverNote(entry, PARTIES[name].ek);
      return { value, nonce };
    };

    const isCommitted = (state: Ledger, note: Note, pk: bigint): boolean =>
      state.Core__commitments.findPathForLeaf(composed.commitOf(note, pk)) !==
      undefined;

    /** The wallet filter over the whole feed: in range, committed to `name`. */
    const scan = (state: Ledger, name: Name): Found[] => {
      const found: Found[] = [];
      for (const entry of state.Delivery__deliveries) {
        const note = open(entry, name);
        if (note.value >= U128 || !isCommitted(state, note, PARTIES[name].pk)) {
          continue;
        }
        found.push({
          ...note,
          spent: state.Core__nullifiers.member(composed.nullifierOf(note)),
        });
      }
      return found;
    };

    const credit = (model: Model, name: Name, note: Note): void => {
      model.notes[name].unshift({ ...note, spent: false });
    };

    /** Points the next spend at `note`, as `name`. */
    const spendAs = (name: Name, note: Note): void => {
      delivered.wallet.secretKey = PARTIES[name].sk;
      delivered.wallet.inputNote = note;
    };

    /** Deploys with `opening` minted to ALICE, and learns that note. */
    const deploy = async (opening: bigint): Promise<Model> => {
      delivered = await ConfidentialNoteFungibleTokenDeliveredSimulator.create({
        ownerPk: PARTIES.ALICE.pk,
        ownerEncPk: PARTIES.ALICE.encPk,
        value: opening,
      });
      const model: Model = {
        outputs: 1n,
        notes: { ALICE: [], BOB: [] },
        spent: [],
      };

      const [entry] = await entries();
      const minted = open(entry, 'ALICE');
      expect(minted.value).toBe(opening);
      credit(model, 'ALICE', minted);
      return model;
    };

    /** Re-checks every invariant that must hold after each operation. */
    const checkInvariants = async (
      model: Model,
      before: Delivery[],
    ): Promise<void> => {
      const state = await delivered.getPublicState();
      const feed = [...state.Delivery__deliveries];

      expect(state.Delivery__deliveries.length()).toBe(model.outputs);
      // Append-only: `pushFront` adds at the head, so the old feed is the tail.
      expect(feed.slice(feed.length - before.length)).toStrictEqual(before);

      for (const name of NAMES) {
        const found = scan(state, name);
        expect(found).toStrictEqual(model.notes[name]);

        const theirs = new Set(
          model.notes[other(name)].map(({ nonce }) => nonce),
        );
        expect(found.filter(({ nonce }) => theirs.has(nonce))).toStrictEqual(
          [],
        );
      }
    };

    /** Applies one operation to both the contract and the model. */
    const step = async (op: Op, model: Model): Promise<void> => {
      if (op.kind === 'mint') {
        const to = PARTIES[op.to];
        await delivered.mint(to.pk, to.encPk, op.value);

        const [entry] = await entries();
        const minted = open(entry, op.to);
        expect(minted.value).toBe(op.value);
        model.outputs += 1n;
        credit(model, op.to, minted);
        return;
      }

      // A party holding nothing hands the spend to the other. ALICE always
      // holds a note, since every spend returns change.
      const actor = model.notes[op.actor].some(({ spent }) => !spent)
        ? op.actor
        : other(op.actor);
      const held = model.notes[actor].find(({ spent }) => !spent);
      if (held === undefined) {
        throw new Error('invariants: neither party holds an unspent note');
      }
      const input: Note = { value: held.value, nonce: held.nonce };
      const value = (input.value * op.pct) / 100n;
      const sender = PARTIES[actor];
      const recipient = other(actor);
      spendAs(actor, input);

      if (value > input.value) {
        await expectRejection(
          op.kind === 'transfer'
            ? delivered.transfer(
                PARTIES[recipient].pk,
                PARTIES[recipient].encPk,
                sender.encPk,
                value,
              )
            : delivered.burn(sender.encPk, value),
          'ConfidentialNoteFungibleToken: insufficient note value',
        );
        return;
      }

      if (op.kind === 'transfer') {
        await delivered.transfer(
          PARTIES[recipient].pk,
          PARTIES[recipient].encPk,
          sender.encPk,
          value,
        );

        // The change is delivered last, so it is the head.
        const [changeEntry, outEntry] = await entries();
        const out = open(outEntry, recipient);
        const change = open(changeEntry, actor);
        expect(out.value).toBe(value);
        expect(out.value + change.value).toBe(input.value);
        model.outputs += 2n;
        credit(model, recipient, out);
        credit(model, actor, change);
      } else {
        await delivered.burn(sender.encPk, value);

        const [changeEntry] = await entries();
        const change = open(changeEntry, actor);
        expect(change.value).toBe(input.value - value);
        model.outputs += 1n;
        credit(model, actor, change);
      }

      held.spent = true;
      model.spent.push({ owner: actor, note: input });
    };

    it('should keep the ledger consistent with the model after every step', async () => {
      await fc.assert(
        fc.asyncProperty(sequence(6), async ([opening, ops]) => {
          const model = await deploy(opening);
          await checkInvariants(model, []);

          for (const op of ops) {
            const before = await entries();
            await step(op, model);
            await checkInvariants(model, before);
          }
        }),
        { numRuns: 20 },
      );
    }, 60_000);

    it('should never let a spent note be spent again', async () => {
      await fc.assert(
        fc.asyncProperty(sequence(5), async ([opening, ops]) => {
          const model = await deploy(opening);
          for (const op of ops) {
            await step(op, model);
          }
          fc.pre(model.spent.length > 0);

          // Each spent note, verbatim and as its owner: its commitment is still
          // in the tree, so the call reaches the nullifier check.
          for (const { owner, note } of model.spent) {
            spendAs(owner, note);
            await expectRejection(
              delivered.burn(PARTIES[owner].encPk, 0n),
              'ConfidentialNoteFungibleToken: note already spent',
            );
          }
        }),
        { numRuns: 15 },
      );
    }, 60_000);

    it('should open every entry under exactly one key, to a distinct note committed to that party', async () => {
      await fc.assert(
        fc.asyncProperty(sequence(6), async ([opening, ops]) => {
          const model = await deploy(opening);
          for (const op of ops) {
            await step(op, model);
          }

          const state = await delivered.getPublicState();
          const nonces = new Set<bigint>();
          for (const entry of state.Delivery__deliveries) {
            // The range check alone picks the owner; the tree confirms it.
            const owners = NAMES.filter(
              (name) => open(entry, name).value < U128,
            );
            expect(owners).toHaveLength(1);

            const [owner] = owners;
            const note = open(entry, owner);
            expect(isCommitted(state, note, PARTIES[owner].pk)).toBe(true);
            expect(nonces.has(note.nonce)).toBe(false);
            nonces.add(note.nonce);
          }
        }),
        { numRuns: 15 },
      );
    }, 60_000);
  },
);
