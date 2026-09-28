/**
 * Stateless properties of the note core's pure circuits.
 *
 * The functional suite states each claim at hand-picked points. This states the
 * same claims over generated inputs, so they hold where nobody chose, and a
 * failure shrinks to the smallest counterexample.
 *
 * Single calls only, no ledger, no deployment. Sequence claims live in
 * `ConfidentialNoteFungibleToken.invariant.test.ts`.
 *
 * Runs on either backend: pure circuits evaluate locally even on live, so nothing
 * here costs a block.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { pureCircuits as core } from '../../../artifacts/MockConfidentialNoteFungibleToken/contract/index.js';

// ---------------------------------------------------------------------------
// Generators, each pinned to the circuit's own type
// ---------------------------------------------------------------------------

/** The inclusive top of an unsigned 128-bit range. */
const UINT128_MAX = (1n << 128n) - 1n;

/** `Uint<128>`, the declared width of a note's value. */
const value = () => fc.bigInt({ min: 0n, max: UINT128_MAX });

/**
 * A note nonce is a `Field`. Generated at 128 bits, comfortably inside the
 * scalar field, so the runtime never rejects an out-of-range element and every
 * failure is about the circuit rather than the encoding.
 */
const nonce = () => fc.bigInt({ min: 0n, max: UINT128_MAX });

/** `Bytes<32>`, the declared width of a spend secret. */
const secret = () => fc.uint8Array({ minLength: 32, maxLength: 32 });

const note = () => fc.record({ value: value(), nonce: nonce() });

/** An owner pk, derived rather than generated, so it is a valid `Field`. */
const ownerPk = () => secret().map((sk) => core.derivePk(sk));

const hex = (bytes: Uint8Array): string =>
  `0x${Buffer.from(bytes).toString('hex')}`;

// ---------------------------------------------------------------------------
// nullifierOf
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleToken property: nullifierOf', () => {
  // The design decision behind escrow-free clawback, generalized: the preimage
  // is the nonce alone, so anyone who learns a nonce derives the nullifier.
  it('should ignore the value, for any two values sharing a nonce', () => {
    fc.assert(
      fc.property(nonce(), value(), value(), (n, a, b) => {
        expect(hex(core.nullifierOf({ value: a, nonce: n }))).toBe(
          hex(core.nullifierOf({ value: b, nonce: n })),
        );
      }),
    );
  });

  it('should differ whenever the nonce differs', () => {
    fc.assert(
      fc.property(value(), nonce(), nonce(), (v, n1, n2) => {
        fc.pre(n1 !== n2);
        expect(hex(core.nullifierOf({ value: v, nonce: n1 }))).not.toBe(
          hex(core.nullifierOf({ value: v, nonce: n2 })),
        );
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// derivePk
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleToken property: derivePk', () => {
  it('should be deterministic for any secret', () => {
    fc.assert(
      fc.property(secret(), (sk) => {
        expect(core.derivePk(sk)).toBe(core.derivePk(sk));
      }),
    );
  });

  it('should be injective across any two distinct secrets', () => {
    fc.assert(
      fc.property(secret(), secret(), (a, b) => {
        fc.pre(hex(a) !== hex(b));
        expect(core.derivePk(a)).not.toBe(core.derivePk(b));
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// commitOf
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleToken property: commitOf', () => {
  it('should bind the value: any two values commit differently', () => {
    fc.assert(
      fc.property(ownerPk(), nonce(), value(), value(), (pk, n, a, b) => {
        fc.pre(a !== b);
        expect(hex(core.commitOf({ value: a, nonce: n }, pk))).not.toBe(
          hex(core.commitOf({ value: b, nonce: n }, pk)),
        );
      }),
    );
  });

  it('should bind the nonce: any two nonces commit differently', () => {
    fc.assert(
      fc.property(ownerPk(), value(), nonce(), nonce(), (pk, v, n1, n2) => {
        fc.pre(n1 !== n2);
        expect(hex(core.commitOf({ value: v, nonce: n1 }, pk))).not.toBe(
          hex(core.commitOf({ value: v, nonce: n2 }, pk)),
        );
      }),
    );
  });

  // This is what makes ownership enforceable: a non-owner's pk yields a leaf
  // that is not in the tree, so no membership proof exists for it.
  it('should bind the owner: any two owners commit differently', () => {
    fc.assert(
      fc.property(note(), ownerPk(), ownerPk(), (n, pk1, pk2) => {
        fc.pre(pk1 !== pk2);
        expect(hex(core.commitOf(n, pk1))).not.toBe(hex(core.commitOf(n, pk2)));
      }),
    );
  });

  it('should never collide with the nullifier of the same note', () => {
    fc.assert(
      fc.property(note(), ownerPk(), (n, pk) => {
        expect(hex(core.commitOf(n, pk))).not.toBe(hex(core.nullifierOf(n)));
      }),
    );
  });
});
