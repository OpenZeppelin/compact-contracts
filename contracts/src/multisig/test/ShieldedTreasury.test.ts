import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import {
  bytesToHex,
  isNonceSpent,
  zswapDelta,
  zswapSnapshot,
} from '#test-utils/zswap.js';
import { ShieldedTreasurySimulator } from './simulators/ShieldedTreasurySimulator.js';

const COLOR = new Uint8Array(32).fill(1);
const COLOR2 = new Uint8Array(32).fill(2);
const AMOUNT = 1000n;

// A non-zero deploy address so the change output (routed to self via
// `selfAsRecipient()`) carries a recognizable address instead of the zero
// `dummyContractAddress()` default — lets the tests assert change returns to
// THIS contract, not merely to "some contract arm".
const TREASURY_ADDRESS = '7a'.repeat(32);

const Z_RECIPIENT = utils.createEitherTestUser('RECIPIENT');

function makeCoin(
  color: Uint8Array,
  value: bigint,
  nonce?: Uint8Array,
): { nonce: Uint8Array; color: Uint8Array; value: bigint } {
  return {
    nonce: nonce ?? new Uint8Array(32).fill(0),
    color,
    value,
  };
}

let treasury: ShieldedTreasurySimulator;

describe('ShieldedTreasury', () => {
  beforeEach(async () => {
    treasury = await ShieldedTreasurySimulator.create({
      contractAddress: TREASURY_ADDRESS,
    });
  });

  describe('initial state', () => {
    it('should return 0 balance for unknown color', async () => {
      expect(await treasury.getTokenBalance(COLOR)).toEqual(0n);
    });

    it('should return 0 received total for unknown color', async () => {
      expect(await treasury.getReceivedTotal(COLOR)).toEqual(0n);
    });

    it('should return 0 sent total for unknown color', async () => {
      expect(await treasury.getSentTotal(COLOR)).toEqual(0n);
    });

    it('should return 0 receivedMinusSent for unknown color', async () => {
      expect(await treasury.getReceivedMinusSent(COLOR)).toEqual(0n);
    });
  });

  describe('_deposit', () => {
    it('should deposit and update balance', async () => {
      await treasury._deposit(makeCoin(COLOR, AMOUNT));
      expect(await treasury.getTokenBalance(COLOR)).toEqual(AMOUNT);
    });

    it('should track received total', async () => {
      await treasury._deposit(makeCoin(COLOR, AMOUNT));
      expect(await treasury.getReceivedTotal(COLOR)).toEqual(AMOUNT);
    });

    it('should accumulate multiple deposits', async () => {
      await treasury._deposit(
        makeCoin(COLOR, AMOUNT, new Uint8Array(32).fill(1)),
      );
      await treasury._deposit(
        makeCoin(COLOR, AMOUNT, new Uint8Array(32).fill(2)),
      );
      expect(await treasury.getTokenBalance(COLOR)).toEqual(AMOUNT * 2n);
      expect(await treasury.getReceivedTotal(COLOR)).toEqual(AMOUNT * 2n);
    });

    it('should track balances per color independently', async () => {
      await treasury._deposit(makeCoin(COLOR, AMOUNT));
      await treasury._deposit(makeCoin(COLOR2, AMOUNT * 2n));
      expect(await treasury.getTokenBalance(COLOR)).toEqual(AMOUNT);
      expect(await treasury.getTokenBalance(COLOR2)).toEqual(AMOUNT * 2n);
    });

    it('should allow zero value deposit', async () => {
      await treasury._deposit(makeCoin(COLOR, 0n));
      expect(await treasury.getTokenBalance(COLOR)).toEqual(0n);
      expect(await treasury.getReceivedTotal(COLOR)).toEqual(0n);
    });

    it('should maintain receivedMinusSent consistency', async () => {
      await treasury._deposit(makeCoin(COLOR, AMOUNT));
      expect(await treasury.getReceivedMinusSent(COLOR)).toEqual(AMOUNT);
    });
  });

  describe('_send', () => {
    beforeEach(async () => {
      await treasury._deposit(makeCoin(COLOR, AMOUNT));
    });

    it('should send partial amount', async () => {
      await treasury._send(Z_RECIPIENT, COLOR, 400n);
      expect(await treasury.getTokenBalance(COLOR)).toEqual(AMOUNT - 400n);
    });

    it('should send full balance', async () => {
      await treasury._send(Z_RECIPIENT, COLOR, AMOUNT);
      expect(await treasury.getTokenBalance(COLOR)).toEqual(0n);
    });

    it('should track sent total', async () => {
      await treasury._send(Z_RECIPIENT, COLOR, 400n);
      expect(await treasury.getSentTotal(COLOR)).toEqual(400n);
    });

    it('should maintain receivedMinusSent after send', async () => {
      await treasury._send(Z_RECIPIENT, COLOR, 400n);
      expect(await treasury.getReceivedMinusSent(COLOR)).toEqual(AMOUNT - 400n);
    });

    it('should fail with insufficient balance', async () => {
      await expect(
        treasury._send(Z_RECIPIENT, COLOR, AMOUNT + 1n),
      ).rejects.toThrow('ShieldedTreasury: coin value insufficient');
    });

    it('should fail for unknown color', async () => {
      await expect(treasury._send(Z_RECIPIENT, COLOR2, 1n)).rejects.toThrow(
        'ShieldedTreasury: no balance',
      );
    });
  });

  // Regression: a partial `_send` must not re-spend the change coin it stores.
  //
  // `sendShielded` already emits change as a self-owned output; re-spending it
  // with `sendImmediateShielded` reveals the stored coin's nullifier in the
  // same transaction, so the next spend of that stored coin is a double spend a
  // node rejects with `Zswap(NullifierAlreadyPresent)`. The dry simulator does
  // not enforce nullifiers, so we assert on the recorded Zswap I/O instead: the
  // spend of the change coin shows up as an extra input carrying its nonce.
  describe('_send — change coin is spendable (no double spend)', () => {
    beforeEach(async () => {
      await treasury._deposit(makeCoin(COLOR, 400n));
    });

    it('should spend the stored coin and route the change back to itself on a partial send', async () => {
      const snap = zswapSnapshot(treasury);
      const result = await treasury._send(Z_RECIPIENT, COLOR, 150n);
      const { inputs, outputs } = zswapDelta(treasury, snap);

      // Exactly one coin is consumed: the stored 400 balance (nonce 0).
      expect(inputs).toHaveLength(1);
      expect(inputs[0].value).toBe(400n);
      expect(inputs[0].color).toStrictEqual(COLOR);
      expect(inputs[0].nonce).toStrictEqual(new Uint8Array(32).fill(0));

      // Two coins are produced: the payment (to the recipient key, `left` arm)
      // and the change (back to this contract, `right`/self arm).
      expect(outputs).toHaveLength(2);
      const toRecipient = outputs.filter((o) => o.recipient.is_left);
      const toSelf = outputs.filter((o) => !o.recipient.is_left);
      expect(toRecipient).toHaveLength(1);
      expect(toSelf).toHaveLength(1);

      // Payment: 150 of COLOR to the intended recipient key; equals result.sent.
      expect(toRecipient[0].coinInfo.value).toBe(150n);
      expect(toRecipient[0].coinInfo.color).toStrictEqual(COLOR);
      expect(toRecipient[0].coinInfo).toStrictEqual(result.sent);
      expect(toRecipient[0].recipient.left.bytes).toStrictEqual(
        Z_RECIPIENT.left.bytes,
      );

      // Change: 250 of COLOR routed back to THIS contract's address; identical
      // to the returned change coin, and crucially NOT spent in this same tx.
      expect(result.change.is_some).toBe(true);
      expect(toSelf[0].coinInfo.value).toBe(250n);
      expect(toSelf[0].coinInfo).toStrictEqual(result.change.value);
      expect(bytesToHex(toSelf[0].recipient.right.bytes)).toBe(
        TREASURY_ADDRESS,
      );
      expect(isNonceSpent(inputs, result.change.value.nonce)).toBe(false);
    });

    it('should spend exactly the stored change coin on a follow-up spend', async () => {
      const first = await treasury._send(Z_RECIPIENT, COLOR, 150n); // 250 change stored
      const storedChange = first.change.value;

      const snap = zswapSnapshot(treasury);
      const second = await treasury._send(Z_RECIPIENT, COLOR, 250n); // spend the change
      const { inputs, outputs } = zswapDelta(treasury, snap);

      // A node would reject this as a double spend if the 250 change coin had
      // already been nullified by the first send. The single input must be
      // exactly that stored change coin (same nonce/value/color).
      expect(inputs).toHaveLength(1);
      expect(inputs[0].value).toBe(250n);
      expect(inputs[0].color).toStrictEqual(COLOR);
      expect(inputs[0].nonce).toStrictEqual(storedChange.nonce);

      // Full spend of the change: one output to the recipient, no further change.
      expect(second.change.is_some).toBe(false);
      expect(outputs).toHaveLength(1);
      expect(outputs[0].recipient.is_left).toBe(true);
      expect(outputs[0].coinInfo.value).toBe(250n);
      expect(await treasury.getTokenBalance(COLOR)).toBe(0n);
    });

    it('should spend the balance and produce only the payment when sending in full', async () => {
      const snap = zswapSnapshot(treasury);
      const result = await treasury._send(Z_RECIPIENT, COLOR, 400n);
      const { inputs, outputs } = zswapDelta(treasury, snap);

      // No change: one input (the 400 balance), one output (the payment).
      expect(result.change.is_some).toBe(false);
      expect(inputs).toHaveLength(1);
      expect(inputs[0].value).toBe(400n);
      expect(outputs).toHaveLength(1);
      expect(outputs[0].recipient.is_left).toBe(true);
      expect(outputs[0].recipient.left.bytes).toStrictEqual(
        Z_RECIPIENT.left.bytes,
      );
      expect(outputs[0].coinInfo.value).toBe(400n);
      expect(outputs[0].coinInfo).toStrictEqual(result.sent);
    });
  });

  describe('accounting consistency', () => {
    it('should keep receivedMinusSent equal to balance', async () => {
      await treasury._deposit(makeCoin(COLOR, 500n));
      await treasury._send(Z_RECIPIENT, COLOR, 200n);
      await treasury._deposit(
        makeCoin(COLOR, 300n, new Uint8Array(32).fill(3)),
      );

      const balance = await treasury.getTokenBalance(COLOR);
      const rms = await treasury.getReceivedMinusSent(COLOR);
      expect(balance).toEqual(600n);
      expect(rms).toEqual(600n);
    });

    it('should accumulate sent total across sends', async () => {
      await treasury._deposit(makeCoin(COLOR, 1000n));
      await treasury._send(Z_RECIPIENT, COLOR, 200n);
      await treasury._send(Z_RECIPIENT, COLOR, 300n);
      expect(await treasury.getSentTotal(COLOR)).toEqual(500n);
    });
  });
});
