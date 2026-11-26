/**
 * Stateful invariants of the core + freeze composition, over generated
 * operation sequences.
 *
 * The unit suite pins each rule on one note. This suite checks that the rules
 * hold together after any interleaving of mint, transfer, burn, seize, freeze
 * and unfreeze between two holders: the frozen set is exactly the model's
 * set, an owner never moves a frozen note, a seize always does, value is
 * conserved per operation and no note is spent twice.
 *
 * Freezes name notes of either holder, spent ones included, and nullifiers no
 * note derives. Nothing is removed from the model's set by a spend or a seize.
 *
 * DRY ONLY. Each operation is a transaction on live.
 */

import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { expectRejection } from '#test-utils/assertions/rejection.js';
import {
  pureCircuits as composed,
  type Ledger,
} from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenFreezable/contract/index.js';
import { NOTE_SALT } from '../../presets/test/witnesses/CustodialConfidentialNoteFungibleTokenWitnesses.js';
import {
  ConfidentialNoteFungibleTokenFreezableSimulator,
  type Identifier,
  type Note,
} from './simulators/ConfidentialNoteFungibleTokenFreezableSimulator.js';

// ---------------------------------------------------------------------------
// Parties
// ---------------------------------------------------------------------------

type Name = 'ALICE' | 'BOB';

interface Party {
  readonly sk: Uint8Array;
  readonly pk: Identifier;
}

const bytes32 = (label: string): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(label));
  return bytes;
};

const party = (label: Name): Party => {
  const sk = bytes32(label);
  return { sk, pk: composed.deriveIdentifier(sk, NOTE_SALT) };
};

const PARTIES: Record<Name, Party> = {
  ALICE: party('ALICE'),
  BOB: party('BOB'),
};

const NAMES: readonly Name[] = ['ALICE', 'BOB'];

const other = (name: Name): Name => (name === 'ALICE' ? 'BOB' : 'ALICE');

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const ERR = {
  frozen: 'ConfidentialNoteFungibleTokenFreeze: note frozen',
  insufficient: 'ConfidentialNoteFungibleToken: insufficient note value',
  spent: 'ConfidentialNoteFungibleToken: note already spent',
} as const;

// ---------------------------------------------------------------------------
// The operations a sequence is built from
// ---------------------------------------------------------------------------

/**
 * `pick` selects a note by index, modulo the candidates when the op runs, so
 * a sequence stays valid whatever the state. A freeze or unfreeze with an
 * index past the notes names a nullifier no note derives.
 */
type Op =
  | { readonly kind: 'mint'; readonly to: Name; readonly value: bigint }
  | {
      readonly kind: 'transfer' | 'burn';
      readonly pick: number;
      readonly pct: bigint;
    }
  | { readonly kind: 'seize'; readonly pick: number }
  | {
      readonly kind: '_freeze' | '_unfreeze';
      readonly pick: number;
      readonly unknown: boolean;
    };

const pick = () => fc.nat({ max: 63 });

