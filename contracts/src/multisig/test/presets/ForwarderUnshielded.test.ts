import { describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import { ForwarderUnshieldedSimulator } from '../simulators/presets/ForwarderUnshieldedSimulator.js';

// The constructor takes a `UserAddress` (the supported arm). The `_parent`
// ledger field stays a generic `Either`; `initialize` stores the address in the
// `right` arm, which is what `getParent` reads back. A contract-address parent
// is not expressible today (see the module header).
const PARENT = utils.createEitherTestUserAddress('PARENT').right;
const ZERO_ADDR = utils.ZERO_USER_ADDRESS.right;
const COLOR = new Uint8Array(32).fill(1);
const AMOUNT = 1000n;

describe('ForwarderUnshielded preset', () => {
  it('should store the parent passed to the constructor in the right arm', async () => {
    const fwd = await ForwarderUnshieldedSimulator.create(PARENT);
    const parent = await fwd.getParent();
    expect(parent.is_left).toBe(false);
    expect(parent.right).toEqual(PARENT);
  });

  it('should expose deposit and forward to _deposit', async () => {
    const fwd = await ForwarderUnshieldedSimulator.create(PARENT);
    await fwd.deposit(COLOR, AMOUNT);
  });

  it('should propagate the zero-parent guard from the module', async () => {
    await expect(
      ForwarderUnshieldedSimulator.create(ZERO_ADDR),
    ).rejects.toThrow('ForwarderUnshielded: zero parent');
  });

  it('should expose the public ledger state', async () => {
    const fwd = await ForwarderUnshieldedSimulator.create(PARENT);
    expect(await fwd.getPublicState()).toBeDefined();
  });
});
