/**
 * Properties of the RandBlinding module over generated blinding factors.
 *
 * The unit suite states each claim at fixed points. This states them where
 * nobody chose: `read` returns the witness value for any non-zero 32 bytes,
 * and the zero check covers every byte of the value.
 *
 * Runs on either backend. `read` is an impure circuit on its mock, so each
 * call is a transaction on live, and the properties run twice there.
 */

import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { RandBlindingSimulator } from './simulators/RandBlindingSimulator.js';

// ---------------------------------------------------------------------------
// Generators, each pinned to the circuit's own type
// ---------------------------------------------------------------------------

/** `Bytes<32>` with at least one non-zero byte: a blinding factor `read` accepts. */
const nonZeroBytes32 = () =>
  fc
    .uint8Array({ minLength: 32, maxLength: 32 })
    .filter((bytes) => bytes.some((byte) => byte !== 0));

const PROPERTY_RUNS = isLiveBackend() ? 2 : 100;

/** Byte positions the one-hot sweep visits. Each `read` is a transaction on live. */
const POSITIONS = isLiveBackend()
  ? [0, 31]
  : Array.from({ length: 32 }, (_, index) => index);

let rand: RandBlindingSimulator;

beforeAll(async () => {
  rand = await RandBlindingSimulator.create();
});

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

describe('RandBlinding property: identity', () => {
  it('should return the witness value for any non-zero 32 bytes', async () => {
    await fc.assert(
      fc.asyncProperty(nonZeroBytes32(), async (blinding) => {
        await rand.updatePrivateState({ blinding });

        expect(await rand.read()).toEqual(blinding);
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Zero check
// ---------------------------------------------------------------------------

describe('RandBlinding property: zero check', () => {
  // A check that covered only part of the value would reject one of these.
  it('should accept a single non-zero byte at every position', async () => {
    for (const position of POSITIONS) {
      const blinding = new Uint8Array(32);
      blinding[position] = 0x01;
      await rand.updatePrivateState({ blinding });

      expect(await rand.read()).toEqual(blinding);
    }
  });
});
