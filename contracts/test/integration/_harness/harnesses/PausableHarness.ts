import {
  type Ledger as PausableLedger,
  ledger as pausableLedger,
} from '../../../../artifacts/MockPausable/contract/index.js';
import type { PausableContract } from '../../fixtures/pausable.js';
import { ContractHarness } from '../ContractHarness.js';

/**
 * Real-node counterpart of `PausableSimulator` (the unit-test class).
 *
 * Exposes the same set of human-friendly methods —
 * `isPaused()`, `pause()`, `unpause()`, `assertPaused()`, `assertNotPaused()` —
 * but each call produces a transaction against the local Midnight node rather
 * than evolving an in-memory `QueryContext`.
 *
 * Specs should go through this class and never reach into `this.deployed.callTx`
 * directly — that's an `as any` escape hatch we deliberately don't need
 * any more.
 */
export class PausableHarness extends ContractHarness<
  PausableContract,
  PausableLedger
> {
  protected ledgerOf(data: unknown): PausableLedger {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return pausableLedger(data as any);
  }

  /** Read the public `Pausable__isPaused` flag from the latest ledger. */
  async isPaused(): Promise<boolean> {
    return (await this.readLedger()).Pausable__isPaused;
  }

  /** Flip `Pausable__isPaused` → `true`. */
  async pause() {
    return this.callTx.pause();
  }

  /** Flip `Pausable__isPaused` → `false`. */
  async unpause() {
    return this.callTx.unpause();
  }

  /** Asserts the contract is paused (fails if not). */
  async assertPaused() {
    return this.callTx.assertPaused();
  }

  /** Asserts the contract is not paused (fails if paused). */
  async assertNotPaused() {
    return this.callTx.assertNotPaused();
  }
}
