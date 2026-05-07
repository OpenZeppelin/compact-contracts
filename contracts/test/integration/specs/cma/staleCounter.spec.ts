import {
  sampleSigningKey,
  signatureVerifyingKey,
} from '@midnight-ntwrk/compact-runtime';
import {
  ContractMaintenanceAuthority,
  ReplaceAuthority,
} from '@midnight-ntwrk/ledger-v8';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  readCmaCounter,
  submitRawMaintenanceUpdate,
} from '../../_harness/cma.js';
import {
  deployTestTokenV1,
  type TestTokenV1Kit,
} from '../../fixtures/testTokenV1.js';

/**
 * Spec: does the chain enforce per-tx counter freshness?
 *
 * The CMA counter is replay-protection: every `MaintenanceUpdate` is signed
 * over `dataToSign` which encodes both the updates and the counter. If a
 * spec records counter `C`, builds an MU at that snapshot, holds the MU,
 * and a *different* update lands first (advancing on-chain to `C+1`), the
 * stored MU's signature now references a stale counter. Submitting it
 * should be rejected by the chain.
 *
 * Test design:
 *   1. Read counter `C`.
 *   2. Submit a real SDK update (advances to `C+1`).
 *   3. Build a raw MU with counter `C` (stale) — passes `counterOverride`
 *      to `submitRawMaintenanceUpdate` so the helper signs against `C`
 *      instead of re-reading the now-fresh `C+1`.
 *   4. Expect rejection.
 *
 * Why this matters: if the chain accepted stale-counter txs, an attacker
 * with a captured signature could replay it indefinitely.
 *
 * **Pinned outcome:** chain rejects at submission with `(FiberFailure)
 * SubmissionError: Transaction submission error` — same wrapper class as
 * other authority-mismatch rejections (the underlying substrate error
 * code differs but the SDK surfaces it identically). See
 * [README](../../README.md#notes--open-questions) Q6.
 */
describe('TestToken — stale-counter `MaintenanceUpdate` is rejected', () => {
  let v1: TestTokenV1Kit;
  let staleCounter: bigint;

  beforeAll(async () => {
    v1 = await deployTestTokenV1();
    staleCounter = await readCmaCounter(v1.providers, v1.contractAddress);

    // Advance the on-chain counter via a real SDK update. After this,
    // `staleCounter` is one behind chain state.
    await v1.deployed.circuitMaintenanceTx._mint.removeVerifierKey();

    const fresh = await readCmaCounter(v1.providers, v1.contractAddress);
    if (fresh !== staleCounter + 1n) {
      throw new Error(
        `staleCounter setup: expected counter to advance by 1 (from ${staleCounter} to ${staleCounter + 1n}), got ${fresh}.`,
      );
    }
  });

  afterAll(async () => {
    await v1?.teardown();
  });

  it('should reject a MaintenanceUpdate built against a counter the chain has already moved past', async () => {
    // Pick a benign SingleUpdate — content doesn't matter, the test target
    // is the COUNTER check. ReplaceAuthority to a fresh sampled key is
    // semantically clean and doesn't depend on slot occupancy.
    const newKey = sampleSigningKey();
    const newAuth = new ContractMaintenanceAuthority(
      [signatureVerifyingKey(newKey)],
      1,
    );

    await expect(
      submitRawMaintenanceUpdate(
        v1.providers,
        v1.contractAddress,
        [new ReplaceAuthority(newAuth)],
        staleCounter, // ← stale: chain expects staleCounter + 1
      ),
    ).rejects.toThrow(/SubmissionError|Transaction submission error/);

    // Sanity: on-chain counter unchanged by the rejected tx.
    const counterAfter = await readCmaCounter(
      v1.providers,
      v1.contractAddress,
    );
    expect(counterAfter).toBe(staleCounter + 1n);
  });
});
