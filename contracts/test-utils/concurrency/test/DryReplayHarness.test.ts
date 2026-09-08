/**
 * The harness's own guard rails, driven by a stub contract.
 *
 * Deliberately no compiled artifact here: `test:harness` does not depend on the
 * `compile` task, so importing one would break a clean checkout. The replay
 * behaviour that genuinely needs real ledger state is pinned instead by
 * `src/token/test/DryReplayHarness.contract.test.ts`, in the `unit` project.
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

/** Like {@link stubContract}, but names itself when its constructor runs. */
const recordingContract = (
  deployed: string[],
  name: string,
): ReplayableContract<Record<string, never>> =>
  ({
    initialState: () => {
      deployed.push(name);
      return {
        currentPrivateState: {},
        currentContractState: new ContractState(),
        currentZswapLocalState: {},
      };
    },
    impureCircuits: {},
  }) as unknown as ReplayableContract<Record<string, never>>;

const options = () => ({
  contracts: { alice: stubContract() },
  privateState: {},
});

describe('DryReplayHarness', () => {
  it('should refuse to deploy with no contracts', async () => {
    await expect(
      createDryHarness({ contracts: {}, privateState: {} }),
    ).rejects.toThrow('concurrency harness: no contracts given');
  });

  it('should reject a call by an actor it does not know', async () => {
    const harness = await createDryHarness(options());
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
    const harness = await createDryHarness(options());
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
    const harness = await createDryHarness(options());
    const snapshot = await harness.snapshot();

    await expect(
      harness.build(
        { actor: 'alice', circuitId: 'doSomething', args: [] },
        snapshot,
      ),
    ).rejects.toThrow('stub circuit: not meant to run');
  });

  it('should start from the deployed state', async () => {
    const harness = await createDryHarness(options());

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

// ---------------------------------------------------------------------------
// Which party's instance runs the constructor
// ---------------------------------------------------------------------------

/**
 * The constructor's witnesses are the deploying party's, so on a module with an
 * initializer this decides whose secrets seed the shared ledger.
 */
describe('DryReplayHarness deployer', () => {
  const recording = () => {
    const deployed: string[] = [];
    return {
      deployed,
      contracts: {
        alice: recordingContract(deployed, 'alice'),
        bob: recordingContract(deployed, 'bob'),
      },
      privateState: {},
    };
  };

  it('should deploy with the first party by default', async () => {
    const { deployed, ...options } = recording();

    await createDryHarness(options);

    expect(deployed).toStrictEqual(['alice']);
  });

  it('should deploy with the named party', async () => {
    const { deployed, ...options } = recording();

    await createDryHarness({ ...options, deployer: 'bob' });

    expect(deployed).toStrictEqual(['bob']);
  });

  it('should reject a deployer it does not know', async () => {
    const { deployed, ...options } = recording();

    await expect(
      createDryHarness({ ...options, deployer: 'carol' }),
    ).rejects.toThrow("concurrency harness: unknown deployer 'carol'");
    // Nothing deployed: the name is checked before a constructor runs.
    expect(deployed).toStrictEqual([]);
  });
});
