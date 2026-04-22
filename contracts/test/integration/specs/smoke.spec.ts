import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deployPausable, type PausableFixture } from '../fixtures/pausable.js';

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
  let fixture: PausableFixture;

  beforeAll(async () => {
    fixture = await deployPausable();
  });

  afterAll(async () => {
    await fixture?.teardown();
  });

  it('deploys MockPausable to the local node', () => {
    expect(fixture.deployed.deployTxData.public.contractAddress).toMatch(
      /^[0-9a-f]+$/,
    );
  });

  it('initial Pausable__isPaused is false', async () => {
    const paused = await fixture.readIsPaused();
    expect(paused).toBe(false);
  });
});
