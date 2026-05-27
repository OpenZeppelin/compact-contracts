import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as utils from '#test-utils/address.js';
import { ForwarderShieldedSimulator } from './simulators/ForwarderShieldedSimulator.js';

const PARENT = utils.createEitherTestUser('PARENT').left.bytes;
const ALT_PARENT = utils.createEitherTestUser('ALT').left.bytes;
const COLOR = new Uint8Array(32).fill(1);
const COLOR2 = new Uint8Array(32).fill(2);
const AMOUNT = 1000n;
const MAX_U32 = (1n << 32n) - 1n;

function makeCoin(color: Uint8Array, value: bigint, nonce?: Uint8Array) {
  return {
    nonce: nonce ?? new Uint8Array(32).fill(0),
    color,
    value,
  };
}

let fwd: ForwarderShieldedSimulator;

describe('ForwarderShielded', () => {
  describe('constructor', () => {
    it('should store and expose the parent at deploy', () => {
      fwd = new ForwarderShieldedSimulator(PARENT);
      expect(fwd.getParent()).toEqual(PARENT);
    });

    it('should return 0 received for unknown color', () => {
      fwd = new ForwarderShieldedSimulator(PARENT);
      expect(fwd.getReceived(COLOR)).toEqual(0n);
    });
  });

  describe('deposit', () => {
    beforeEach(() => {
      fwd = new ForwarderShieldedSimulator(PARENT);
    });

    it('should accumulate _received[color] on deposit', () => {
      fwd.deposit(makeCoin(COLOR, AMOUNT));
      expect(fwd.getReceived(COLOR)).toEqual(AMOUNT);
    });

    it('should track received per color independently', () => {
      fwd.deposit(makeCoin(COLOR, AMOUNT));
      fwd.deposit(makeCoin(COLOR2, AMOUNT * 2n));
      expect(fwd.getReceived(COLOR)).toEqual(AMOUNT);
      expect(fwd.getReceived(COLOR2)).toEqual(AMOUNT * 2n);
    });

    it('should accumulate sequential deposits to the same color', () => {
      fwd.deposit(makeCoin(COLOR, AMOUNT, new Uint8Array(32).fill(1)));
      fwd.deposit(makeCoin(COLOR, AMOUNT, new Uint8Array(32).fill(2)));
      fwd.deposit(makeCoin(COLOR, AMOUNT, new Uint8Array(32).fill(3)));
      expect(fwd.getReceived(COLOR)).toEqual(AMOUNT * 3n);
    });

    it('should forward the deposited color without substitution', () => {
      fwd.deposit(makeCoin(COLOR, AMOUNT));
      expect(fwd.getReceived(COLOR)).toEqual(AMOUNT);
      expect(fwd.getReceived(COLOR2)).toEqual(0n);
    });

    it('should not modify _parent after multiple deposits', () => {
      for (let i = 0; i < 5; i++) {
        fwd.deposit(makeCoin(COLOR, AMOUNT, new Uint8Array(32).fill(i)));
      }
      expect(fwd.getParent()).toEqual(PARENT);
    });
  });

  describe('privacy / disclosure', () => {
    it('should expose distinct parents for distinct deployments', () => {
      const fwd1 = new ForwarderShieldedSimulator(PARENT);
      const fwd2 = new ForwarderShieldedSimulator(ALT_PARENT);
      expect(fwd1.getParent()).toEqual(PARENT);
      expect(fwd2.getParent()).toEqual(ALT_PARENT);
      expect(fwd1.getParent()).not.toEqual(fwd2.getParent());
    });
  });

  describe('property: accumulation', () => {
    it(
      'should accumulate _received as the sum of deposited values',
      { timeout: 30_000 },
      () => {
        fc.assert(
          fc.property(
            fc.array(
              fc.bigInt({ min: 0n, max: MAX_U32 }),
              { minLength: 1, maxLength: 4 },
            ),
            (values) => {
              const sim = new ForwarderShieldedSimulator(PARENT);
              let i = 0;
              for (const v of values) {
                sim.deposit(makeCoin(COLOR, v, new Uint8Array(32).fill(i++)));
              }
              const expected = values.reduce((acc, v) => acc + v, 0n);
              expect(sim.getReceived(COLOR)).toEqual(expected);
            },
          ),
          { numRuns: 20 },
        );
      },
    );
  });
});
