import {
  CompactTypeBytes,
  CompactTypeVector,
  degradeToTransient,
  ecMulGenerator,
  type JubjubPoint,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';

/** Mirrors Compact's `pad(32, s)`: UTF-8 bytes of `s`, zero-padded to 32 bytes. */
export const padTag = (s: string): Uint8Array => {
  const b = new Uint8Array(32);
  b.set(new TextEncoder().encode(s));
  return b;
};

/** The domain-separation tag `ElGamal.secretToScalar` prefixes its input with. */
const SECRET_TO_SCALAR_TAG = padTag('ElGamal:secretToScalar');

/**
 * @description Derives the ElGamal public key for an encryption secret,
 * mirroring the in-circuit `ElGamal.derivePk`:
 *   pk = ecMulGenerator(degradeToTransient(persistentHash([TAG, ek])))
 * This is the value `ConfidentialFungibleToken.registerWithKey` expects.
 *
 * @note The tag keeps this scalar unrelated to an account identifier derived
 * without a domain tag, `persistentHash([sk])`, which is public as a ledger
 * map key. Without it, a secret used in both roles would have its encryption
 * key recoverable from the published identifier.
 *
 * @note `degradeToTransient` truncates the hash to 31 bytes, so the effective
 * collision resistance is 248 bits.
 */
export const deriveEncryptionPk = (ek: Uint8Array): JubjubPoint => {
  const rt_type = new CompactTypeVector(2, new CompactTypeBytes(32));
  const ekHash = persistentHash(rt_type, [SECRET_TO_SCALAR_TAG, ek]);
  return ecMulGenerator(degradeToTransient(ekHash));
};
