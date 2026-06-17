import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import { MockForwarderPrivateSimulator } from './simulators/MockForwarderPrivateSimulator.js';

// The drain parent is now an `Either<ZswapCoinPublicKey, ContractAddress>`.
// The commitment is still over the raw 32 address bytes of the *active* arm
// (`_calculateParentCommitment(parentAddr: Bytes<32>, opSecret)` is unchanged),
// so test commitments are computed from the bytes we place in the active arm.
const PARENT_BYTES = utils.createEitherTestUser('PARENT').left.bytes;
const WRONG_BYTES = utils.createEitherTestUser('WRONG').left.bytes;
const OP_SECRET = new Uint8Array(32).fill(0xaa);
const WRONG_OP_SECRET = new Uint8Array(32).fill(0xbb);
const ZERO = new Uint8Array(32);
const GARBAGE = new Uint8Array(32).fill(0x99);
const COLOR = new Uint8Array(32).fill(1);
const AMOUNT = 1000n;
const MAX_U64 = (1n << 64n) - 1n;

type KeyOrAddress = {
  is_left: boolean;
  left: { bytes: Uint8Array };
  right: { bytes: Uint8Array };
};

/** Coin-public-key arm (`left`); the inactive contract arm is zeroed. */
function leftParent(bytes: Uint8Array): KeyOrAddress {
  return { is_left: true, left: { bytes }, right: { bytes: ZERO } };
}

/** Contract-address arm (`right`); the inactive key arm is zeroed. */
function rightParent(bytes: Uint8Array): KeyOrAddress {
  return { is_left: false, left: { bytes: ZERO }, right: { bytes } };
}

/** A non-canonical Either carrying data in *both* arms (INV-35). */
function dualArm(
  is_left: boolean,
  left: Uint8Array,
  right: Uint8Array,
): KeyOrAddress {
  return { is_left, left: { bytes: left }, right: { bytes: right } };
}

