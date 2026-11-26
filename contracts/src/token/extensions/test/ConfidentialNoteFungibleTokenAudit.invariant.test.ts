/**
 * Stateful invariants of the core + audit composition, over generated
 * operation sequences.
 *
 * Neither the unit nor the property suite says anything about an arbitrary
 * SEQUENCE: that after any interleaving of mint, transfer, burn and seize, the
 * auditor's scan of the whole trail finds exactly the notes the ledger holds,
 * one record per leaf, and the trail has only grown at its head.
 *
 * The model learns each note from the circuit's return value. The auditor
 * learns it from the trail alone, under the audit scalar. The two are compared
 * after every step, so neither is checked against itself. Conservation is
 * checked per operation, as in the core's suite.
 *
 * DRY ONLY. Each operation is a transaction on live, so 20 runs of 6 would be
 * some 120 txs. Live covers the same circuits by example in the unit suite.
 */

import { ecMulGenerator } from '@midnight-ntwrk/compact-runtime';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { expectRejection } from '#test-utils/assertions/rejection.js';
import {
  pureCircuits as composed,
  type Ledger,
} from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenAudited/contract/index.js';
import { NOTE_SALT } from '../../presets/test/witnesses/CustodialConfidentialNoteFungibleTokenWitnesses.js';
import {
  type AuditRecord,
  ConfidentialNoteFungibleTokenAuditedSimulator,
  type Identifier,
  type Note,
} from './simulators/ConfidentialNoteFungibleTokenAuditedSimulator.js';

// ---------------------------------------------------------------------------
// Parties
// ---------------------------------------------------------------------------

type Name = 'ALICE' | 'BOB';

interface Party {
  readonly sk: Uint8Array;
  readonly pk: Identifier;
}

const party = (label: Name): Party => {
  const sk = new Uint8Array(32);
  sk.set(new TextEncoder().encode(label));
  return { sk, pk: composed.deriveIdentifier(sk, NOTE_SALT) };
};

const PARTIES: Record<Name, Party> = {
  ALICE: party('ALICE'),
  BOB: party('BOB'),
};

const NAMES: readonly Name[] = ['ALICE', 'BOB'];

const other = (name: Name): Name => (name === 'ALICE' ? 'BOB' : 'ALICE');

const hexOf = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const nameOf = (owner: Identifier): Name => {
  const name = NAMES.find(
    (n) => hexOf(PARTIES[n].pk.left) === hexOf(owner.left),
  );
  if (name === undefined) throw new Error('invariants: unknown owner');
  return name;
};

const U128 = 1n << 128n;

const AUDIT_SCALAR = 111222333444555n;
const AUDIT_KEY = ecMulGenerator(AUDIT_SCALAR);

// ---------------------------------------------------------------------------
// The operations a sequence is built from
// ---------------------------------------------------------------------------

type Op =
  | { readonly kind: 'mint'; readonly to: Name; readonly value: bigint }
  | { readonly kind: 'transfer'; readonly actor: Name; readonly pct: bigint }
  | { readonly kind: 'burn'; readonly actor: Name; readonly pct: bigint }
  | { readonly kind: 'seize'; readonly target: Name };

const anyParty = () => fc.constantFrom(...NAMES);

const amount = () => fc.bigInt({ min: 0n, max: 200n });

/**
 * A spend names a PERCENTAGE of the spent note, so it scales with the state.
 * Past 100 it reaches the insufficient-value guard.
 */
const percentage = () => fc.bigInt({ min: 0n, max: 120n });

