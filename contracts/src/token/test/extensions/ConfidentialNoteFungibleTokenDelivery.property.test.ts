/**
 * Stateless properties of the delivery extension.
 *
 * The unit suite states each claim at hand-picked points. This states the same
 * claims over generated inputs, so they hold where nobody chose, and a failure
 * shrinks to the smallest counterexample.
 *
 * Each run reads back only the deliveries it just made. Sequence claims live in
 * `ConfidentialNoteFungibleTokenDelivery.invariant.test.ts`.
 *
 * Runs on either backend. `recoverNote` is pure and evaluates locally even on
 * live, so its properties run 100 times anywhere. The `_deliver` properties
 * deploy the standalone mock, and every delivery is a transaction on live, so
 * they run twice there.
 */

import { ecMulGenerator } from '@midnight-ntwrk/compact-runtime';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import { pureCircuits as delivery } from '../../../../artifacts/MockConfidentialNoteFungibleTokenDelivery/contract/index.js';
import {
  ConfidentialNoteFungibleTokenDeliverySimulator,
  type Delivery,
} from '../simulators/ConfidentialNoteFungibleTokenDeliverySimulator.js';

// ---------------------------------------------------------------------------
// Generators, each pinned to the circuit's own type
// ---------------------------------------------------------------------------

const U128 = 1n << 128n;
const U248 = 1n << 248n;

// Jubjub prime-order subgroup order; valid secret scalars are [1, L-1].
const L =
  6554484396890773809930967563523245729705921265872317281365359162392183254199n;

/** `Uint<128>`, the declared width of a note's value. */
const value = () => fc.bigInt({ min: 0n, max: U128 - 1n });

/** A `Field` nonce in `[0, 2^248)`, the range `_deliver` accepts. */
const nonce = () => fc.bigInt({ min: 0n, max: U248 - 1n });

/** `Uint<248>`, the declared width of both pads. */
const pad = () => fc.bigInt({ min: 0n, max: U248 - 1n });

/** A `JubjubScalar` in `[1, L-1]`, so `g^ek` is never the identity. */
const scalar = () => fc.bigInt({ min: 1n, max: L - 1n });

/** Any `JubjubScalar`, zero included: the recipient side returns for every key. */
const anyScalar = () => fc.bigInt({ min: 0n, max: L - 1n });

/** `Bytes<32>`, the declared width of a slot and of the delivery seed. */
const bytes32 = () => fc.uint8Array({ minLength: 32, maxLength: 32 });

/** Any entry `_deliver` could write, and more: any non-identity `E`, any pads. */
const anyEntry = (): fc.Arbitrary<Delivery> =>
  fc.record({
    ephemeralPk: scalar().map((e) => ecMulGenerator(e)),
    valueCt: pad(),
    nonceCt: pad(),
  });

const hex = (bytes: Uint8Array): string =>
  `0x${Buffer.from(bytes).toString('hex')}`;

const PROPERTY_RUNS = isLiveBackend() ? 2 : 25;

let token: ConfidentialNoteFungibleTokenDeliverySimulator;

/** The feed, newest first. */
const entries = async (): Promise<Delivery[]> => [
  ...(await token.getPublicState()).Delivery__deliveries,
];

