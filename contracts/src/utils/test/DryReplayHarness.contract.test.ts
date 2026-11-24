/**
 * `DryReplayHarness` against real ledger state.
 *
 * `test-utils/concurrency/test/DryReplayHarness.test.ts` covers the guard rails
 * with a stub contract, since the `harness` project does not depend on a
 * compile. A transcript the onchain runtime re-executes needs a compiled
 * artifact, so these live in the `unit` project.
 */

import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDryHarness } from '#test-utils/concurrency/DryReplayHarness.js';
import {
  createParties,
  labelledSecret,
} from '#test-utils/concurrency/parties.js';
import type { Call } from '#test-utils/concurrency/types.js';
import {
  ledger,
  Contract as MockReplayHarness,
} from '../../../artifacts/utils/test/mocks/MockReplayHarness/contract/index.js';

type PrivateState = Record<string, never>;

const KEY = labelledSecret('key');
const OTHER_KEY = labelledSecret('other key');

const AMOUNT = 100n;
const OTHER_AMOUNT = 250n;

/** The runtime's rejection of a `member` read built as false, replayed as true. */
const PINNED_READ_DIVERGED =
  'mismatch between expected (<[-]: b1>) and actual (<[01]: b1>) read';

const replayParties = () =>
  createParties<PrivateState, MockReplayHarness<PrivateState>>(
    ['alice', 'bob'],
    {
      wallet: () => ({}),
      contract: () => new MockReplayHarness({}),
    },
  );

const claim = (actor: string, key: Uint8Array, amount = AMOUNT): Call => ({
  actor,
  circuitId: 'claim',
  args: [key, amount],
});

const bump = (actor: string): Call => ({
  actor,
  circuitId: 'bump',
  args: [],
});

describe.skipIf(isLiveBackend())('DryReplayHarness against real state', () => {
  let harness: Awaited<ReturnType<typeof createDryHarness<PrivateState>>>;

  beforeEach(async () => {
    const { contracts } = replayParties();
    harness = await createDryHarness({ contracts, privateState: {} });
  });

  const state = () => ledger(harness.state);

  /** Every claim on the ledger as `[key in hex, amount]`, sorted. */
  const claims = () =>
    [...state()._claims]
      .map(([key, amount]) => [Buffer.from(key).toString('hex'), amount])
      .sort();

  const entry = (key: Uint8Array, amount: bigint) => [
    Buffer.from(key).toString('hex'),
    amount,
  ];

  // -------------------------------------------------------------------------
  // apply
  // -------------------------------------------------------------------------

  it('apply returns the circuit result and advances the state', async () => {
    const before = await harness.snapshot();

    const claimed = await harness.apply<bigint>(claim('alice', KEY));

    expect(claimed).toBe(AMOUNT);
    expect(await harness.snapshot()).not.toBe(before);
    expect(claims()).toStrictEqual([entry(KEY, AMOUNT)]);
  });

  // -------------------------------------------------------------------------
  // attempt: scoring a replay
  // -------------------------------------------------------------------------

  it('attempt rejects a second build that pinned the same read', async () => {
    const snapshot = await harness.snapshot();
    const first = await harness.build(claim('alice', KEY), snapshot);
    const second = await harness.build(
      claim('bob', KEY, OTHER_AMOUNT),
      snapshot,
    );

    await harness.land(first);
    const landed = await harness.snapshot();

    expect(await harness.attempt(second)).toStrictEqual({
      outcome: 'rejected',
      reason: PINNED_READ_DIVERGED,
    });
    expect(await harness.snapshot()).toBe(landed);
    expect(claims()).toStrictEqual([entry(KEY, AMOUNT)]);
  });

  it('attempt lands a second build that pinned a different key', async () => {
    const snapshot = await harness.snapshot();
    const first = await harness.build(claim('alice', KEY), snapshot);
    const second = await harness.build(
      claim('bob', OTHER_KEY, OTHER_AMOUNT),
      snapshot,
    );

    await harness.land(first);

    expect(await harness.attempt(second)).toStrictEqual({ outcome: 'landed' });
    expect(claims()).toStrictEqual(
      [entry(KEY, AMOUNT), entry(OTHER_KEY, OTHER_AMOUNT)].sort(),
    );
  });

  it('attempt lands a commuting write after another commuting write', async () => {
    const snapshot = await harness.snapshot();
    const first = await harness.build(bump('alice'), snapshot);
    const second = await harness.build(bump('bob'), snapshot);

    await harness.land(first);

    expect(await harness.attempt(second)).toStrictEqual({ outcome: 'landed' });
    expect(state()._bumps).toBe(2n);
  });

  // -------------------------------------------------------------------------
  // classify: a conflict is not the same as a broken transcript
  // -------------------------------------------------------------------------

  it('attempt rethrows a transcript that fails against its own build snapshot', async () => {
    const snapshot = await harness.snapshot();
    const pending = await harness.build(claim('alice', KEY), snapshot);

    await harness.land(pending);
    // Built on the post-claim state, the transcript is valid nowhere: a spec
    // or harness bug, not a divergence between two states.
    (pending as unknown as { builtOn: unknown }).builtOn =
      await harness.snapshot();

    await expect(harness.attempt(pending)).rejects.toThrow(
      PINNED_READ_DIVERGED,
    );
    expect(claims()).toStrictEqual([entry(KEY, AMOUNT)]);
  });

  // -------------------------------------------------------------------------
  // land: replayed against the current state, not the build state
  // -------------------------------------------------------------------------

  it('land applies two independent builds from one snapshot', async () => {
    // Replayed against its build snapshot, the second would discard the first.
    const snapshot = await harness.snapshot();
    const first = await harness.build(claim('alice', KEY), snapshot);
    const second = await harness.build(
      claim('bob', OTHER_KEY, OTHER_AMOUNT),
      snapshot,
    );

    await harness.land(first);
    await harness.land(second);

    expect(claims()).toStrictEqual(
      [entry(KEY, AMOUNT), entry(OTHER_KEY, OTHER_AMOUNT)].sort(),
    );
  });
});
