import { describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import { MockForwarderShieldedSimulator } from './simulators/MockForwarderShieldedSimulator.js';
import { MockForwarderUnshieldedSimulator } from './simulators/MockForwarderUnshieldedSimulator.js';

// The constructors take the narrow, supported arm only: a `ZswapCoinPublicKey`
// for the shielded forwarder and a `UserAddress` for the unshielded one. A
// contract-address parent is intentionally not expressible today — an atomic
// forward to a non-participating contract is rejected on-chain (the output is
// never claimed). The `_parent` ledger field stays a generic `Either` so a
// future CMA circuit upgrade can add contract support without a state
// migration; `initialize` stores the supported arm (shielded → `left`,
// unshielded → `right`), which is what `getParent` reads back.
const SHIELDED_PARENT = utils.createEitherTestUser('PARENT').left;
const SHIELDED_ZERO = utils.ZERO_KEY.left;
const UNSHIELDED_PARENT = utils.createEitherTestUserAddress('PARENT').right;
const UNSHIELDED_ZERO = utils.ZERO_USER_ADDRESS.right;
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
    it('should initialize on construction when isInit is true', async () => {
      await MockForwarderShieldedSimulator.create(SHIELDED_PARENT, true);
    });

    it('should fail initialization with a zero parent', async () => {
      await expect(
        MockForwarderShieldedSimulator.create(SHIELDED_ZERO, true),
      ).rejects.toThrow('ForwarderShielded: zero parent');
    });

    it('should store the coin-public-key parent in the left arm', async () => {
      const mock = await MockForwarderShieldedSimulator.create(
        SHIELDED_PARENT,
        true,
      );
      const parent = await mock.getParent();
      expect(parent.is_left).toBe(true);
      expect(parent.left).toEqual(SHIELDED_PARENT);
    });
  });

  describe('init guard', () => {
    it('should fail deposit when not initialized', async () => {
      const mock = await MockForwarderShieldedSimulator.create(
        SHIELDED_PARENT,
        false,
      );
      await expect(mock.deposit(makeCoin(COLOR, AMOUNT))).rejects.toThrow(
        'ForwarderShielded: contract not initialized',
      );
    });
  });

  describe('deposit', () => {
    it('should accept a shielded deposit and forward it', async () => {
      const mock = await MockForwarderShieldedSimulator.create(
        SHIELDED_PARENT,
        true,
      );
      await mock.deposit(makeCoin(COLOR, AMOUNT));
    });
  });
});

describe('ForwarderUnshielded module', () => {
  describe('initialization', () => {
    it('should initialize on construction when isInit is true', async () => {
      await MockForwarderUnshieldedSimulator.create(UNSHIELDED_PARENT, true);
    });

    it('should fail initialization with a zero parent', async () => {
      await expect(
        MockForwarderUnshieldedSimulator.create(UNSHIELDED_ZERO, true),
      ).rejects.toThrow('ForwarderUnshielded: zero parent');
    });

    it('should store the user-address parent in the right arm', async () => {
      const mock = await MockForwarderUnshieldedSimulator.create(
        UNSHIELDED_PARENT,
        true,
      );
      const parent = await mock.getParent();
      expect(parent.is_left).toBe(false);
      expect(parent.right).toEqual(UNSHIELDED_PARENT);
    });
  });

  describe('init guard', () => {
    it('should fail deposit when not initialized', async () => {
      const mock = await MockForwarderUnshieldedSimulator.create(
        UNSHIELDED_PARENT,
        false,
      );
      await expect(mock.deposit(COLOR, AMOUNT)).rejects.toThrow(
        'ForwarderUnshielded: contract not initialized',
      );
    });
  });

  describe('deposit', () => {
    it('should accept an unshielded deposit and forward it', async () => {
      const mock = await MockForwarderUnshieldedSimulator.create(
        UNSHIELDED_PARENT,
        true,
      );
      await mock.deposit(COLOR, AMOUNT);
    });
  });
});
