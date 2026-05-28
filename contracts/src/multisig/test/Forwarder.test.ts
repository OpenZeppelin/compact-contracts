import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as utils from '#test-utils/address.js';
import { MockForwarderSimulator } from './simulators/MockForwarderSimulator.js';

const PARENT = utils.createEitherTestUser('PARENT').left.bytes;
const ZERO = new Uint8Array(32);
const COLOR = new Uint8Array(32).fill(1);
const COLOR2 = new Uint8Array(32).fill(2);
const AMOUNT = 1000n;
const MAX_U32 = (1n << 32n) - 1n;
const MAX_U64 = (1n << 64n) - 1n;
const MAX_U128 = (1n << 128n) - 1n;

function makeCoin(color: Uint8Array, value: bigint, nonce?: Uint8Array) {
  return {
    nonce: nonce ?? new Uint8Array(32).fill(0),
    color,
    value,
  };
}

describe('Forwarder module', () => {
  describe('initialization', () => {
    it('should initialize on construction when isInit is true', () => {
      const mock = new MockForwarderSimulator(PARENT, true);
      expect(mock.getReceived(COLOR)).toEqual(0n);
    });

    it('should fail initialization with zero parent', () => {
      expect(() => new MockForwarderSimulator(ZERO, true)).toThrow(
        'Forwarder: zero parent',
      );
    });

    it('should fail when initialized twice', () => {
      const mock = new MockForwarderSimulator(PARENT, true);
      expect(() => mock.initialize(PARENT)).toThrow(
        'Initializable: contract already initialized',
      );
    });

    it('should allow late initialize when isInit is false', () => {
      const mock = new MockForwarderSimulator(PARENT, false);
      expect(() => mock.initialize(PARENT)).not.toThrow();
      expect(mock.getReceived(COLOR)).toEqual(0n);
    });

    it('should expose the public ledger state after initialization', () => {
      const mock = new MockForwarderSimulator(PARENT, true);
      expect(mock.getPublicState()).toBeDefined();
    });
  });

  describe('init guard', () => {
    let mock: MockForwarderSimulator;

    beforeEach(() => {
      mock = new MockForwarderSimulator(PARENT, false);
    });

    it('should fail depositShielded when not initialized', () => {
      expect(() => mock.depositShielded(makeCoin(COLOR, AMOUNT))).toThrow(
        'Initializable: contract not initialized',
      );
    });

    it('should fail depositUnshielded when not initialized', () => {
      expect(() => mock.depositUnshielded(COLOR, AMOUNT)).toThrow(
        'Initializable: contract not initialized',
      );
    });

    it('should fail getReceived when not initialized', () => {
      expect(() => mock.getReceived(COLOR)).toThrow(
        'Initializable: contract not initialized',
      );
    });
  });

  describe('_recordReceived via depositShielded', () => {
    let mock: MockForwarderSimulator;

    beforeEach(() => {
      mock = new MockForwarderSimulator(PARENT, true);
    });

    it('should accumulate _received[color] on a single shielded deposit', () => {
      mock.depositShielded(makeCoin(COLOR, AMOUNT));
      expect(mock.getReceived(COLOR)).toEqual(AMOUNT);
    });

    it('should track received per color independently for shielded deposits', () => {
      mock.depositShielded(makeCoin(COLOR, AMOUNT));
      mock.depositShielded(makeCoin(COLOR2, AMOUNT * 2n));
      expect(mock.getReceived(COLOR)).toEqual(AMOUNT);
      expect(mock.getReceived(COLOR2)).toEqual(AMOUNT * 2n);
    });

    it('should accumulate sequential shielded deposits to the same color', () => {
      mock.depositShielded(makeCoin(COLOR, AMOUNT, new Uint8Array(32).fill(1)));
      mock.depositShielded(makeCoin(COLOR, AMOUNT, new Uint8Array(32).fill(2)));
      mock.depositShielded(makeCoin(COLOR, AMOUNT, new Uint8Array(32).fill(3)));
      expect(mock.getReceived(COLOR)).toEqual(AMOUNT * 3n);
    });

    // The `_recordReceived` overflow assert targets `Uint<128>`. Zswap
    // bounds `ShieldedCoinInfo.value` at `Uint<64>`, so the `Uint<128>`
    // ceiling cannot be reached by shielded deposits in finite test
    // runs. The unshielded path (Uint<128> amounts) exercises the assert
    // directly below.
    it('should reject shielded deposit when coin.value exceeds Uint<64>', () => {
      expect(() =>
        mock.depositShielded(makeCoin(COLOR, MAX_U128)),
      ).toThrow();
    });

    it('should accept shielded deposit at the Uint<64> ceiling', () => {
      mock.depositShielded(makeCoin(COLOR, MAX_U64));
      expect(mock.getReceived(COLOR)).toEqual(MAX_U64);
    });
  });

  describe('_recordReceived via depositUnshielded', () => {
    let mock: MockForwarderSimulator;

    beforeEach(() => {
      mock = new MockForwarderSimulator(PARENT, true);
    });

    it('should accumulate _received[color] on a single unshielded deposit', () => {
      mock.depositUnshielded(COLOR, AMOUNT);
      expect(mock.getReceived(COLOR)).toEqual(AMOUNT);
    });

    it('should track received per color independently for unshielded deposits', () => {
      mock.depositUnshielded(COLOR, AMOUNT);
      mock.depositUnshielded(COLOR2, AMOUNT * 2n);
      expect(mock.getReceived(COLOR)).toEqual(AMOUNT);
      expect(mock.getReceived(COLOR2)).toEqual(AMOUNT * 2n);
    });

    it('should fail depositUnshielded with "Forwarder: received overflow" at MAX', () => {
      mock.depositUnshielded(COLOR, MAX_U128);
      expect(() => mock.depositUnshielded(COLOR, 1n)).toThrow(
        'Forwarder: received overflow',
      );
    });
  });

  describe('property: accumulation', () => {
    it(
      'should accumulate _received as the sum of shielded deposits',
      { timeout: 30_000 },
      () => {
        fc.assert(
          fc.property(
            fc.array(fc.bigInt({ min: 0n, max: MAX_U32 }), {
              minLength: 1,
              maxLength: 4,
            }),
            (values) => {
              const mock = new MockForwarderSimulator(PARENT, true);
              let i = 0;
              for (const v of values) {
                mock.depositShielded(
                  makeCoin(COLOR, v, new Uint8Array(32).fill(i++)),
                );
              }
              const expected = values.reduce((acc, v) => acc + v, 0n);
              expect(mock.getReceived(COLOR)).toEqual(expected);
            },
          ),
          { numRuns: 20 },
        );
      },
    );
  });
});