const opArb: fc.Arbitrary<Op> = fc.oneof(
  {
    arbitrary: fc.record({
      kind: fc.constant('mint' as const),
      to: anyParty(),
      value: amount(),
    }),
    weight: 2,
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
  {
    arbitrary: fc.record({
      kind: fc.constant('seize' as const),
      target: anyParty(),
    }),
    weight: 1,
  },
);

/** The opening mint to ALICE, then the ops. */
const sequence = (maxOps: number): fc.Arbitrary<[bigint, Op[]]> =>
  fc.tuple(
    fc.bigInt({ min: 1n, max: 200n }),
    fc.array(opArb, { minLength: 1, maxLength: maxOps }),
  );

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/** One output the model knows of, from the circuit that created it. */
type Held = { owner: Name; note: Note; spent: boolean };

interface Model {
  /** Every output, newest first: the order the trail lists its records. */
  outputs: Held[];
  /** Value minted minus value burned. */
  supply: bigint;
  /** Spent notes in spend order, with their owners, for the replay. */
  spent: { owner: Name; note: Note }[];
}

/** What the auditor sees of one record, from the trail and the tree alone. */
type Audited = {
  owner: Name;
  note: Note;
  spent: boolean;
  leaf: string;
};

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenAudit: invariants under generated op sequences',
  () => {
    let audited: ConfidentialNoteFungibleTokenAuditedSimulator;

    const trail = async (): Promise<AuditRecord[]> => [
      ...(await audited.getPublicState()).Audit__auditTrail,
    ];

    /** The auditor's scan: every record must pass the filter and hit a leaf. */
    const scan = (state: Ledger): Audited[] =>
      [...state.Audit__auditTrail].map((record) => {
        const r = composed.recoverRecord(record, AUDIT_SCALAR);
        expect(r.value).toBeLessThan(U128);
        expect(r.ownerLo).toBeLessThan(U128);
        expect(r.ownerHi).toBeLessThan(U128);

        const owner = composed.ownerOf(r.ownerLo, r.ownerHi);
        const note = { value: r.value, nonce: r.nonce };
        const leaf = composed.commitOf(note, owner);
        expect(state.Core__commitments.findPathForLeaf(leaf)).toBeDefined();
        return {
          owner: nameOf(owner),
          note,
          spent: state.Core__nullifiers.member(composed.nullifierOf(note)),
          leaf: hexOf(leaf),
        };
      });

    const credit = (model: Model, owner: Name, note: Note): void => {
      model.outputs.unshift({ owner, note, spent: false });
    };

    const pathOf = (note: Note, owner: Name) =>
      audited.pathOf(note, PARTIES[owner].pk);

    const deploy = async (opening: bigint): Promise<Model> => {
      audited = await ConfidentialNoteFungibleTokenAuditedSimulator.create({
        auditKey: AUDIT_KEY,
      });
      const note = await audited.mint(PARTIES.ALICE.pk, opening);
      const model: Model = { outputs: [], supply: opening, spent: [] };
      credit(model, 'ALICE', note);
      return model;
    };

    /** Re-checks every invariant that must hold after each operation. */
    const checkInvariants = async (
      model: Model,
      before: AuditRecord[],
    ): Promise<void> => {
      const state = await audited.getPublicState();
      const records = [...state.Audit__auditTrail];

      // Completeness: one record per leaf.
      expect(state.Audit__auditTrail.length()).toBe(
        state.Core__commitments.firstFree(),
      );
      expect(records).toHaveLength(model.outputs.length);
      // Append-only: `pushFront` adds at the head, so the old trail is the tail.
      expect(records.slice(records.length - before.length)).toStrictEqual(
        before,
      );

      const found = scan(state);
      expect(new Set(found.map(({ leaf }) => leaf)).size).toBe(found.length);
      expect(
        found.map(({ owner, note, spent }) => ({ owner, note, spent })),
      ).toStrictEqual(model.outputs);

      const unspent = found
        .filter(({ spent }) => !spent)
        .reduce((sum, { note }) => sum + note.value, 0n);
      expect(unspent).toBe(model.supply);
    };

    /** The newest unspent note `name` holds in the model, if any. */
    const heldBy = (model: Model, name: Name): Held | undefined =>
      model.outputs.find((held) => held.owner === name && !held.spent);

    const markSpent = (model: Model, held: Held): void => {
      held.spent = true;
      model.spent.push({ owner: held.owner, note: held.note });
    };

    /** Applies one operation to both the contract and the model. */
    const step = async (op: Op, model: Model): Promise<void> => {
      if (op.kind === 'mint') {
        const note = await audited.mint(PARTIES[op.to].pk, op.value);
        expect(note.value).toBe(op.value);
        model.supply += op.value;
        credit(model, op.to, note);
        return;
      }

      if (op.kind === 'seize') {
        const held =
          heldBy(model, op.target) ?? heldBy(model, other(op.target));
        if (held === undefined) return;
        const recovery = other(held.owner);
        const seized = await audited.seize(
          PARTIES[held.owner].pk,
          PARTIES[recovery].pk,
          held.note,
          await pathOf(held.note, held.owner),
        );
        expect(seized.value).toBe(held.note.value);
        markSpent(model, held);
        credit(model, recovery, seized);
        return;
      }

      // A party holding nothing hands the spend to the other.
      const held = heldBy(model, op.actor) ?? heldBy(model, other(op.actor));
      if (held === undefined) return;
      const actor = held.owner;
      const input = held.note;
      const value = (input.value * op.pct) / 100n;
      const path = await pathOf(input, actor);
      audited.wallet.secretKey = PARTIES[actor].sk;

      if (value > input.value) {
        await expectRejection(
          op.kind === 'transfer'
            ? audited.transfer(PARTIES[other(actor)].pk, value, input, path)
            : audited.burn(value, input, path),
          'ConfidentialNoteFungibleToken: insufficient note value',
        );
        return;
      }

      if (op.kind === 'transfer') {
        const [out, change] = await audited.transfer(
          PARTIES[other(actor)].pk,
          value,
          input,
          path,
        );
        expect(out.value).toBe(value);
        expect(out.value + change.value).toBe(input.value);
        markSpent(model, held);
        credit(model, other(actor), out);
        credit(model, actor, change);
      } else {
        const change = await audited.burn(value, input, path);
        expect(change.value).toBe(input.value - value);
        model.supply -= value;
        markSpent(model, held);
        credit(model, actor, change);
      }
    };

    it('should keep the trail complete and consistent with the model after every step', async () => {
      await fc.assert(
        fc.asyncProperty(sequence(6), async ([opening, ops]) => {
          const model = await deploy(opening);
          await checkInvariants(model, []);

          for (const op of ops) {
            const before = await trail();
            await step(op, model);
            await checkInvariants(model, before);
          }
        }),
        { numRuns: 20 },
      );
    }, 120_000);

    it('should never let a spent or seized note be spent again', async () => {
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
            audited.wallet.secretKey = PARTIES[owner].sk;
            await expectRejection(
              audited.burn(0n, note, await pathOf(note, owner)),
              'ConfidentialNoteFungibleToken: note already spent',
            );
          }
          expect((await trail()).length).toBe(model.outputs.length);
        }),
        { numRuns: 15 },
      );
    }, 120_000);
  },
);
