/**
 * Backend seam: a spec asks for a harness, not for a particular transport.
 *
 * Dry today. The live implementation is the same four operations over
 * `midnight-js-contracts`: `build` becomes
 * `createUnprovenCallTxFromInitialStates` with `initialContractState` pinned to
 * the snapshot, and `land` / `attempt` become `submitCallTxAsync` plus a
 * finality wait. It needs providers on {@link HarnessOptions}, so that field
 * arrives with it.
 *
 * The live backend classifies a rejection from TYPED signals, never from error
 * text, so nothing there needs the dry backend's differential replay:
 *
 *   `CallTxFailedError` / `TxFailedError`  @midnight-ntwrk/midnight-js-contracts
 *   `SucceedEntirely` / `FailEntirely` / `FailFallible`, `SegmentSuccess` /
 *   `SegmentFail`, `TxStatus`             @midnight-ntwrk/midnight-js-types
 *   `TransactionResult`                   @midnight-ntwrk/ledger-v8
 *
 * `TransactionResult` carries `type: 'success' | 'partialSuccess' | 'failure'`
 * and `error?: string`, so the ledger's own message is readable at runtime.
 * Read it; do not hardcode it. The Display strings behind it are static data in
 * the wasm binary, exported nowhere.
 *
 * Known open question, settled only by running it: this module's conflicts are
 * GUARANTEED-segment failures (no `Kernel.checkpoint` anywhere in the note
 * core), and a guaranteed-phase failure keeps the transaction out of any block.
 * So there may be no `FinalizedTxData` and no `TransactionResult` to read, and
 * the signal is a submit-time rejection or a timeout instead. `FailEntirely` and
 * `TransactionResult.error` are what a FALLIBLE-segment failure produces. The
 * rejected path needs a bounded wait either way.
 */

import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { createDryHarness } from './DryReplayHarness.js';
import type { ConcurrencyHarness, HarnessOptions } from './types.js';

/** The harness for the current backend. */
export async function createConcurrencyHarness<P>(
  options: HarnessOptions<P>,
): Promise<ConcurrencyHarness> {
  if (isLiveBackend()) {
    throw new Error(
      'concurrency harness: live backend not implemented yet — see the seam ' +
        'note in test-utils/concurrency/backend.ts',
    );
  }
  return createDryHarness(options);
}
