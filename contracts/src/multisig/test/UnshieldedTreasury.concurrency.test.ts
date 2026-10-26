/**
 * Concurrency claims for the UnshieldedTreasury module.
 *
 * Every case builds two calls against one snapshot, lands the first, then
 * applies the second. See `#test-utils/concurrency/types.ts` for why that
 * reproduces a real block conflict deterministically.
 *
 * `_send` and `_deposit` both pin `_balances[color]` (a `popeq` read through
 * `getTokenBalance`), and both write it. So a pending `_send` survives exactly
 * the landed calls that leave that cell's value unchanged: a zero-value deposit
 * of the same color, or any deposit of another color.
 */

import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import { createConcurrencyHarness } from '#test-utils/concurrency/backend.js';
import { createParties } from '#test-utils/concurrency/parties.js';
import { race } from '#test-utils/concurrency/race.js';
import type {
  Call,
  ConcurrencyHarness,
} from '#test-utils/concurrency/types.js';
import * as utils from '#test-utils/fixtures/address.js';
import { Contract as MockUnshieldedTreasury } from '../../../artifacts/MockUnshieldedTreasury/contract/index.js';
import { EmptyPrivateState, emptyWitnesses } from './EmptyWitnesses.js';

// The depositor is anyone; the executor is whoever the consumer authorizes to
// send. Neither has witnesses, so they differ by name only.
const DEPOSITOR = 'depositor';
const EXECUTOR = 'executor';

const COLOR = new Uint8Array(32).fill(1);
const OTHER_COLOR = new Uint8Array(32).fill(9);
const RECIPIENT = utils.createEitherTestUserAddress('RECIPIENT');
const AMOUNT = 1_000n;
const SEND = 400n;

/** The runtime's rejection of a pinned read whose value moved underneath it. */
const PINNED_READ_DIVERGED = /mismatch between expected .* and actual .* read/;

const treasuryParties = () =>
  createParties<EmptyPrivateState, MockUnshieldedTreasury<EmptyPrivateState>>(
    [DEPOSITOR, EXECUTOR],
    {
      wallet: () => EmptyPrivateState,
      contract: () => new MockUnshieldedTreasury(emptyWitnesses()),
    },
  );

const createHarness = async (): Promise<ConcurrencyHarness> => {
  const { contracts } = treasuryParties();
  return createConcurrencyHarness<EmptyPrivateState>({
    contracts,
    privateState: EmptyPrivateState,
  });
};

const deposit = (color: Uint8Array, amount: bigint): Call => ({
  actor: DEPOSITOR,
  circuitId: '_deposit',
  args: [color, amount],
});

const send = (color: Uint8Array, amount: bigint): Call => ({
  actor: EXECUTOR,
  circuitId: '_send',
  args: [RECIPIENT, color, amount],
});

const balance = (
  harness: ConcurrencyHarness,
  color: Uint8Array,
): Promise<bigint> =>
  harness.apply<bigint>({
    actor: EXECUTOR,
    circuitId: 'getTokenBalance',
    args: [color],
  });

// The dry harness is the only backend; see test-utils/concurrency/backend.ts.
describe.skipIf(isLiveBackend())('UnshieldedTreasury: concurrency', () => {
  let harness: ConcurrencyHarness;

  beforeEach(async () => {
    harness = await createHarness();
    await harness.apply(deposit(COLOR, AMOUNT));
  });

  describe('a pending _send', () => {
    it('is rejected by a non-zero deposit of its color', async () => {
      const verdict = await race(
        harness,
        deposit(COLOR, 1n),
        send(COLOR, SEND),
      );

      expect(verdict.outcome).toBe('second-rejected');
      if (verdict.outcome === 'second-rejected') {
        expect(verdict.reason).toMatch(PINNED_READ_DIVERGED);
      }
      expect(await balance(harness, COLOR)).toBe(AMOUNT + 1n);
    });

    it('survives a zero-value deposit of its color', async () => {
      const verdict = await race(
        harness,
        deposit(COLOR, 0n),
        send(COLOR, SEND),
      );

      expect(verdict.outcome).toBe('both-landed');
      expect(await balance(harness, COLOR)).toBe(AMOUNT - SEND);
    });

    it('survives a deposit of another color', async () => {
      const verdict = await race(
        harness,
        deposit(OTHER_COLOR, AMOUNT),
        send(COLOR, SEND),
      );

      expect(verdict.outcome).toBe('both-landed');
      expect(await balance(harness, COLOR)).toBe(AMOUNT - SEND);
      expect(await balance(harness, OTHER_COLOR)).toBe(AMOUNT);
    });

    it('lands once rebuilt on the new state', async () => {
      const lost = send(COLOR, SEND);
      const verdict = await race(harness, deposit(COLOR, AMOUNT), lost);
      expect(verdict.outcome).toBe('second-rejected');
      expect(await balance(harness, COLOR)).toBe(2n * AMOUNT);

      await harness.apply(lost);

      expect(await balance(harness, COLOR)).toBe(2n * AMOUNT - SEND);
    });
  });

  describe('a pending _deposit', () => {
    it('is rejected by a _send of its color', async () => {
      const verdict = await race(
        harness,
        send(COLOR, SEND),
        deposit(COLOR, AMOUNT),
      );

      expect(verdict.outcome).toBe('second-rejected');
      if (verdict.outcome === 'second-rejected') {
        expect(verdict.reason).toMatch(PINNED_READ_DIVERGED);
      }
      expect(await balance(harness, COLOR)).toBe(AMOUNT - SEND);
    });
  });
});
