/**
 * Concurrency claims for the ConfidentialNoteFungibleTokenReview extension, on
 * the composed mock (core + review).
 *
 * Every case builds two calls against one snapshot, lands the first, then
 * applies the second. See `#test-utils/concurrency/types.ts` for why that
 * reproduces a real conflict deterministically.
 *
 * What each operation pins:
 *
 *   `mint`, `transfer`, `burn`     read `_reviewers.member(key)` for the key
 *                                  they review to, pinning that answer.
 *                                  `transfer` and `burn` also pin the spent
 *                                  note's nullifier.
 *   `_addReviewer`,                insert or remove a key and read nothing.
 *   `_removeReviewer`
 *
 * So a removal of the key a pending call reviews to rejects it, two spends
 * conflict only on one note, and nothing else conflicts. Every verdict is
 * asserted against {@link predict}.
 */

import type { ChargedState } from '@midnight-ntwrk/compact-runtime';
import { ecMulGenerator } from '@midnight-ntwrk/compact-runtime';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import { createConcurrencyHarness } from '#test-utils/concurrency/backend.js';
import {
  createParties,
  labelledSecret,
} from '#test-utils/concurrency/parties.js';
import { race } from '#test-utils/concurrency/race.js';
import type {
  Call,
  ConcurrencyHarness,
  Outcome,
} from '#test-utils/concurrency/types.js';
import {
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
// Parties and keys
// ---------------------------------------------------------------------------

type PrivateState = Record<string, never>;

/** Two holders who spend their own notes. Every other call is ungated. */
const NAMES = ['alice', 'bob'] as const;

type Holder = (typeof NAMES)[number];

const NOTE_KEYS: Readonly<Record<Holder, Identifier>> = {
  alice: reviewed.deriveIdentifier(labelledSecret('alice'), NOTE_SALT),
  bob: reviewed.deriveIdentifier(labelledSecret('bob'), NOTE_SALT),
};

/** The key every reviewing call names. Approved before each case. */
const REVIEWED_KEY = ecMulGenerator(111222333444555n);
/** Approved before each case, never reviewed to. */
const APPROVED_KEY = ecMulGenerator(999888777666555n);
/** Never approved. */
const FRESH_KEY = ecMulGenerator(123123123123123n);

const NOTE_VALUE = 100n;
const SPEND_VALUE = 30n;

const parties = () =>
  createParties<CustodialWallet, MockReviewed<PrivateState>>(NAMES, {
    wallet: (label) => ({ secretKey: labelledSecret(label) }),
    contract: (wallet) =>
      new MockReviewed<PrivateState>(
        CustodialConfidentialNoteFungibleTokenWitnesses(wallet),
      ),
  });

// ---------------------------------------------------------------------------
// The operation space, and the conflict model it is measured against
// ---------------------------------------------------------------------------

const OPERATIONS = [
  'mint',
  'transfer',
  'burn',
  '_addReviewer',
  '_removeReviewer',
] as const;

type Operation = (typeof OPERATIONS)[number];

/** Records the call pushes, which is whether it pins the approval of its key. */
const RECORDS: Readonly<Record<Operation, bigint>> = {
  mint: 1n,
  transfer: 2n,
  burn: 1n,
  _addReviewer: 0n,
  _removeReviewer: 0n,
};

const REVIEWS = (operation: Operation): boolean => RECORDS[operation] > 0n;

const SPENDS: Readonly<Record<Operation, boolean>> = {
  mint: false,
  transfer: true,
  burn: true,
  _addReviewer: false,
  _removeReviewer: false,
};

const MUTATES_REGISTRY = (operation: Operation): boolean => !REVIEWS(operation);

/**
 * The key a registry call acts on: the reviewed key, or one no pending call
 * reviews to.
 */
const registryKey = (operation: Operation, onReviewedKey: boolean) =>
  onReviewedKey
    ? REVIEWED_KEY
    : operation === '_addReviewer'
      ? FRESH_KEY
      : APPROVED_KEY;

/**
 * The second call fails only when the first withdrew the key it reviews to,
 * or both spend one note.
 */
const predict = (
  first: Operation,
  second: Operation,
  sameNote: boolean,
  onReviewedKey: boolean,
): Outcome =>
  (first === '_removeReviewer' && onReviewedKey && REVIEWS(second)) ||
  (SPENDS[first] && SPENDS[second] && sameNote)
    ? 'second-rejected'
    : 'both-landed';

/** Whether the reviewed key is approved after the race: the last landed write wins. */
const approvedAfter = (
  first: Operation,
  second: Operation,
  onReviewedKey: boolean,
  landed: boolean,
): boolean => {
  const writes = landed ? [first, second] : [first];
  let approved = true;
  for (const operation of writes) {
    if (onReviewedKey && MUTATES_REGISTRY(operation)) {
      approved = operation === '_addReviewer';
    }
  }
  return approved;
};

interface MatrixCase {
  readonly first: Operation;
  readonly second: Operation;
  /** Only meaningful when both operations spend. */
  readonly sameNote: boolean;
  /** Only meaningful when one operation changes the registry. */
  readonly onReviewedKey: boolean;
  readonly expected: Outcome;
  readonly name: string;
}

const describeCase = (
  first: Operation,
  second: Operation,
  sameNote: boolean,
  onReviewedKey: boolean,
  expected: Outcome,
): string => {
  const notes =
    SPENDS[first] && SPENDS[second]
      ? sameNote
        ? ' on one note'
        : ' on separate notes'
      : '';
  const keys =
    MUTATES_REGISTRY(first) || MUTATES_REGISTRY(second)
      ? onReviewedKey
        ? ' on the reviewed key'
        : ' on another key'
      : '';
  return expected === 'both-landed'
    ? `should let ${first} and ${second} both land${notes}${keys}`
    : `should not let ${second} land after ${first}${notes}${keys}`;
};

const MATRIX: readonly MatrixCase[] = OPERATIONS.flatMap((first) =>
  OPERATIONS.flatMap((second) => {
    const sharings = SPENDS[first] && SPENDS[second] ? [true, false] : [false];
    const keyings =
      MUTATES_REGISTRY(first) || MUTATES_REGISTRY(second)
        ? [true, false]
        : [false];
    return sharings.flatMap((sameNote) =>
      keyings.map((onReviewedKey) => {
        const expected = predict(first, second, sameNote, onReviewedKey);
        return {
          first,
          second,
          sameNote,
          onReviewedKey,
          expected,
          name: describeCase(first, second, sameNote, onReviewedKey, expected),
        };
      }),
    );
  }),
);

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenReview: concurrency',
  () => {
    let harness: ConcurrencyHarness;

    const view = async () => ledger((await harness.snapshot()) as ChargedState);

    /** Gives `holder` a spendable note, committed and reviewed on the shared ledger. */
    const arm = async (holder: Holder): Promise<Note> =>
      harness.apply<Note>({
        actor: holder,
        circuitId: 'mint',
        args: [NOTE_KEYS[holder], NOTE_VALUE, REVIEWED_KEY],
      });

    const pathOf = async (holder: Holder, note: Note) => {
      const path = (await view()).Core__commitments.findPathForLeaf(
        reviewed.commitOf(note, NOTE_KEYS[holder]),
      );
      if (path === undefined) throw new Error('test setup: note not committed');
      return path.path;
    };

    /** The call for `operation`. A spend is `holder` spending `note`. */
    const callFor = async (
      operation: Operation,
      holder: Holder,
      note: Note | undefined,
      onReviewedKey: boolean,
    ): Promise<Call> => {
      const recipient = holder === 'alice' ? NOTE_KEYS.bob : NOTE_KEYS.alice;
      switch (operation) {
        case 'mint':
          return {
            actor: holder,
            circuitId: 'mint',
            args: [recipient, NOTE_VALUE, REVIEWED_KEY],
          };
        case '_addReviewer':
        case '_removeReviewer':
          return {
            actor: holder,
            circuitId: operation,
            args: [registryKey(operation, onReviewedKey)],
          };
        case 'transfer':
        case 'burn': {
          if (note === undefined) throw new Error('test setup: no note armed');
          const path = await pathOf(holder, note);
          return operation === 'transfer'
            ? {
                actor: holder,
                circuitId: 'transfer',
                args: [recipient, SPEND_VALUE, note, path, REVIEWED_KEY],
              }
            : {
                actor: holder,
                circuitId: 'burn',
                args: [SPEND_VALUE, note, path, REVIEWED_KEY],
              };
        }
      }
    };

    beforeEach(async () => {
      harness = await createConcurrencyHarness({
        contracts: parties().contracts,
        privateState: {},
        constructorArgs: [NOTE_SALT],
      });
      for (const key of [REVIEWED_KEY, APPROVED_KEY]) {
        await harness.apply({
          actor: 'alice',
          circuitId: '_addReviewer',
          args: [key],
        });
      }
    });

    for (const testCase of MATRIX) {
      it(testCase.name, async () => {
        const { first, second, sameNote, onReviewedKey } = testCase;
        // Same note means alice issues both spends; separate notes means bob
        // spends his own second.
        const secondHolder: Holder = sameNote ? 'alice' : 'bob';
        const aliceNote =
          SPENDS[first] || (SPENDS[second] && secondHolder === 'alice')
            ? await arm('alice')
            : undefined;
        const bobNote =
          SPENDS[second] && secondHolder === 'bob'
            ? await arm('bob')
            : undefined;
        const armed = (await view()).Review__reviewTrail.length();

        const verdict = await race(
          harness,
          await callFor(first, 'alice', aliceNote, onReviewedKey),
          await callFor(
            second,
            secondHolder,
            secondHolder === 'alice' ? aliceNote : bobNote,
            onReviewedKey,
          ),
        );

        expect(verdict.outcome).toBe(testCase.expected);
        if (verdict.outcome === 'second-rejected') {
          expect(verdict.reason).not.toBe('');
        }

        const state = await view();
        const landed = verdict.outcome === 'both-landed';
        expect(state.Review__reviewTrail.length()).toBe(
          armed + RECORDS[first] + (landed ? RECORDS[second] : 0n),
        );
        expect(state.Review__reviewers.member(REVIEWED_KEY)).toBe(
          approvedAfter(first, second, onReviewedKey, landed),
        );
      });
    }
  },
);
