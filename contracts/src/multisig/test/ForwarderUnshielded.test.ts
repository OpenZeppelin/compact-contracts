import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import { ForwarderUnshieldedSimulator } from './simulators/ForwarderUnshieldedSimulator.js';

const PARENT = utils.createEitherTestUser('PARENT').left.bytes;
const COLOR = new Uint8Array(32).fill(1);
const COLOR2 = new Uint8Array(32).fill(2);
const AMOUNT = 1000n;
const MAX_U128 = (1n << 128n) - 1n;

let fwd: ForwarderUnshieldedSimulator;

describe('ForwarderUnshielded', () => {
  describe('constructor', () => {
    it('should store and expose the parent at deploy', () => {
      fwd = new ForwarderUnshieldedSimulator(PARENT);
      expect(fwd.getParent()).toEqual(PARENT);
    });

    it('should return 0 received for unknown color', () => {
      fwd = new ForwarderUnshieldedSimulator(PARENT);
      expect(fwd.getReceived(COLOR)).toEqual(0n);
    });
  });

  describe('depositUnshielded', () => {
    beforeEach(() => {
      fwd = new ForwarderUnshieldedSimulator(PARENT);
    });

    it('should accumulate _received[color] on depositUnshielded', () => {
      fwd.depositUnshielded(COLOR, AMOUNT);
      expect(fwd.getReceived(COLOR)).toEqual(AMOUNT);
    });

    it('should fail depositUnshielded with "Forwarder: received overflow" at MAX', () => {
      fwd.depositUnshielded(COLOR, MAX_U128);
      expect(() => fwd.depositUnshielded(COLOR, 1n)).toThrow(
        'Forwarder: received overflow',
      );
    });

    it('should not modify _parent after depositUnshielded', () => {
      fwd.depositUnshielded(COLOR, AMOUNT);
      expect(fwd.getParent()).toEqual(PARENT);
    });

    it('should track received per color independently on unshielded deposits', () => {
      fwd.depositUnshielded(COLOR, AMOUNT);
      fwd.depositUnshielded(COLOR2, AMOUNT * 2n);
      expect(fwd.getReceived(COLOR)).toEqual(AMOUNT);
      expect(fwd.getReceived(COLOR2)).toEqual(AMOUNT * 2n);
    });
  });
});
