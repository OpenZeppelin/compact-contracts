/**
 * Concurrency claims for the ConfidentialNoteFungibleToken core.
 *
 * The functional suite asks what a circuit did. The privacy suite asks what the
 * chain gets to see. This one asks whether a call still lands when someone
 * else's call moved the ledger first.
 *
 * Every case has the same shape: build two calls against one snapshot, land the
 * first, then apply the second. See `#test-utils/concurrency/types.ts` for why
 * that reproduces a real conflict deterministically, with no race to lose.
 *
 * What this contract's ledger implies, and what the cases below pin:
 *
 *   `_commitments`  HistoricMerkleTree — `insert` appends at the live index, so
 *                   appends commute; `checkRoot` proves the root is in history,
 *                   which stays true as the tree grows.
 *   `_nullifiers`   Set — `insert` commutes, but `member(nf)` pins that one key,
 *                   so two spends of the SAME note conflict by design.
 *
 * The load-bearing case is "a spend lands after a concurrent mint". Swap
 * `HistoricMerkleTree` for `MerkleTree` and it fails, because plain `checkRoot`
 * pins the current root and every mint then invalidates every in-flight spend.
 * No functional or privacy test notices that one-word change.
 */

import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import { createConcurrencyHarness } from '#test-utils/concurrency/backend.js';
import {
  createParties,
  labelledSecret,
  type Party,
} from '#test-utils/concurrency/parties.js';
import { race } from '#test-utils/concurrency/race.js';
import type {
  Call,
  ConcurrencyHarness,
} from '#test-utils/concurrency/types.js';
import {
  pureCircuits as core,
  Contract as MockCore,
} from '../../../artifacts/MockConfidentialNoteFungibleToken/contract/index.js';
import {
  ConfidentialNoteFungibleTokenWitnesses,
  createNoteWallet,
  type Note,
  type NoteWallet,
} from './witnesses/ConfidentialNoteFungibleTokenWitnesses.js';

// ---------------------------------------------------------------------------
// Two parties, one ledger
// ---------------------------------------------------------------------------

type PrivateState = Record<string, never>;
type NoteParty = Party<NoteWallet, MockCore<PrivateState>>;

/**
 * A party's spend secret comes from its name, so the derived public keys below
 * are stable across every `beforeEach` and can be computed once.
 */
const noteParties = () =>
  createParties<NoteWallet, MockCore<PrivateState>>(['alice', 'bob'], {
    wallet: (label) => {
      const wallet = createNoteWallet();
      wallet.secretKey = labelledSecret(label);
      return wallet;
    },
    contract: (wallet) =>
      new MockCore(ConfidentialNoteFungibleTokenWitnesses(wallet)),
  });

const ALICE = core.derivePk(labelledSecret('alice'));
const BOB = core.derivePk(labelledSecret('bob'));

const NOTE_VALUE = 100n;

// TODO: Support live concurrency https://github.com/OpenZeppelin/compact-contracts/issues/749
describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleToken: concurrency',
  () => {
    // These cases are backend-neutral: they assert a verdict from `race`, not a
    // transport. The skip above comes off once the live harness lands.
    let harness: ConcurrencyHarness;
    let alice: NoteParty;
    let bob: NoteParty;

    const mint = (actor: string, to: bigint, value = NOTE_VALUE): Call => ({
      actor,
      circuitId: '_mint',
      args: [to, value],
    });

    const transfer = (actor: string, to: bigint, value: bigint): Call => ({
      actor,
      circuitId: 'transfer',
      args: [to, value],
    });

    const burn = (actor: string, value: bigint): Call => ({
      actor,
      circuitId: 'burn',
      args: [value],
    });

    const consume = (actor: string, owner: bigint): Call => ({
      actor,
      circuitId: '_consumeNote',
      args: [owner],
    });

    /** Gives `holder` a spendable note, committed on the shared ledger. */
    const arm = async (holder: NoteParty, ownerPk: bigint): Promise<void> => {
      holder.wallet.inputNote = await harness.apply<Note>(
        mint(holder.name, ownerPk),
      );
    };

    beforeEach(async () => {
      const { parties, contracts } = noteParties();
      alice = parties.alice;
      bob = parties.bob;
      harness = await createConcurrencyHarness({
        contracts,
        privateState: {},
      });
    });

    // -----------------------------------------------------------------------
    // Commuting: independent work must not serialize
    // -----------------------------------------------------------------------

    it('should let two mints land concurrently', async () => {
      const verdict = await race(
        harness,
        mint('alice', ALICE),
        mint('bob', BOB),
      );

      expect(verdict).toBe('both-landed');
    });

    it('should let two holders transfer concurrently', async () => {
      await arm(alice, ALICE);
      await arm(bob, BOB);

      const verdict = await race(
        harness,
        transfer('alice', BOB, 30n),
        transfer('bob', ALICE, 40n),
      );

      expect(verdict).toBe('both-landed');
    });

    it('should let a spend land after a concurrent mint moved the tree', async () => {
      await arm(alice, ALICE);

      const verdict = await race(
        harness,
        mint('bob', BOB),
        transfer('alice', BOB, 30n),
      );

      expect(verdict).toBe('both-landed');
    });

    it('should let a spend land after a concurrent unrelated spend', async () => {
      await arm(alice, ALICE);
      await arm(bob, BOB);

      const verdict = await race(
        harness,
        burn('bob', 10n),
        transfer('alice', BOB, 30n),
      );

      expect(verdict).toBe('both-landed');
    });

    // -----------------------------------------------------------------------
    // Conflicting by design: one note, one spend
    // -----------------------------------------------------------------------

    it('should not let the same note be transferred twice concurrently', async () => {
      await arm(alice, ALICE);

      const verdict = await race(
        harness,
        transfer('alice', BOB, 30n),
        transfer('alice', BOB, 40n),
      );

      expect(verdict).toBe('second-rejected');
    });

    it('should not let a concurrent burn and transfer spend the same note', async () => {
      await arm(alice, ALICE);

      const verdict = await race(
        harness,
        burn('alice', 30n),
        transfer('alice', BOB, 40n),
      );

      expect(verdict).toBe('second-rejected');
    });

    it('should not let two spends of one note both consume it', async () => {
      await arm(alice, ALICE);

      const verdict = await race(
        harness,
        consume('alice', ALICE),
        consume('alice', ALICE),
      );

      expect(verdict).toBe('second-rejected');
    });
  },
);
