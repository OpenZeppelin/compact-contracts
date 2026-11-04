/**
 * Concurrency claims for the ShieldedTreasury module.
 *
 * Every case builds two calls against one snapshot, lands the first, then
 * applies the second. See `#test-utils/concurrency/types.ts` for why that
 * reproduces a real block conflict deterministically.
 *
 * `_send` pins `_coins[color]` (a `popeq` read of the stored coin), and every
 * `_deposit` of that color replaces it, so a pending `_send` survives only a
 * deposit of another color. There is no zero-value variant to survive:
 * `_deposit` rejects a zero-value coin before it reaches the ledger.
 *
 * A dry verdict covers contract state only, so the coins themselves (their
 * nullifiers and Merkle indices) are outside what these cases observe.
 */

import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import { createConcurrencyHarness } from '#test-utils/concurrency/backend.js';
import {
  createParties,
  labelledSecret,
} from '#test-utils/concurrency/parties.js';
import { race } from '#test-utils/concurrency/race.js';
import type {
  Call,
  ConcurrencyHarness,
} from '#test-utils/concurrency/types.js';
import { encodeShieldedCoinInfo } from '#test-utils/fixtures/nativeShieldedToken.js';
import { shieldedTestKey } from '#test-utils/fixtures/shieldedKey.js';
import { Contract as MockShieldedTreasury } from '../../../artifacts/MockShieldedTreasury/contract/index.js';
import { EmptyPrivateState, emptyWitnesses } from './EmptyWitnesses.js';

// The depositor is anyone; the executor is whoever the consumer authorizes to
// send. Neither has witnesses, so they differ by name only.
const DEPOSITOR = 'depositor';
const EXECUTOR = 'executor';

const COLOR = new Uint8Array(32).fill(1);
const OTHER_COLOR = new Uint8Array(32).fill(2);
const AMOUNT = 1_000n;
const SEND = 400n;

// Non-zero, so change routed to the zero `dummyContractAddress()` default
// fails the recipient check.
const TREASURY_ADDRESS = '7a'.repeat(32);

const Z_RECIPIENT = shieldedTestKey();

/** The runtime's rejection of a pinned read whose value moved underneath it. */
const PINNED_READ_DIVERGED = /mismatch between expected .* and actual .* read/;

const treasuryParties = () =>
  createParties<EmptyPrivateState, MockShieldedTreasury<EmptyPrivateState>>(
    [DEPOSITOR, EXECUTOR],
    {
      wallet: () => EmptyPrivateState,
      contract: () => new MockShieldedTreasury(emptyWitnesses()),
    },
  );

const createHarness = async (): Promise<ConcurrencyHarness> => {
  const { contracts } = treasuryParties();
  return createConcurrencyHarness<EmptyPrivateState>({
    contracts,
    privateState: EmptyPrivateState,
    contractAddress: TREASURY_ADDRESS,
  });
};

/** A deposit of `value` in `color`, with a nonce no other deposit shares. */
const deposit = (color: Uint8Array, value: bigint, label: string): Call => ({
  actor: DEPOSITOR,
  circuitId: '_deposit',
  args: [encodeShieldedCoinInfo(color, value, labelledSecret(label))],
});

const send = (color: Uint8Array, amount: bigint): Call => ({
  actor: EXECUTOR,
  circuitId: '_send',
  args: [Z_RECIPIENT, color, amount],
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
describe.skipIf(isLiveBackend())('ShieldedTreasury: concurrency', () => {
  let harness: ConcurrencyHarness;

  beforeEach(async () => {
    harness = await createHarness();
    await harness.apply(deposit(COLOR, AMOUNT, 'funding'));
  });

  describe('a pending _send', () => {
    it('is rejected by a deposit of its color', async () => {
      const verdict = await race(
        harness,
        deposit(COLOR, 1n, 'grief'),
        send(COLOR, SEND),
      );

      expect(verdict.outcome).toBe('second-rejected');
      if (verdict.outcome === 'second-rejected') {
        expect(verdict.reason).toMatch(PINNED_READ_DIVERGED);
      }
      expect(await balance(harness, COLOR)).toBe(AMOUNT + 1n);
    });

    it('survives a deposit of another color', async () => {
      const verdict = await race(
        harness,
        deposit(OTHER_COLOR, AMOUNT, 'other'),
        send(COLOR, SEND),
      );

      expect(verdict.outcome).toBe('both-landed');
      expect(await balance(harness, COLOR)).toBe(AMOUNT - SEND);
      expect(await balance(harness, OTHER_COLOR)).toBe(AMOUNT);
    });

    it('lands once rebuilt on the new state', async () => {
      const lost = send(COLOR, SEND);
      const verdict = await race(
        harness,
        deposit(COLOR, AMOUNT, 'second funding'),
        lost,
      );
      expect(verdict.outcome).toBe('second-rejected');
      expect(await balance(harness, COLOR)).toBe(2n * AMOUNT);

      await harness.apply(lost);

      expect(await balance(harness, COLOR)).toBe(2n * AMOUNT - SEND);
    });

    it('cannot be rejected for free: a zero-value deposit does not build', async () => {
      const snapshot = await harness.snapshot();

      await expect(
        harness.build(deposit(COLOR, 0n, 'free grief'), snapshot),
      ).rejects.toThrow('ShieldedTreasury: zero value');
    });
  });

  describe('a pending _deposit', () => {
    it('is rejected by a _send of its color', async () => {
      const verdict = await race(
        harness,
        send(COLOR, SEND),
        deposit(COLOR, AMOUNT, 'late'),
      );

      expect(verdict.outcome).toBe('second-rejected');
      if (verdict.outcome === 'second-rejected') {
        expect(verdict.reason).toMatch(PINNED_READ_DIVERGED);
      }
      expect(await balance(harness, COLOR)).toBe(AMOUNT - SEND);
    });
  });
});
