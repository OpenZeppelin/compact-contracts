import type { EncodedQualifiedShieldedCoinInfo } from '@midnight-ntwrk/compact-runtime';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/fixtures/address.js';
import {
  encodeShieldedCoinInfo,
  GENESIS_NATIVE_SHIELDED_TOKEN_COLORS,
} from '#test-utils/fixtures/nativeShieldedToken.js';
import { shieldedTestRecipient } from '#test-utils/fixtures/shieldedKey.js';
import {
  bytesToHex,
  isNonceSpent,
  zswapDelta,
  zswapSnapshot,
} from '#test-utils/fixtures/zswap.js';
import {
  contractOwner,
  getQualifiedShieldedCoinInfo,
} from '#test-utils/harness/NativeShieldedTokenTracker.js';
import { MockShieldedTreasuryStatelessSimulator } from './simulators/MockShieldedTreasuryStatelessSimulator.js';

// Genesis-funded shielded color (`0x00…01`): on the live backend a `_deposit` /
// `_send` can only draw a color the deployer wallet holds. `fill(1)` (`0x0101…01`)
// is a different, unfunded type on live; on dry any color mints freely. See
// nativeShieldedToken.ts.
const COLOR = GENESIS_NATIVE_SHIELDED_TOKEN_COLORS.nativeShieldedToken1;
const AMOUNT = 1000n;

// A non-zero deploy address so the change output (routed to self) carries a
// recognizable address rather than the zero `dummyContractAddress()` default.
const TREASURY_ADDRESS = '5c'.repeat(32);

// Assigned in `beforeEach` after `create()` syncs the wallet: on live this
// resolves to the deployer's own coin public key (an encryption key the node can
// resolve); dry → a synthetic user.
let Z_RECIPIENT: ReturnType<typeof shieldedTestRecipient>;

// Delegates to the backend-aware builder: live gets a fresh random nonce per run
// (the local node persists nullifiers, so a fixed nonce would replay a spent
// coin — Custom error 103); dry uses `nonce` (else zero) for reproducibility.
function makeCoin(color: Uint8Array, value: bigint, nonce?: Uint8Array) {
  return encodeShieldedCoinInfo(color, value, nonce);
}

let treasury: MockShieldedTreasuryStatelessSimulator;
// The coin deposited in `beforeEach`, qualified with its coin-commitment-tree
// index: recovered from the chain's event stream on live (the stateless treasury
// keeps no record of it), a `0n` placeholder the in-memory runtime ignores on dry.
let coin: EncodedQualifiedShieldedCoinInfo;

