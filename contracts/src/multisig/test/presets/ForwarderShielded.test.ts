import { describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import { ForwarderShieldedSimulator } from '../simulators/presets/ForwarderShieldedSimulator.js';

// The constructor takes a `ZswapCoinPublicKey` (the supported arm). The
// `_parent` ledger field stays a generic `Either`; `initialize` stores the key
// in the `left` arm, which is what `getParent` reads back. A contract-address
// parent is not expressible today (see the module header).
const PARENT = utils.createEitherTestUser('PARENT').left;
const ZERO_KEY = utils.ZERO_KEY.left;
const COLOR = new Uint8Array(32).fill(1);
const AMOUNT = 1000n;

function makeCoin(color: Uint8Array, value: bigint) {
  return { nonce: new Uint8Array(32), color, value };
}

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
