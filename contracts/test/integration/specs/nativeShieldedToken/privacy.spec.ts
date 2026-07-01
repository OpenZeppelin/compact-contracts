import { randomBytes } from 'node:crypto';
import { encodeCoinPublicKey } from '@midnight-ntwrk/compact-runtime';
import {
  coinCommitment,
  decodeShieldedCoinInfo,
  sampleCoinPublicKey,
} from '@midnight-ntwrk/ledger-v8';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { publicEffectsHexBlob, toHex } from '../../_harness/effects.js';
import {
  deployNativeShieldedTokenV1,
  type NativeShieldedTokenV1Kit,
} from '../../fixtures/nativeShieldedToken.js';

/**
 * Recipient-privacy spec (P0 / HIGH-1) — the standard's defining claim.
 *
 * The privacy difference between the two mint paths rests entirely on whether
 * the coin nonce is secret:
 *
 *  - base `_mint` with a secret, uniform nonce → the nonce never appears in
 *    public data, so a third party cannot reconstruct the coin and therefore
 *    cannot recompute its commitment for any candidate recipient key. The
 *    recipient is UNLINKABLE.
 *  - `_mintWithDerivedNonce` → the nonce is derived from public ledger state,
 *    so a third party can reconstruct the coin and recompute its commitment by
 *    enumerating candidate recipient keys. The recipient is RECOVERABLE (the
 *    documented trade-off).
 *
 * All assertions are against the public transaction data (`res.public.tx` +
 * effects), never the call argument.
 */
describe('Privacy — recipient (un)linkability (HIGH-1, P0)', () => {
  let kit: NativeShieldedTokenV1Kit;
  let recipientCpk: string;
  let selfRecipient: {
    is_left: boolean;
    left: { bytes: Uint8Array };
    right: { bytes: Uint8Array };
  };

  beforeAll(async () => {
    kit = await deployNativeShieldedTokenV1();
    recipientCpk = kit.wallet.getCoinPublicKey();
    selfRecipient = {
      is_left: true,
      left: { bytes: encodeCoinPublicKey(recipientCpk) },
      right: { bytes: new Uint8Array(32) },
    };
  });

  afterAll(async () => {
    await kit?.teardown();
  });

  it('should NOT expose a secret-nonce mint recipient in public data (recipient-private)', async () => {
    const secretNonce = new Uint8Array(randomBytes(32));
    const res = await kit.deployed.callTx._mint(
      selfRecipient,
      1_000n,
      secretNonce,
    );
    const coin = res.private.result;

    const blob = publicEffectsHexBlob(res.public);

    // Positive control: the mint really landed and we are searching the right
    // blob — the coin commitment IS present in public data. (The test can
    // compute it because it holds the secret nonce; a third party cannot.)
    const ledgerCoin = decodeShieldedCoinInfo({
      color: coin.color,
      nonce: coin.nonce,
      value: coin.value,
    });
    const commitment = coinCommitment(ledgerCoin, recipientCpk).toLowerCase();
    expect(blob.includes(commitment)).toBe(true);

    // The secret nonce is the linchpin: it never appears in any public field,
    // so that commitment cannot be recomputed by an enumerator who lacks it.
    expect(blob.includes(toHex(secretNonce))).toBe(false);
  });

  it('should make a derived-nonce mint recipient recoverable by key enumeration (recipient-public)', async () => {
    const res = await kit.deployed.callTx._mintWithDerivedNonce(
      selfRecipient,
      2_000n,
    );
    const coin = res.private.result;

    // Reconstruct the coin from data a third party has: the derived nonce is
    // public ledger state, the color is public, the value is public via
    // shieldedMints.
    const ledgerCoin = decodeShieldedCoinInfo({
      color: coin.color,
      nonce: coin.nonce,
      value: coin.value,
    });
    const blob = publicEffectsHexBlob(res.public);

    // The correct recipient key reproduces the on-chain commitment ...
    const realCommitment = coinCommitment(
      ledgerCoin,
      recipientCpk,
    ).toLowerCase();
    expect(blob.includes(realCommitment)).toBe(true);

    // ... a wrong candidate key does not.
    const wrongCommitment = coinCommitment(
      ledgerCoin,
      sampleCoinPublicKey(),
    ).toLowerCase();
    expect(blob.includes(wrongCommitment)).toBe(false);
  });
});
