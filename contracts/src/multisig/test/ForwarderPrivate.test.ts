import type { EncodedQualifiedShieldedCoinInfo } from '@midnight-ntwrk/compact-runtime';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/fixtures/address.js';
import {
  encodeShieldedCoinInfo,
  GENESIS_NATIVE_SHIELDED_TOKEN_COLORS,
} from '#test-utils/fixtures/nativeShieldedToken.js';
import { shieldedTestParentKey } from '#test-utils/fixtures/shieldedKey.js';
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
import { MockForwarderPrivateSimulator } from './simulators/MockForwarderPrivateSimulator.js';

// The drain parent is a `ZswapCoinPublicKey` (coin public key only). A contract
// recipient is intentionally unsupported: a shielded send to a contract
// publishes the contract address in cleartext, which would defeat the
// private-parent guarantee (confirmed on preprod). The commitment is over the
// parent key's raw 32 bytes (`_calculateParentCommitment(parent.bytes, opSecret)`).
//
// Live: the parent is the deployer's own coin public key — the drain sends the
// note to it, so its encryption key must resolve on-chain (a fabricated key has
// none). Published by the live setup, so safe to read at module scope. `WRONG`
// stays a synthetic key: it only exercises the commitment gate, which rejects it
// before any send.
const PARENT_BYTES = shieldedTestParentKey().bytes;
const WRONG_BYTES = utils.createEitherTestUser('WRONG').left.bytes;
const OP_SECRET = new Uint8Array(32).fill(0xaa);
const WRONG_OP_SECRET = new Uint8Array(32).fill(0xbb);
const ZERO = new Uint8Array(32);
// A shielded token type the deployer wallet holds on live (genesis-minted);
// `fill(1)` would be unfunded on live. On dry the color is arbitrary.
const COLOR = GENESIS_NATIVE_SHIELDED_TOKEN_COLORS.nativeShieldedToken1;
const AMOUNT = 1000n;
const MAX_U64 = (1n << 64n) - 1n;

// A non-zero deploy address so a change output routed to self carries a
// recognizable address rather than the zero `dummyContractAddress()` default
// (asserted in the dry Zswap-I/O block; ignored on live, which deploys for real).
const FORWARDER_ADDRESS = '3e'.repeat(32);

/** A coin-public-key parent: `ZswapCoinPublicKey` is `{ bytes }`. */
function key(bytes: Uint8Array): { bytes: Uint8Array } {
  return { bytes };
}

