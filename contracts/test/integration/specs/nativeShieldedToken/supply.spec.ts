import { encodeCoinPublicKey } from '@midnight-ntwrk/compact-runtime';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deployNativeShieldedTokenV1,
  type NativeShieldedTokenV1Kit,
} from '../../fixtures/nativeShieldedToken.js';

function bytes32(label: string): Uint8Array {
  const b = new Uint8Array(32);
  b.set(new TextEncoder().encode(label).slice(0, 32));
  return b;
}

/**
 * Supply accounting spec (mint side) — proves the exact-minted and
 * upper-bound-supply invariants on-chain across a sequence of mints.
 *
 * Verifies that totalMinted is the exact sum of minted amounts, and that
 * totalSupply == totalMinted - totalBurned (with no contract-mediated burns
 * yet, totalSupply == totalMinted and totalBurned == 0).
 *
 * Bypass-burn and indexer-reconstruction cases (the rest of the supply story
 * and the "independently verifiable from shieldedMints" claim) are added with
 * the indexer effect decoder — see the burn / supply-bypass coverage.
 */
describe('Supply — NativeShieldedTokenV1 (mint-side accounting)', () => {
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

  it('should accumulate totalMinted as the exact sum across mints', async () => {
    const amounts = [100n, 250n, 75n];
    let i = 0;
    for (const amount of amounts) {
      await kit.deployed.callTx._mint(
        selfRecipient,
        amount,
        bytes32(`supply-${i++}`),
      );
    }
    // Supply totals live in the supply core behind a prefixed import — read
    // through the extension circuits rather than the typed ledger.
    expect((await kit.deployed.callTx.totalMinted()).private.result).toBe(425n);
    expect((await kit.deployed.callTx.totalBurned()).private.result).toBe(0n);
  });

  it('should report totalSupply == totalMinted - totalBurned', async () => {
    const minted = (await kit.deployed.callTx.totalMinted()).private.result;
    const burned = (await kit.deployed.callTx.totalBurned()).private.result;
    const supply = (await kit.deployed.callTx.totalSupply()).private.result;
    expect(supply).toBe(minted - burned);
    // With no contract-mediated burns, the upper bound equals total minted.
    expect(supply).toBe(minted);
  });
});
