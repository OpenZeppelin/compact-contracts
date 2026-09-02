import { secp256k1 } from '@noble/curves/secp256k1.js';
import { describe, expect, it } from 'vitest';
import {
  type EcdsaSignature,
  highSTwin,
  makeSigner,
  SECP256K1_N,
  sign,
  signerFromLabel,
} from '../ecdsa.js';

/**
 * The secp256k1 signing fixtures. Key derivation and RFC 6979 signing are both
 * deterministic, so every case pins an exact value. The premise the low-s work
 * rests on — that `highSTwin` is an equally valid plain-ECDSA signature — is
 * checked here against noble's own verifier rather than assumed.
 */

const HALF_N = SECP256K1_N / 2n;

/** A fixed 32-byte pre-hashed message. */
const DIGEST = new Uint8Array(32).fill(0x42);

const LABEL = 'fixture-signer';
const SIGNER = signerFromLabel(LABEL);
const OTHER = signerFromLabel('fixture-signer-other');

/** 0x04 || X || Y, the public-key form noble's verifier takes. */
const PK_BYTES = secp256k1.getPublicKey(SIGNER.secretKey, false);

const bigIntToBytesBE = (value: bigint): Uint8Array => {
  const out = new Uint8Array(32);
  let acc = value;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(acc & 0xffn);
    acc >>= 8n;
  }
  return out;
};

/** The 64-byte `r‖s` encoding noble's verifier takes. */
const compact = (sig: EcdsaSignature): Uint8Array => {
  const out = new Uint8Array(64);
  out.set(bigIntToBytesBE(sig.r), 0);
  out.set(bigIntToBytesBE(sig.s), 32);
  return out;
};

const verify = (sig: EcdsaSignature, lowS: boolean): boolean =>
  secp256k1.verify(compact(sig), DIGEST, PK_BYTES, { lowS, prehash: false });

describe('ecdsa fixtures', () => {
  describe('SECP256K1_N', () => {
    it('should be the secp256k1 group order', () => {
      expect(SECP256K1_N).toBe(
        0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n,
      );
    });

    // @noble/curves v1 exposes the order as `CURVE.n`; v2 moves it, so this
    // cross-check runs only where the field is present.
    it.runIf(typeof secp256k1.CURVE?.n === 'bigint')(
      "should match noble's curve order",
      () => {
        expect(SECP256K1_N).toBe(secp256k1.CURVE.n);
      },
    );
  });

  describe('makeSigner', () => {
    it('should derive the same point for the same secret key', () => {
      expect(makeSigner(SIGNER.secretKey)).toStrictEqual(SIGNER);
    });

    it('should mark a derived key as a non-identity point', () => {
      expect(SIGNER.publicKey.identity).toBe(false);
    });
  });

  describe('signerFromLabel', () => {
    it('should derive the same signer for the same label', () => {
      expect(signerFromLabel(LABEL)).toStrictEqual(SIGNER);
    });

    it('should derive the pinned public key for a fixed label', () => {
      expect(SIGNER.publicKey).toStrictEqual({
        x: 0x728b5f3135a93cdd9fc127915405c5e70b8b5aca4b2b32957da8b6c0dc19744an,
        y: 0xbe5357b3a1c7215b3e8e132c7a68707bc7bf2e115dd37d8a3de145fb18623a1en,
        identity: false,
      });
    });

    it('should derive distinct keys for distinct labels', () => {
      expect(OTHER.publicKey).not.toStrictEqual(SIGNER.publicKey);
    });

    // Byte 31 is forced non-zero, so the empty label still yields a usable key.
    it('should avoid the zero scalar for an empty label', () => {
      expect(signerFromLabel('').secretKey[31]).toBe(1);
    });
  });

  describe('sign', () => {
    const sig = sign(SIGNER, DIGEST);

    it('should be deterministic for the same signer and digest', () => {
      expect(sign(SIGNER, DIGEST)).toStrictEqual(sig);
    });

    it('should produce a low-s signature', () => {
      expect(sig.s).toBeLessThanOrEqual(HALF_N);
    });

    it('should produce scalars inside [1, n - 1]', () => {
      expect(sig.r).toBeGreaterThan(0n);
      expect(sig.r).toBeLessThan(SECP256K1_N);
      expect(sig.s).toBeGreaterThan(0n);
      expect(sig.s).toBeLessThan(SECP256K1_N);
    });

    it('should verify against the signer public key', () => {
      expect(verify(sig, true)).toBe(true);
    });
  });

  describe('highSTwin', () => {
    const sig = sign(SIGNER, DIGEST);
    const twin = highSTwin(sig);

    it('should keep r unchanged', () => {
      expect(twin.r).toBe(sig.r);
    });

    it('should reflect s about the group order', () => {
      expect(twin.s + sig.s).toBe(SECP256K1_N);
    });

    it('should land above the low-s boundary', () => {
      expect(twin.s).toBeGreaterThan(HALF_N);
    });

    // The malleability premise: the twin is an equally valid ECDSA signature
    // over the same digest, so rejecting it is a policy choice, not arithmetic.
    it('should still verify under plain ECDSA', () => {
      expect(verify(twin, false)).toBe(true);
    });

    it("should be rejected by noble's low-s check", () => {
      expect(verify(twin, true)).toBe(false);
    });

    it('should round-trip back to the original signature', () => {
      expect(highSTwin(twin)).toStrictEqual(sig);
    });
  });
});