/** A spend names a PERCENTAGE of its note. Past 100 it hits the value guard. */
const percentage = () => fc.bigInt({ min: 0n, max: 120n });

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    kind: fc.constant('mint' as const),
    to: fc.constantFrom(...NAMES),
    value: fc.bigInt({ min: 1n, max: 200n }),
  }),
  {
    arbitrary: fc.record({
      kind: fc.constantFrom('transfer' as const, 'burn' as const),
      pick: pick(),
      pct: percentage(),
    }),
    weight: 2,
  },
  fc.record({ kind: fc.constant('seize' as const), pick: pick() }),
  {
    arbitrary: fc.record({
      kind: fc.constantFrom('_freeze' as const, '_unfreeze' as const),
      pick: pick(),
      unknown: fc.boolean(),
    }),
    weight: 2,
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

interface Held {
  readonly owner: Name;
  readonly note: Note;
  spent: boolean;
}

interface Model {
  /** Every note ever created, oldest first. */
  notes: Held[];
  /** The frozen nullifiers, hex. A spend or seize removes none. */
  frozen: Set<string>;
  /** Value minted and not burned. */
  supply: bigint;
}

const nfOf = (note: Note): string => hex(composed.nullifierOf(note));

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenFreeze: invariants under generated op sequences',
  () => {
    let token: ConfidentialNoteFungibleTokenFreezableSimulator;

    const state = (): Promise<Ledger> => token.getPublicState();

    /** Every cell the mock publishes, in a form `toStrictEqual` compares. */
    const cells = async () => {
      const ledgerState = await state();
      return {
        commitments: ledgerState.Core__commitments.firstFree(),
        nullifiers: [...ledgerState.Core__nullifiers].map(hex).sort(),
        issuedNonces: ledgerState.Core__issuedNonces.size(),
        frozen: [...ledgerState.Freeze__frozen].map(hex).sort(),
      };
    };

    const pathOf = (held: Held) =>
      token.pathOf(held.note, PARTIES[held.owner].pk);

    const deploy = async (opening: bigint): Promise<Model> => {
      token = await ConfidentialNoteFungibleTokenFreezableSimulator.create();
      const note = await token.mint(PARTIES.ALICE.pk, opening);
      return {
        notes: [{ owner: 'ALICE', note, spent: false }],
        frozen: new Set(),
        supply: opening,
      };
    };

    const credit = (model: Model, owner: Name, note: Note): void => {
      model.notes.push({ owner, note, spent: false });
    };

    const unspent = (model: Model): Held[] =>
      model.notes.filter(({ spent }) => !spent);

    /** Re-checks every invariant that must hold after each operation. */
    const checkInvariants = async (model: Model): Promise<void> => {
      const ledgerState = await state();

      expect((await cells()).frozen).toStrictEqual([...model.frozen].sort());
      expect(ledgerState.Core__nullifiers.size()).toBe(
        BigInt(model.notes.filter(({ spent }) => spent).length),
      );
      expect(ledgerState.Core__commitments.firstFree()).toBe(
        BigInt(model.notes.length),
      );

      for (const held of model.notes) {
        const nf = composed.nullifierOf(held.note);
        expect(ledgerState.Core__nullifiers.member(nf)).toBe(held.spent);
        expect(ledgerState.Freeze__frozen.member(nf)).toBe(
          model.frozen.has(hex(nf)),
        );
        expect(
          ledgerState.Core__commitments.findPathForLeaf(
            composed.commitOf(held.note, PARTIES[held.owner].pk),
          ),
        ).toBeDefined();
      }

      const circulating = unspent(model).reduce(
        (sum, { note }) => sum + note.value,
        0n,
      );
      expect(circulating).toBe(model.supply);
    };

    /** Applies one operation to both the contract and the model. */
    const step = async (op: Op, model: Model): Promise<void> => {
      switch (op.kind) {
        case 'mint': {
          const note = await token.mint(PARTIES[op.to].pk, op.value);
          expect(note.value).toBe(op.value);
          credit(model, op.to, note);
          model.supply += op.value;
          return;
        }
        case '_freeze':
        case '_unfreeze': {
          const nf = op.unknown
            ? bytes32(`UNKNOWN-${op.pick}`)
            : composed.nullifierOf(
                model.notes[op.pick % model.notes.length].note,
              );
          if (op.kind === '_freeze') {
            await token._freeze(nf);
            model.frozen.add(hex(nf));
          } else {
            await token._unfreeze(nf);
            model.frozen.delete(hex(nf));
          }
          return;
        }
        case 'seize': {
          const candidates = unspent(model);
          const held = candidates[op.pick % candidates.length];
          const recovery = other(held.owner);
          const seized = await token.seize(
            PARTIES[held.owner].pk,
            PARTIES[recovery].pk,
            held.note,
            await pathOf(held),
          );

          expect(seized.value).toBe(held.note.value);
          expect(
            (await state()).Freeze__frozen.member(composed.nullifierOf(seized)),
          ).toBe(false);
          held.spent = true;
          credit(model, recovery, seized);
          return;
        }
        case 'transfer':
        case 'burn': {
          const candidates = unspent(model);
          const held = candidates[op.pick % candidates.length];
          const input = held.note;
          const value = (input.value * op.pct) / 100n;
          const recipient = other(held.owner);
          token.wallet.secretKey = PARTIES[held.owner].sk;
          const path = await pathOf(held);
          const spend = () =>
            op.kind === 'transfer'
              ? token.transfer(PARTIES[recipient].pk, value, input, path)
              : token.burn(value, input, path);

          // The freeze check runs first, so a frozen note fails on it whatever
          // the value asked for.
          if (model.frozen.has(nfOf(input)) || value > input.value) {
            const before = await cells();
            await expectRejection(
              spend(),
              model.frozen.has(nfOf(input)) ? ERR.frozen : ERR.insufficient,
            );
            expect(await cells()).toStrictEqual(before);
            return;
          }

          if (op.kind === 'transfer') {
            const [out, change] = (await spend()) as [Note, Note];
            expect(out.value).toBe(value);
            expect(out.value + change.value).toBe(input.value);
            credit(model, recipient, out);
            credit(model, held.owner, change);
          } else {
            const change = (await spend()) as Note;
            expect(change.value).toBe(input.value - value);
            credit(model, held.owner, change);
            model.supply -= value;
          }
          held.spent = true;
          return;
        }
      }
    };

    it('should keep the ledger consistent with the model after every step', async () => {
      await fc.assert(
        fc.asyncProperty(sequence(8), async ([opening, ops]) => {
          const model = await deploy(opening);
          await checkInvariants(model);

          for (const op of ops) {
            await step(op, model);
            await checkInvariants(model);
          }
        }),
        { numRuns: 15 },
      );
    }, 180_000);

    it('should never let a spent note be spent again', async () => {
      await fc.assert(
        fc.asyncProperty(sequence(8), async ([opening, ops]) => {
          const model = await deploy(opening);
          for (const op of ops) {
            await step(op, model);
          }
          const spent = model.notes.filter((held) => held.spent);
          fc.pre(spent.length > 0);

          // A seize skips the freeze check, so the core's nullifier check is
          // what refuses it. An owner spend meets the freeze check first.
          for (const held of spent) {
            const path = await pathOf(held);
            await expectRejection(
              token.seize(
                PARTIES[held.owner].pk,
                PARTIES[held.owner].pk,
                held.note,
                path,
              ),
              ERR.spent,
            );
            token.wallet.secretKey = PARTIES[held.owner].sk;
            await expectRejection(
              token.burn(0n, held.note, path),
              model.frozen.has(nfOf(held.note)) ? ERR.frozen : ERR.spent,
            );
          }
        }),
        { numRuns: 10 },
      );
    }, 180_000);

    it('should hold every frozen note against its owner until it is unfrozen', async () => {
      await fc.assert(
        fc.asyncProperty(sequence(8), async ([opening, ops]) => {
          const model = await deploy(opening);
          for (const op of ops) {
            await step(op, model);
          }
          const held = unspent(model);
          const indexOf = (target: Held) => unspent(model).indexOf(target);

          for (const target of held) {
            await step(
              {
                kind: '_freeze',
                pick: model.notes.indexOf(target),
                unknown: false,
              },
              model,
            );
          }
          // Each spend is rejected on the freeze, with the ledger unchanged.
          for (const target of held) {
            await step(
              { kind: 'transfer', pick: indexOf(target), pct: 50n },
              model,
            );
            await step(
              { kind: 'burn', pick: indexOf(target), pct: 50n },
              model,
            );
          }
          expect(unspent(model)).toStrictEqual(held);
          await checkInvariants(model);

          for (const target of held) {
            await step(
              {
                kind: '_unfreeze',
                pick: model.notes.indexOf(target),
                unknown: false,
              },
              model,
            );
            await step(
              { kind: 'burn', pick: indexOf(target), pct: 100n },
              model,
            );
          }
          expect(held.every(({ spent }) => spent)).toBe(true);
          await checkInvariants(model);
        }),
        { numRuns: 10 },
      );
    }, 180_000);

    it('should let a seize move every unspent note, frozen or not, to its recovery key', async () => {
      await fc.assert(
        fc.asyncProperty(sequence(8), async ([opening, ops]) => {
          const model = await deploy(opening);
          for (const op of ops) {
            await step(op, model);
          }

          for (const held of unspent(model)) {
            await step(
              { kind: 'seize', pick: unspent(model).indexOf(held) },
              model,
            );
          }
          await checkInvariants(model);
        }),
        { numRuns: 10 },
      );
    }, 180_000);
  },
);
