import { describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import { MockForwarderShieldedSimulator } from './simulators/MockForwarderShieldedSimulator.js';
import { MockForwarderUnshieldedSimulator } from './simulators/MockForwarderUnshieldedSimulator.js';

const SHIELDED_PARENT = utils.createEitherTestUser('PARENT');
const SHIELDED_PARENT_CONTRACT =
  utils.createEitherTestContractAddress('PARENT');
const UNSHIELDED_PARENT = utils.createEitherTestUserAddress('PARENT');
const UNSHIELDED_PARENT_CONTRACT =
  utils.createEitherTestUnshieldedContract('PARENT');
const COLOR = new Uint8Array(32).fill(1);
const AMOUNT = 1000n;

function makeCoin(color: Uint8Array, value: bigint, nonce?: Uint8Array) {
  return {
    nonce: nonce ?? new Uint8Array(32).fill(0),
    color,
    value,
  };
}

describe('ForwarderShielded module', () => {
  describe('initialization', () => {
    it('should initialize on construction when isInit is true', () => {
      expect(
        () => new MockForwarderShieldedSimulator(SHIELDED_PARENT, true),
      ).not.toThrow();
    });

    it('should initialize with a contract-address parent', () => {
      expect(
        () =>
          new MockForwarderShieldedSimulator(SHIELDED_PARENT_CONTRACT, true),
      ).not.toThrow();
    });

    it('should fail initialization with a zero parent', () => {
      expect(
        () => new MockForwarderShieldedSimulator(utils.ZERO_KEY, true),
      ).toThrow('ForwarderShielded: zero parent');
    });

    it('should fail initialization with a zero contract-address parent', () => {
      expect(
        () => new MockForwarderShieldedSimulator(utils.ZERO_ADDRESS, true),
      ).toThrow('ForwarderShielded: zero parent');
    });

    it('should expose the configured parent after initialization', () => {
      const mock = new MockForwarderShieldedSimulator(SHIELDED_PARENT, true);
      expect(mock.getParent()).toEqual(SHIELDED_PARENT);
    });

    it('should expose a configured contract-address parent', () => {
      const mock = new MockForwarderShieldedSimulator(
        SHIELDED_PARENT_CONTRACT,
        true,
      );
      expect(mock.getParent()).toEqual(SHIELDED_PARENT_CONTRACT);
    });
  });

  describe('init guard', () => {
    it('should fail deposit when not initialized', () => {
      const mock = new MockForwarderShieldedSimulator(SHIELDED_PARENT, false);
      expect(() => mock.deposit(makeCoin(COLOR, AMOUNT))).toThrow(
        'ForwarderShielded: contract not initialized',
      );
    });
  });

  describe('deposit', () => {
    it('should accept a shielded deposit and forward it', () => {
      const mock = new MockForwarderShieldedSimulator(SHIELDED_PARENT, true);
      expect(() => mock.deposit(makeCoin(COLOR, AMOUNT))).not.toThrow();
    });
  });
});

describe('ForwarderUnshielded module', () => {
  describe('initialization', () => {
    it('should initialize on construction when isInit is true', () => {
      expect(
        () => new MockForwarderUnshieldedSimulator(UNSHIELDED_PARENT, true),
      ).not.toThrow();
    });

    it('should initialize with a contract-address parent', () => {
      expect(
        () =>
          new MockForwarderUnshieldedSimulator(
            UNSHIELDED_PARENT_CONTRACT,
            true,
          ),
      ).not.toThrow();
    });

    it('should fail initialization with a zero parent', () => {
      expect(
        () =>
          new MockForwarderUnshieldedSimulator(utils.ZERO_USER_ADDRESS, true),
      ).toThrow('ForwarderUnshielded: zero parent');
    });

    it('should fail initialization with a zero contract-address parent', () => {
      expect(
        () =>
          new MockForwarderUnshieldedSimulator(
            utils.ZERO_UNSHIELDED_CONTRACT,
            true,
          ),
      ).toThrow('ForwarderUnshielded: zero parent');
    });

    it('should expose the configured parent after initialization', () => {
      const mock = new MockForwarderUnshieldedSimulator(
        UNSHIELDED_PARENT,
        true,
      );
      expect(mock.getParent()).toEqual(UNSHIELDED_PARENT);
    });

    it('should expose a configured contract-address parent', () => {
      const mock = new MockForwarderUnshieldedSimulator(
        UNSHIELDED_PARENT_CONTRACT,
        true,
      );
      expect(mock.getParent()).toEqual(UNSHIELDED_PARENT_CONTRACT);
    });
  });

  describe('init guard', () => {
    it('should fail deposit when not initialized', () => {
      const mock = new MockForwarderUnshieldedSimulator(
        UNSHIELDED_PARENT,
        false,
      );
      expect(() => mock.deposit(COLOR, AMOUNT)).toThrow(
        'ForwarderUnshielded: contract not initialized',
      );
    });
  });

  describe('deposit', () => {
    it('should accept an unshielded deposit and forward it', () => {
      const mock = new MockForwarderUnshieldedSimulator(
        UNSHIELDED_PARENT,
        true,
      );
      expect(() => mock.deposit(COLOR, AMOUNT)).not.toThrow();
    });
  });
});
