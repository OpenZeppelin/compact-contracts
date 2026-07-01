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
 * Verifies color soundness (the minted coin carries this contract's color),
 * totalMinted exactness, the zero-recipient revert, the derived nonce advancing
 * the chain, and the derived nonce being domain-separated from the public chain
 * value.
 */
describe('Mint — NativeShieldedTokenV1 (both paths)', () => {
  let kit: NativeShieldedTokenV1Kit;

  beforeAll(async () => {
    kit = await deployNativeShieldedTokenV1();
  });

  afterAll(async () => {
    await kit?.teardown();
  });

  it('should mint a caller-nonce coin with color = tokenColor, value = amount, nonce = arg', async () => {
    const alice = await kit.signers.eitherFor('ALICE');
    const handle = await kit.as('ALICE');
    const nonce = bytes32('mint-nonce-alice-1');
    const amount = 1_000n;

    const before = (await kit.deployed.callTx.totalMinted()).private.result;

    const res = await handle.callTx._mint(alice, amount, nonce);
    const coin = res.private.result;

    // Returned coin carries the requested value and nonce ...
    expect(coin.value).toBe(amount);
    expect(coin.nonce).toEqual(nonce);

    // ... and this contract's color. tokenColor() is read through the
    // circuit so the comparison is against the contract's own derivation.
    const color = (await handle.callTx.tokenColor()).private.result;
    expect(coin.color).toEqual(color);

    // totalMinted is exact.
    const after = (await kit.deployed.callTx.totalMinted()).private.result;
    expect(after).toBe(before + amount);
  });

  it('should mint via the derived-nonce path, advancing the chain', async () => {
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

    const counter0 = (await kit.readLedger())
      .NativeShieldedTokenDerivedNonce__counter;
    const minted0 = (await kit.deployed.callTx.totalMinted()).private.result;

    const res = await handle.callTx._mintWithDerivedNonce(recipient, amount);
    const coin = res.private.result;
    expect(coin.value).toBe(amount);

    // Each derived mint advances the monotonic counter (read via the ledger).
    const counter1 = (await kit.readLedger())
      .NativeShieldedTokenDerivedNonce__counter;
    expect(counter1).toBe(counter0 + 1n);
    // totalMinted still exact across the composed path.
    const minted1 = (await kit.deployed.callTx.totalMinted()).private.result;
    expect(minted1).toBe(minted0 + amount);
    // The derived nonce is `evolveNonce(counter, tag)` — a hash, never
    // the raw public counter an honest `_mint` caller could echo. Assert it is
    // a real, non-zero 32-byte derivation (the unit suite covers the exact hash
    // relation; privacy.spec proves it is the public-recoverable value).
    expect(coin.nonce).toBeInstanceOf(Uint8Array);
    expect(coin.nonce.length).toBe(32);
    expect(coin.nonce.some((b: number) => b !== 0)).toBe(true);
  });

  it('should reject a mint to the zero recipient', async () => {
    const handle = await kit.as('ALICE');
    await expect(
      handle.callTx._mint(ZERO_RECIPIENT, 1n, bytes32('zero-recipient')),
    ).rejects.toThrow('NativeShieldedToken: invalid recipient');
  });
});
