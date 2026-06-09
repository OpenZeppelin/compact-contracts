import { describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import { ForwarderUnshieldedSimulator } from '../simulators/presets/ForwarderUnshieldedSimulator.js';

const PARENT = utils.createEitherTestUserAddress('PARENT');
const COLOR = new Uint8Array(32).fill(1);
const AMOUNT = 1000n;

describe('ForwarderUnshielded preset', () => {
  it('should store the parent passed to the constructor', () => {
    const fwd = new ForwarderUnshieldedSimulator(PARENT);
    expect(fwd.getParent()).toEqual(PARENT);
  });

  it('should expose deposit and forward to _deposit', () => {
    const fwd = new ForwarderUnshieldedSimulator(PARENT);
    expect(() => fwd.deposit(COLOR, AMOUNT)).not.toThrow();
  });

  it('should propagate the zero-parent guard from the module', () => {
    expect(
      () => new ForwarderUnshieldedSimulator(utils.ZERO_USER_ADDRESS),
    ).toThrow('ForwarderUnshielded: zero parent');
  });

  it('should expose the public ledger state', () => {
    const fwd = new ForwarderUnshieldedSimulator(PARENT);
    expect(fwd.getPublicState()).toBeDefined();
  });
});