describe('ShieldedTreasuryStateless', () => {
  beforeEach(async () => {
    treasury = await MockShieldedTreasuryStatelessSimulator.create({
      contractAddress: TREASURY_ADDRESS,
    });
    Z_RECIPIENT = shieldedTestRecipient();
    const deposited = makeCoin(COLOR, AMOUNT);
    await treasury._deposit(deposited);
    coin = await getQualifiedShieldedCoinInfo(
      contractOwner(treasury),
      deposited,
    );
  });

  describe('_send', () => {
    it('should send the requested amount and return change', async () => {
      const result = await treasury._send(coin, Z_RECIPIENT, 400n);
      expect(result.sent.value).toBe(400n);
      expect(result.sent.color).toStrictEqual(COLOR);
      expect(result.change.is_some).toBe(true);
      expect(result.change.value.value).toBe(AMOUNT - 400n);
      expect(result.change.value.color).toStrictEqual(COLOR);
    });

    it('should produce no change when sending the full value', async () => {
      const result = await treasury._send(coin, Z_RECIPIENT, AMOUNT);
      expect(result.change.is_some).toBe(false);
    });

    it('should fail when amount exceeds coin value', async () => {
      await expect(
        treasury._send(coin, Z_RECIPIENT, AMOUNT + 1n),
      ).rejects.toThrow();
    });
  });

  // `_send` hands `result.change` back to the caller to persist and spend later.
  // `sendShielded` routes that change back to the contract as a self-owned
  // output, so it must stay spendable: if `_send` also re-spent it with
  // `sendImmediateShielded`, that would reveal its nullifier in the same
  // transaction, making the returned change a double spend the node rejects on
  // the next spend. The dry simulator does not enforce nullifiers, so these
  // tests read the recorded Zswap I/O: the returned change coin's nonce must not
  // appear among the spent inputs.
  //
  // Dry-only: `zswapSnapshot`/`zswapDelta` read the dry sim's Zswap local state,
  // which does not exist on the live backend. The live counterpart follows.
  describe.skipIf(isLiveBackend())(
    '_send — change coin is spendable, via Zswap I/O (dry only, no double spend)',
    () => {
      it('should spend the supplied coin and route the change back to itself on a partial send', async () => {
        const snap = zswapSnapshot(treasury);
        const result = await treasury._send(coin, Z_RECIPIENT, 400n);
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
        const result = await treasury._send(coin, Z_RECIPIENT, AMOUNT);
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
    },
  );

  // Live counterpart of the block above: the SAME two cases, asserted on what a
  // node exposes. Zswap I/O is not readable on live, so the no-double-spend
  // proof is the node's own nullifier enforcement — the returned change coin is
  // spent in a follow-up `_send` and the node would reject it (Custom error 103)
  // if the first send had already nullified it, so the second send SUCCEEDING is
  // the proof.
  describe.runIf(isLiveBackend())(
    '_send — change coin is spendable on live (no double spend)',
    () => {
      it('should spend the supplied coin and route the change back to itself on a partial send', async () => {
        const result = await treasury._send(coin, Z_RECIPIENT, 400n);

        // Payment: 400 of COLOR to the recipient.
        expect(result.sent.value).toBe(400n);
        expect(result.sent.color).toStrictEqual(COLOR);

        // Change: the remainder handed back as a live, spendable coin.
        expect(result.change.is_some).toBe(true);
        expect(result.change.value.value).toBe(AMOUNT - 400n);

        // Spend that change coin: recover its index, then send it. A double
        // spend would be rejected, so this succeeding proves it stayed spendable.
        const change = await getQualifiedShieldedCoinInfo(
          contractOwner(treasury),
          result.change.value,
        );
        const second = await treasury._send(change, Z_RECIPIENT, AMOUNT - 400n);
        expect(second.sent.value).toBe(AMOUNT - 400n);
        expect(second.change.is_some).toBe(false);
      });

      it('should spend the coin and produce only the payment when sending in full', async () => {
        const result = await treasury._send(coin, Z_RECIPIENT, AMOUNT);
        expect(result.sent.value).toBe(AMOUNT);
        expect(result.change.is_some).toBe(false);
      });
    },
  );

  // `_send` hands back a live, unspent change coin, so an implementing contract
  // can spend it onward to a different recipient in the same tx (the only reason
  // to re-spend change, since `sendShielded` already routes it to self). If
  // `_send` returned a coin it had already spent, this same-tx re-spend would be
  // a double spend and fail.
  //
  // Dry-only: reads the recorded Zswap I/O (no live counterpart to it below,
  // where recipient arms are indistinguishable — both resolve to the deployer).
  describe.skipIf(isLiveBackend())(
    '_send — implementing contract routes the change onward (dry only)',
    () => {
      const CHANGE_DEST = utils.createEitherTestUser('CHANGE_DEST');

      it('should let the caller send the change to a different recipient using the send result', async () => {
        const snap = zswapSnapshot(treasury);
        const routed = await treasury._sendAndRouteChange(
          coin,
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
    },
  );

  // Live counterpart: the recipient arm/address is not observable on live and
  // every deliverable target must be a node-resolvable key (so both the payment
  // and change targets are the deployer), so this asserts only the functional
  // outcome — the returned change was live enough to be routed fully onward, with
  // nothing retained.
  describe.runIf(isLiveBackend())(
    '_send — implementing contract routes the change onward on live',
    () => {
      it('should let the caller send the change to a different recipient using the send result', async () => {
        const changeDest = shieldedTestRecipient();
        const routed = await treasury._sendAndRouteChange(
          coin,
          Z_RECIPIENT,
          400n,
          changeDest,
        );
        expect(routed.change.is_some).toBe(false);
        expect(routed.sent.value).toBe(AMOUNT - 400n);
      });
    },
  );
});
