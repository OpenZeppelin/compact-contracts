/**
 * Properties of the Identifier module over generated accounts.
 *
 * The unit suite states each claim at fixed points. This states them where
 * nobody chose: `is_left` alone decides whether the accessor answers, and
 * the answer is the `left` arm whatever the other arm holds.
 *
 * Runs on either backend. Every wrapper is an impure circuit on
 * `MockIdentifier`, so each call is a transaction on live, and the properties
 * run twice there.
 */

import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { IdentifierSimulator } from './simulators/IdentifierSimulator.js';

// ---------------------------------------------------------------------------
// Generators, each pinned to the circuit's own type
// ---------------------------------------------------------------------------

/** `Bytes<32>`: a key, a contract address, or an unused arm. */
const bytes32 = () => fc.uint8Array({ minLength: 32, maxLength: 32 });

/**
 * Both arms of an `Either<Bytes<32>, ContractAddress>`. Each property sets
 * `is_left`, so the inactive arm holds arbitrary bytes.
 */
const arms = () =>
  fc.record({ left: bytes32(), right: fc.record({ bytes: bytes32() }) });

const PROPERTY_RUNS = isLiveBackend() ? 2 : 100;

let sim: IdentifierSimulator;

beforeAll(async () => {
  sim = await IdentifierSimulator.create();
});

// ---------------------------------------------------------------------------
// Accessor
// ---------------------------------------------------------------------------

describe('Identifier property: accessor', () => {
  it('should return the key arm of any key identifier', async () => {
    await fc.assert(
      fc.asyncProperty(arms(), async (a) => {
        const key = { is_left: true, ...a };

        expect(await sim.publicKeyOf(key)).toStrictEqual(a.left);
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('should reject any contract identifier on publicKeyOf', async () => {
    await fc.assert(
      fc.asyncProperty(arms(), async (a) => {
        const contract = { is_left: false, ...a };

        await expect(sim.publicKeyOf(contract)).rejects.toThrow(
          'Identifier: contract identifier',
        );
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });
});
