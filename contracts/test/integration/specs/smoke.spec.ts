import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PausableHarness } from '../_harness/harnesses/PausableHarness.js';
import { deployPausable } from '../fixtures/pausable.js';

/**
 * Smoke spec — proves the integration harness works end-to-end:
 *   1. the local node / indexer / proof server are reachable,
 *   2. a compiled contract deploys against the undeployed network, and
 *   3. its initial ledger state is queryable via the indexer.
 *
 * This is the first red→green of the TDD loop: if this passes, every
 * subsequent spec can assume the harness is wired correctly.
 */
describe('Smoke — Pausable deploy + initial state', () => {
  let pausable: PausableHarness;

  beforeAll(async () => {
    pausable = await deployPausable();
  });

  afterAll(async () => {
    await pausable?.teardown();
  });

  it('deploys MockPausable to the local node', () => {
    expect(pausable.contractAddress).toMatch(/^[0-9a-f]+$/);
  });

  it('initial Pausable__isPaused is false', async () => {
    expect(await pausable.isPaused()).toBe(false);
  });
});
