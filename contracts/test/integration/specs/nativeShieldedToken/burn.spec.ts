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

const ZERO_REFUND = {
  is_left: true,
  left: { bytes: new Uint8Array(32) },
  right: { bytes: new Uint8Array(32) },
};

/**
 * Burn revert guards on the proof loop.
 *
 * `_burn` asserts color, value, and refundTo BEFORE `receiveShielded`, so these
 * guards are reachable during circuit execution / proving without the caller
 * owning a real coin — the tx fails to construct/prove on the assert.
 *
 * The HAPPY burn paths (full / partial-with-refund) and the wallet round-trip
 * require the caller to already own a SYNCED coin of the contract's color. A
 * contract mint emits no coin ciphertext, and the testkit `MidnightWalletProvider`
 * exposes no coin-import hook (`ZswapLocalState.watchFor` is ledger-level only),
 * so those paths are not expressible against this wallet as shipped. See the
 * test artifact "Out of Scope". The unit suite covers the happy `_burn`
 * return-shape and accounting (INV-4, INV-10) in the simulator.
 *
 * Verifies on the proof loop: INV-1 (wrong-color rejection — the only barrier,
 * since the protocol receive does not validate color), INV-7 (zero refundTo),
 * INV-8 (amount > coin.value).
 */
describe('Burn — revert guards (proof loop)', () => {
  let kit: NativeShieldedTokenV1Kit;
  let color: Uint8Array;
  let refundTo: {
    is_left: boolean;
    left: { bytes: Uint8Array };
    right: { bytes: Uint8Array };
  };

  beforeAll(async () => {
    kit = await deployNativeShieldedTokenV1();
    color = (await kit.deployed.callTx.tokenColor()).private.result;
    refundTo = {
      is_left: true,
      left: { bytes: encodeCoinPublicKey(kit.wallet.getCoinPublicKey()) },
      right: { bytes: new Uint8Array(32) },
    };
  });

  afterAll(async () => {
    await kit?.teardown();
  });

  it('should reject burning a wrong-color coin (INV-1)', async () => {
    const coin = { nonce: b32('c'), color: b32('wrong-color'), value: 1_000n };
    await expect(kit.deployed.callTx._burn(coin, 1_000n, refundTo)).rejects.toThrow(
      'NativeShieldedToken: wrong token',
    );
  });

  it('should reject when amount > coin.value (INV-8)', async () => {
    const coin = { nonce: b32('c'), color, value: 1_000n };
    await expect(kit.deployed.callTx._burn(coin, 1_001n, refundTo)).rejects.toThrow(
      'NativeShieldedToken: insufficient coin value',
    );
  });

  it('should reject a zero refundTo (INV-7)', async () => {
    const coin = { nonce: b32('c'), color, value: 1_000n };
    await expect(kit.deployed.callTx._burn(coin, 500n, ZERO_REFUND)).rejects.toThrow(
      'NativeShieldedToken: invalid refund target',
    );
  });
});

/**
 * `_burnFromContract` revert guards (proof loop). Same reasoning: color and
 * value asserts fire before `sendShielded`. The happy Merkle-spend path
 * requires a contract-held coin with a valid `mt_index` (a prior finalized
 * mint-to-self plus tree residency) — see the artifact.
 *
 * Verifies: INV-1 (wrong color), INV-8 (amount > coin.value).
 */
describe('BurnFromContract — revert guards (proof loop)', () => {
  let kit: NativeShieldedTokenV1Kit;
  let color: Uint8Array;

  beforeAll(async () => {
    kit = await deployNativeShieldedTokenV1();
    color = (await kit.deployed.callTx.tokenColor()).private.result;
  });

  afterAll(async () => {
    await kit?.teardown();
  });

  it('should reject a wrong-color contract-held coin (INV-1)', async () => {
    const coin = { nonce: b32('q'), color: b32('wrong-color'), value: 1_000n, mt_index: 0n };
    await expect(kit.deployed.callTx._burnFromContract(coin, 1_000n)).rejects.toThrow(
      'NativeShieldedToken: wrong token',
    );
  });

  it('should reject when amount > coin.value (INV-8)', async () => {
    const coin = { nonce: b32('q'), color, value: 1_000n, mt_index: 0n };
    await expect(kit.deployed.callTx._burnFromContract(coin, 1_001n)).rejects.toThrow(
      'NativeShieldedToken: insufficient coin value',
    );
  });
});
