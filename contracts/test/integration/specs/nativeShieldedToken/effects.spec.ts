import { encodeCoinPublicKey } from '@midnight-ntwrk/compact-runtime';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  decodeShieldedMints,
  toHex,
  totalShieldedMinted,
} from '../../_harness/effects.js';
import {
  DEFAULT_DOMAIN,
  deployNativeShieldedTokenV1,
  type NativeShieldedTokenV1Kit,
} from '../../fixtures/nativeShieldedToken.js';

function b32(label: string): Uint8Array {
  const u = new Uint8Array(32);
  u.set(new TextEncoder().encode(label).slice(0, 32));
  return u;
}

/**
 * Supply reconstruction from public effects — proves the MIP claim that
 * `totalMinted` is "independently verifiable from the public shieldedMints
 * effects" (INV-2). A mint of `amount` under the contract's domain records
 * exactly `shieldedMints[domain] == amount` in the contract-call transcript,
 * with no other coin minted. This is what lets an indexer flag a
 * non-conforming implementation.
 */
describe('Effects — shieldedMints reconstruction (INV-2)', () => {
  let kit: NativeShieldedTokenV1Kit;
  let selfRecipient: {
    is_left: boolean;
    left: { bytes: Uint8Array };
    right: { bytes: Uint8Array };
  };

  beforeAll(async () => {
    kit = await deployNativeShieldedTokenV1();
    selfRecipient = {
      is_left: true,
      left: { bytes: encodeCoinPublicKey(kit.wallet.getCoinPublicKey()) },
      right: { bytes: new Uint8Array(32) },
    };
  });

  afterAll(async () => {
    await kit?.teardown();
  });

  it('should record shieldedMints[domain] == minted amount in the tx effects (INV-2)', async () => {
    const amount = 777n;
    const res = await kit.deployed.callTx._mint(selfRecipient, amount, b32('eff-1'));

    const mints = decodeShieldedMints(res.public);
    const domainHex = toHex(DEFAULT_DOMAIN);

    // Exactly one color minted, under this contract's domain, for `amount`.
    expect(mints.get(domainHex)).toBe(amount);
    expect(totalShieldedMinted(res.public)).toBe(amount);
    expect([...mints.keys()]).toEqual([domainHex]);
  });

  it('should reconstruct the derived-nonce mint amount from public effects too (INV-2)', async () => {
    const amount = 321n;
    const res = await kit.deployed.callTx._mintWithDerivedNonce(selfRecipient, amount);
    const mints = decodeShieldedMints(res.public);
    expect(mints.get(toHex(DEFAULT_DOMAIN))).toBe(amount);
    expect(totalShieldedMinted(res.public)).toBe(amount);
  });
});
