/**
 * Concurrency claims for the ConfidentialNoteFungibleTokenIssuer extension.
 *
 * Every case builds two calls against one snapshot, lands the first, then
 * applies the second. See `#test-utils/concurrency/types.ts` for why that
 * reproduces a real conflict deterministically.
 *
 * The gate and `rotateIssuer` pin their read of `_issuerPk`; `_setIssuer` pins
 * only the init flag. So a call that moves the key invalidates every in-flight
 * call that reads it, and nothing else conflicts. The standalone mock's three
 * circuits give 9 ordered pairs, each asserted against {@link predict}. The
 * composed mock repeats the claim for a gated mint.
 */

import type { ChargedState } from '@midnight-ntwrk/compact-runtime';
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
  pureCircuits as composed,
  ledger as composedLedger,
  Contract as MockIssued,
} from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenIssued/contract/index.js';
import {
  pureCircuits as issuer,
  ledger,
  Contract as MockIssuer,
} from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenIssuer/contract/index.js';
import {
  ConfidentialNoteFungibleTokenWitnesses,
  createNoteWallet,
  INSTANCE_SALT,
  type NoteCommitmentLedger,
  type NoteWallet,
} from '../../test/witnesses/ConfidentialNoteFungibleTokenWitnesses.js';
import {
  ConfidentialNoteFungibleTokenIssuerWitnesses,
  type IssuerWallet,
} from './witnesses/ConfidentialNoteFungibleTokenIssuerWitnesses.js';

// ---------------------------------------------------------------------------
// Parties and keys
// ---------------------------------------------------------------------------

type PrivateState = Record<string, never>;

/** The issuer, and a stranger with no issuer secret. */
const NAMES = ['issuer', 'stranger'] as const;

const ISSUER = issuer.derivePk(labelledSecret('issuer'), INSTANCE_SALT);

/** Two candidate keys, so two writes built on one snapshot stay distinguishable. */
const TARGETS = [
  issuer.derivePk(labelledSecret('first-successor'), INSTANCE_SALT),
  issuer.derivePk(labelledSecret('second-successor'), INSTANCE_SALT),
] as const;

const RECIPIENT = composed.derivePk(labelledSecret('recipient'), INSTANCE_SALT);

const standaloneParties = () =>
  createParties<IssuerWallet, MockIssuer<PrivateState>>(NAMES, {
    wallet: (label) => ({ secretKey: labelledSecret(label) }),
    contract: (wallet) =>
      new MockIssuer<PrivateState>(
        ConfidentialNoteFungibleTokenIssuerWitnesses(wallet),
      ),
  });

type ComposedWallet = { note: NoteWallet; issuer: IssuerWallet };

const composedParties = () =>
  createParties<ComposedWallet, MockIssued<PrivateState>>(NAMES, {
    wallet: (label) => ({
      note: createNoteWallet(),
      issuer: { secretKey: labelledSecret(label) },
    }),
    contract: (wallet) =>
      new MockIssued<PrivateState>({
        ...ConfidentialNoteFungibleTokenWitnesses<NoteCommitmentLedger>(
          wallet.note,
        ),
        ...ConfidentialNoteFungibleTokenIssuerWitnesses<
          NoteCommitmentLedger,
          PrivateState
        >(wallet.issuer),
      }),
  });

// ---------------------------------------------------------------------------
// The operation space, and the conflict model it is measured against
// ---------------------------------------------------------------------------

const OPERATIONS = ['assertOnlyIssuer', 'rotateIssuer', '_setIssuer'] as const;

type Operation = (typeof OPERATIONS)[number];

/** Whether the call's transcript pins the value of `_issuerPk`. */
const READS_KEY: Readonly<Record<Operation, boolean>> = {
  assertOnlyIssuer: true,
  rotateIssuer: true,
  _setIssuer: false,
};

/** Whether the call moves `_issuerPk` (every case writes a new key). */
const WRITES_KEY: Readonly<Record<Operation, boolean>> = {
  assertOnlyIssuer: false,
  rotateIssuer: true,
  _setIssuer: true,
};

/** The second call fails only when the first moved a key the second read. */
const predict = (first: Operation, second: Operation): Outcome =>
  WRITES_KEY[first] && READS_KEY[second] ? 'second-rejected' : 'both-landed';

