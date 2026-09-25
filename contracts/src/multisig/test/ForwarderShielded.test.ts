import { describe, expect, it } from 'vitest';
import * as utils from '#test-utils/fixtures/address.js';
import {
  encodeShieldedCoinInfo,
  GENESIS_NATIVE_SHIELDED_TOKEN_COLORS,
} from '#test-utils/fixtures/nativeShieldedToken.js';
import { shieldedTestKey } from '#test-utils/fixtures/shieldedKey.js';
import { MockForwarderShieldedSimulator } from './simulators/MockForwarderShieldedSimulator.js';

// The constructor takes the narrow, supported arm only: a `ZswapCoinPublicKey`.
// A contract-address parent is intentionally not expressible today — an atomic
// forward to a non-participating contract is rejected on-chain (the output is
// never claimed). The `_parent` ledger field stays a generic `Either` so a
// future CMA circuit upgrade can add contract support without a state
// migration; `initialize` stores the supported arm (`left`), which is what
// `getParent` reads back.
//
// Live: the shielded parent is the deployer's own key (the forward sends the
// coin to it, so its encryption key must resolve on-chain).
const SHIELDED_PARENT = shieldedTestKey().left;
const SHIELDED_ZERO = utils.ZERO_KEY.left;

// Shielded color: genesis-funded (`0x00…01`) so a live forward has funds to
// draw; `fill(1)` would be unfunded on live.
const SHIELDED_COLOR =
  GENESIS_NATIVE_SHIELDED_TOKEN_COLORS.nativeShieldedToken1;
const AMOUNT = 1000n;

// Live gets a fresh random nonce per run (the node persists nullifiers); dry
// uses zero for reproducibility.
function makeCoin(color: Uint8Array, value: bigint, nonce?: Uint8Array) {
  return encodeShieldedCoinInfo(color, value, nonce);
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
      await expect(
        mock.deposit(makeCoin(SHIELDED_COLOR, AMOUNT)),
      ).rejects.toThrow('ForwarderShielded: contract not initialized');
    });
  });

  describe('deposit', () => {
    it('should accept a shielded deposit and forward it', async () => {
      const mock = await MockForwarderShieldedSimulator.create(
        SHIELDED_PARENT,
        true,
      );
      await mock.deposit(makeCoin(SHIELDED_COLOR, AMOUNT));
    });
  });
});
