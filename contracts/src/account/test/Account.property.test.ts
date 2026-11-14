/**
 * Properties of the Account module over generated accounts.
 *
 * The unit suite states each claim at fixed points. This states them where
 * nobody chose: `is_left` alone picks the accessor that answers, and the
 * answer is the active arm whatever the other arm holds.
 *
 * Runs on either backend. Every wrapper is an impure circuit on `MockAccount`,
 * so each call is a transaction on live, and the properties run twice there.
 */

import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { AccountSimulator } from './simulators/AccountSimulator.js';

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

let sim: AccountSimulator;

beforeAll(async () => {
  sim = await AccountSimulator.create();
});

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

describe('Account property: accessors', () => {
  it('should return the key arm of any key account', async () => {
    await fc.assert(
      fc.asyncProperty(arms(), async (a) => {
        const key = { is_left: true, ...a };

        expect(await sim.publicKeyOf(key)).toStrictEqual(a.left);
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('should return the address arm of any contract account', async () => {
    await fc.assert(
      fc.asyncProperty(arms(), async (a) => {
        const contract = { is_left: false, ...a };

        expect(await sim.contractAddressOf(contract)).toStrictEqual(a.right);
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('should reject any contract account on publicKeyOf', async () => {
    await fc.assert(
      fc.asyncProperty(arms(), async (a) => {
        const contract = { is_left: false, ...a };

        await expect(sim.publicKeyOf(contract)).rejects.toThrow(
          'Account: contract account',
        );
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('should reject any key account on contractAddressOf', async () => {
    await fc.assert(
      fc.asyncProperty(arms(), async (a) => {
        const key = { is_left: true, ...a };

        await expect(sim.contractAddressOf(key)).rejects.toThrow(
          'Account: not a contract account',
        );
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });
});
