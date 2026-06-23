import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import { NativeShieldedTokenSimulator } from './simulators/NativeShieldedTokenSimulator.js';

// The derived-nonce extension is exercised through MockNativeShieldedToken,
// which composes it. The mock exposes `initializeNonce` (the chain fields are
// not sealed) so the seed guards are reachable post-deploy.

const b32 = (label: string): Uint8Array => {
  const u = new Uint8Array(32);
  u.set(new TextEncoder().encode(label).slice(0, 32));
  return u;
};
const toHex = (u: Uint8Array): string => Buffer.from(u).toString('hex');

const DOMAIN = b32('domain-A');
const SEED = b32('nonce-seed');
const ZERO = utils.zeroUint8Array();
const INIT = true;
const BAD_INIT = false;

const deploy = (init: boolean): NativeShieldedTokenSimulator =>
  new NativeShieldedTokenSimulator(DOMAIN, SEED, 'N', 'S', 6n, init);

describe('NativeShieldedTokenDerivedNonce (extension)', () => {
  describe('seeding guards', () => {
    it('should revert _deriveNonce before the chain is seeded (INV-13)', () => {
      const t = deploy(BAD_INIT);
      expect(() => t._deriveNonce()).toThrow(
        'NativeShieldedTokenDerivedNonce: chain not seeded',
      );
    });

    it('should revert initialize on a zero seed (INV-13)', () => {
      const t = deploy(BAD_INIT);
      expect(() => t.initializeNonce(ZERO)).toThrow(
        'NativeShieldedTokenDerivedNonce: invalid nonce seed',
      );
    });

    it('should seed once then revert a second seed (INV-13)', () => {
      const t = deploy(BAD_INIT);
      t.initializeNonce(SEED);
      expect(() => t.initializeNonce(b32('other-seed'))).toThrow(
        'NativeShieldedTokenDerivedNonce: already seeded',
      );
    });

    it('should revert seeding when the constructor already seeded the chain (INV-13)', () => {
      const t = deploy(INIT);
      expect(() => t.initializeNonce(b32('other-seed'))).toThrow(
        'NativeShieldedTokenDerivedNonce: already seeded',
      );
    });

    it('should allow _deriveNonce once seeded post-deploy', () => {
      const t = deploy(BAD_INIT);
      t.initializeNonce(SEED);
      expect(() => t._deriveNonce()).not.toThrow();
    });
  });

  describe('chain progression', () => {
    let t: NativeShieldedTokenSimulator;
    beforeEach(() => {
      t = deploy(INIT);
    });

    it('should advance the counter and chain value on each _deriveNonce call', () => {
      expect(t.nonceCounter()).toBe(0n);
      const chain0 = t.nonceChainValue();
      t._deriveNonce();
      expect(t.nonceCounter()).toBe(1n);
      const chain1 = t.nonceChainValue();
      expect(chain1).not.toEqual(chain0);
      t._deriveNonce();
      expect(t.nonceCounter()).toBe(2n);
      expect(t.nonceChainValue()).not.toEqual(chain1);
    });

    it('should never repeat a derived nonce across N calls (INV-11)', () => {
      const N = 25;
      const seen = new Set<string>();
      for (let i = 0; i < N; i++) {
        seen.add(toHex(t._deriveNonce()));
      }
      expect(seen.size).toBe(N);
    });

    it('should produce a derived nonce distinct from the public chain value (INV-12)', () => {
      // The derived nonce is Hash(tag, chainValue) — an honest caller echoing
      // the public `_nonce` field cannot reproduce it.
      for (let i = 0; i < 5; i++) {
        const derived = t._deriveNonce();
        expect(derived).not.toEqual(t.nonceChainValue());
      }
    });
  });
});