/** The key left after the race: the last write that landed, if any. */
const keyAfter = (
  first: Operation,
  second: Operation,
  outcome: Outcome,
): bigint => {
  if (outcome === 'both-landed' && WRITES_KEY[second]) return TARGETS[1];
  if (WRITES_KEY[first]) return TARGETS[0];
  return ISSUER;
};

/** The call for `operation`. `slot` picks the key a write installs. */
const callFor = (operation: Operation, slot: 0 | 1): Call => {
  switch (operation) {
    case 'assertOnlyIssuer':
      return { actor: 'issuer', circuitId: operation, args: [] };
    case 'rotateIssuer':
      return { actor: 'issuer', circuitId: operation, args: [TARGETS[slot]] };
    case '_setIssuer':
      // Ungated: a party with no issuer secret makes the call.
      return { actor: 'stranger', circuitId: operation, args: [TARGETS[slot]] };
  }
};

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
// The extension alone
// ---------------------------------------------------------------------------

// TODO: run on live once the concurrency harness has a live backend.
describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenIssuer: concurrency',
  () => {
    let harness: ConcurrencyHarness;

    const issuerKey = async (): Promise<bigint> =>
      ledger((await harness.snapshot()) as ChargedState).Issuer__issuerPk;

    beforeEach(async () => {
      harness = await createConcurrencyHarness({
        contracts: standaloneParties().contracts,
        privateState: {},
        constructorArgs: [ISSUER, INSTANCE_SALT],
      });
    });

    for (const testCase of MATRIX) {
      it(testCase.name, async () => {
        const verdict = await race(
          harness,
          callFor(testCase.first, 0),
          callFor(testCase.second, 1),
        );

        expect(verdict.outcome).toBe(testCase.expected);
        if (verdict.outcome === 'second-rejected') {
          expect(verdict.reason).not.toBe('');
        }
        expect(await issuerKey()).toBe(
          keyAfter(testCase.first, testCase.second, verdict.outcome),
        );
      });
    }

    // The conflict is on the key's value: a rotation that writes the key it
    // found leaves every pinned read valid.
    it('should let an in-flight issuer call land after a rotation to the same key', async () => {
      const verdict = await race(
        harness,
        { actor: 'issuer', circuitId: 'rotateIssuer', args: [ISSUER] },
        callFor('assertOnlyIssuer', 1),
      );

      expect(verdict.outcome).toBe('both-landed');
      expect(await issuerKey()).toBe(ISSUER);
    });
  },
);

// ---------------------------------------------------------------------------
// Composed with the core
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenIssuer: concurrency composed with the core',
  () => {
    let harness: ConcurrencyHarness;

    const view = async () =>
      composedLedger((await harness.snapshot()) as ChargedState);

    const mint: Call = {
      actor: 'issuer',
      circuitId: 'mint',
      args: [RECIPIENT, 100n],
    };

    const rotate = (slot: 0 | 1): Call => ({
      actor: 'issuer',
      circuitId: 'rotateIssuer',
      args: [TARGETS[slot]],
    });

    beforeEach(async () => {
      harness = await createConcurrencyHarness({
        contracts: composedParties().contracts,
        privateState: {},
        constructorArgs: [INSTANCE_SALT, ISSUER],
      });
    });

    it('should let two mints by the issuer both land', async () => {
      const verdict = await race(harness, mint, mint);

      expect(verdict.outcome).toBe('both-landed');
      expect((await view()).Core__commitments.firstFree()).toBe(2n);
    });

    it('should not let an in-flight mint land after a rotation', async () => {
      const verdict = await race(harness, rotate(0), mint);

      expect(verdict.outcome).toBe('second-rejected');
      if (verdict.outcome === 'second-rejected') {
        expect(verdict.reason).not.toBe('');
      }
      const state = await view();
      expect(state.Issuer__issuerPk).toBe(TARGETS[0]);
      expect(state.Core__commitments.firstFree()).toBe(0n);
    });

    it('should let a rotation land after an in-flight mint', async () => {
      const verdict = await race(harness, mint, rotate(0));

      expect(verdict.outcome).toBe('both-landed');
      const state = await view();
      expect(state.Issuer__issuerPk).toBe(TARGETS[0]);
      expect(state.Core__commitments.firstFree()).toBe(1n);
    });

    it('should not let a second rotation land after the first', async () => {
      const verdict = await race(harness, rotate(0), rotate(1));

      expect(verdict.outcome).toBe('second-rejected');
      expect((await view()).Issuer__issuerPk).toBe(TARGETS[0]);
    });
  },
);
