/**
 * Properties of the ConfidentialNoteFungibleTokenUtils module over generated
 * notes and owner keys.
 *
 * The unit and compatibility suites state each claim at fixed points. This
 * states them where nobody chose: each wrapper equals its flat reference, each
 * of value, nonce and key alone moves the commitment, and the nullifier and the
 * issued tag follow the nonce alone and never coincide.
 *
 * Runs on either backend. Every wrapper is an impure circuit on
 * `MockConfidentialNoteFungibleTokenUtils`, so each call is a transaction on
 * live, and the properties run twice there.
 */

import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type Account,
  ConfidentialNoteFungibleTokenUtilsSimulator,
  type Note,
} from './simulators/ConfidentialNoteFungibleTokenUtilsSimulator.js';

// ---------------------------------------------------------------------------
// Generators, each pinned to the circuit's own type
// ---------------------------------------------------------------------------

// Compact `Field` modulus (BLS12-381 scalar field).
const P =
  52435875175126190479447740508185965837690552500527637822603658699938581184513n;

/** A `Uint<128>` note value. */
const uint128 = () => fc.bigInt({ min: 0n, max: (1n << 128n) - 1n });

/** A `Field` nonce or key in `[0, P - 1]`. */
const field = () => fc.bigInt({ min: 0n, max: P - 1n });

const bytes32 = () => fc.uint8Array({ minLength: 32, maxLength: 32 });

const note = (): fc.Arbitrary<Note> =>
  fc.record({ value: uint128(), nonce: field() });

/** An `Either<Bytes<32>, ContractAddress>` with every field drawn. */
const account = (): fc.Arbitrary<Account> =>
  fc.record({
    is_left: fc.boolean(),
    left: bytes32(),
    right: fc.record({ bytes: bytes32() }),
  });

/** Which one of the three commitment inputs a separation property moves. */
const component = () => fc.constantFrom('value', 'nonce', 'key');

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const accountKey = (pk: Account): string =>
  `${pk.is_left}:${hex(pk.left)}:${hex(pk.right.bytes)}`;

const PROPERTY_RUNS = isLiveBackend() ? 2 : 100;

let utils: ConfidentialNoteFungibleTokenUtilsSimulator;

beforeAll(async () => {
  utils = await ConfidentialNoteFungibleTokenUtilsSimulator.create();
});

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenUtils property: layout', () => {
  it('should match the references at a Field key for any note and key', async () => {
    await fc.assert(
      fc.asyncProperty(note(), field(), async (n, pk) => {
        const digest = await utils.commitOfField(n, pk);

        expect(digest).toStrictEqual(await utils.refCommitOfField(n, pk));
        expect(digest).toStrictEqual(await utils.refCommitOfFieldBytes(n, pk));
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('should match the reference at an Either key for any note and key', async () => {
    await fc.assert(
      fc.asyncProperty(note(), account(), async (n, pk) => {
        expect(await utils.commitOfEither(n, pk)).toStrictEqual(
          await utils.refCommitOfEither(n, pk),
        );
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('should match the references for the nullifier and the tag of any note', async () => {
    await fc.assert(
      fc.asyncProperty(note(), async (n) => {
        expect(await utils.nullifierOf(n)).toStrictEqual(
          await utils.refNullifierOf(n),
        );
        expect(await utils.issuedTagOf(n)).toStrictEqual(
          await utils.refIssuedTagOf(n),
        );
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Separation
// ---------------------------------------------------------------------------

/**
 * Each run draws two values for one input and holds the other two fixed, so a
 * failure names the input that did not separate.
 */
describe('ConfidentialNoteFungibleTokenUtils property: separation', () => {
  it('should move the commitment at a Field key when any one input changes', async () => {
    await fc.assert(
      fc.asyncProperty(
        component(),
        note(),
        field(),
        uint128(),
        field(),
        async (moved, n, pk, otherValue, otherField) => {
          fc.pre(
            moved === 'value'
              ? otherValue !== n.value
              : otherField !== (moved === 'nonce' ? n.nonce : pk),
          );
          const next: Note = {
            value: moved === 'value' ? otherValue : n.value,
            nonce: moved === 'nonce' ? otherField : n.nonce,
          };
          const nextPk = moved === 'key' ? otherField : pk;

          expect(hex(await utils.commitOfField(n, pk))).not.toBe(
            hex(await utils.commitOfField(next, nextPk)),
          );
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('should move the commitment at an Either key when any one input changes', async () => {
    await fc.assert(
      fc.asyncProperty(
        component(),
        note(),
        account(),
        uint128(),
        field(),
        account(),
        async (moved, n, pk, otherValue, otherNonce, otherPk) => {
          fc.pre(
            moved === 'value'
              ? otherValue !== n.value
              : moved === 'nonce'
                ? otherNonce !== n.nonce
                : accountKey(otherPk) !== accountKey(pk),
          );
          const next: Note = {
            value: moved === 'value' ? otherValue : n.value,
            nonce: moved === 'nonce' ? otherNonce : n.nonce,
          };
          const nextPk = moved === 'key' ? otherPk : pk;

          expect(hex(await utils.commitOfEither(n, pk))).not.toBe(
            hex(await utils.commitOfEither(next, nextPk)),
          );
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('should move the nullifier and the tag with the nonce', async () => {
    await fc.assert(
      fc.asyncProperty(note(), field(), async (n, otherNonce) => {
        fc.pre(otherNonce !== n.nonce);
        const next: Note = { value: n.value, nonce: otherNonce };

        expect(hex(await utils.nullifierOf(n))).not.toBe(
          hex(await utils.nullifierOf(next)),
        );
        expect(hex(await utils.issuedTagOf(n))).not.toBe(
          hex(await utils.issuedTagOf(next)),
        );
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('should keep the nullifier and the tag when only the value changes', async () => {
    await fc.assert(
      fc.asyncProperty(note(), uint128(), async (n, otherValue) => {
        const next: Note = { value: otherValue, nonce: n.nonce };

        expect(await utils.nullifierOf(next)).toStrictEqual(
          await utils.nullifierOf(n),
        );
        expect(await utils.issuedTagOf(next)).toStrictEqual(
          await utils.issuedTagOf(n),
        );
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('should give any note distinct nullifier and issued tag', async () => {
    await fc.assert(
      fc.asyncProperty(note(), async (n) => {
        expect(hex(await utils.nullifierOf(n))).not.toBe(
          hex(await utils.issuedTagOf(n)),
        );
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });
});
