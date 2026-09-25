/**
 * The one scenario every concurrency claim is made of.
 *
 * Deliberately not a wall-clock race: a conflict is a divergence between the
 * state a transcript was built on and the state it is applied to, so building
 * both calls against one snapshot and then applying them in order reproduces it
 * exactly, every time. No same-block trickery on either backend.
 */

import type { Call, ConcurrencyHarness, Pending, RaceResult } from './types.js';

const describeCall = (call: Call): string => `${call.actor}.${call.circuitId}`;

/**
 * Runs one harness phase, tagging any throw with the phase it came from.
 *
 * A bare failure out of `race` says nothing about which of the five steps
 * broke, and the four that are not `attempt` are spec or harness bugs rather
 * than outcomes.
 */
async function phase<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (cause) {
    throw new Error(`race: ${what} failed`, { cause });
  }
}

/**
 * Builds both calls against one snapshot, lands the first, then applies the
 * second. The second is the one under test: it was built against a state that
 * no longer exists.
 *
 * @param harness - Backend to run against.
 * @param first - The call that wins the race and lands.
 * @param second - The call built on the now-stale snapshot.
 * @returns Whether both landed, or the second was rejected and why.
 */
export async function race<S>(
  harness: ConcurrencyHarness<S>,
  first: Call,
  second: Call,
): Promise<RaceResult> {
  const snapshot = await phase('snapshot', () => harness.snapshot());
  const pendingFirst: Pending = await phase(
    `build of first call '${describeCall(first)}'`,
    () => harness.build(first, snapshot),
  );
  const pendingSecond: Pending = await phase(
    `build of second call '${describeCall(second)}'`,
    () => harness.build(second, snapshot),
  );

  await phase('landing the first call', () => harness.land(pendingFirst));
  // Only this phase produces an outcome. A throw here is still a defect: a
  // rejection arrives as a returned value, never as an exception.
  const attempt = await phase('attempting the second call', () =>
    harness.attempt(pendingSecond),
  );

  return attempt.outcome === 'landed'
    ? { outcome: 'both-landed' }
    : { outcome: 'second-rejected', reason: attempt.reason };
}
