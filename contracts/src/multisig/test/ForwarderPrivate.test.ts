import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as utils from '#test-utils/address.js';
import { ForwarderPrivateSimulator } from './simulators/ForwarderPrivateSimulator.js';

const PARENT = utils.createEitherTestUser('PARENT').left.bytes;
const WRONG_PARENT = utils.createEitherTestUser('WRONG').left.bytes;
const SALT = new Uint8Array(32).fill(0xaa);
const WRONG_SALT = new Uint8Array(32).fill(0xbb);
const COLOR = new Uint8Array(32).fill(1);
const AMOUNT = 1000n;
const MAX_U64 = (1n << 64n) - 1n;

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

function commitment(parent: Uint8Array, salt: Uint8Array): Uint8Array {
  return ForwarderPrivateSimulator.calculateParentCommitment(parent, salt);
}

let fwd: ForwarderPrivateSimulator;

describe('ForwarderPrivate', () => {
  describe('constructor', () => {
    it('should store and expose the parentCommitment at deploy', () => {
      const c = commitment(PARENT, SALT);
      fwd = new ForwarderPrivateSimulator(c);
      expect(fwd.getParentCommitment()).toEqual(c);
    });

    it('should produce the same commitment for the same (parent, salt)', () => {
      const c1 = commitment(PARENT, SALT);
      const c2 = commitment(PARENT, SALT);
      expect(c1).toEqual(c2);
    });
  });

  describe('deposit', () => {
    beforeEach(() => {
      fwd = new ForwarderPrivateSimulator(commitment(PARENT, SALT));
    });

    it('should not modify _parentCommitment on deposit', () => {
      const before = fwd.getParentCommitment();
      fwd.deposit(makeCoin(COLOR, AMOUNT));
      expect(fwd.getParentCommitment()).toEqual(before);
    });
  });

  describe('drain', () => {
    beforeEach(() => {
      fwd = new ForwarderPrivateSimulator(commitment(PARENT, SALT));
      fwd.deposit(makeCoin(COLOR, AMOUNT));
    });

    it('should succeed drain with correct (parentAddr, salt)', () => {
      const result = fwd.drain(
        makeQualifiedCoin(COLOR, AMOUNT, 0n),
        PARENT,
        SALT,
        AMOUNT,
      );
      expect(result.sent.value).toEqual(AMOUNT);
    });

    it('should fail drain with wrong parentAddr', () => {
      expect(() =>
        fwd.drain(
          makeQualifiedCoin(COLOR, AMOUNT, 0n),
          WRONG_PARENT,
          SALT,
          AMOUNT,
        ),
      ).toThrow('ForwarderPrivate: invalid parent');
    });

    it('should fail drain with wrong salt', () => {
      expect(() =>
        fwd.drain(
          makeQualifiedCoin(COLOR, AMOUNT, 0n),
          PARENT,
          WRONG_SALT,
          AMOUNT,
        ),
      ).toThrow('ForwarderPrivate: invalid parent');
    });

    it('should fail drain with both wrong', () => {
      expect(() =>
        fwd.drain(
          makeQualifiedCoin(COLOR, AMOUNT, 0n),
          WRONG_PARENT,
          WRONG_SALT,
          AMOUNT,
        ),
      ).toThrow('ForwarderPrivate: invalid parent');
    });

    it('should fail drain with value > coin.value', () => {
      expect(() =>
        fwd.drain(
          makeQualifiedCoin(COLOR, AMOUNT, 0n),
          PARENT,
          SALT,
          AMOUNT + 1n,
        ),
      ).toThrow();
    });

    it('should produce no change when drain value equals coin value', () => {
      const result = fwd.drain(
        makeQualifiedCoin(COLOR, AMOUNT, 0n),
        PARENT,
        SALT,
        AMOUNT,
      );
      expect(result.change.is_some).toBe(false);
    });

    it('should produce a change coin when drain value is less than coin value', () => {
      const result = fwd.drain(
        makeQualifiedCoin(COLOR, AMOUNT, 0n),
        PARENT,
        SALT,
        400n,
      );
      expect(result.change.is_some).toBe(true);
      expect(result.change.value.value).toEqual(AMOUNT - 400n);
      expect(result.change.value.color).toEqual(COLOR);
    });

    it('should produce a sent coin of exactly value on partial drain', () => {
      const result = fwd.drain(
        makeQualifiedCoin(COLOR, AMOUNT, 0n),
        PARENT,
        SALT,
        400n,
      );
      expect(result.sent.value).toEqual(400n);
      expect(result.sent.color).toEqual(COLOR);
    });

    it('should not mutate _parentCommitment on drain', () => {
      const before = fwd.getParentCommitment();
      fwd.drain(makeQualifiedCoin(COLOR, AMOUNT, 0n), PARENT, SALT, 100n);
      expect(fwd.getParentCommitment()).toEqual(before);
    });

    it('should not mutate ledger when drain fails authorization', () => {
      const before = fwd.getParentCommitment();
      expect(() =>
        fwd.drain(
          makeQualifiedCoin(COLOR, AMOUNT, 0n),
          WRONG_PARENT,
          SALT,
          AMOUNT,
        ),
      ).toThrow();
      expect(fwd.getParentCommitment()).toEqual(before);
    });
  });

  describe('regression', () => {
    it('should not modify _parentCommitment across deposit/drain sequence', () => {
      fwd = new ForwarderPrivateSimulator(commitment(PARENT, SALT));
      const before = fwd.getParentCommitment();
      fwd.deposit(makeCoin(COLOR, AMOUNT));
      fwd.drain(makeQualifiedCoin(COLOR, AMOUNT, 0n), PARENT, SALT, 500n);
      expect(fwd.getParentCommitment()).toEqual(before);
    });
  });

  describe('property: unlinkability', () => {
    it('should produce different commitments for different salts', () => {
      fc.assert(
        fc.property(
          fc.uint8Array({ minLength: 32, maxLength: 32 }),
          fc.uint8Array({ minLength: 32, maxLength: 32 }),
          fc.uint8Array({ minLength: 32, maxLength: 32 }),
          (parent, s1, s2) => {
            fc.pre(s1.some((b, i) => b !== s2[i]));
            const c1 = commitment(
              Uint8Array.from(parent),
              Uint8Array.from(s1),
            );
            const c2 = commitment(
              Uint8Array.from(parent),
              Uint8Array.from(s2),
            );
            expect(c1).not.toEqual(c2);
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  describe('property: change arithmetic', () => {
    it('should preserve change.value == coin.value - drain.value on partial drain', () => {
      fc.assert(
        fc.property(
          fc.bigInt({ min: 2n, max: MAX_U64 - 1n }),
          fc.bigInt({ min: 1n, max: MAX_U64 - 1n }),
          (coinVal, drainVal) => {
            fc.pre(drainVal < coinVal);
            const sim = new ForwarderPrivateSimulator(commitment(PARENT, SALT));
            sim.deposit(makeCoin(COLOR, coinVal));
            const result = sim.drain(
              makeQualifiedCoin(COLOR, coinVal, 0n),
              PARENT,
              SALT,
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
