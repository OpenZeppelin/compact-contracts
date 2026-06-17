import { describe, expect, it } from 'vitest';
import {
  type Ciphertext,
  ElGamalSimulator,
} from './simulators/ElGamalSimulator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Deterministic 32-byte value seeded from a label, so every test input is
 * reproducible. Mirrors the `createTestSK` helper used in the token tests.
 */
const b32 = (label: string): Uint8Array => {
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode(label).slice(0, 32));
  return out;
};

// Distinct secrets for two independent identities.
const EK_A = b32('elgamal-ek-A');
const EK_B = b32('elgamal-ek-B');

// Explicit encryption randomness. Any value below the Jubjub scalar field
// order (~2^252) is a valid scalar; these small constants keep the tests
// deterministic and let us assert that distinct randomness yields distinct
// ciphertexts. `expandRandomness` is exercised separately.
const R1 = 111n;
const R2 = 222n;
const R3 = 333n;

let contract: ElGamalSimulator;

describe('ElGamal', () => {
  contract = new ElGamalSimulator();

  const pkA = contract.derivePk(EK_A);
  const pkB = contract.derivePk(EK_B);

  // -------------------------------------------------------------------------
  // secretToScalar
  // -------------------------------------------------------------------------
  describe('secretToScalar', () => {
    it('is deterministic for the same secret', () => {
      expect(contract.secretToScalar(EK_A)).toBe(contract.secretToScalar(EK_A));
    });

    it('maps distinct secrets to distinct scalars', () => {
      expect(contract.secretToScalar(EK_A)).not.toBe(
        contract.secretToScalar(EK_B),
      );
    });

    it('returns a positive scalar', () => {
      expect(contract.secretToScalar(EK_A)).toBeGreaterThan(0n);
    });
  });

  // -------------------------------------------------------------------------
  // derivePk
  // -------------------------------------------------------------------------
  describe('derivePk', () => {
    it('is deterministic for the same secret', () => {
      expect(contract.derivePk(EK_A)).toEqual(contract.derivePk(EK_A));
    });

    it('maps distinct secrets to distinct public keys', () => {
      expect(contract.derivePk(EK_A)).not.toEqual(contract.derivePk(EK_B));
    });
  });

  // -------------------------------------------------------------------------
  // expandRandomness
  //
  // The anti-reuse guarantee: a single witness seed must yield independent
  // randomness per tag, and the wallet cannot collapse them.
  // -------------------------------------------------------------------------
  describe('expandRandomness', () => {
    const seed = b32('seed-0');
    const otherSeed = b32('seed-1');
    const tagX = b32('tag-x');
    const tagY = b32('tag-y');

    it('is deterministic for the same (seed, tag)', () => {
      expect(contract.expandRandomness(seed, tagX)).toBe(
        contract.expandRandomness(seed, tagX),
      );
    });

    it('produces distinct outputs for distinct tags under the same seed', () => {
      expect(contract.expandRandomness(seed, tagX)).not.toBe(
        contract.expandRandomness(seed, tagY),
      );
    });

    it('produces distinct outputs for distinct seeds under the same tag', () => {
      expect(contract.expandRandomness(seed, tagX)).not.toBe(
        contract.expandRandomness(otherSeed, tagX),
      );
    });
  });

  // -------------------------------------------------------------------------
  // encrypt + assertDecryptsTo (correctness of the core scheme)
  //
  // `assertDecryptsTo` is the decryption oracle for these tests: it succeeds
  // if `ct` decrypts under `(pk, ek)` to the claimed value.
  // -------------------------------------------------------------------------
  describe('encrypt / decryption round-trip', () => {
    it('decrypts to the encrypted value', () => {
      const ct = contract.encrypt(pkA, 100n, R1);
      expect(() =>
        contract.assertDecryptsTo(ct, pkA, EK_A, 100n),
      ).not.toThrow();
    });

    it('round-trips the zero value', () => {
      const ct = contract.encrypt(pkA, 0n, R1);
      expect(() => contract.assertDecryptsTo(ct, pkA, EK_A, 0n)).not.toThrow();
    });

    it('rejects a wrong claimed plaintext', () => {
      const ct = contract.encrypt(pkA, 100n, R1);
      expect(() => contract.assertDecryptsTo(ct, pkA, EK_A, 101n)).toThrow(
        'ElGamal: plaintext mismatch',
      );
    });

    it('rejects an ek that does not match the public key', () => {
      const ct = contract.encrypt(pkA, 100n, R1);
      // EK_B derives pkB, not pkA, so the key-binding check fails first.
      expect(() => contract.assertDecryptsTo(ct, pkA, EK_B, 100n)).toThrow(
        'ElGamal: ek/pk mismatch',
      );
    });

    it('rejects a public key the ek does not correspond to', () => {
      const ct = contract.encrypt(pkA, 100n, R1);
      expect(() => contract.assertDecryptsTo(ct, pkB, EK_A, 100n)).toThrow(
        'ElGamal: ek/pk mismatch',
      );
    });

    it('is randomized: same plaintext under different randomness yields different ciphertexts', () => {
      const ct1 = contract.encrypt(pkA, 100n, R1);
      const ct2 = contract.encrypt(pkA, 100n, R2);
      expect(ct1).not.toEqual(ct2);
      // ...yet both decrypt to the same value.
      expect(() =>
        contract.assertDecryptsTo(ct1, pkA, EK_A, 100n),
      ).not.toThrow();
      expect(() =>
        contract.assertDecryptsTo(ct2, pkA, EK_A, 100n),
      ).not.toThrow();
    });

    it('binds a ciphertext to its recipient key (no cross-key decryption)', () => {
      // A ciphertext for pkA must not decrypt to its plaintext under B's key,
      // even though (pkB, EK_B) is internally consistent.
      const ct = contract.encrypt(pkA, 100n, R1);
      expect(() => contract.assertDecryptsTo(ct, pkB, EK_B, 100n)).toThrow(
        'ElGamal: plaintext mismatch',
      );
    });
  });

  // -------------------------------------------------------------------------
  // encryptZero
  // -------------------------------------------------------------------------
  describe('encryptZero', () => {
    it('decrypts to 0 under a valid key pair', () => {
      const ct = contract.encryptZero();
      expect(() => contract.assertDecryptsTo(ct, pkA, EK_A, 0n)).not.toThrow();
    });

    it('does not decrypt to a nonzero value', () => {
      const ct = contract.encryptZero();
      expect(() => contract.assertDecryptsTo(ct, pkA, EK_A, 1n)).toThrow(
        'ElGamal: plaintext mismatch',
      );
    });

    it('is the canonical (non-randomized) identity ciphertext', () => {
      expect(contract.encryptZero()).toEqual(contract.encryptZero());
    });
  });

  // -------------------------------------------------------------------------
  // addEncrypted (additive homomorphism)
  // -------------------------------------------------------------------------
  describe('addEncrypted', () => {
    it('adds to the encrypted plaintext: Enc(a) + b decrypts to a + b', () => {
      const ct = contract.addEncrypted(
        contract.encrypt(pkA, 40n, R1),
        pkA,
        2n,
        R2,
      );
      expect(() => contract.assertDecryptsTo(ct, pkA, EK_A, 42n)).not.toThrow();
    });

    it('adding to the identity yields the added value', () => {
      const ct = contract.addEncrypted(contract.encryptZero(), pkA, 75n, R1);
      expect(() => contract.assertDecryptsTo(ct, pkA, EK_A, 75n)).not.toThrow();
    });

    it('adding 0 preserves the plaintext but rerandomizes the ciphertext', () => {
      const base = contract.encrypt(pkA, 40n, R1);
      const added = contract.addEncrypted(base, pkA, 0n, R2);
      expect(added).not.toEqual(base);
      expect(() =>
        contract.assertDecryptsTo(added, pkA, EK_A, 40n),
      ).not.toThrow();
    });

    it('rejects a wrong claimed sum', () => {
      const ct = contract.addEncrypted(
        contract.encrypt(pkA, 40n, R1),
        pkA,
        2n,
        R2,
      );
      expect(() => contract.assertDecryptsTo(ct, pkA, EK_A, 43n)).toThrow(
        'ElGamal: plaintext mismatch',
      );
    });
  });

  // -------------------------------------------------------------------------
  // subEncrypted (additive homomorphism, subtraction)
  // -------------------------------------------------------------------------
  describe('subEncrypted', () => {
    it('subtracts from the encrypted plaintext: Enc(a) - b decrypts to a - b', () => {
      const ct = contract.subEncrypted(
        contract.encrypt(pkA, 50n, R1),
        pkA,
        8n,
        R2,
      );
      expect(() => contract.assertDecryptsTo(ct, pkA, EK_A, 42n)).not.toThrow();
    });

    it('subtracting the full balance decrypts to 0', () => {
      const ct = contract.subEncrypted(
        contract.encrypt(pkA, 50n, R1),
        pkA,
        50n,
        R2,
      );
      expect(() => contract.assertDecryptsTo(ct, pkA, EK_A, 0n)).not.toThrow();
    });

    it('rejects a wrong claimed difference', () => {
      const ct = contract.subEncrypted(
        contract.encrypt(pkA, 50n, R1),
        pkA,
        8n,
        R2,
      );
      expect(() => contract.assertDecryptsTo(ct, pkA, EK_A, 41n)).toThrow(
        'ElGamal: plaintext mismatch',
      );
    });

    it('does NOT guard against underflow (caller must check the plaintext)', () => {
      // Subtracting more than the balance produces a ciphertext of a - b taken
      // modulo the curve order — a huge value, not a clamped 0. This documents
      // the contract: callers (e.g. _debit) must assert sufficiency first.
      const ct = contract.subEncrypted(
        contract.encrypt(pkA, 5n, R1),
        pkA,
        10n,
        R2,
      );
      expect(() => contract.assertDecryptsTo(ct, pkA, EK_A, 0n)).toThrow(
        'ElGamal: plaintext mismatch',
      );
    });
  });

  // -------------------------------------------------------------------------
  // Composed flow
  //
  // Exercises the exact sequence the token uses: start from a fresh balance,
  // credit twice (add), debit once (sub), and confirm the running plaintext.
  // -------------------------------------------------------------------------
  describe('composed balance flow', () => {
    it('tracks a running balance through credit/credit/debit', () => {
      let bal: Ciphertext = contract.encryptZero();
      bal = contract.addEncrypted(bal, pkA, 100n, R1); // credit 100
      bal = contract.addEncrypted(bal, pkA, 30n, R2); // credit 30
      bal = contract.subEncrypted(bal, pkA, 45n, R3); // debit 45
      expect(() =>
        contract.assertDecryptsTo(bal, pkA, EK_A, 85n),
      ).not.toThrow();
      // And the intermediate-wrong value is rejected.
      expect(() => contract.assertDecryptsTo(bal, pkA, EK_A, 130n)).toThrow(
        'ElGamal: plaintext mismatch',
      );
    });
  });

  describe('simulator wiring', () => {
    it('exposes an empty public ledger via getPublicState', () => {
      expect(contract.getPublicState()).toStrictEqual({});
    });
  });
});
