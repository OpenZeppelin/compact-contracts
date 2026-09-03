/**
 * The harness's own guard rails, driven by a stub contract.
 *
 * Deliberately no compiled artifact here: `test:harness` does not depend on the
 * `compile` task, so importing one would break a clean checkout. The replay
 * behaviour that genuinely needs real ledger state is pinned instead by the
 * `harness invariants` describe in a contract's own concurrency spec.
 */

import { ContractState } from '@midnight-ntwrk/compact-runtime';
import { describe, expect, it } from 'vitest';
import { createConcurrencyHarness } from '../backend.js';
import { createDryHarness, DryReplayHarness } from '../DryReplayHarness.js';
import type { ReplayableContract } from '../types.js';

/** A contract that deploys to a blank ledger and exposes one circuit name. */
const stubContract = (): ReplayableContract<Record<string, never>> =>
  ({
    initialState: () => ({
      currentPrivateState: {},
      currentContractState: new ContractState(),
      currentZswapLocalState: {},
    }),
    impureCircuits: {
      doSomething: () => {
        throw new Error('stub circuit: not meant to run');
      },
    },
  }) as unknown as ReplayableContract<Record<string, never>>;

const options = () => ({
  contracts: { alice: stubContract() },
  privateState: {},
});

describe('DryReplayHarness', () => {
  it('should refuse to deploy with no contracts', () => {
    expect(() => createDryHarness({ contracts: {}, privateState: {} })).toThrow(
      'concurrency harness: no contracts given',
    );
  });

  it('should reject a call by an actor it does not know', async () => {
    const harness = createDryHarness(options());
    const snapshot = await harness.snapshot();

    // A lookup failure is a spec bug, and `build` is where it surfaces: only
    // `attempt` ever scores an outcome, and only for a replay that failed.
    await expect(
      harness.build(
        { actor: 'carol', circuitId: 'doSomething', args: [] },
        snapshot,
      ),
    ).rejects.toThrow("concurrency harness: unknown actor 'carol'");
  });

  it('should reject a circuit the actor does not have', async () => {
    const harness = createDryHarness(options());
    const snapshot = await harness.snapshot();

    await expect(
      harness.build(
        { actor: 'alice', circuitId: 'notACircuit', args: [] },
        snapshot,
      ),
    ).rejects.toThrow(
      "concurrency harness: 'alice' has no circuit 'notACircuit'",
    );
  });

  it('should surface a throwing circuit rather than scoring it', async () => {
    const harness = createDryHarness(options());
    const snapshot = await harness.snapshot();

    await expect(
      harness.build(
        { actor: 'alice', circuitId: 'doSomething', args: [] },
        snapshot,
      ),
    ).rejects.toThrow('stub circuit: not meant to run');
  });

  it('should start from the deployed state', async () => {
    const harness = createDryHarness(options());

    expect(await harness.snapshot()).toBe(await harness.snapshot());
  });
});

describe('createConcurrencyHarness', () => {
  it('should give a replay harness on the dry backend', async () => {
    expect(await createConcurrencyHarness(options())).toBeInstanceOf(
      DryReplayHarness,
    );
  });
});
