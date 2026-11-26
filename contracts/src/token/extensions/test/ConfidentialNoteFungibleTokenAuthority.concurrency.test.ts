/**
 * Concurrency claims for the ConfidentialNoteFungibleTokenAuthority extension.
 *
 * Every case builds two calls against one snapshot, lands the first, then
 * applies the second. See `#test-utils/concurrency/types.ts` for why that
 * reproduces a real conflict deterministically.
 *
 * What each operation pins:
 *
 *   `assertOnlyAuthority`,   read `_isInitialized`, which never moves after
 *   `authority`,             the constructor, and `_authority`, pinning its
 *   `transferAuthority`      value. `transferAuthority` also writes it.
 *   `_transferAuthority`     reads `_isInitialized` only, and writes
 *                            `_authority`.
 *
 * So a handover that changes the id invalidates every in-flight call that
 * reads it, two ungated writes both land with the last one winning, and a
 * handover to the current id invalidates nothing. Four operations give 16
 * ordered pairs, each asserted against {@link predict}.
 *
 * The mock's witness reads the secret from the private state the harness
 * shares between actors, so one actor, the authority, builds every call.
 */

import type { ChargedState } from '@midnight-ntwrk/compact-runtime';
import {
  CompactTypeBytes,
  CompactTypeVector,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import { createConcurrencyHarness } from '#test-utils/concurrency/backend.js';
import { labelledSecret } from '#test-utils/concurrency/parties.js';
import { race } from '#test-utils/concurrency/race.js';
import type {
  Call,
  ConcurrencyHarness,
  Outcome,
} from '#test-utils/concurrency/types.js';
import {
  type Ledger,
  ledger,
  Contract as MockAuthority,
} from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenAuthority/contract/index.js';
import type { Identifier } from './simulators/ConfidentialNoteFungibleTokenAuthoritySimulator.js';
import {
  type ConfidentialNoteFungibleTokenAuthorityPrivateState,
  ConfidentialNoteFungibleTokenAuthorityWitnesses,
} from './witnesses/ConfidentialNoteFungibleTokenAuthorityWitnesses.js';

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** The mock's account id: `AuthPrfPseudonym` under the salt `MockAuthority`. */
const idOf = (label: string): Identifier => ({
  is_left: true,
  left: persistentHash(new CompactTypeVector(3, new CompactTypeBytes(32)), [
    labelledSecret('AuthPrfPseudonym:identifier'),
    labelledSecret('MockAuthority'),
    labelledSecret(label),
  ]),
  right: { bytes: new Uint8Array(32) },
});

const AUTHORITY_SK = labelledSecret('authority');
const AUTHORITY = idOf('authority');

/** Two candidate ids, so two handovers built on one snapshot stay distinguishable. */
const TARGETS = [idOf('first-successor'), idOf('second-successor')] as const;

// ---------------------------------------------------------------------------
// The operation space, and the conflict model it is measured against
// ---------------------------------------------------------------------------

const OPERATIONS = [
  'assertOnlyAuthority',
  'authority',
  'transferAuthority',
  '_transferAuthority',
] as const;

type Operation = (typeof OPERATIONS)[number];

/** Whether the call's transcript pins the value of `_authority`. */
const READS_AUTHORITY: Readonly<Record<Operation, boolean>> = {
  assertOnlyAuthority: true,
  authority: true,
  transferAuthority: true,
  _transferAuthority: false,
};

/** Whether the call writes `_authority`. */
const WRITES_AUTHORITY: Readonly<Record<Operation, boolean>> = {
  assertOnlyAuthority: false,
  authority: false,
  transferAuthority: true,
  _transferAuthority: true,
};

/**
 * The second call fails only when the first moved an authority the second
 * read. Every handover in the matrix installs a new id.
 */
const predict = (first: Operation, second: Operation): Outcome =>
  WRITES_AUTHORITY[first] && READS_AUTHORITY[second]
    ? 'second-rejected'
    : 'both-landed';

/** The authority left after the race: the last write that landed, if any. */
const authorityAfter = (
  first: Operation,
  second: Operation,
  outcome: Outcome,
): Identifier => {
  if (outcome === 'both-landed' && WRITES_AUTHORITY[second]) return TARGETS[1];
  if (WRITES_AUTHORITY[first]) return TARGETS[0];
  return AUTHORITY;
};

const callFor = (operation: Operation, target: Identifier): Call => ({
  actor: 'authority',
  circuitId: operation,
  args: WRITES_AUTHORITY[operation] ? [target] : [],
});

const MATRIX = OPERATIONS.flatMap((first) =>
  OPERATIONS.map((second) => {
    const expected = predict(first, second);
    return {
      first,
      second,
      expected,
      name:
        expected === 'both-landed'
          ? `should let ${first} and ${second} both land`
          : `should not let ${second} land after ${first}`,
    };
  }),
);

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenAuthority: concurrency',
  () => {
    let harness: ConcurrencyHarness;

    const view = async () => ledger((await harness.snapshot()) as ChargedState);

    beforeEach(async () => {
      harness =
        await createConcurrencyHarness<ConfidentialNoteFungibleTokenAuthorityPrivateState>(
          {
            contracts: {
              authority:
                new MockAuthority<ConfidentialNoteFungibleTokenAuthorityPrivateState>(
                  ConfidentialNoteFungibleTokenAuthorityWitnesses<Ledger>(),
                ),
            },
            privateState: { secretKey: AUTHORITY_SK },
            constructorArgs: [AUTHORITY, 1n],
          },
        );
    });

    for (const testCase of MATRIX) {
      it(testCase.name, async () => {
        const verdict = await race(
          harness,
          callFor(testCase.first, TARGETS[0]),
          callFor(testCase.second, TARGETS[1]),
        );

        expect(verdict.outcome).toBe(testCase.expected);
        if (verdict.outcome === 'second-rejected') {
          expect(verdict.reason).not.toBe('');
        }
        expect((await view()).Authority__authority).toStrictEqual(
          authorityAfter(testCase.first, testCase.second, verdict.outcome),
        );
      });
    }

    // The conflict is on the id's value: a handover that writes the id it
    // found leaves every pinned read valid.
    describe.each(['transferAuthority', '_transferAuthority'] as const)(
      'after %s to the current id',
      (writer) => {
        it.each(OPERATIONS)('should let %s land', async (second) => {
          const verdict = await race(
            harness,
            callFor(writer, AUTHORITY),
            callFor(second, TARGETS[1]),
          );

          expect(verdict.outcome).toBe('both-landed');
          expect((await view()).Authority__authority).toStrictEqual(
            WRITES_AUTHORITY[second] ? TARGETS[1] : AUTHORITY,
          );
        });
      },
    );
  },
);
