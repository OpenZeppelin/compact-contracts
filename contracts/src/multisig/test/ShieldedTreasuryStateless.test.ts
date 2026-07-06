import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import {
  bytesToHex,
  isNonceSpent,
  zswapDelta,
  zswapSnapshot,
} from '#test-utils/zswap.js';
import { MockShieldedTreasuryStatelessSimulator } from './simulators/MockShieldedTreasuryStatelessSimulator.js';

const COLOR = new Uint8Array(32).fill(1);
const AMOUNT = 1000n;

// A non-zero deploy address so the change output (routed to self) carries a
// recognizable address rather than the zero `dummyContractAddress()` default.
const TREASURY_ADDRESS = '5c'.repeat(32);

const Z_RECIPIENT = utils.createEitherTestUser('RECIPIENT');

function makeCoin(color: Uint8Array, value: bigint, nonce?: Uint8Array) {
  return { nonce: nonce ?? new Uint8Array(32).fill(0), color, value };
}

function makeQualifiedCoin(
  color: Uint8Array,
  value: bigint,
  mtIndex: bigint,
  nonce?: Uint8Array,
) {
  return {
    nonce: nonce ?? new Uint8Array(32).fill(0),
    color,
    value,
    mt_index: mtIndex,
  };
}

let treasury: MockShieldedTreasuryStatelessSimulator;

