/**
 * `DryReplayHarness` against real ledger state.
 *
 * `test-utils/concurrency/test/DryReplayHarness.test.ts` covers the guard rails
 * with a stub contract, because `test:harness` must not require a compiled
 * build. Everything below needs a transcript the onchain runtime will actually
 * re-execute, so it lives here in the `unit` project, which does depend on a
 * compile.
 *
 * The claims are about the harness, not the token: what `apply`, `land` and
 * `attempt` do to the shared state, and how `attempt` decides that a failed
 * replay is a conflict rather than a broken transcript. The token's own
 * concurrency matrix uses those answers; it does not check them.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createDryHarness } from '#test-utils/concurrency/DryReplayHarness.js';
import {
  createParties,
  labelledSecret,
} from '#test-utils/concurrency/parties.js';
import {
  pureCircuits as core,
  ledger,
  Contract as MockCore,
} from '../../../artifacts/MockConfidentialNoteFungibleToken/contract/index.js';
import {
  ConfidentialNoteFungibleTokenWitnesses,
  createNoteWallet,
  type Note,
  type NoteWallet,
} from './witnesses/ConfidentialNoteFungibleTokenWitnesses.js';

type PrivateState = Record<string, never>;

const ALICE = core.derivePk(labelledSecret('alice'));
const BOB = core.derivePk(labelledSecret('bob'));

const NOTE_VALUE = 100n;

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

describe('DryReplayHarness against real state', () => {
  let harness: ReturnType<typeof createDryHarness<PrivateState>>;
  let wallets: Record<string, NoteWallet>;

  beforeEach(() => {
    const { parties, contracts } = noteParties();
    wallets = { alice: parties.alice.wallet, bob: parties.bob.wallet };
    harness = createDryHarness({ contracts, privateState: {} });
  });

  /** Mints a note to `ownerPk` and arms `actor` to spend it. */
  const mintTo = async (actor: string, ownerPk: bigint): Promise<Note> => {
    const note = await harness.apply<Note>({
      actor,
      circuitId: '_mint',
      args: [ownerPk, NOTE_VALUE],
    });
    wallets[actor].inputNote = note;
    return note;
  };

  const spend = (actor: string, ownerPk: bigint) => ({
    actor,
    circuitId: '_consumeNote',
    args: [ownerPk],
  });

  const mintNote = (actor: string, nonce: bigint, ownerPk: bigint) => ({
    actor,
    circuitId: '_mintNote',
    args: [{ value: NOTE_VALUE, nonce }, ownerPk],
  });

  const state = () => ledger(harness.state);

  // -------------------------------------------------------------------------
  // apply
  // -------------------------------------------------------------------------

  it('should return the circuit result and advance the state', async () => {
    const before = await harness.snapshot();

    const note = await mintTo('alice', ALICE);

    expect(note.value).toBe(NOTE_VALUE);
    expect(await harness.snapshot()).not.toBe(before);
    expect(state().Core__commitments.firstFree()).toBe(1n);
  });

  // -------------------------------------------------------------------------
  // attempt: scoring a replay
  // -------------------------------------------------------------------------

  it('should reject a second build that pinned the same nullifier', async () => {
    await mintTo('alice', ALICE);
    const snapshot = await harness.snapshot();
    const first = await harness.build(spend('alice', ALICE), snapshot);
    const second = await harness.build(spend('alice', ALICE), snapshot);

    await harness.land(first);
    const attempt = await harness.attempt(second);

    expect(attempt.outcome).toBe('rejected');
    // The reason is the runtime's own, so it must at least be there.
    expect(attempt.outcome === 'rejected' ? attempt.reason : '').not.toBe('');
    expect(state().Core__nullifiers.size()).toBe(1n);
  });

  it('should let a second build that pinned a different key land', async () => {
    const snapshot = await harness.snapshot();
    const first = await harness.build(mintNote('alice', 1n, ALICE), snapshot);
    const second = await harness.build(mintNote('bob', 2n, BOB), snapshot);

    await harness.land(first);

    expect(await harness.attempt(second)).toStrictEqual({ outcome: 'landed' });
    expect(state().Core__commitments.firstFree()).toBe(2n);
  });

  // -------------------------------------------------------------------------
  // classify: a conflict is not the same as a broken transcript
  // -------------------------------------------------------------------------

  it('should rethrow a transcript that fails against its own build snapshot', async () => {
    await mintTo('alice', ALICE);
    const snapshot = await harness.snapshot();
    const pending = await harness.build(spend('alice', ALICE), snapshot);

    await harness.land(pending);
    // Repointing the build snapshot at the post-spend state leaves the
    // transcript invalid everywhere, which is a spec or harness bug rather
    // than a divergence between two states.
    (pending as { builtOn: unknown }).builtOn = await harness.snapshot();

    await expect(harness.attempt(pending)).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // land: replayed against the current state, not the build state
  // -------------------------------------------------------------------------

  it('should land two independent builds from one snapshot', async () => {
    // Replaying the second against its build snapshot would discard the first
    // insert and score every case as landed.
    const snapshot = await harness.snapshot();
    const first = await harness.build(mintNote('alice', 1n, ALICE), snapshot);
    const second = await harness.build(mintNote('bob', 2n, BOB), snapshot);

    await harness.land(first);
    await harness.land(second);

    expect(state().Core__commitments.firstFree()).toBe(2n);
    expect(state().Core__issuedNonces.size()).toBe(2n);
  });
});