// Backend-aware coin builder: live gets a fresh random nonce per run (the node
// persists nullifiers, so a fixed nonce would replay a spent coin); dry uses
// `nonce` (else zero) for reproducibility.
function makeCoin(color: Uint8Array, value: bigint, nonce?: Uint8Array) {
  return encodeShieldedCoinInfo(color, value, nonce);
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

function commitment(parent: Uint8Array, opSecret: Uint8Array): Uint8Array {
  return MockForwarderPrivateSimulator.calculateParentCommitment(
    parent,
    opSecret,
  );
}

/**
 * An initialized forwarder committed to `committedBytes`, with one coin deposited
 * and qualified for spending. On live the coin's real `mt_index` is recovered
 * from the coin tracker (the contract keeps no record of it); on dry a
 * placeholder the in-memory runtime ignores. `contractAddress` sets a
 * recognizable self-address for the dry change-output assertions.
 */
async function freshMock(
  committedBytes: Uint8Array,
  opSecret: Uint8Array = OP_SECRET,
  contractAddress?: string,
): Promise<{
  mock: MockForwarderPrivateSimulator;
  coin: EncodedQualifiedShieldedCoinInfo;
}> {
  const mock = await MockForwarderPrivateSimulator.create(
    commitment(committedBytes, opSecret),
    true,
    contractAddress ? { contractAddress } : {},
  );
  const deposited = makeCoin(COLOR, AMOUNT);
  await mock.deposit(deposited);
  const coin = await getQualifiedShieldedCoinInfo(
    contractOwner(mock),
    deposited,
  );
  return { mock, coin };
}

describe('ForwarderPrivate module', () => {
  describe('initialization', () => {
    it('should initialize on construction when isInit is true', async () => {
      const c = commitment(PARENT_BYTES, OP_SECRET);
      const mock = await MockForwarderPrivateSimulator.create(c, true);
      await mock.deposit(makeCoin(COLOR, AMOUNT));
    });

    it('should fail initialization with zero commitment', async () => {
      await expect(
        MockForwarderPrivateSimulator.create(ZERO, true),
      ).rejects.toThrow('ForwarderPrivate: zero commitment');
    });

    it('should store the parent commitment after initialization', async () => {
      const c = commitment(PARENT_BYTES, OP_SECRET);
      const mock = await MockForwarderPrivateSimulator.create(c, true);
      // The module is imported with a prefix only, so `_parentCommitment` is
      // not in the public ledger reader; read it via the getter circuit.
      expect(await mock.getParentCommitment()).toStrictEqual(c);
    });
  });

  describe('init guard', () => {
    let mock: MockForwarderPrivateSimulator;

    beforeEach(async () => {
      mock = await MockForwarderPrivateSimulator.create(
        commitment(PARENT_BYTES, OP_SECRET),
        false,
      );
    });

    it('should fail deposit when not initialized', async () => {
      await expect(mock.deposit(makeCoin(COLOR, AMOUNT))).rejects.toThrow(
        'ForwarderPrivate: contract not initialized',
      );
    });

    it('should fail drain when not initialized', async () => {
      // The init guard rejects before any coin is spent, so the placeholder
      // `mt_index` is never used here.
      await expect(
        mock.drain(
          makeQualifiedCoin(COLOR, AMOUNT, 0n),
          key(PARENT_BYTES),
          OP_SECRET,
          AMOUNT,
        ),
      ).rejects.toThrow('ForwarderPrivate: contract not initialized');
    });
  });

  describe('calculateParentCommitment', () => {
    it('should produce the same commitment for the same (parent, opSecret)', () => {
      const c1 = commitment(PARENT_BYTES, OP_SECRET);
      const c2 = commitment(PARENT_BYTES, OP_SECRET);
      expect(c1).toEqual(c2);
    });

    it('should produce different commitments for different opSecrets', () => {
      fc.assert(
        fc.property(
          fc.uint8Array({ minLength: 32, maxLength: 32 }),
          fc.uint8Array({ minLength: 32, maxLength: 32 }),
          fc.uint8Array({ minLength: 32, maxLength: 32 }),
          (parent, s1, s2) => {
            fc.pre(s1.some((b, i) => b !== s2[i]));
            const c1 = commitment(Uint8Array.from(parent), Uint8Array.from(s1));
            const c2 = commitment(Uint8Array.from(parent), Uint8Array.from(s2));
            expect(c1).not.toEqual(c2);
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  // Drain authorization + change behavior. Verifies the commitment gate
  // (INV-6/27), value sufficiency (INV-7), and the change-coin pattern (INV-22).
  describe('drain', () => {
    let mock: MockForwarderPrivateSimulator;
    let coin: EncodedQualifiedShieldedCoinInfo;

    beforeEach(async () => {
      ({ mock, coin } = await freshMock(PARENT_BYTES));
    });

    it('should succeed drain with correct (parent, opSecret)', async () => {
      const result = await mock.drain(
        coin,
        key(PARENT_BYTES),
        OP_SECRET,
        AMOUNT,
      );
      expect(result.sent.value).toEqual(AMOUNT);
    });

    it('should fail drain with wrong parent key', async () => {
      await expect(
        mock.drain(coin, key(WRONG_BYTES), OP_SECRET, AMOUNT),
      ).rejects.toThrow('ForwarderPrivate: invalid parent');
    });

    it('should fail drain with wrong opSecret', async () => {
      await expect(
        mock.drain(coin, key(PARENT_BYTES), WRONG_OP_SECRET, AMOUNT),
      ).rejects.toThrow('ForwarderPrivate: invalid parent');
    });

    it('should fail drain with both wrong', async () => {
      await expect(
        mock.drain(coin, key(WRONG_BYTES), WRONG_OP_SECRET, AMOUNT),
      ).rejects.toThrow('ForwarderPrivate: invalid parent');
    });

    it('should fail drain with value > coin.value', async () => {
      await expect(
        mock.drain(coin, key(PARENT_BYTES), OP_SECRET, AMOUNT + 1n),
      ).rejects.toThrow();
    });

    it('should produce no change when drain value equals coin value', async () => {
      const result = await mock.drain(
        coin,
        key(PARENT_BYTES),
        OP_SECRET,
        AMOUNT,
      );
      expect(result.change.is_some).toBe(false);
    });

    it('should produce a change coin when drain value is less than coin value', async () => {
      const result = await mock.drain(coin, key(PARENT_BYTES), OP_SECRET, 400n);
      expect(result.change.is_some).toBe(true);
      expect(result.change.value.value).toEqual(AMOUNT - 400n);
      expect(result.change.value.color).toEqual(COLOR);
    });

    it('should produce a sent coin of exactly value on partial drain', async () => {
      const result = await mock.drain(coin, key(PARENT_BYTES), OP_SECRET, 400n);
      expect(result.sent.value).toEqual(400n);
      expect(result.sent.color).toEqual(COLOR);
    });
  });

  // INV-34: a zero parent key is rejected before the commitment gate.
  describe('drain — rejects a zero parent', () => {
    it('should reject a zero parent key', async () => {
      const { mock, coin } = await freshMock(PARENT_BYTES);
      await expect(
        mock.drain(coin, key(ZERO), OP_SECRET, AMOUNT),
      ).rejects.toThrow('ForwarderPrivate: zero parent');
    });
  });

  // INV-12 / INV-25: a drain performs no ledger write. `_parentCommitment` is
  // written only at init; it is unchanged after a drain and no recipient field
  // is added. (Read via the getter circuit — the module is imported with a
  // prefix only, so it is not in the public ledger reader.)
  //
  // INV-17 (recipient privacy): the parent coin public key flows only into the
  // `sendShielded` recipient, where it is encrypted inside the Zswap output and
  // never appears on the public transcript. Confirmed end-to-end on preprod (a
  // coin-public-key recipient occurs 0 times in the published tx); not
  // simulator-observable, so it is asserted by the residual-surface check here.
  describe('drain — residual public surface (INV-12 / INV-17 / INV-25)', () => {
    it('should not mutate the parent commitment on a successful drain', async () => {
      const c = commitment(PARENT_BYTES, OP_SECRET);
      const { mock, coin } = await freshMock(PARENT_BYTES);

      const before = await mock.getParentCommitment();
      await mock.drain(coin, key(PARENT_BYTES), OP_SECRET, AMOUNT);
      const after = await mock.getParentCommitment();

      expect(after).toStrictEqual(before);
      expect(after).toStrictEqual(c);
    });
  });

  // `sendShielded` routes a partial drain's change back to the contract as a
  // self-owned output, handed to the caller via `result.change`. That coin must
  // stay spendable: if `_drain` also re-spent it with `sendImmediateShielded`,
  // that would reveal its nullifier in the same transaction, making the returned
  // coin a double spend the node rejects on the next drain. The dry simulator
  // does not enforce nullifiers, so these tests read the recorded Zswap I/O: the
  // change coin's nonce must not appear among the spent inputs.
  //
  // Dry-only: `zswapSnapshot`/`zswapDelta` read the dry sim's Zswap local state,
  // which does not exist on the live backend. The live counterpart follows.
  describe.skipIf(isLiveBackend())(
    'drain — change coin is spendable, via Zswap I/O (dry only, no double spend)',
    () => {
      it('should send the note to the parent and route the change back to itself on a partial drain', async () => {
        const { mock, coin } = await freshMock(
          PARENT_BYTES,
          OP_SECRET,
          FORWARDER_ADDRESS,
        );
        const snap = zswapSnapshot(mock);
        const result = await mock.drain(
          coin,
          key(PARENT_BYTES),
          OP_SECRET,
          400n,
        );
        const { inputs, outputs } = zswapDelta(mock, snap);

        // One coin consumed: the drained coin (nonce 0, full value).
        expect(inputs).toHaveLength(1);
        expect(inputs[0].value).toBe(AMOUNT);
        expect(inputs[0].color).toStrictEqual(COLOR);
        expect(inputs[0].nonce).toStrictEqual(new Uint8Array(32).fill(0));

        // Two coins produced: the note to the parent key (`left` arm) and the
        // change back to this contract (`right`/self arm).
        expect(outputs).toHaveLength(2);
        const toParent = outputs.filter((o) => o.recipient.is_left);
        const toSelf = outputs.filter((o) => !o.recipient.is_left);
        expect(toParent).toHaveLength(1);
        expect(toSelf).toHaveLength(1);

        // Note: 400 of COLOR to the parent key; equals result.sent.
        expect(toParent[0].coinInfo.value).toBe(400n);
        expect(toParent[0].coinInfo).toStrictEqual(result.sent);
        expect(toParent[0].recipient.left.bytes).toStrictEqual(PARENT_BYTES);

        // Change: the remainder back to THIS contract's address (for future
        // drains), identical to the returned change coin, and NOT spent in this
        // same tx.
        expect(result.change.is_some).toBe(true);
        expect(toSelf[0].coinInfo.value).toBe(AMOUNT - 400n);
        expect(toSelf[0].coinInfo).toStrictEqual(result.change.value);
        expect(bytesToHex(toSelf[0].recipient.right.bytes)).toBe(
          FORWARDER_ADDRESS,
        );
        expect(isNonceSpent(inputs, result.change.value.nonce)).toBe(false);
      });

      it('should spend the coin and produce only the note when draining in full', async () => {
        const { mock, coin } = await freshMock(
          PARENT_BYTES,
          OP_SECRET,
          FORWARDER_ADDRESS,
        );
        const snap = zswapSnapshot(mock);
        const result = await mock.drain(
          coin,
          key(PARENT_BYTES),
          OP_SECRET,
          AMOUNT,
        );
        const { inputs, outputs } = zswapDelta(mock, snap);

        // No change: one input (the drained coin), one output (the note to parent).
        expect(result.change.is_some).toBe(false);
        expect(inputs).toHaveLength(1);
        expect(inputs[0].value).toBe(AMOUNT);
        expect(outputs).toHaveLength(1);
        expect(outputs[0].recipient.is_left).toBe(true);
        expect(outputs[0].recipient.left.bytes).toStrictEqual(PARENT_BYTES);
        expect(outputs[0].coinInfo.value).toBe(AMOUNT);
        expect(outputs[0].coinInfo).toStrictEqual(result.sent);
      });
    },
  );

  // Live counterpart of the block above: the SAME two cases, asserted on what a
  // node exposes. Zswap I/O is not readable on live, so the no-double-spend
  // proof is the node's own nullifier enforcement — the change coin routed back
  // to the contract is spent in a follow-up drain, which the node would reject
  // (Custom error 103) if the first drain had already nullified it, so the
  // second drain SUCCEEDING is the proof.
  describe.runIf(isLiveBackend())(
    'drain — change coin is spendable on live (no double spend)',
    () => {
      it('should send the note to the parent and route the change back to itself on a partial drain', async () => {
        const { mock, coin } = await freshMock(PARENT_BYTES);
        const result = await mock.drain(
          coin,
          key(PARENT_BYTES),
          OP_SECRET,
          400n,
        );

        // Note: 400 of COLOR to the parent.
        expect(result.sent.value).toBe(400n);
        expect(result.sent.color).toStrictEqual(COLOR);

        // Change: the remainder handed back as a live, spendable coin.
        expect(result.change.is_some).toBe(true);
        expect(result.change.value.value).toBe(AMOUNT - 400n);

        // Spend that retained change in a follow-up drain: recover its index,
        // then drain it. A double spend would be rejected, so this succeeding
        // proves the change stayed spendable.
        const change = await getQualifiedShieldedCoinInfo(
          contractOwner(mock),
          result.change.value,
        );
        const second = await mock.drain(
          change,
          key(PARENT_BYTES),
          OP_SECRET,
          AMOUNT - 400n,
        );
        expect(second.sent.value).toBe(AMOUNT - 400n);
        expect(second.change.is_some).toBe(false);
      });

      it('should spend the coin and produce only the note when draining in full', async () => {
        const { mock, coin } = await freshMock(PARENT_BYTES);
        const result = await mock.drain(
          coin,
          key(PARENT_BYTES),
          OP_SECRET,
          AMOUNT,
        );
        expect(result.sent.value).toBe(AMOUNT);
        expect(result.change.is_some).toBe(false);
      });
    },
  );

  // Tests that `_drain` (inner call in the mock `drainAndRouteChange`) returns a
  // live, unspent change coin, so an implementing contract can spend it onward to
  // a different recipient in the same tx (the only reason to re-spend change,
  // since `sendShielded` already routes it to self). This would be impossible if
  // `_drain` handed back a coin it had already spent.
  //
  // Dry-only: reads the recorded Zswap I/O; the live counterpart below asserts
  // the functional outcome (recipient arms are indistinguishable on live — both
  // resolve to the deployer key).
  describe.skipIf(isLiveBackend())(
    'drain — implementing contract routes the change onward (dry only)',
    () => {
      const CHANGE_DEST = utils.createEitherTestUser('CHANGE_DEST');

      it('should let the caller send the change to a different recipient using the drain result', async () => {
        const { mock, coin } = await freshMock(PARENT_BYTES);
        const snap = zswapSnapshot(mock);
        const routed = await mock.drainAndRouteChange(
          coin,
          key(PARENT_BYTES),
          OP_SECRET,
          400n,
          CHANGE_DEST,
        );
        const { inputs, outputs } = zswapDelta(mock, snap);

        // The onward send delivered the whole change to `changeRecipient`, so
        // nothing is left over.
        expect(routed.change.is_some).toBe(false);
        expect(routed.sent.value).toBe(AMOUNT - 400n);

        // Two coins are consumed: the drained coin, then the change coin (spent
        // to route it onward — spending it here is correct, unlike the keep-change
        // path).
        expect(inputs).toHaveLength(2);

        // The note still went to the parent for the drained `value`...
        const toParent = outputs.filter(
          (o) =>
            o.recipient.is_left &&
            bytesToHex(o.recipient.left.bytes) === bytesToHex(PARENT_BYTES),
        );
        expect(toParent).toHaveLength(1);
        expect(toParent[0].coinInfo.value).toBe(400n);

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

  // Live counterpart: every deliverable target must be a node-resolvable key (so
  // the parent and the change recipient are both the deployer here), so this
  // asserts only the functional outcome — `_drain` returned a live change coin
  // that was routed fully onward, with nothing retained.
  describe.runIf(isLiveBackend())(
    'drain — implementing contract routes the change onward on live',
    () => {
      it('should let the caller send the change to a different recipient using the drain result', async () => {
        const { mock, coin } = await freshMock(PARENT_BYTES);
        const routed = await mock.drainAndRouteChange(
          coin,
          key(PARENT_BYTES),
          OP_SECRET,
          400n,
          // Reuse the parent (deployer) key so the onward send is deliverable.
          {
            is_left: true,
            left: key(PARENT_BYTES),
            right: utils.createEitherTestUser('CHANGE_DEST').right,
          },
        );
        expect(routed.change.is_some).toBe(false);
        expect(routed.sent.value).toBe(AMOUNT - 400n);
      });
    },
  );

  // Dry-only: fast-check fuzzes coin/drain values up to `MAX_U64`, which exceeds
  // the deployer wallet's genesis balance and would spawn a deploy per run on a
  // real node. The concrete partial/full drains above cover the live path.
  describe.skipIf(isLiveBackend())(
    'property: change arithmetic (dry only)',
    () => {
      it('should preserve change.value == coin.value - drain.value on partial drain', async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.bigInt({ min: 2n, max: MAX_U64 - 1n }),
            fc.bigInt({ min: 1n, max: MAX_U64 - 1n }),
            async (coinVal, drainVal) => {
              fc.pre(drainVal < coinVal);
              const mock = await MockForwarderPrivateSimulator.create(
                commitment(PARENT_BYTES, OP_SECRET),
                true,
              );
              await mock.deposit(makeCoin(COLOR, coinVal));
              const result = await mock.drain(
                makeQualifiedCoin(COLOR, coinVal, 0n),
                key(PARENT_BYTES),
                OP_SECRET,
                drainVal,
              );
              expect(result.change.value.value).toEqual(coinVal - drainVal);
            },
          ),
          { numRuns: 25 },
        );
      });
    },
  );
});
