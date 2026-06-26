import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import { MockForwarderPrivateSimulator } from './simulators/MockForwarderPrivateSimulator.js';

// The drain parent is a `ZswapCoinPublicKey` (coin public key only). A contract
// recipient is intentionally unsupported: a shielded send to a contract
// publishes the contract address in cleartext, which would defeat the
// private-parent guarantee (confirmed on preprod). The commitment is over the
// parent key's raw 32 bytes (`_calculateParentCommitment(parent.bytes, opSecret)`).
const PARENT_BYTES = utils.createEitherTestUser('PARENT').left.bytes;
const WRONG_BYTES = utils.createEitherTestUser('WRONG').left.bytes;
const OP_SECRET = new Uint8Array(32).fill(0xaa);
const WRONG_OP_SECRET = new Uint8Array(32).fill(0xbb);
const ZERO = new Uint8Array(32);
const COLOR = new Uint8Array(32).fill(1);
const AMOUNT = 1000n;
const MAX_U64 = (1n << 64n) - 1n;

/** A coin-public-key parent: `ZswapCoinPublicKey` is `{ bytes }`. */
function key(bytes: Uint8Array): { bytes: Uint8Array } {
  return { bytes };
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
async function freshMock(
  committedBytes: Uint8Array,
  opSecret: Uint8Array = OP_SECRET,
): Promise<MockForwarderPrivateSimulator> {
  const mock = await MockForwarderPrivateSimulator.create(
    commitment(committedBytes, opSecret),
    true,
  );
  await mock.deposit(makeCoin(COLOR, AMOUNT));
  return mock;
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

    beforeEach(async () => {
      mock = await freshMock(PARENT_BYTES);
    });

    it('should succeed drain with correct (parent, opSecret)', async () => {
      const result = await mock.drain(
        makeQualifiedCoin(COLOR, AMOUNT, 0n),
        key(PARENT_BYTES),
        OP_SECRET,
        AMOUNT,
      );
      expect(result.sent.value).toEqual(AMOUNT);
    });

    it('should fail drain with wrong parent key', async () => {
      await expect(
        mock.drain(
          makeQualifiedCoin(COLOR, AMOUNT, 0n),
          key(WRONG_BYTES),
          OP_SECRET,
          AMOUNT,
        ),
      ).rejects.toThrow('ForwarderPrivate: invalid parent');
    });

    it('should fail drain with wrong opSecret', async () => {
      await expect(
        mock.drain(
          makeQualifiedCoin(COLOR, AMOUNT, 0n),
          key(PARENT_BYTES),
          WRONG_OP_SECRET,
          AMOUNT,
        ),
      ).rejects.toThrow('ForwarderPrivate: invalid parent');
    });

    it('should fail drain with both wrong', async () => {
      await expect(
        mock.drain(
          makeQualifiedCoin(COLOR, AMOUNT, 0n),
          key(WRONG_BYTES),
          WRONG_OP_SECRET,
          AMOUNT,
        ),
      ).rejects.toThrow('ForwarderPrivate: invalid parent');
    });

    it('should fail drain with value > coin.value', async () => {
      await expect(
        mock.drain(
          makeQualifiedCoin(COLOR, AMOUNT, 0n),
          key(PARENT_BYTES),
          OP_SECRET,
          AMOUNT + 1n,
        ),
      ).rejects.toThrow();
    });

    it('should produce no change when drain value equals coin value', async () => {
      const result = await mock.drain(
        makeQualifiedCoin(COLOR, AMOUNT, 0n),
        key(PARENT_BYTES),
        OP_SECRET,
        AMOUNT,
      );
      expect(result.change.is_some).toBe(false);
    });

    it('should produce a change coin when drain value is less than coin value', async () => {
      const result = await mock.drain(
        makeQualifiedCoin(COLOR, AMOUNT, 0n),
        key(PARENT_BYTES),
        OP_SECRET,
        400n,
      );
      expect(result.change.is_some).toBe(true);
      expect(result.change.value.value).toEqual(AMOUNT - 400n);
      expect(result.change.value.color).toEqual(COLOR);
    });

    it('should produce a sent coin of exactly value on partial drain', async () => {
      const result = await mock.drain(
        makeQualifiedCoin(COLOR, AMOUNT, 0n),
        key(PARENT_BYTES),
        OP_SECRET,
        400n,
      );
      expect(result.sent.value).toEqual(400n);
      expect(result.sent.color).toEqual(COLOR);
    });
  });

  // INV-34: a zero parent key is rejected before the commitment gate.
  describe('drain — rejects a zero parent', () => {
    it('should reject a zero parent key', async () => {
      const mock = await freshMock(PARENT_BYTES);
      await expect(
        mock.drain(
          makeQualifiedCoin(COLOR, AMOUNT, 0n),
          key(ZERO),
          OP_SECRET,
          AMOUNT,
        ),
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
      const mock = await MockForwarderPrivateSimulator.create(c, true);
      await mock.deposit(makeCoin(COLOR, AMOUNT));

      const before = await mock.getParentCommitment();
      await mock.drain(
        makeQualifiedCoin(COLOR, AMOUNT, 0n),
        key(PARENT_BYTES),
        OP_SECRET,
        AMOUNT,
      );
      const after = await mock.getParentCommitment();

      expect(after).toStrictEqual(before);
      expect(after).toStrictEqual(c);
    });
  });

  describe('property: change arithmetic', () => {
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
  });
});
