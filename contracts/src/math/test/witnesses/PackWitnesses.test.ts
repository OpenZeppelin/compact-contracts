import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { describe, expect, test } from 'vitest';
import { bytesLEToBigint, toBytesLE } from '../utils/oracles.js';
import { PackPrivateState, PackWitnesses } from './PackWitnesses.js';

const context = (
  privateState: PackPrivateState,
): WitnessContext<unknown, PackPrivateState> =>
  ({ privateState }) as WitnessContext<unknown, PackPrivateState>;

const witnesses = PackWitnesses();

describe('PackWitnesses', () => {
  describe('wit_unpackBytes', () => {
    test('returns byte i of the input as element i', () => {
      const bytes = Uint8Array.from([0x01, 0x00, 0xff, 0x7f, 0x80]);
      const [, vec] = witnesses.wit_unpackBytes(
        context(PackPrivateState),
        bytes,
      );
      expect(vec).toEqual([0x01n, 0x00n, 0xffn, 0x7fn, 0x80n]);
    });

    test('returns the private state unchanged', () => {
      const state = Object.freeze({ ...PackPrivateState });
      const [next] = witnesses.wit_unpackBytes(
        context(state),
        new Uint8Array(8),
      );
      expect(next).toBe(state);
    });

    test('is deterministic', () => {
      const bytes = toBytesLE(0x0123456789abcdefn, 32);
      const first = witnesses.wit_unpackBytes(context(PackPrivateState), bytes);
      const second = witnesses.wit_unpackBytes(
        context(PackPrivateState),
        bytes,
      );
      expect(first).toEqual(second);
    });

    test('recomposes every single-byte value and every 16-bit value', () => {
      for (let value = 0n; value < 1n << 16n; value++) {
        const bytes = toBytesLE(value, 2);
        const [, vec] = witnesses.wit_unpackBytes(
          context(PackPrivateState),
          bytes,
        );
        expect(vec.every((digit) => digit >= 0n && digit <= 0xffn)).toBe(true);
        expect(bytesLEToBigint(Uint8Array.from(vec, Number))).toBe(value);
      }
    });
  });
});
