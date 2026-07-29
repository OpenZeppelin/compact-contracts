/**
 * The one scenario every concurrency claim is made of.
 *
 * Deliberately not a wall-clock race: a conflict is a divergence between the
 * state a transcript was built on and the state it is applied to, so building
 * both calls against one snapshot and then applying them in order reproduces it
 * exactly, every time. No same-block trickery on either backend.
 */

import type { Call, ConcurrencyHarness, Outcome } from './types.js';

/**
 * Builds both calls against one snapshot, lands the first, then applies the
 * second. The second is the one under test: it was built against a state that
 * no longer exists.
 *
 * @param harness - Backend to run against.
 * @param first - The call that wins the race and lands.
 * @param second - The call built on the now-stale snapshot.
 * @returns Whether both landed, or the second was rejected.
 */
export async function race<S>(
  harness: ConcurrencyHarness<S>,
  first: Call,
  second: Call,
): Promise<Outcome> {
  const snapshot = await harness.snapshot();
  const pendingFirst = await harness.build(first, snapshot);
  const pendingSecond = await harness.build(second, snapshot);

  await harness.land(pendingFirst);
  const attempt = await harness.attempt(pendingSecond);

  return attempt.outcome === 'landed' ? 'both-landed' : 'second-rejected';
}
