import { describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import { ForwarderUnshieldedSimulator } from '../simulators/presets/ForwarderUnshieldedSimulator.js';

const PARENT = utils.createEitherTestUser('PARENT').left.bytes;
const COLOR = new Uint8Array(32).fill(1);
const AMOUNT = 1000n;

describe('ForwarderUnshielded preset', () => {
  it('should store the parent passed to the constructor', () => {
    const fwd = new ForwarderUnshieldedSimulator(PARENT);
    expect(fwd.getParent()).toEqual(PARENT);
  });

  it('should expose depositUnshielded and forward to _depositUnshielded', () => {
    const fwd = new ForwarderUnshieldedSimulator(PARENT);
    expect(() => fwd.depositUnshielded(COLOR, AMOUNT)).not.toThrow();
  });

  it('should propagate the zero-parent guard from the module', () => {
    expect(() => new ForwarderUnshieldedSimulator(new Uint8Array(32))).toThrow(
      'Forwarder: zero parent',
    );
  });

  it('should expose the public ledger state', () => {
    const fwd = new ForwarderUnshieldedSimulator(PARENT);
    expect(fwd.getPublicState()).toBeDefined();
  });
});