describe('ShieldedTreasuryStateless', () => {
  beforeEach(async () => {
    treasury = await MockShieldedTreasuryStatelessSimulator.create({
      contractAddress: TREASURY_ADDRESS,
    });
    await treasury._deposit(makeCoin(COLOR, AMOUNT));
  });

  describe('_send', () => {
    it('should send the requested amount and return change', async () => {
      const result = await treasury._send(
        makeQualifiedCoin(COLOR, AMOUNT, 0n),
        Z_RECIPIENT,
        400n,
      );
      expect(result.sent.value).toBe(400n);
      expect(result.sent.color).toStrictEqual(COLOR);
      expect(result.change.is_some).toBe(true);
      expect(result.change.value.value).toBe(AMOUNT - 400n);
      expect(result.change.value.color).toStrictEqual(COLOR);
    });

    it('should produce no change when sending the full value', async () => {
      const result = await treasury._send(
        makeQualifiedCoin(COLOR, AMOUNT, 0n),
        Z_RECIPIENT,
        AMOUNT,
      );
      expect(result.change.is_some).toBe(false);
    });

    it('should fail when amount exceeds coin value', async () => {
      await expect(
        treasury._send(
          makeQualifiedCoin(COLOR, AMOUNT, 0n),
          Z_RECIPIENT,
          AMOUNT + 1n,
        ),
      ).rejects.toThrow();
    });
  });

  // Regression: `_send` returns `result.change` to the caller to persist and
  // spend next. `sendShielded` already routes change back to the contract as a
  // self-owned output; re-spending it here with `sendImmediateShielded` would
  // reveal its nullifier in the same tx, so the returned change coin
  // would be a double-spent coin a node rejects on the next spend. The dry
  // simulator does not enforce nullifiers, so we assert on the recorded Zswap
  // I/O: the returned change coin's nonce must not appear among the spent
  // inputs.
  describe('_send — change coin is spendable (no double spend)', () => {
    it('should spend the supplied coin and route the change back to itself on a partial send', async () => {
      const snap = zswapSnapshot(treasury);
      const result = await treasury._send(
        makeQualifiedCoin(COLOR, AMOUNT, 0n),
        Z_RECIPIENT,
        400n,
      );
      const { inputs, outputs } = zswapDelta(treasury, snap);

      // One coin consumed: the supplied coin (nonce 0, full value).
      expect(inputs).toHaveLength(1);
      expect(inputs[0].value).toBe(AMOUNT);
      expect(inputs[0].color).toStrictEqual(COLOR);
      expect(inputs[0].nonce).toStrictEqual(new Uint8Array(32).fill(0));

      // Two coins produced: the payment (recipient key, `left` arm) and the
      // change (back to this contract, `right`/self arm).
      expect(outputs).toHaveLength(2);
      const toRecipient = outputs.filter((o) => o.recipient.is_left);
      const toSelf = outputs.filter((o) => !o.recipient.is_left);
      expect(toRecipient).toHaveLength(1);
      expect(toSelf).toHaveLength(1);

      // Payment: 400 of COLOR to the recipient key; equals result.sent.
      expect(toRecipient[0].coinInfo.value).toBe(400n);
      expect(toRecipient[0].coinInfo).toStrictEqual(result.sent);
      expect(toRecipient[0].recipient.left.bytes).toStrictEqual(
        Z_RECIPIENT.left.bytes,
      );

      // Change: the remainder back to THIS contract's address, identical to
      // the returned change coin, and NOT spent in this same tx.
      expect(result.change.is_some).toBe(true);
      expect(toSelf[0].coinInfo.value).toBe(AMOUNT - 400n);
      expect(toSelf[0].coinInfo).toStrictEqual(result.change.value);
      expect(bytesToHex(toSelf[0].recipient.right.bytes)).toBe(
        TREASURY_ADDRESS,
      );
      expect(isNonceSpent(inputs, result.change.value.nonce)).toBe(false);
    });

    it('should spend the coin and produce only the payment when sending in full', async () => {
      const snap = zswapSnapshot(treasury);
      const result = await treasury._send(
        makeQualifiedCoin(COLOR, AMOUNT, 0n),
        Z_RECIPIENT,
        AMOUNT,
      );
      const { inputs, outputs } = zswapDelta(treasury, snap);

      // No change: one input (the supplied coin), one output (the payment).
      expect(result.change.is_some).toBe(false);
      expect(inputs).toHaveLength(1);
      expect(inputs[0].value).toBe(AMOUNT);
      expect(outputs).toHaveLength(1);
      expect(outputs[0].recipient.is_left).toBe(true);
      expect(outputs[0].recipient.left.bytes).toStrictEqual(
        Z_RECIPIENT.left.bytes,
      );
      expect(outputs[0].coinInfo.value).toBe(AMOUNT);
      expect(outputs[0].coinInfo).toStrictEqual(result.sent);
    });
  });

  // The fix returns a live, unspent change coin, so an implementing contract can
  // route it onward to a different recipient in the same tx (the burn()-style pattern).
  // This would be impossible if `_send` handed back a coin it had already spent.
  describe('_send — implementing contract routes the change onward', () => {
    const CHANGE_DEST = utils.createEitherTestUser('CHANGE_DEST');

    it('should let the caller send the change to a different recipient using the send result', async () => {
      const snap = zswapSnapshot(treasury);
      const routed = await treasury._sendAndRouteChange(
        makeQualifiedCoin(COLOR, AMOUNT, 0n),
        Z_RECIPIENT,
        400n,
        CHANGE_DEST,
      );
      const { inputs, outputs } = zswapDelta(treasury, snap);

      // The onward send delivered the whole change to `changeRecipient`.
      expect(routed.change.is_some).toBe(false);
      expect(routed.sent.value).toBe(AMOUNT - 400n);

      // Two coins consumed: the supplied coin, then the change coin (spent to
      // route it onward — correct here, unlike the keep-change path).
      expect(inputs).toHaveLength(2);

      // The payment still went to the original recipient for `amount`...
      const toRecipient = outputs.filter(
        (o) =>
          o.recipient.is_left &&
          bytesToHex(o.recipient.left.bytes) ===
            bytesToHex(Z_RECIPIENT.left.bytes),
      );
      expect(toRecipient).toHaveLength(1);
      expect(toRecipient[0].coinInfo.value).toBe(400n);

      // ...and the change was routed onward to `changeRecipient`, matching the
      // returned coin.
      const toChangeDest = outputs.filter(
        (o) =>
          o.recipient.is_left &&
          bytesToHex(o.recipient.left.bytes) ===
            bytesToHex(CHANGE_DEST.left.bytes),
      );
      expect(toChangeDest).toHaveLength(1);
      expect(toChangeDest[0].coinInfo.value).toBe(AMOUNT - 400n);
      expect(toChangeDest[0].coinInfo).toStrictEqual(routed.sent);
    });
  });
});
