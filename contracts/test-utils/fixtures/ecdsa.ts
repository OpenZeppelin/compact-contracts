import type { Secp256k1Point } from '@midnight-ntwrk/compact-runtime';
import { secp256k1 } from '@noble/curves/secp256k1.js';

/**
 * secp256k1 key pairs and ECDSA signatures in the shape the compiled circuits
 * expect: a `Secp256k1Point` public key and an `{ r, s }` signature of scalar
 * field elements. Signers derive from ASCII labels so fixtures are stable
 * across runs and backends.
 *
 * Digest reconstruction lives with the specs that own the message encoding
 * (`multisig/test/EcdsaTestUtils.ts`), not here.
 */

/** An ECDSA signature as the circuits consume it: two secp256k1 scalars. */
export interface EcdsaSignature {
  r: bigint;
  s: bigint;
}

/** A secp256k1 signer: its secret key plus the public key as a circuit point. */
export interface Signer {
  secretKey: Uint8Array;
  publicKey: Secp256k1Point;
}

/** secp256k1 group order. */
export const SECP256K1_N =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

const bytesToBigIntBE = (bytes: Uint8Array): bigint => {
  let acc = 0n;
  for (const b of bytes) acc = (acc << 8n) | BigInt(b);
  return acc;
};

/** Derives a signer from a 32-byte secret key. */
export function makeSigner(secretKey: Uint8Array): Signer {
  const uncompressed = secp256k1.getPublicKey(secretKey, false); // 0x04 || X || Y
  return {
    secretKey,
    publicKey: {
      x: bytesToBigIntBE(uncompressed.slice(1, 33)),
      y: bytesToBigIntBE(uncompressed.slice(33, 65)),
      identity: false,
    },
  };
}

/** Deterministic signer from an ASCII label, for stable fixtures. */
export function signerFromLabel(label: string): Signer {
  const secretKey = new Uint8Array(32);
  secretKey.set(new TextEncoder().encode(label).slice(0, 32));
  secretKey[31] ||= 1; // avoid the zero scalar
  return makeSigner(secretKey);
}

/**
 * Signs a 32-byte digest, returning a low-s `{ r, s }`. The digest is the
 * pre-hashed message, exactly as `secp256k1EcdsaVerify` interprets `msgHash`.
 */
export function sign(signer: Signer, digest: Uint8Array): EcdsaSignature {
  const sig = secp256k1.sign(digest, signer.secretKey, {
    prehash: false,
    lowS: true,
  });
  // @noble/curves v1 returns a `Signature`; v2 returns compact r‖s bytes.
  if (sig instanceof Uint8Array) {
    return {
      r: bytesToBigIntBE(sig.slice(0, 32)),
      s: bytesToBigIntBE(sig.slice(32, 64)),
    };
  }
  return { r: sig.r, s: sig.s };
}

/** The `(r, n - s)` twin: valid under plain ECDSA, but not in low-s form. */
export function highSTwin(sig: EcdsaSignature): EcdsaSignature {
  return { r: sig.r, s: SECP256K1_N - sig.s };
}
