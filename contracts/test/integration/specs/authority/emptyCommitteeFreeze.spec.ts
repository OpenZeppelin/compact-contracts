import {
  ContractMaintenanceAuthority,
  ReplaceAuthority,
} from '@midnight-ntwrk/ledger-v8';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  readAuthority,
  submitRawMaintenanceUpdate,
} from '../../_harness/cma.js';
import {
  deployTestTokenV1,
  type TestTokenV1Kit,
} from '../../fixtures/testTokenV1.js';

/**
 * Spec: does the chain accept `ContractMaintenanceAuthority(committee=[],
 * threshold=1)` as a valid replacement authority?
 *
 * Background: the upgradability research report describes an "empty
 * authority" (∅-authority) as the canonical *frozen* state — no committee
 * key can sign, so no further maintenance is possible. The SDK's
 * high-level `contractMaintenanceTx.replaceAuthority` only accepts a
 * single `SigningKey`, so the empty-committee path can't be reached
 * through it. [`freeze.spec.ts`](./freeze.spec.ts) approximates a freeze
 * by rotating to a freshly-sampled key whose bytes are immediately
 * discarded — behaviourally equivalent (no one has the key) but not the
 * documented protocol-level state.
 *
 * The Stage 5 raw helper lifts that limitation: we can build a
 * `ContractMaintenanceAuthority([], 1)` and submit a `ReplaceAuthority`
 * carrying it directly.
 *
 * **Pinned outcome (observed):** chain *rejects* the empty committee at
 * submission with substrate `1010: Invalid Transaction: Custom error:
 * 117`, surfaced by the SDK as `(FiberFailure) SubmissionError`. So the
 * documented "∅-authority" semantic is *not* directly reachable via
 * `ReplaceAuthority` — at the chain level, a CMA must always have at
 * least one committee key. The "abandoned-key" workaround in
 * `freeze.spec.ts` remains the only viable freeze pattern from this
 * runtime.
 *
 * Implication for [`freeze.spec.ts`](./freeze.spec.ts): its workaround
 * isn't just an SDK convenience — it's necessary, because the protocol
 * itself doesn't accept the empty committee. Worth noting in the
 * docstring there at some point.
 *
 * See Q9 in the [README notes table](../../README.md#notes--open-questions).
 */
describe('TestToken — empty-committee CMA is rejected at the chain level', () => {
  let v1: TestTokenV1Kit;

  beforeAll(async () => {
    v1 = await deployTestTokenV1();
  });

  afterAll(async () => {
    await v1?.teardown();
  });

  it('should reject ReplaceAuthority(committee=[], threshold=1) at submission', async () => {
    const emptyAuth = new ContractMaintenanceAuthority([], 1);

    await expect(
      submitRawMaintenanceUpdate(v1.providers, v1.contractAddress, [
        new ReplaceAuthority(emptyAuth),
      ]),
    ).rejects.toThrow(/SubmissionError|Transaction submission error/);

    // Sanity: the contract's authority is unchanged from deploy. The
    // empty-committee replacement didn't take effect.
    const authAfter = await readAuthority(v1.providers, v1.contractAddress);
    expect(authAfter.committee.length).toBe(1);
  });
});
