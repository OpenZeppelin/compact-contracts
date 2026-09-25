/**
 * What `race` guarantees about the scenario it runs, independent of a backend.
 *
 * The claims are ordering and plumbing: both calls are built against ONE
 * snapshot, the first lands before the second is attempted, and the attempt's
 * verdict reaches the caller intact. A recording harness pins all of that
 * without a ledger, so a real backend only has to be correct about replay.
 */

import { describe, expect, it } from 'vitest';
import { race } from '../race.js';
import type { Attempt, Call, ConcurrencyHarness, Pending } from '../types.js';

// ---------------------------------------------------------------------------
// A harness that records instead of executing
// ---------------------------------------------------------------------------

/** The snapshot handle. Identity is the whole point, so an empty object serves. */
type Snapshot = { readonly tag: 'snapshot' };

interface Recorder {
  readonly harness: ConcurrencyHarness<Snapshot>;
  /** Method names in call order. */
  readonly steps: string[];
  /** The snapshot each `build` was handed. */
  readonly builtOn: Snapshot[];
  readonly landed: Pending[];
  readonly attempted: Pending[];
}

const recorder = (
  attempt: Attempt,
  overrides: Partial<ConcurrencyHarness<Snapshot>> = {},
): Recorder => {
  const snapshot: Snapshot = { tag: 'snapshot' };
  const steps: string[] = [];
  const builtOn: Snapshot[] = [];
  const landed: Pending[] = [];
  const attempted: Pending[] = [];

  const harness: ConcurrencyHarness<Snapshot> = {
    async snapshot() {
      steps.push('snapshot');
      return snapshot;
    },
    async build<R>(call: Call, at: Snapshot): Promise<Pending<R>> {
      steps.push(`build:${call.actor}.${call.circuitId}`);
      builtOn.push(at);
      return { call, result: undefined as R };
    },
    async apply<R>(): Promise<R> {
      throw new Error('apply: not used by race');
    },
    async land(pending: Pending) {
      steps.push('land');
      landed.push(pending);
    },
    async attempt(pending: Pending): Promise<Attempt> {
      steps.push('attempt');
      attempted.push(pending);
      return attempt;
    },
    ...overrides,
  };

  return { harness, steps, builtOn, landed, attempted };
};

const alice: Call = { actor: 'alice', circuitId: 'transfer', args: [] };
const bob: Call = { actor: 'bob', circuitId: 'burn', args: [] };

// ---------------------------------------------------------------------------
// The scenario
// ---------------------------------------------------------------------------

describe('race: the scenario', () => {
  it('should build both calls against one snapshot', async () => {
    // The whole method rests on this: two builds against DIFFERENT states are
    // sequential calls, and no conflict could arise.
    const rec = recorder({ outcome: 'landed' });

    await race(rec.harness, alice, bob);

    expect(rec.builtOn).toHaveLength(2);
    expect(rec.builtOn[0]).toBe(rec.builtOn[1]);
  });

  it('should land the first call before attempting the second', async () => {
    const rec = recorder({ outcome: 'landed' });

    await race(rec.harness, alice, bob);

    expect(rec.steps).toStrictEqual([
      'snapshot',
      'build:alice.transfer',
      'build:bob.burn',
      'land',
      'attempt',
    ]);
  });

  it('should land the first call and attempt the second, not the reverse', async () => {
    const rec = recorder({ outcome: 'landed' });

    await race(rec.harness, alice, bob);

    expect(rec.landed[0]?.call).toBe(alice);
    expect(rec.attempted[0]?.call).toBe(bob);
  });
});

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

describe('race: the verdict', () => {
  it('should report both landed when the second is accepted', async () => {
    const rec = recorder({ outcome: 'landed' });

    expect(await race(rec.harness, alice, bob)).toStrictEqual({
      outcome: 'both-landed',
    });
  });

  it('should pass the rejection reason through', async () => {
    // The reason is what lets a spec check the conflict was the one it set up.
    const rec = recorder({ outcome: 'rejected', reason: 'popeq mismatch' });

    expect(await race(rec.harness, alice, bob)).toStrictEqual({
      outcome: 'second-rejected',
      reason: 'popeq mismatch',
    });
  });
});

// ---------------------------------------------------------------------------
// Failures that are not outcomes
// ---------------------------------------------------------------------------

describe('race: phase failures', () => {
  it('should name the phase and keep the cause when a build throws', async () => {
    const boom = new Error('unknown actor');
    const rec = recorder(
      { outcome: 'landed' },
      {
        build: async (call: Call) => {
          if (call.actor === 'bob') {
            throw boom;
          }
          return { call, result: undefined };
        },
      },
    );

    try {
      await race(rec.harness, alice, bob);
      expect.unreachable('expected a throw');
    } catch (error) {
      expect((error as Error).message).toBe(
        "race: build of second call 'bob.burn' failed",
      );
      expect((error as Error).cause).toBe(boom);
    }
  });

  it('should name the phase when landing the first call throws', async () => {
    const boom = new Error('replay refused');
    const rec = recorder(
      { outcome: 'landed' },
      {
        land: async () => {
          throw boom;
        },
      },
    );

    try {
      await race(rec.harness, alice, bob);
      expect.unreachable('expected a throw');
    } catch (error) {
      expect((error as Error).message).toBe(
        'race: landing the first call failed',
      );
      expect((error as Error).cause).toBe(boom);
    }
  });

  // A rejection is a returned value; a throw out of `attempt` is a defect and
  // must not be scored as the outcome under test.
  it('should not score a throw from attempt as a rejection', async () => {
    const boom = new Error('harness broke');
    const rec = recorder(
      { outcome: 'landed' },
      {
        attempt: async () => {
          throw boom;
        },
      },
    );

    await expect(race(rec.harness, alice, bob)).rejects.toThrow(
      'race: attempting the second call failed',
    );
  });
});
