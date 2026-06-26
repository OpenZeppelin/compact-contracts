import { encodeCoinPublicKey } from '@midnight-ntwrk/compact-runtime';
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
 * Commitment-collision rejection (MIP §Security "Commitment collisions").
 *
 * The ledger rejects a duplicate coin commitment. This is the mechanism behind
 * both the caller's nonce-uniqueness responsibility and the derived-nonce
 * extension's guarantee (INV-11): reusing a nonce for the same
 * (value, recipient) reproduces the commitment, which is rejected.
 *
 * The full collision-griefing vector (pre-minting a commitment that collides
 * with a FUTURE `_mintWithDerivedNonce` of the same tuple) is an operational
 * risk mitigated by gating both mint paths; its underlying rejection is exactly
 * what this spec exercises. Recovery (a later derived mint with a different
 * tuple advances past the collision) is the derived-nonce chain progression
 * already verified in the mint and unit suites.
 */
describe('Collision — duplicate commitment rejection (INV-11 mechanism)', () => {
  let kit: NativeShieldedTokenV1Kit;
  let recipient: {
    is_left: boolean;
    left: { bytes: Uint8Array };
    right: { bytes: Uint8Array };
  };

  beforeAll(async () => {
    kit = await deployNativeShieldedTokenV1();
    recipient = {
      is_left: true,
      left: { bytes: encodeCoinPublicKey(kit.wallet.getCoinPublicKey()) },
      right: { bytes: new Uint8Array(32) },
    };
  });

  afterAll(async () => {
    await kit?.teardown();
  });

  it('should accept a first mint and reject a second reusing the same (nonce, value, recipient)', async () => {
    const nonce = b32('collide-nonce');
    // First mint of the tuple finalizes and registers the commitment.
    const first = await kit.deployed.callTx._mint(recipient, 1_000n, nonce);
    expect(first.private.result.value).toBe(1_000n);

    // Re-using the same tuple reproduces the commitment, which the ledger
    // rejects (duplicate commitment).
    await expect(
      kit.deployed.callTx._mint(recipient, 1_000n, nonce),
    ).rejects.toThrow();
  });

  it('should accept a mint with a different nonce after a collision (recovery)', async () => {
    const before = (await kit.readLedger()).NativeShieldedTokenSupply__totalMinted;
    const res = await kit.deployed.callTx._mint(recipient, 1_000n, b32('collide-recover'));
    expect(res.private.result.value).toBe(1_000n);
    const after = (await kit.readLedger()).NativeShieldedTokenSupply__totalMinted;
    expect(after).toBe(before + 1_000n);
  });
});