function makeCoin(color: Uint8Array, value: bigint, nonce?: Uint8Array) {
  return {
    nonce: nonce ?? new Uint8Array(32).fill(0),
    color,
    value,
  };
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

/** Initialized forwarder committed to `committedBytes`, with one coin deposited. */
function freshMock(
  committedBytes: Uint8Array,
  opSecret: Uint8Array = OP_SECRET,
): MockForwarderPrivateSimulator {
  const mock = new MockForwarderPrivateSimulator(
    commitment(committedBytes, opSecret),
    true,
  );
  mock.deposit(makeCoin(COLOR, AMOUNT));
  return mock;
}

describe('ForwarderPrivate module', () => {
  describe('initialization', () => {
    it('should initialize on construction when isInit is true', () => {
      const c = commitment(PARENT_BYTES, OP_SECRET);
      const mock = new MockForwarderPrivateSimulator(c, true);
      expect(() => mock.deposit(makeCoin(COLOR, AMOUNT))).not.toThrow();
    });

    it('should fail initialization with zero commitment', () => {
      expect(() => new MockForwarderPrivateSimulator(ZERO, true)).toThrow(
        'ForwarderPrivate: zero commitment',
      );
    });

    it('should store the parent commitment after initialization', () => {
      const c = commitment(PARENT_BYTES, OP_SECRET);
      const mock = new MockForwarderPrivateSimulator(c, true);
      // The module is imported with a prefix only, so `_parentCommitment` is
      // not in the public ledger reader; read it via the getter circuit.
      expect(mock.getParentCommitment()).toStrictEqual(c);
    });
  });

  describe('init guard', () => {
    let mock: MockForwarderPrivateSimulator;

    beforeEach(() => {
      mock = new MockForwarderPrivateSimulator(
        commitment(PARENT_BYTES, OP_SECRET),
        false,
      );
    });

    it('should fail deposit when not initialized', () => {
      expect(() => mock.deposit(makeCoin(COLOR, AMOUNT))).toThrow(
        'Initializable: contract not initialized',
      );
    });

    it('should fail drain when not initialized', () => {
      expect(() =>
        mock.drain(
          makeQualifiedCoin(COLOR, AMOUNT, 0n),
          leftParent(PARENT_BYTES),
          OP_SECRET,
          AMOUNT,
        ),
      ).toThrow('Initializable: contract not initialized');
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

  // Regression: the existing drain authorization + change behavior, now driven
  // through the `Either` parent (coin-public-key / `left` arm). Verifies the
  // commitment gate (INV-6/27), value sufficiency (INV-7), and the change-coin
  // pattern (INV-22) are unchanged by the generalization.
  describe('drain (left arm — regression)', () => {
    let mock: MockForwarderPrivateSimulator;

    beforeEach(() => {
      mock = freshMock(PARENT_BYTES);
    });

    it('should succeed drain with correct (parent, opSecret)', () => {
      const result = mock.drain(
        makeQualifiedCoin(COLOR, AMOUNT, 0n),
        leftParent(PARENT_BYTES),
        OP_SECRET,
        AMOUNT,
      );
      expect(result.sent.value).toEqual(AMOUNT);
    });

    it('should fail drain with wrong active-arm bytes', () => {
      expect(() =>
        mock.drain(
          makeQualifiedCoin(COLOR, AMOUNT, 0n),
          leftParent(WRONG_BYTES),
          OP_SECRET,
          AMOUNT,
        ),
      ).toThrow('ForwarderPrivate: invalid parent');
    });

    it('should fail drain with wrong opSecret', () => {
      expect(() =>
        mock.drain(
          makeQualifiedCoin(COLOR, AMOUNT, 0n),
          leftParent(PARENT_BYTES),
          WRONG_OP_SECRET,
          AMOUNT,
        ),
      ).toThrow('ForwarderPrivate: invalid parent');
    });

    it('should fail drain with both wrong', () => {
      expect(() =>
        mock.drain(
          makeQualifiedCoin(COLOR, AMOUNT, 0n),
          leftParent(WRONG_BYTES),
          WRONG_OP_SECRET,
          AMOUNT,
        ),
      ).toThrow('ForwarderPrivate: invalid parent');
    });

    it('should fail drain with value > coin.value', () => {
      expect(() =>
        mock.drain(
          makeQualifiedCoin(COLOR, AMOUNT, 0n),
          leftParent(PARENT_BYTES),
          OP_SECRET,
          AMOUNT + 1n,
        ),
      ).toThrow();
    });

    it('should produce no change when drain value equals coin value', () => {
      const result = mock.drain(
        makeQualifiedCoin(COLOR, AMOUNT, 0n),
        leftParent(PARENT_BYTES),
        OP_SECRET,
        AMOUNT,
      );
      expect(result.change.is_some).toBe(false);
    });

    it('should produce a change coin when drain value is less than coin value', () => {
      const result = mock.drain(
        makeQualifiedCoin(COLOR, AMOUNT, 0n),
        leftParent(PARENT_BYTES),
        OP_SECRET,
        400n,
      );
      expect(result.change.is_some).toBe(true);
      expect(result.change.value.value).toEqual(AMOUNT - 400n);
      expect(result.change.value.color).toEqual(COLOR);
    });

    it('should produce a sent coin of exactly value on partial drain', () => {
      const result = mock.drain(
        makeQualifiedCoin(COLOR, AMOUNT, 0n),
        leftParent(PARENT_BYTES),
        OP_SECRET,
        400n,
      );
      expect(result.sent.value).toEqual(400n);
      expect(result.sent.color).toEqual(COLOR);
    });
  });

  // INV-33: the commitment binds only the 32 address bytes + opSecret, never the
  // recipient *type*. The same committed bytes authorize a drain via either arm.
  //
  // NOTE: this covers only the *authorization* half. Whether a `left`/`right`
  // drain actually lands at the matching recipient kind is NOT observable in the
  // simulator — `ShieldedSendResult` carries only the sent/change coins, and the
  // recipient is encrypted into the Zswap output. See the TODO below.
  describe('drain — recipient type is operator-selected (INV-33)', () => {
    it('should authorize a drain via the right (contract) arm with the committed bytes', () => {
      const mock = freshMock(PARENT_BYTES);
      const result = mock.drain(
        makeQualifiedCoin(COLOR, AMOUNT, 0n),
        rightParent(PARENT_BYTES),
        OP_SECRET,
        AMOUNT,
      );
      expect(result.sent.value).toEqual(AMOUNT);
    });

    it('should authorize the same committed bytes via both arms', () => {
      // Identical bytes + opSecret, drained once as a coin public key (left) and
      // once as a contract address (right). Both pass the arm-agnostic gate.
      expect(() =>
        freshMock(PARENT_BYTES).drain(
          makeQualifiedCoin(COLOR, AMOUNT, 0n),
          leftParent(PARENT_BYTES),
          OP_SECRET,
          AMOUNT,
        ),
      ).not.toThrow();
      expect(() =>
        freshMock(PARENT_BYTES).drain(
          makeQualifiedCoin(COLOR, AMOUNT, 0n),
          rightParent(PARENT_BYTES),
          OP_SECRET,
          AMOUNT,
        ),
      ).not.toThrow();
    });

    // TODO(proof-loop): assert recipient-kind delivery — that a `left` drain
    // lands at the coin public key and a `right` drain at the contract address.
    // Not simulator-observable (recipient is encrypted in the Zswap output);
    // requires an end-to-end proof-server test. See artifact Open Question 1.
  });

  // INV-34: a zero parent (after canonicalization) is rejected before the
  // commitment gate, on either arm.
  describe('drain — rejects a zero parent (INV-34)', () => {
    it('should reject a zero left (coin-key) parent', () => {
      const mock = freshMock(PARENT_BYTES);
      expect(() =>
        mock.drain(
          makeQualifiedCoin(COLOR, AMOUNT, 0n),
          leftParent(ZERO),
          OP_SECRET,
          AMOUNT,
        ),
      ).toThrow('ForwarderPrivate: zero parent');
    });

    it('should reject a zero right (contract) parent', () => {
      const mock = freshMock(PARENT_BYTES);
      expect(() =>
        mock.drain(
          makeQualifiedCoin(COLOR, AMOUNT, 0n),
          rightParent(ZERO),
          OP_SECRET,
          AMOUNT,
        ),
      ).toThrow('ForwarderPrivate: zero parent');
    });
  });

  // INV-35: `_drain` canonicalizes the parent first, zeroing the inactive arm,
  // so a crafted dual-arm Either behaves identically to its single-arm canonical
  // form. The inactive arm contributes to neither the zero-check, the commitment
  // gate, nor the recipient.
  describe('drain — canonicalizes the parent, no dual-arm desync (INV-35)', () => {
    it('should ignore garbage in the inactive right arm when active is left', () => {
      const mock = freshMock(PARENT_BYTES);
      const result = mock.drain(
        makeQualifiedCoin(COLOR, AMOUNT, 0n),
        dualArm(true, PARENT_BYTES, GARBAGE),
        OP_SECRET,
        AMOUNT,
      );
      expect(result.sent.value).toEqual(AMOUNT);
    });

    it('should ignore garbage in the inactive left arm when active is right', () => {
      const mock = freshMock(PARENT_BYTES);
      const result = mock.drain(
        makeQualifiedCoin(COLOR, AMOUNT, 0n),
        dualArm(false, GARBAGE, PARENT_BYTES),
        OP_SECRET,
        AMOUNT,
      );
      expect(result.sent.value).toEqual(AMOUNT);
    });

    it('should reject when the active arm is wrong even if the inactive arm matches the commitment', () => {
      // Commitment is over PARENT_BYTES. Active arm (left) carries WRONG_BYTES;
      // the inactive arm (right) carries the committed bytes. Canonicalization
      // zeroes the inactive arm, so the gate reads WRONG_BYTES and aborts —
      // proving the inactive arm is never consulted.
      const mock = freshMock(PARENT_BYTES);
      expect(() =>
        mock.drain(
          makeQualifiedCoin(COLOR, AMOUNT, 0n),
          dualArm(true, WRONG_BYTES, PARENT_BYTES),
          OP_SECRET,
          AMOUNT,
        ),
      ).toThrow('ForwarderPrivate: invalid parent');
    });
  });

  // INV-12 / INV-25: a drain performs no ledger write. `_parentCommitment` is
  // written only at init; it is unchanged after a drain and no recipient field
  // is added. (It is read via the getter circuit — the module is imported with
  // a prefix only, so it is not in the public ledger reader.)
  //
  // NOTE: this is the observable residual-surface assertion. INV-17's arm-privacy
  // claim (that `is_left` does not leak) concerns the encrypted Zswap output and
  // is not simulator-observable — see the TODO below.
  describe('drain — residual public surface (INV-12 / INV-17 / INV-25)', () => {
    it('should not mutate the parent commitment on a successful drain', () => {
      const c = commitment(PARENT_BYTES, OP_SECRET);
      const mock = new MockForwarderPrivateSimulator(c, true);
      mock.deposit(makeCoin(COLOR, AMOUNT));

      const before = mock.getParentCommitment();
      mock.drain(
        makeQualifiedCoin(COLOR, AMOUNT, 0n),
        leftParent(PARENT_BYTES),
        OP_SECRET,
        AMOUNT,
      );
      const after = mock.getParentCommitment();

      expect(after).toStrictEqual(before);
      expect(after).toStrictEqual(c);
    });

    // TODO(proof-loop): assert arm-privacy (INV-17) — that the `is_left` selector
    // (coin public key vs contract address) is not observable on the public
    // transcript. The recipient Either is encrypted in the Zswap output and is
    // not exposed by the simulator; requires an end-to-end proof-server test
    // against the native-entry recipient encoding. See artifact Open Question 2.
  });

  describe('property: change arithmetic', () => {
    it('should preserve change.value == coin.value - drain.value on partial drain', () => {
      fc.assert(
        fc.property(
          fc.bigInt({ min: 2n, max: MAX_U64 - 1n }),
          fc.bigInt({ min: 1n, max: MAX_U64 - 1n }),
          (coinVal, drainVal) => {
            fc.pre(drainVal < coinVal);
            const mock = new MockForwarderPrivateSimulator(
              commitment(PARENT_BYTES, OP_SECRET),
              true,
            );
            mock.deposit(makeCoin(COLOR, coinVal));
            const result = mock.drain(
              makeQualifiedCoin(COLOR, coinVal, 0n),
              leftParent(PARENT_BYTES),
              OP_SECRET,
              drainVal,
            );
            expect(result.change.value.value).toEqual(coinVal - drainVal);
          },
        ),
        { numRuns: 25 },
      );
    });
  });
});
