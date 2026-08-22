import {
  CompactTypeBytes,
  CompactTypeVector,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { zeroUint8Array } from './address.js';

/**
 * TypeScript mirror of `access/Principal`. A spec has to name a principal before the
 * contract exists, to pass an `initialOwner` or pre-grant a role. The on-chain
 * derivation is `pure`, so it reproduces here exactly.
 *
 * Keep this in lockstep with `Principal_derivePrincipal`. Let the two drift and you
 * get an authorization failure, not a type error.
 */

/** `pad(32, "Principal:v1")`: the scheme tag mixed into every derivation. */
export const PRINCIPAL_SCHEME_TAG = pad32('Principal:v1');

/** Compact's `pad(32, s)`: the UTF-8 bytes of `s`, zero-filled to 32 bytes. */
export function pad32(s: string): Uint8Array {
  const out = new Uint8Array(32);
  const encoded = new TextEncoder().encode(s);
  if (encoded.length > 32) {
    throw new Error(`pad32: "${s}" is ${encoded.length} bytes, max 32`);
  }
  out.set(encoded);
  return out;
}

/**
 * `principal = persistentHash([secretKey, domain, SCHEME_TAG])`.
 *
 * @param secretKey The caller's 32-byte secret.
 * @param domain The per-deployment domain the contract authenticates under.
 */
export function derivePrincipal(
  secretKey: Uint8Array,
  domain: Uint8Array,
): Uint8Array {
  const rtType = new CompactTypeVector(3, new CompactTypeBytes(32));
  return persistentHash(rtType, [secretKey, domain, PRINCIPAL_SCHEME_TAG]);
}

/** The `Principal_AuthenticatedCaller` struct as the compiled circuits accept it. */
export type AuthenticatedCaller = {
  principal: Uint8Array;
  domain: Uint8Array;
};

/** Builds an `AuthenticatedCaller` the same way `Caller_authenticate` would. */
export function authenticatedCaller(
  secretKey: Uint8Array,
  domain: Uint8Array,
): AuthenticatedCaller {
  return { principal: derivePrincipal(secretKey, domain), domain };
}

/**
 * Builds an `AuthenticatedCaller` whose principal came from somewhere other than
 * `secretKey`. This is the confused-deputy input. Before the refactor a spec could
 * not express it, because each module derived its own caller from a witness only
 * that module could see.
 *
 * @param principal The principal to claim.
 * @param domain The domain to claim it under.
 */
export function forgedCaller(
  principal: Uint8Array,
  domain: Uint8Array,
): AuthenticatedCaller {
  return { principal, domain };
}

/** A 32-byte secret key derived from a readable label, as the specs do. */
export function testSecretKey(label: string): Uint8Array {
  return pad32(label);
}

/**
 * A test user carrying everything a spec needs: the secret, the principal it derives
 * under `domain`, that principal as an `Either` account, and the authenticated
 * caller struct.
 */
export function makePrincipalUser(label: string, domain: Uint8Array) {
  const secretKey = testSecretKey(label);
  const principal = derivePrincipal(secretKey, domain);
  return {
    secretKey,
    principal,
    domain,
    either: {
      is_left: true,
      left: principal,
      right: { bytes: zeroUint8Array() },
    },
    caller: { principal, domain } satisfies AuthenticatedCaller,
  };
}
