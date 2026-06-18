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
  it('should store the parent passed to the constructor in the left arm', () => {
    const fwd = new ForwarderShieldedSimulator(PARENT);
    const parent = fwd.getParent();
    expect(parent.is_left).toBe(true);
    expect(parent.left).toEqual(PARENT);
  });

  it('should expose deposit and forward to _deposit', () => {
    const fwd = new ForwarderShieldedSimulator(PARENT);
    expect(() => fwd.deposit(makeCoin(COLOR, AMOUNT))).not.toThrow();
  });

  it('should propagate the zero-parent guard from the module', () => {
    expect(() => new ForwarderShieldedSimulator(ZERO_KEY)).toThrow(
      'ForwarderShielded: zero parent',
    );
  });

  it('should expose the public ledger state', () => {
    const fwd = new ForwarderShieldedSimulator(PARENT);
    expect(fwd.getPublicState()).toBeDefined();
  });
});
