import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type Ciphertext,
  ElGamalSimulator,
} from './simulators/ElGamalSimulator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Deterministic 32-byte value seeded from a label, so every test input is
 * reproducible.
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
let pkA: JubjubPoint;
let pkB: JubjubPoint;

describe('ElGamal', () => {
  beforeAll(async () => {
    contract = await ElGamalSimulator.create();
    pkA = await contract.derivePk(EK_A);
    pkB = await contract.derivePk(EK_B);
  });

  // -------------------------------------------------------------------------
  // secretToScalar
  // -------------------------------------------------------------------------
  describe('secretToScalar', () => {
    it('is deterministic for the same secret', async () => {
      expect(await contract.secretToScalar(EK_A)).toBe(
        await contract.secretToScalar(EK_A),
      );
    });

    it('maps distinct secrets to distinct scalars', async () => {
      expect(await contract.secretToScalar(EK_A)).not.toBe(
        await contract.secretToScalar(EK_B),
      );
    });

    it('returns a positive scalar', async () => {
      expect(await contract.secretToScalar(EK_A)).toBeGreaterThan(0n);
    });
  });

  // -------------------------------------------------------------------------
  // derivePk
  // -------------------------------------------------------------------------
  describe('derivePk', () => {
    it('is deterministic for the same secret', async () => {
      expect(await contract.derivePk(EK_A)).toEqual(
        await contract.derivePk(EK_A),
      );
    });

    it('maps distinct secrets to distinct public keys', async () => {
      expect(await contract.derivePk(EK_A)).not.toEqual(
        await contract.derivePk(EK_B),
      );
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

    it('is deterministic for the same (seed, tag)', async () => {
      expect(await contract.expandRandomness(seed, tagX)).toBe(
        await contract.expandRandomness(seed, tagX),
      );
    });

    it('produces distinct outputs for distinct tags under the same seed', async () => {
      expect(await contract.expandRandomness(seed, tagX)).not.toBe(
        await contract.expandRandomness(seed, tagY),
      );
    });

    it('produces distinct outputs for distinct seeds under the same tag', async () => {
      expect(await contract.expandRandomness(seed, tagX)).not.toBe(
        await contract.expandRandomness(otherSeed, tagX),
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
    it('decrypts to the encrypted value', async () => {
      const ct = await contract.encrypt(pkA, 100n, R1);
      await contract.assertDecryptsTo(ct, pkA, EK_A, 100n);
    });

    it('round-trips the zero value', async () => {
      const ct = await contract.encrypt(pkA, 0n, R1);
      await contract.assertDecryptsTo(ct, pkA, EK_A, 0n);
    });

    it('rejects a wrong claimed plaintext', async () => {
      const ct = await contract.encrypt(pkA, 100n, R1);
      await expect(
        contract.assertDecryptsTo(ct, pkA, EK_A, 101n),
      ).rejects.toThrow('ElGamal: plaintext mismatch');
    });

    it('rejects an ek that does not match the public key', async () => {
      const ct = await contract.encrypt(pkA, 100n, R1);
      // EK_B derives pkB, not pkA, so the key-binding check fails first.
      await expect(
        contract.assertDecryptsTo(ct, pkA, EK_B, 100n),
      ).rejects.toThrow('ElGamal: ek/pk mismatch');
    });

    it('rejects a public key the ek does not correspond to', async () => {
      const ct = await contract.encrypt(pkA, 100n, R1);
      await expect(
        contract.assertDecryptsTo(ct, pkB, EK_A, 100n),
      ).rejects.toThrow('ElGamal: ek/pk mismatch');
    });

    it('is randomized: same plaintext under different randomness yields different ciphertexts', async () => {
      const ct1 = await contract.encrypt(pkA, 100n, R1);
      const ct2 = await contract.encrypt(pkA, 100n, R2);
      expect(ct1).not.toEqual(ct2);
      // ...yet both decrypt to the same value.
      await contract.assertDecryptsTo(ct1, pkA, EK_A, 100n);
      await contract.assertDecryptsTo(ct2, pkA, EK_A, 100n);
    });

    it('binds a ciphertext to its recipient key (no cross-key decryption)', async () => {
      // A ciphertext for pkA must not decrypt to its plaintext under B's key,
      // even though (pkB, EK_B) is internally consistent.
      const ct = await contract.encrypt(pkA, 100n, R1);
      await expect(
        contract.assertDecryptsTo(ct, pkB, EK_B, 100n),
      ).rejects.toThrow('ElGamal: plaintext mismatch');
    });
  });

  // -------------------------------------------------------------------------
  // encryptPoint / assertDecryptsToPoint (general, non-lifted ElGamal)
  //
  // Message points are arbitrary prime-order-subgroup points; we reuse derived
  // public keys as convenient subgroup points to encrypt.
  // -------------------------------------------------------------------------
  describe('encryptPoint / assertDecryptsToPoint', () => {
    let m1: JubjubPoint; // an arbitrary subgroup point
    let m2: JubjubPoint;

    beforeAll(async () => {
      m1 = pkB;
      m2 = await contract.derivePk(b32('msg-point-2'));
    });

    it('round-trips an arbitrary message point', async () => {
      const ct = await contract.encryptPoint(pkA, m1, R1);
      await contract.assertDecryptsToPoint(ct, pkA, EK_A, m1);
    });

    it('rejects a wrong claimed message point', async () => {
      const ct = await contract.encryptPoint(pkA, m1, R1);
      await expect(
        contract.assertDecryptsToPoint(ct, pkA, EK_A, m2),
      ).rejects.toThrow('ElGamal: plaintext mismatch');
    });

    it('rejects an ek that does not match the public key', async () => {
      const ct = await contract.encryptPoint(pkA, m1, R1);
      await expect(
        contract.assertDecryptsToPoint(ct, pkA, EK_B, m1),
      ).rejects.toThrow('ElGamal: ek/pk mismatch');
    });

    it('rejects encryption under the identity public key (non-hiding weak key)', async () => {
      // encryptZero().c1 is g^0 = the curve identity, a valid subgroup point.
      const idPk = (await contract.encryptZero()).c1;
      await expect(contract.encryptPoint(idPk, m1, R1)).rejects.toThrow(
        'ElGamal: identity pk',
      );
      // The lifted path routes through encryptPoint, so it is guarded too.
      await expect(contract.encrypt(idPk, 100n, R1)).rejects.toThrow(
        'ElGamal: identity pk',
      );
    });

    it('rejects zero randomness (mask vanishes, non-hiding)', async () => {
      await expect(contract.encryptPoint(pkA, m1, 0n)).rejects.toThrow(
        'ElGamal: zero randomness',
      );
      await expect(contract.encrypt(pkA, 100n, 0n)).rejects.toThrow(
        'ElGamal: zero randomness',
      );
      // rerandomize routes through encryptPoint, so r=0 hard-fails (no longer a
      // silent no-op).
      const ct = await contract.encrypt(pkA, 40n, R1);
      await expect(contract.rerandomize(ct, pkA, 0n)).rejects.toThrow(
        'ElGamal: zero randomness',
      );
    });

    it('lifted encrypt is the special case encryptPoint(pk, g^value, r)', async () => {
      // g^0 is the curve identity, which encryptZero exposes as its c1.
      const idPoint = (await contract.encryptZero()).c1;
      const lifted = await contract.encrypt(pkA, 0n, R1);
      await contract.assertDecryptsToPoint(lifted, pkA, EK_A, idPoint);
    });
  });

  // -------------------------------------------------------------------------
  // encryptZero
  // -------------------------------------------------------------------------
  describe('encryptZero', () => {
    it('decrypts to 0 under a valid key pair', async () => {
      const ct = await contract.encryptZero();
      await contract.assertDecryptsTo(ct, pkA, EK_A, 0n);
    });

    it('does not decrypt to a nonzero value', async () => {
      const ct = await contract.encryptZero();
      await expect(
        contract.assertDecryptsTo(ct, pkA, EK_A, 1n),
      ).rejects.toThrow('ElGamal: plaintext mismatch');
    });

    it('is the canonical (non-randomized) identity ciphertext', async () => {
      expect(await contract.encryptZero()).toEqual(
        await contract.encryptZero(),
      );
    });
  });

  // -------------------------------------------------------------------------
  // addEncrypted (additive homomorphism)
  // -------------------------------------------------------------------------
  describe('addEncrypted', () => {
    it('adds to the encrypted plaintext: Enc(a) + b decrypts to a + b', async () => {
      const ct = await contract.addEncrypted(
        await contract.encrypt(pkA, 40n, R1),
        pkA,
        2n,
        R2,
      );
      await contract.assertDecryptsTo(ct, pkA, EK_A, 42n);
    });

    it('adding to the identity yields the added value', async () => {
      const ct = await contract.addEncrypted(
        await contract.encryptZero(),
        pkA,
        75n,
        R1,
      );
      await contract.assertDecryptsTo(ct, pkA, EK_A, 75n);
    });

    it('adding 0 preserves the plaintext but rerandomizes the ciphertext', async () => {
      const base = await contract.encrypt(pkA, 40n, R1);
      const added = await contract.addEncrypted(base, pkA, 0n, R2);
      expect(added).not.toEqual(base);
      await contract.assertDecryptsTo(added, pkA, EK_A, 40n);
    });

    it('rejects a wrong claimed sum', async () => {
      const ct = await contract.addEncrypted(
        await contract.encrypt(pkA, 40n, R1),
        pkA,
        2n,
        R2,
      );
      await expect(
        contract.assertDecryptsTo(ct, pkA, EK_A, 43n),
      ).rejects.toThrow('ElGamal: plaintext mismatch');
    });
  });

  // -------------------------------------------------------------------------
  // subEncrypted (additive homomorphism, subtraction)
  // -------------------------------------------------------------------------
  describe('subEncrypted', () => {
    it('subtracts from the encrypted plaintext: Enc(a) - b decrypts to a - b', async () => {
      const ct = await contract.subEncrypted(
        await contract.encrypt(pkA, 50n, R1),
        pkA,
        8n,
        R2,
      );
      await contract.assertDecryptsTo(ct, pkA, EK_A, 42n);
    });

    it('subtracting the full balance decrypts to 0', async () => {
      const ct = await contract.subEncrypted(
        await contract.encrypt(pkA, 50n, R1),
        pkA,
        50n,
        R2,
      );
      await contract.assertDecryptsTo(ct, pkA, EK_A, 0n);
    });

    it('rejects a wrong claimed difference', async () => {
      const ct = await contract.subEncrypted(
        await contract.encrypt(pkA, 50n, R1),
        pkA,
        8n,
        R2,
      );
      await expect(
        contract.assertDecryptsTo(ct, pkA, EK_A, 41n),
      ).rejects.toThrow('ElGamal: plaintext mismatch');
    });

    it('does NOT guard against underflow (caller must check the plaintext)', async () => {
      // Subtracting more than the balance produces a ciphertext of a - b taken
      // modulo the curve order — a huge value, not a clamped 0. This documents
      // the contract: callers must assert sufficiency of the plaintext first.
      const ct = await contract.subEncrypted(
        await contract.encrypt(pkA, 5n, R1),
        pkA,
        10n,
        R2,
      );
      await expect(
        contract.assertDecryptsTo(ct, pkA, EK_A, 0n),
      ).rejects.toThrow('ElGamal: plaintext mismatch');
    });
  });

  // -------------------------------------------------------------------------
  // negate (componentwise ciphertext negation)
  // -------------------------------------------------------------------------
  describe('negate', () => {
    it('a ciphertext plus its negation decrypts to 0', async () => {
      const ct = await contract.encrypt(pkA, 30n, R1);
      const zero = await contract.add(ct, await contract.negate(ct));
      await contract.assertDecryptsTo(zero, pkA, EK_A, 0n);
    });

    it('negating twice round-trips to the original plaintext', async () => {
      const ct = await contract.encrypt(pkA, 30n, R1);
      const back = await contract.negate(await contract.negate(ct));
      await contract.assertDecryptsTo(back, pkA, EK_A, 30n);
    });
  });

  // -------------------------------------------------------------------------
  // add (homomorphic addition of two ciphertexts)
  // -------------------------------------------------------------------------
  describe('add', () => {
    it('Enc(a) + Enc(b) decrypts to a + b', async () => {
      const sum = await contract.add(
        await contract.encrypt(pkA, 40n, R1),
        await contract.encrypt(pkA, 2n, R2),
      );
      await contract.assertDecryptsTo(sum, pkA, EK_A, 42n);
    });

    it('adding the identity ciphertext preserves the plaintext', async () => {
      const base = await contract.encrypt(pkA, 40n, R1);
      const sum = await contract.add(base, await contract.encryptZero());
      await contract.assertDecryptsTo(sum, pkA, EK_A, 40n);
    });

    it('does not combine across recipient keys (result opens under neither)', async () => {
      // Enc_A(10) + Enc_B(5) is not a valid ciphertext under either key.
      const mixed = await contract.add(
        await contract.encrypt(pkA, 10n, R1),
        await contract.encrypt(pkB, 5n, R2),
      );
      await expect(
        contract.assertDecryptsTo(mixed, pkA, EK_A, 15n),
      ).rejects.toThrow('ElGamal: plaintext mismatch');
      await expect(
        contract.assertDecryptsTo(mixed, pkB, EK_B, 15n),
      ).rejects.toThrow('ElGamal: plaintext mismatch');
    });
  });

  // -------------------------------------------------------------------------
  // sub (homomorphic subtraction of two ciphertexts)
  // -------------------------------------------------------------------------
  describe('sub', () => {
    it('Enc(a) - Enc(b) decrypts to a - b', async () => {
      const diff = await contract.sub(
        await contract.encrypt(pkA, 50n, R1),
        await contract.encrypt(pkA, 8n, R2),
      );
      await contract.assertDecryptsTo(diff, pkA, EK_A, 42n);
    });

    it('subtracting an equal-value ciphertext decrypts to 0', async () => {
      const diff = await contract.sub(
        await contract.encrypt(pkA, 50n, R1),
        await contract.encrypt(pkA, 50n, R2),
      );
      await contract.assertDecryptsTo(diff, pkA, EK_A, 0n);
    });
  });

  // -------------------------------------------------------------------------
  // scalarMul (homomorphic multiplication by a public scalar)
  // -------------------------------------------------------------------------
  describe('scalarMul', () => {
    it('scales the plaintext: k * Enc(v) decrypts to k * v', async () => {
      const scaled = await contract.scalarMul(
        await contract.encrypt(pkA, 6n, R1),
        7n,
      );
      await contract.assertDecryptsTo(scaled, pkA, EK_A, 42n);
    });

    it('scaling by 1 preserves the plaintext', async () => {
      const scaled = await contract.scalarMul(
        await contract.encrypt(pkA, 40n, R1),
        1n,
      );
      await contract.assertDecryptsTo(scaled, pkA, EK_A, 40n);
    });

    it('scaling by 0 decrypts to 0', async () => {
      const scaled = await contract.scalarMul(
        await contract.encrypt(pkA, 40n, R1),
        0n,
      );
      await contract.assertDecryptsTo(scaled, pkA, EK_A, 0n);
    });

    it('composes with add into a weighted sum: 3a + 5b', async () => {
      // 3*4 + 5*6 = 42
      const weighted = await contract.add(
        await contract.scalarMul(await contract.encrypt(pkA, 4n, R1), 3n),
        await contract.scalarMul(await contract.encrypt(pkA, 6n, R2), 5n),
      );
      await contract.assertDecryptsTo(weighted, pkA, EK_A, 42n);
    });
  });

  // -------------------------------------------------------------------------
  // rerandomize (same plaintext, fresh randomness, unlinkable ciphertext)
  // -------------------------------------------------------------------------
  describe('rerandomize', () => {
    it('produces a different ciphertext that decrypts to the same value', async () => {
      const base = await contract.encrypt(pkA, 40n, R1);
      const fresh = await contract.rerandomize(base, pkA, R2);
      expect(fresh).not.toEqual(base);
      await contract.assertDecryptsTo(fresh, pkA, EK_A, 40n);
    });

    it('distinct randomness yields distinct rerandomizations', async () => {
      const base = await contract.encrypt(pkA, 40n, R1);
      expect(await contract.rerandomize(base, pkA, R2)).not.toEqual(
        await contract.rerandomize(base, pkA, R3),
      );
    });
  });

  // -------------------------------------------------------------------------
  // assertKeyPair (standalone key-ownership check)
  // -------------------------------------------------------------------------
  describe('assertKeyPair', () => {
    it('accepts a matching (pk, ek) pair', async () => {
      await contract.assertKeyPair(pkA, EK_A);
    });

    it('rejects an ek that does not derive the public key', async () => {
      await expect(contract.assertKeyPair(pkA, EK_B)).rejects.toThrow(
        'ElGamal: ek/pk mismatch',
      );
    });
  });

  // -------------------------------------------------------------------------
  // Composed flow
  //
  // Exercises a typical running-balance sequence: start from a fresh balance,
  // add twice, subtract once, and confirm the running plaintext.
  // -------------------------------------------------------------------------
  describe('composed balance flow', () => {
    it('tracks a running balance through add/add/sub', async () => {
      let bal: Ciphertext = await contract.encryptZero();
      bal = await contract.addEncrypted(bal, pkA, 100n, R1); // add 100
      bal = await contract.addEncrypted(bal, pkA, 30n, R2); // add 30
      bal = await contract.subEncrypted(bal, pkA, 45n, R3); // subtract 45
      await contract.assertDecryptsTo(bal, pkA, EK_A, 85n);
      // And the intermediate-wrong value is rejected.
      await expect(
        contract.assertDecryptsTo(bal, pkA, EK_A, 130n),
      ).rejects.toThrow('ElGamal: plaintext mismatch');
    });
  });

  describe('simulator wiring', () => {
    it('exposes an empty public ledger via getPublicState', async () => {
      expect(await contract.getPublicState()).toStrictEqual({});
    });
  });
});
