import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as utils from '#test-utils/address.js';
import { MockForwarderPrivateSimulator } from './simulators/MockForwarderPrivateSimulator.js';

const PARENT = utils.createEitherTestUser('PARENT').left.bytes;
const WRONG_PARENT = utils.createEitherTestUser('WRONG').left.bytes;
const SALT = new Uint8Array(32).fill(0xaa);
const WRONG_SALT = new Uint8Array(32).fill(0xbb);
const ZERO = new Uint8Array(32);
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
  return MockForwarderPrivateSimulator.calculateParentCommitment(parent, salt);
}

describe('ForwarderPrivate module', () => {
  describe('initialization', () => {
    it('should initialize on construction when isInit is true', () => {
      const c = commitment(PARENT, SALT);
      const mock = new MockForwarderPrivateSimulator(c, true);
      expect(() => mock.deposit(makeCoin(COLOR, AMOUNT))).not.toThrow();
    });

    it('should fail initialization with zero commitment', () => {
      expect(() => new MockForwarderPrivateSimulator(ZERO, true)).toThrow(
        'ForwarderPrivate: zero commitment',
      );
    });

    it('should fail when initialized twice', () => {
      const c = commitment(PARENT, SALT);
      const mock = new MockForwarderPrivateSimulator(c, true);
      expect(() => mock.initialize(c)).toThrow(
        'Initializable: contract already initialized',
      );
    });

    it('should allow late initialize when isInit is false', () => {
      const c = commitment(PARENT, SALT);
      const mock = new MockForwarderPrivateSimulator(c, false);
      expect(() => mock.initialize(c)).not.toThrow();
    });

    it('should expose the public ledger state after initialization', () => {
      const c = commitment(PARENT, SALT);
      const mock = new MockForwarderPrivateSimulator(c, true);
      expect(mock.getPublicState()).toBeDefined();
    });
  });

  describe('init guard', () => {
    let mock: MockForwarderPrivateSimulator;

    beforeEach(() => {
      mock = new MockForwarderPrivateSimulator(commitment(PARENT, SALT), false);
    });

    it('should fail deposit when not initialized', () => {
      expect(() => mock.deposit(makeCoin(COLOR, AMOUNT))).toThrow(
        'Initializable: contract not initialized',
      );
    });

    it('should fail drain when not initialized', () => {
      expect(() =>
        mock.drain(makeQualifiedCoin(COLOR, AMOUNT, 0n), PARENT, SALT, AMOUNT),
      ).toThrow('Initializable: contract not initialized');
    });
  });

  describe('calculateParentCommitment', () => {
    it('should produce the same commitment for the same (parent, salt)', () => {
      const c1 = commitment(PARENT, SALT);
      const c2 = commitment(PARENT, SALT);
      expect(c1).toEqual(c2);
    });

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

  describe('drain', () => {
    let mock: MockForwarderPrivateSimulator;

    beforeEach(() => {
      mock = new MockForwarderPrivateSimulator(commitment(PARENT, SALT), true);
      mock.deposit(makeCoin(COLOR, AMOUNT));
    });

    it('should succeed drain with correct (parentAddr, salt)', () => {
      const result = mock.drain(
        makeQualifiedCoin(COLOR, AMOUNT, 0n),
        PARENT,
        SALT,
        AMOUNT,
      );
      expect(result.sent.value).toEqual(AMOUNT);
    });

    it('should fail drain with wrong parentAddr', () => {
      expect(() =>
        mock.drain(
          makeQualifiedCoin(COLOR, AMOUNT, 0n),
          WRONG_PARENT,
          SALT,
          AMOUNT,
        ),
      ).toThrow('ForwarderPrivate: invalid parent');
    });

    it('should fail drain with wrong salt', () => {
      expect(() =>
        mock.drain(
          makeQualifiedCoin(COLOR, AMOUNT, 0n),
          PARENT,
          WRONG_SALT,
          AMOUNT,
        ),
      ).toThrow('ForwarderPrivate: invalid parent');
    });

    it('should fail drain with both wrong', () => {
      expect(() =>
        mock.drain(
          makeQualifiedCoin(COLOR, AMOUNT, 0n),
          WRONG_PARENT,
          WRONG_SALT,
          AMOUNT,
        ),
      ).toThrow('ForwarderPrivate: invalid parent');
    });

    it('should fail drain with value > coin.value', () => {
      expect(() =>
        mock.drain(
          makeQualifiedCoin(COLOR, AMOUNT, 0n),
          PARENT,
          SALT,
          AMOUNT + 1n,
        ),
      ).toThrow();
    });

    it('should produce no change when drain value equals coin value', () => {
      const result = mock.drain(
        makeQualifiedCoin(COLOR, AMOUNT, 0n),
        PARENT,
        SALT,
        AMOUNT,
      );
      expect(result.change.is_some).toBe(false);
    });

    it('should produce a change coin when drain value is less than coin value', () => {
      const result = mock.drain(
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
      const result = mock.drain(
        makeQualifiedCoin(COLOR, AMOUNT, 0n),
        PARENT,
        SALT,
        400n,
      );
      expect(result.sent.value).toEqual(400n);
      expect(result.sent.color).toEqual(COLOR);
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
            const mock = new MockForwarderPrivateSimulator(
              commitment(PARENT, SALT),
              true,
            );
            mock.deposit(makeCoin(COLOR, coinVal));
            const result = mock.drain(
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
