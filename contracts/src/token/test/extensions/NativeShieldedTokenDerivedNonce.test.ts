import { beforeEach, describe, expect, it } from 'vitest';
import { NativeShieldedTokenDerivedNonceSimulator } from '../simulators/NativeShieldedTokenDerivedNonceSimulator.js';

const toHex = (u: Uint8Array): string => Buffer.from(u).toString('hex');

// The derived-nonce extension is counter-only: it needs no initialization, and
// `_deriveNonce` is callable immediately after deploy.

let nonce: NativeShieldedTokenDerivedNonceSimulator;

describe('NativeShieldedTokenDerivedNonce (extension)', () => {
  beforeEach(async () => {
    nonce = await NativeShieldedTokenDerivedNonceSimulator.create();
  });

  it('should derive a 32-byte nonce without any initialization', async () => {
    expect(await nonce.nonceCounter()).toBe(0n);
    const n = await nonce._deriveNonce();
    expect(n).toBeInstanceOf(Uint8Array);
    expect(n.length).toBe(32);
  });

  it('should advance the counter on each call', async () => {
    expect(await nonce.nonceCounter()).toBe(0n);
    await nonce._deriveNonce();
    expect(await nonce.nonceCounter()).toBe(1n);
    await nonce._deriveNonce();
    expect(await nonce.nonceCounter()).toBe(2n);
  });

  it('should never repeat a derived nonce across N calls', async () => {
    const N = 25;
    const seen = new Set<string>();
    for (let i = 0; i < N; i++) {
      seen.add(toHex(await nonce._deriveNonce()));
    }
    expect(seen.size).toBe(N);
  });

  it('should derive an identical sequence across independent instances', async () => {
    // The derivation is a pure function of the public counter, so two fresh
    // deployments must yield byte-identical nonce sequences. This is a loud
    // guard: any hidden randomness introduced into `_deriveNonce` would make
    // the two sequences diverge and fail this assertion.
    const other = await NativeShieldedTokenDerivedNonceSimulator.create();
    const seqA: string[] = [];
    const seqB: string[] = [];
    for (let i = 0; i < 5; i++) {
      seqA.push(toHex(await nonce._deriveNonce()));
      seqB.push(toHex(await other._deriveNonce()));
    }
    expect(seqA).toStrictEqual(seqB);
  });
});
