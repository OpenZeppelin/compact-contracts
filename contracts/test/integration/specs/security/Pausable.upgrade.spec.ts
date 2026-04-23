import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readCmaCounter, rotateCircuitVK } from '../../_harness/cma.js';
import type { PausableHarness } from '../../_harness/harnesses/PausableHarness.js';
import { deployPausable } from '../../fixtures/pausable.js';

/**
 * Spec: Pausable — ledger state survives a CMA-authorised VK rotation.
 *
 * Given a contract in `paused = true`, when the CMA rotates the `pause` circuit's
 * verifier key (remove + insert), then:
 *   - the public ledger flag `Pausable__isPaused` is preserved,
 *   - the CMA replay-protection counter advances by 2 (one per SingleUpdate),
 *   - subsequent circuit calls still verify against the reinserted key.
 */
describe('Pausable — VK rotation preserves public ledger state', () => {
  let pausable: PausableHarness;
  let counterAtStart: bigint;

  beforeAll(async () => {
    pausable = await deployPausable();
    await pausable.pause();
    counterAtStart = await readCmaCounter(
      pausable.providers,
      pausable.contractAddress,
    );
  });

  afterAll(async () => {
    await pausable?.teardown();
  });

  it('paused = true before rotation (sanity check)', async () => {
    expect(await pausable.isPaused()).toBe(true);
  });

  it('rotating pause-circuit VK preserves paused = true', async () => {
    await rotateCircuitVK(pausable.providers, pausable.deployed, 'pause');
    expect(await pausable.isPaused()).toBe(true);
  });

  it('CMA counter advanced by exactly 2 across remove+insert', async () => {
    const counterNow = await readCmaCounter(
      pausable.providers,
      pausable.contractAddress,
    );
    expect(counterNow).toBe(counterAtStart + 2n);
  });

  it('unpause() still verifies after rotation (its VK was untouched)', async () => {
    await pausable.unpause();
    expect(await pausable.isPaused()).toBe(false);
  });
});
