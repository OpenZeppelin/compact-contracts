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

const deploy = (init: boolean): Promise<NativeShieldedTokenSimulator> =>
  NativeShieldedTokenSimulator.create(DOMAIN, SEED, 'N', 'S', 6n, init);

describe('NativeShieldedTokenDerivedNonce (extension)', () => {
  describe('seeding guards', () => {
    it('should revert _deriveNonce before the chain is seeded (INV-13)', async () => {
      const t = await deploy(BAD_INIT);
      await expect(t._deriveNonce()).rejects.toThrow(
        'NativeShieldedTokenDerivedNonce: chain not seeded',
      );
    });

    it('should revert initialize on a zero seed (INV-13)', async () => {
      const t = await deploy(BAD_INIT);
      await expect(t.initializeNonce(ZERO)).rejects.toThrow(
        'NativeShieldedTokenDerivedNonce: invalid nonce seed',
      );
    });

    it('should seed once then revert a second seed (INV-13)', async () => {
      const t = await deploy(BAD_INIT);
      await t.initializeNonce(SEED);
      await expect(t.initializeNonce(b32('other-seed'))).rejects.toThrow(
        'NativeShieldedTokenDerivedNonce: already seeded',
      );
    });

    it('should revert seeding when the constructor already seeded the chain (INV-13)', async () => {
      const t = await deploy(INIT);
      await expect(t.initializeNonce(b32('other-seed'))).rejects.toThrow(
        'NativeShieldedTokenDerivedNonce: already seeded',
      );
    });

    it('should allow _deriveNonce once seeded post-deploy', async () => {
      const t = await deploy(BAD_INIT);
      await t.initializeNonce(SEED);
      await t._deriveNonce();
    });
  });

  describe('chain progression', () => {
    let t: NativeShieldedTokenSimulator;
    beforeEach(async () => {
      t = await deploy(INIT);
    });

    it('should advance the counter and chain value on each _deriveNonce call', async () => {
      expect(await t.nonceCounter()).toBe(0n);
      const chain0 = await t.nonceChainValue();
      await t._deriveNonce();
      expect(await t.nonceCounter()).toBe(1n);
      const chain1 = await t.nonceChainValue();
      expect(chain1).not.toEqual(chain0);
      await t._deriveNonce();
      expect(await t.nonceCounter()).toBe(2n);
      expect(await t.nonceChainValue()).not.toEqual(chain1);
    });

    it('should never repeat a derived nonce across N calls (INV-11)', async () => {
      const N = 25;
      const seen = new Set<string>();
      for (let i = 0; i < N; i++) {
        seen.add(toHex(await t._deriveNonce()));
      }
      expect(seen.size).toBe(N);
    });

    it('should produce a derived nonce distinct from the public chain value (INV-12)', async () => {
      // The derived nonce is Hash(tag, chainValue) — an honest caller echoing
      // the public `_nonce` field cannot reproduce it.
      for (let i = 0; i < 5; i++) {
        const derived = await t._deriveNonce();
        expect(derived).not.toEqual(await t.nonceChainValue());
      }
    });
  });
});