// ---------------------------------------------------------------------------
// recoverNote
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenDelivery property: recoverNote', () => {
  it('should be deterministic for any entry and scalar', () => {
    fc.assert(
      fc.property(anyEntry(), anyScalar(), (entry, ek) => {
        expect(delivery.recoverNote(entry, ek)).toStrictEqual(
          delivery.recoverNote(entry, ek),
        );
      }),
    );
  });

  it('should return a pair below 2^248 for any entry and scalar, without asserting', () => {
    fc.assert(
      fc.property(anyEntry(), anyScalar(), (entry, ek) => {
        const pair = delivery.recoverNote(entry, ek);

        expect(pair.value).toBeLessThan(U248);
        expect(pair.nonce).toBeLessThan(U248);
      }),
    );
  });

  it('should not open an identity ephemeral under any scalar, whatever the pads', () => {
    fc.assert(
      fc.property(pad(), pad(), anyScalar(), (valueCt, nonceCt, ek) => {
        const placeholder = {
          ephemeralPk: ecMulGenerator(0n),
          valueCt,
          nonceCt,
        };

        expect(() => delivery.recoverNote(placeholder, ek)).toThrow(
          'ConfidentialNoteFungibleTokenDelivery: identity ephemeral',
        );
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// _deliver
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenDelivery property: _deliver', () => {
  beforeEach(async () => {
    token = await ConfidentialNoteFungibleTokenDeliverySimulator.create();
  });

  it('should open any note in range under the owner scalar, for any scalar and slot', async () => {
    await fc.assert(
      fc.asyncProperty(
        scalar(),
        value(),
        nonce(),
        bytes32(),
        async (ek, v, n, slot) => {
          await token._deliver(ecMulGenerator(ek), v, n, slot);
          const [newest] = await entries();

          expect(newest.valueCt).toBeLessThan(U248);
          expect(newest.nonceCt).toBeLessThan(U248);
          expect(delivery.recoverNote(newest, ek)).toStrictEqual({
            value: v,
            nonce: n,
          });
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('should return a pair the wallet filter drops under any other scalar', async () => {
    await fc.assert(
      fc.asyncProperty(
        scalar(),
        scalar(),
        value(),
        nonce(),
        bytes32(),
        async (ek, other, v, n, slot) => {
          fc.pre(ek !== other);
          await token._deliver(ecMulGenerator(ek), v, n, slot);
          const [newest] = await entries();
          const wrong = delivery.recoverNote(newest, other);

          expect(wrong.value).toBeGreaterThanOrEqual(U128);
          expect(wrong.nonce).not.toBe(n);
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Pads under a reused seed
// ---------------------------------------------------------------------------

/**
 * The ephemeral is `Hf(seed, tag, slot, nonce, encPk)`, so with the seed
 * planted the nonce, the slot and the key are the inputs left to separate two
 * entries. Each run repeats its first delivery to show the seed held.
 */
describe('ConfidentialNoteFungibleTokenDelivery property: pads under a reused seed', () => {
  beforeEach(async () => {
    token = await ConfidentialNoteFungibleTokenDeliverySimulator.create();
  });

  it('should move the ephemeral for any two distinct nonces under one seed, key and slot', async () => {
    await fc.assert(
      fc.asyncProperty(
        bytes32(),
        scalar(),
        bytes32(),
        value(),
        nonce(),
        nonce(),
        async (seed, ek, slot, v, n1, n2) => {
          fc.pre(n1 !== n2);
          token.wallet.deliverySeed = seed;
          await token._deliver(ecMulGenerator(ek), v, n1, slot);
          await token._deliver(ecMulGenerator(ek), v, n2, slot);
          await token._deliver(ecMulGenerator(ek), v, n1, slot);
          const [repeat, second, first] = await entries();

          expect(repeat).toStrictEqual(first);
          expect(second.ephemeralPk).not.toStrictEqual(first.ephemeralPk);
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('should move the ephemeral for any two distinct slots under one seed, key and nonce', async () => {
    await fc.assert(
      fc.asyncProperty(
        bytes32(),
        scalar(),
        value(),
        nonce(),
        bytes32(),
        bytes32(),
        async (seed, ek, v, n, slot1, slot2) => {
          fc.pre(hex(slot1) !== hex(slot2));
          token.wallet.deliverySeed = seed;
          await token._deliver(ecMulGenerator(ek), v, n, slot1);
          await token._deliver(ecMulGenerator(ek), v, n, slot2);
          await token._deliver(ecMulGenerator(ek), v, n, slot1);
          const [repeat, second, first] = await entries();

          expect(repeat).toStrictEqual(first);
          expect(second.ephemeralPk).not.toStrictEqual(first.ephemeralPk);
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('should move the ephemeral for any two distinct keys under one seed, slot and nonce', async () => {
    await fc.assert(
      fc.asyncProperty(
        bytes32(),
        bytes32(),
        value(),
        nonce(),
        scalar(),
        scalar(),
        async (seed, slot, v, n, first, second) => {
          fc.pre(first !== second);
          token.wallet.deliverySeed = seed;
          await token._deliver(ecMulGenerator(first), v, n, slot);
          await token._deliver(ecMulGenerator(second), v, n, slot);
          await token._deliver(ecMulGenerator(first), v, n, slot);
          const [repeat, other, mine] = await entries();

          expect(repeat).toStrictEqual(mine);
          expect(other.ephemeralPk).not.toStrictEqual(mine.ephemeralPk);
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });
});
