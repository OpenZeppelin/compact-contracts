import { encodeCoinPublicKey } from '@midnight-ntwrk/compact-runtime';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deployNativeShieldedTokenV1,
  type NativeShieldedTokenV1Kit,
} from '../../fixtures/nativeShieldedToken.js';

/** Encode an ASCII label into a fixed 32-byte nonce (truncated to fit). */
function bytes32(label: string): Uint8Array {
  const b = new Uint8Array(32);
  b.set(new TextEncoder().encode(label).slice(0, 32));
  return b;
}

const ZERO_RECIPIENT = {
  is_left: true,
  left: { bytes: new Uint8Array(32) },
  right: { bytes: new Uint8Array(32) },
};

/**
 * Mint spec — drives both mint paths through the full prove -> verify -> apply
 * loop against the live stack.
 *
 * Verifies: INV-1 (color soundness — the minted coin carries this contract's
 * color), INV-2 (totalMinted exact), INV-6 (zero-recipient revert), INV-11
 * (derived nonce advances the chain), INV-12 (derived nonce is domain-separated
 * from the public chain value).
 */
describe('Mint — NativeShieldedTokenV1 (both paths)', () => {
  let kit: NativeShieldedTokenV1Kit;

  beforeAll(async () => {
    kit = await deployNativeShieldedTokenV1();
  });

  afterAll(async () => {
    await kit?.teardown();
  });

  it('should mint a caller-nonce coin with color = tokenColor, value = amount, nonce = arg (INV-1, INV-2)', async () => {
    const alice = await kit.signers.eitherFor('ALICE');
    const handle = await kit.as('ALICE');
    const nonce = bytes32('mint-nonce-alice-1');
    const amount = 1_000n;

    const before = (await kit.readLedger()).NativeShieldedTokenSupply__totalMinted;

    const res = await handle.callTx._mint(alice, amount, nonce);
    const coin = res.private.result;

    // Returned coin carries the requested value and nonce ...
    expect(coin.value).toBe(amount);
    expect(coin.nonce).toEqual(nonce);

    // ... and this contract's color (INV-1). tokenColor() is read through the
    // circuit so the comparison is against the contract's own derivation.
    const color = (await handle.callTx.tokenColor()).private.result;
    expect(coin.color).toEqual(color);

    // totalMinted is exact (INV-2).
    const after = (await kit.readLedger()).NativeShieldedTokenSupply__totalMinted;
    expect(after).toBe(before + amount);
  });

  it('should mint via the derived-nonce path, advancing the chain (INV-2, INV-11, INV-12)', async () => {
    // Submit from the well-funded genesis deployer, minting to its own key.
    // Recipient identity is irrelevant to the chain/supply invariants here, and
    // minting to the submitter's own key sidesteps the encryption-key resolver
    // the wallet SDK needs for a third-party recipient (that is the MIP's
    // out-of-band coin-delivery concern, exercised separately by the burn /
    // delivery specs).
    const recipient = {
      is_left: true,
      left: { bytes: encodeCoinPublicKey(kit.wallet.getCoinPublicKey()) },
      right: { bytes: new Uint8Array(32) },
    };
    const handle = kit.deployed;
    const amount = 500n;

    const l0 = await kit.readLedger();
    const counter0 = l0.NativeShieldedTokenDerivedNonce__counter;
    const minted0 = l0.NativeShieldedTokenSupply__totalMinted;

    const res = await handle.callTx._mintWithDerivedNonce(recipient, amount);
    const coin = res.private.result;
    expect(coin.value).toBe(amount);

    const l1 = await kit.readLedger();
    // INV-11: each derived mint advances the monotonic counter.
    expect(l1.NativeShieldedTokenDerivedNonce__counter).toBe(counter0 + 1n);
    // INV-2: totalMinted still exact across the composed path.
    expect(l1.NativeShieldedTokenSupply__totalMinted).toBe(minted0 + amount);
    // INV-12: the derived coin nonce is domain-separated from the public chain
    // value an honest `_mint` caller could echo (it is Hash(tag, chainValue)).
    expect(coin.nonce).not.toEqual(l1.NativeShieldedTokenDerivedNonce__nonce);
  });

  it('should reject a mint to the zero recipient (INV-6)', async () => {
    const handle = await kit.as('ALICE');
    await expect(
      handle.callTx._mint(ZERO_RECIPIENT, 1n, bytes32('zero-recipient')),
    ).rejects.toThrow('NativeShieldedToken: invalid recipient');
  });
});
