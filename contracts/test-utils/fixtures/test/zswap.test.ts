import { describe, expect, it } from 'vitest';
import {
  bytesToHex,
  isNonceSpent,
  type ZswapInput,
  type ZswapLocalState,
  type ZswapOutput,
  zswapDelta,
  zswapLocalState,
  zswapSnapshot,
} from '../zswap.js';

/**
 * The Zswap-introspection fixtures. `bytesToHex` and `isNonceSpent` are pure;
 * `zswapLocalState` / `zswapSnapshot` / `zswapDelta` read the accumulated
 * `currentZswapLocalState` off a dry simulator, which is reproduced here with a
 * plain object shaped like the backend the helpers dig into.
 */

/** A minimal coin body for building inputs/outputs. */
const coin = (nonceByte: number, value = 1000n) => ({
  nonce: new Uint8Array(32).fill(nonceByte),
  color: new Uint8Array(32).fill(1),
  value,
});

const input = (nonceByte: number, mt_index = 0n): ZswapInput => ({
  ...coin(nonceByte),
  mt_index,
});

const output = (nonceByte: number): ZswapOutput => ({
  coinInfo: coin(nonceByte),
  recipient: {
    is_left: true,
    left: { bytes: new Uint8Array(32) },
    right: { bytes: new Uint8Array(32) },
  },
});

/** Wraps a local state in the nested shape `zswapLocalState` reads from. */
const mockSim = (state: ZswapLocalState) => ({
  _backend: { sim: { circuitContext: { currentZswapLocalState: state } } },
});

describe('zswap fixtures', () => {
  describe('bytesToHex', () => {
    it('should hex-encode a byte string', () => {
      expect(bytesToHex(Uint8Array.from([0xde, 0xad, 0xbe, 0xef]))).toBe(
        'deadbeef',
      );
    });

    it('should encode an empty array as an empty string', () => {
      expect(bytesToHex(new Uint8Array(0))).toBe('');
    });
  });

  describe('zswapLocalState', () => {
    it('should read the accumulated local state off the simulator', () => {
      const state: ZswapLocalState = {
        inputs: [input(7)],
        outputs: [output(8)],
      };
      expect(zswapLocalState(mockSim(state))).toBe(state);
    });

    it('should throw when the simulator does not expose the local state', () => {
      expect(() => zswapLocalState({})).toThrow(
        'Could not read currentZswapLocalState',
      );
    });
  });

  describe('zswapSnapshot', () => {
    it('should capture the current input and output counts', () => {
      const state: ZswapLocalState = {
        inputs: [input(1), input(2)],
        outputs: [output(3)],
      };
      expect(zswapSnapshot(mockSim(state))).toStrictEqual({
        inputs: 2,
        outputs: 1,
      });
    });
  });

  describe('zswapDelta', () => {
    it('should return only the entries appended since the snapshot', () => {
      const kept = input(1);
      const spentSince = input(2);
      const madeSince = output(3);
      const state: ZswapLocalState = {
        inputs: [kept, spentSince],
        outputs: [madeSince],
      };
      expect(
        zswapDelta(mockSim(state), { inputs: 1, outputs: 0 }),
      ).toStrictEqual({ inputs: [spentSince], outputs: [madeSince] });
    });

    it('should return empty deltas when nothing was appended', () => {
      const state: ZswapLocalState = {
        inputs: [input(1)],
        outputs: [output(2)],
      };
      expect(
        zswapDelta(mockSim(state), { inputs: 1, outputs: 1 }),
      ).toStrictEqual({ inputs: [], outputs: [] });
    });
  });

  describe('isNonceSpent', () => {
    const nonce7 = new Uint8Array(32).fill(7);

    it('should be true when a coin with the nonce was spent', () => {
      expect(isNonceSpent([input(1), input(7)], nonce7)).toBe(true);
    });

    it('should match by value, not by array identity', () => {
      // A fresh array with the same bytes must still count as spent.
      expect(isNonceSpent([input(7)], new Uint8Array(32).fill(7))).toBe(true);
    });

    it('should be false when no input carries the nonce', () => {
      expect(isNonceSpent([input(1), input(2)], nonce7)).toBe(false);
    });

    it('should be false for an empty input set', () => {
      expect(isNonceSpent([], nonce7)).toBe(false);
    });
  });
});
