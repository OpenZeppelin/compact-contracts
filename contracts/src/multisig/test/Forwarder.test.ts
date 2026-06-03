import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import { MockForwarderSimulator } from './simulators/MockForwarderSimulator.js';

const PARENT = utils.createEitherTestUser('PARENT').left.bytes;
const ZERO = new Uint8Array(32);
const COLOR = new Uint8Array(32).fill(1);
const AMOUNT = 1000n;

function makeCoin(color: Uint8Array, value: bigint, nonce?: Uint8Array) {
  return {
    nonce: nonce ?? new Uint8Array(32).fill(0),
    color,
    value,
  };
}

describe('Forwarder module', () => {
  describe('initialization', () => {
    it('should initialize on construction when isInit is true', () => {
      expect(() => new MockForwarderSimulator(PARENT, true)).not.toThrow();
    });

    it('should fail initialization with zero parent', () => {
      expect(() => new MockForwarderSimulator(ZERO, true)).toThrow(
        'Forwarder: zero parent',
      );
    });

    it('should expose the public ledger state after initialization', () => {
      const mock = new MockForwarderSimulator(PARENT, true);
      expect(mock.getPublicState()).toBeDefined();
    });
  });

  describe('init guard', () => {
    let mock: MockForwarderSimulator;

    beforeEach(() => {
      mock = new MockForwarderSimulator(PARENT, false);
    });

    it('should fail depositShielded when not initialized', () => {
      expect(() => mock.depositShielded(makeCoin(COLOR, AMOUNT))).toThrow(
        'Initializable: contract not initialized',
      );
    });

    it('should fail depositUnshielded when not initialized', () => {
      expect(() => mock.depositUnshielded(COLOR, AMOUNT)).toThrow(
        'Initializable: contract not initialized',
      );
    });
  });

  describe('deposit', () => {
    let mock: MockForwarderSimulator;

    beforeEach(() => {
      mock = new MockForwarderSimulator(PARENT, true);
    });

    it('should accept a shielded deposit and forward it', () => {
      expect(() =>
        mock.depositShielded(makeCoin(COLOR, AMOUNT)),
      ).not.toThrow();
    });

    it('should accept an unshielded deposit and forward it', () => {
      expect(() => mock.depositUnshielded(COLOR, AMOUNT)).not.toThrow();
    });
  });
});
