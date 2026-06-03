import { describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import { ForwarderShieldedSimulator } from '../simulators/presets/ForwarderShieldedSimulator.js';

const PARENT = utils.createEitherTestUser('PARENT').left.bytes;
const COLOR = new Uint8Array(32).fill(1);
const AMOUNT = 1000n;

function makeCoin(color: Uint8Array, value: bigint) {
  return { nonce: new Uint8Array(32), color, value };
}

describe('ForwarderShielded preset', () => {
  it('should store the parent passed to the constructor', () => {
    const fwd = new ForwarderShieldedSimulator(PARENT);
    expect(fwd.getParent()).toEqual(PARENT);
  });

  it('should expose deposit and forward to _depositShielded', () => {
    const fwd = new ForwarderShieldedSimulator(PARENT);
    expect(() => fwd.deposit(makeCoin(COLOR, AMOUNT))).not.toThrow();
  });

  it('should propagate the zero-parent guard from the module', () => {
    expect(() => new ForwarderShieldedSimulator(new Uint8Array(32))).toThrow(
      'Forwarder: zero parent',
    );
  });

  it('should expose the public ledger state', () => {
    const fwd = new ForwarderShieldedSimulator(PARENT);
    expect(fwd.getPublicState()).toBeDefined();
  });
});
