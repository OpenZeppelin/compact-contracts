import { describe, expect, it } from 'vitest';
import * as utils from '#test-utils/fixtures/address.js';
import {
  GENESIS_NATIVE_SHIELDED_TOKEN_COLORS,
  encodeShieldedCoinInfo as makeCoin,
} from '#test-utils/fixtures/nativeShieldedToken.js';
import { shieldedTestParentKey } from '#test-utils/fixtures/shieldedKey.js';
import { ForwarderShieldedSimulator } from '../simulators/presets/ForwarderShieldedSimulator.js';

// The constructor takes a `ZswapCoinPublicKey` (the supported arm). The
// `_parent` ledger field stays a generic `Either`; `initialize` stores the key
// in the `left` arm, which is what `getParent` reads back. A contract-address
// parent is not expressible today (see the module header).
//
// Live: the parent is the deployer's own key (the deposit forwards the coin to
// it, so its encryption key must resolve on-chain).
const PARENT = shieldedTestParentKey();
const ZERO_KEY = utils.ZERO_KEY.left;
// A shielded token type the deployer wallet holds on live (genesis-minted).
const COLOR = GENESIS_NATIVE_SHIELDED_TOKEN_COLORS.nativeShieldedToken1;
const AMOUNT = 1000n;

describe('ForwarderShielded preset', () => {
  it('should store the parent passed to the constructor in the left arm', async () => {
    const fwd = await ForwarderShieldedSimulator.create(PARENT);
    const parent = await fwd.getParent();
    expect(parent.is_left).toBe(true);
    expect(parent.left).toEqual(PARENT);
  });

  it('should expose deposit and forward to _deposit', async () => {
    const fwd = await ForwarderShieldedSimulator.create(PARENT);
    await fwd.deposit(makeCoin(COLOR, AMOUNT));
  });

  it('should propagate the zero-parent guard from the module', async () => {
    await expect(ForwarderShieldedSimulator.create(ZERO_KEY)).rejects.toThrow(
      'ForwarderShielded: zero parent',
    );
  });

  it('should expose the public ledger state', async () => {
    const fwd = await ForwarderShieldedSimulator.create(PARENT);
    expect(await fwd.getPublicState()).toBeDefined();
  });
});
