import { ecMulGenerator } from '@midnight-ntwrk/compact-runtime';
import { describe, expect, it } from 'vitest';
import { pureCircuits } from '../../../artifacts/MockEcdh/contract/index.js';

// The Ecdh circuits are pure, so tests drive them directly via the compiled
// artifact's `pureCircuits` (no proof, no simulator needed).

// Jubjub prime-order subgroup order. Valid scalars are [1, L-1]; the runtime
// faults ecMul on scalars >= L (see crypto/ElGamal), so L-1 is the largest
// valid scalar.
const L =
  6554484396890773809930967563523245729705921265872317281365359162392183254199n;

// A recipient's secret scalar and their derived public key g^ek.
const EK = 111222333444555n;
const PK = ecMulGenerator(EK);
const IDENTITY = ecMulGenerator(0n);

describe('Ecdh', () => {
  describe('weak-input guards', () => {
    it('rejects the identity public key', () => {
      expect(() => pureCircuits.deriveShared(IDENTITY, 42n)).toThrow(
        'Ecdh: identity pk',
      );
    });

    it('rejects a zero ephemeral', () => {
      expect(() => pureCircuits.deriveShared(PK, 0n)).toThrow(
        'Ecdh: zero ephemeral',
      );
    });
  });

  describe('key agreement', () => {
    it('returns the ephemeral public key g^e', () => {
      expect(pureCircuits.deriveShared(PK, 31337n).ephemeralPk).toStrictEqual(
        ecMulGenerator(31337n),
      );
    });

    it('recovers the shared secret from the ephemeral public key', () => {
      const shared = pureCircuits.deriveShared(PK, 31337n);
      expect(pureCircuits.recoverShared(shared.ephemeralPk, EK)).toStrictEqual(
        shared.sShared,
      );
    });

    it('agrees at the maximum valid scalar (L - 1) for key and ephemeral', () => {
      // The top of the valid scalar range: L and above fault ecMul.
      const ek = L - 1n;
      const shared = pureCircuits.deriveShared(ecMulGenerator(ek), L - 1n);
      expect(pureCircuits.recoverShared(shared.ephemeralPk, ek)).toStrictEqual(
        shared.sShared,
      );
    });

    it('produces distinct shared secrets for distinct ephemerals', () => {
      expect(pureCircuits.deriveShared(PK, 1n).sShared).not.toStrictEqual(
        pureCircuits.deriveShared(PK, 2n).sShared,
      );
    });
  });

  describe('total recipient side', () => {
    // Nothing on the recipient side asserts, so a scanner cannot tell an
    // addressed exchange from an unaddressed one by an abort.
    it('accepts a wrong secret key', () => {
      const shared = pureCircuits.deriveShared(PK, 31337n);
      expect(() =>
        pureCircuits.recoverShared(shared.ephemeralPk, 999999n),
      ).not.toThrow();
    });

    it('recovers a different point under a wrong secret key', () => {
      const shared = pureCircuits.deriveShared(PK, 31337n);
      expect(
        pureCircuits.recoverShared(shared.ephemeralPk, 999999n),
      ).not.toStrictEqual(shared.sShared);
    });

    it('returns the identity for an identity ephemeral point', () => {
      // The degenerate input the sender guard rejects still resolves here, so a
      // wallet can scan a malformed exchange without aborting.
      expect(pureCircuits.recoverShared(IDENTITY, EK)).toStrictEqual(IDENTITY);
    });
  });
});
