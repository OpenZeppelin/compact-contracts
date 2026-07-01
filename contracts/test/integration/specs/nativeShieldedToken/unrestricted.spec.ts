import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deployNativeShieldedTokenV1,
  type NativeShieldedTokenV1Kit,
} from '../../fixtures/nativeShieldedToken.js';

function b32(label: string): Uint8Array {
  const u = new Uint8Array(32);
  u.set(new TextEncoder().encode(label).slice(0, 32));
  return u;
}

/**
 * Unrestricted-issuance baseline (MIP §Security "Unrestricted issuance").
 *
 * The module carries no authorization, so ANY caller — not just the deployer —
 * can mint. This is the safety baseline that makes the consumer's gating
 * obligation explicit: a consumer that exposes `_mint` ungated has an
 * infinitely mintable token.
 *
 * Authorization gating is out of scope for this suite (presets removed;
 * consumer concern).
 */
describe('Unrestricted — any caller can mint (no auth gate)', () => {
  let kit: NativeShieldedTokenV1Kit;

  beforeAll(async () => {
    kit = await deployNativeShieldedTokenV1();
  });

  afterAll(async () => {
    await kit?.teardown();
  });

  it('should let a non-deployer (ALICE) mint to herself with no role grant', async () => {
    const alice = await kit.signers.eitherFor('ALICE');
    const handle = await kit.as('ALICE');

    const before = (await kit.deployed.callTx.totalMinted()).private.result;
    const res = await handle.callTx._mint(
      alice,
      1_000n,
      b32('alice-unrestricted'),
    );
    expect(res.private.result.value).toBe(1_000n);

    const after = (await kit.deployed.callTx.totalMinted()).private.result;
    expect(after).toBe(before + 1_000n);
  });
});
