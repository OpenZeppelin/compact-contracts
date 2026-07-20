import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/fixtures/address.js';
import { encodeShieldedCoinInfo } from '#test-utils/fixtures/nativeShieldedToken.js';
import { shieldedTestRecipient } from '#test-utils/fixtures/shieldedKey.js';
import {
  NativeShieldedTokenSimulator,
  type NativeShieldedTokenSimulator as Sim,
} from './simulators/NativeShieldedTokenSimulator.js';

// Helpers
const b32 = (label: string): Uint8Array => {
  const u = new Uint8Array(32);
  u.set(new TextEncoder().encode(label).slice(0, 32));
  return u;
};

// Users / recipients
const RECIPIENT = utils.createEitherTestUser('RECIPIENT');
const RECIPIENT_CONTRACT = utils.createEitherTestContractAddress('RECIPIENT_C');
const REFUND_TO = utils.createEitherTestUser('REFUND_TO');
const { ZERO_KEY, ZERO_ADDRESS } = utils;

// Metadata
const NAME = 'Native Shielded Token';
const SYMBOL = 'NST';
const DECIMALS = 6n;
const DOMAIN = b32('domain-A');
const INIT = true;
const BAD_INIT = false;

// Amounts
const AMOUNT = 1_000n;

const deploy = (init = INIT): Promise<NativeShieldedTokenSimulator> =>
  NativeShieldedTokenSimulator.create(DOMAIN, NAME, SYMBOL, DECIMALS, init);

let token: NativeShieldedTokenSimulator;

// Resolved once in `beforeAll` after the first `create()`: on live the harness
// then publishes MIDNIGHT_DEPLOYER_COIN_PK, so this is the deployer wallet's own
// coin public key (an encryption key the node can resolve as a mint recipient /
// refund target); on dry it is the synthetic `createEitherTestUser('RECIPIENT')`,
// identical to the un-gated tests' `RECIPIENT`.
let Z_RECIPIENT: ReturnType<typeof shieldedTestRecipient>;

// A backend-aware mint nonce, delegated to the shared coin builder: on live every
// coin gets a fresh random nonce (the local node persists nullifiers/commitments
// across runs, so a fixed nonce would replay a spent coin — Custom error 103); on
// dry it is the passed seed (else zero) so `coin.nonce` assertions stay reproducible.
const mintNonce = (seed?: Uint8Array): Uint8Array =>
  encodeShieldedCoinInfo(new Uint8Array(32), 0n, seed).nonce;

describe('NativeShieldedToken (Fungible profile)', () => {
  // Resolve the shared recipient once: on live it needs a prior `create()` (which
  // triggers the wallet sync that publishes the deployer key); on dry it is
  // synthetic. Mutating groups still deploy a fresh token per test in `beforeEach`.
  beforeAll(async () => {
    token = await deploy(INIT);
    Z_RECIPIENT = shieldedTestRecipient();
  });

  describe('initialization', () => {
    beforeEach(async () => {
      token = await deploy(INIT);
    });

    it('should expose the constructor metadata', async () => {
      expect(await token.name()).toEqual(NAME);
      expect(await token.symbol()).toEqual(SYMBOL);
      expect(await token.decimals()).toEqual(DECIMALS);
    });

    it('should report initialized after construction', async () => {
      expect(await token.isInitialized()).toBe(true);
    });

    it('should compute tokenColor as a 32-byte value at call time', async () => {
      const color = await token.tokenColor();
      expect(color).toBeInstanceOf(Uint8Array);
      expect(color.length).toBe(32);
      // Stable across calls (same domain + same contract address).
      expect(await token.tokenColor()).toEqual(color);
    });
  });

  describe('before initialization', () => {
    beforeEach(async () => {
      token = await deploy(BAD_INIT);
    });

    it('should report not initialized', async () => {
      expect(await token.isInitialized()).toBe(false);
    });

    type FailingCircuit = [method: keyof Sim, args: unknown[]];
    const circuitsToFail: FailingCircuit[] = [
      ['name', []],
      ['symbol', []],
      ['decimals', []],
      ['tokenColor', []],
      ['_mint', [RECIPIENT, AMOUNT, b32('n')]],
      [
        '_burn',
        [
          { nonce: b32('cn'), color: b32('c'), value: AMOUNT },
          AMOUNT,
          REFUND_TO,
        ],
      ],
      [
        '_burnFromSelf',
        [
          { nonce: b32('cn'), color: b32('c'), value: AMOUNT, mt_index: 0n },
          AMOUNT,
        ],
      ],
    ];

    it.each(circuitsToFail)(
      'should revert %s before initialize',
      async (method, args) => {
        await expect(
          (token[method] as (...a: unknown[]) => Promise<unknown>)(...args),
        ).rejects.toThrow('NativeShieldedToken: contract not initialized');
      },
    );
  });

  describe('_mint', () => {
    beforeEach(async () => {
      token = await deploy(INIT);
    });

    // `_mint` creates a NEW coin (`mintShieldedToken`, no input coin to receive),
    // so it runs on both backends: recipient → the node-resolvable `Z_RECIPIENT`,
    // nonce → a backend-aware value captured locally (a fixed nonce would replay a
    // prior run's commitment on live). The mint echoes the nonce back, so assert
    // against the one we passed, never a hardcoded value.
    it('should return a coin with color = tokenColor, value = amount, nonce = arg', async () => {
      const nonce = mintNonce(b32('mint-nonce-1'));
      const coin = await token._mint(Z_RECIPIENT, AMOUNT, nonce);
      expect(coin.value).toBe(AMOUNT);
      expect(coin.nonce).toEqual(nonce);
      expect(coin.color).toEqual(await token.tokenColor());
    });

    // Minting to a contract-address recipient: a mint only creates a commitment
    // (no ciphertext / no encryption-key resolution needed), so a synthetic
    // contract address is fine on both backends; only the nonce must be
    // backend-aware to avoid replaying a prior run's commitment on live.
    it('should mint to a contract-address recipient', async () => {
      const coin = await token._mint(
        RECIPIENT_CONTRACT,
        AMOUNT,
        mintNonce(b32('mint-c')),
      );
      expect(coin.value).toBe(AMOUNT);
      expect(coin.color).toEqual(await token.tokenColor());
    });

    it('should revert on a zero recipient key', async () => {
      await expect(token._mint(ZERO_KEY, AMOUNT, b32('z'))).rejects.toThrow(
        'NativeShieldedToken: invalid recipient',
      );
    });

    it('should revert on a zero recipient address', async () => {
      await expect(token._mint(ZERO_ADDRESS, AMOUNT, b32('z'))).rejects.toThrow(
        'NativeShieldedToken: invalid recipient',
      );
    });
  });

  describe('_burn (same-tx coin)', () => {
    let color: Uint8Array;
    beforeEach(async () => {
      token = await deploy(INIT);
      color = await token.tokenColor();
    });

    const coinOf = (value: bigint, c: Uint8Array = color) => ({
      nonce: b32('coin'),
      color: c,
      value,
    });

    // Reverts assert-and-throw on the guards BEFORE the coin is received/spent, so
    // the fabricated coin never reaches Zswap — valid on both backends, un-gated.
    it('should revert on a wrong-color coin', async () => {
      await expect(
        token._burn(coinOf(AMOUNT, b32('wrong')), AMOUNT, REFUND_TO),
      ).rejects.toThrow('NativeShieldedToken: wrong token');
    });

    it('should revert when amount > coin.value', async () => {
      await expect(
        token._burn(coinOf(AMOUNT), AMOUNT + 1n, REFUND_TO),
      ).rejects.toThrow('NativeShieldedToken: insufficient coin value');
    });

    it('should revert on a zero refundTo', async () => {
      await expect(token._burn(coinOf(AMOUNT), 1n, ZERO_KEY)).rejects.toThrow(
        'NativeShieldedToken: invalid refund target',
      );
      await expect(
        token._burn(coinOf(AMOUNT), 1n, ZERO_ADDRESS),
      ).rejects.toThrow('NativeShieldedToken: invalid refund target');
    });

    // The happy paths actually receive and spend the coin. A fabricated coin has
    // no on-chain existence on live (`receiveShielded`/`sendImmediateShielded`
    // reverts), so split like ShieldedTreasury: keep the fabricated-coin assertions
    // as dry coverage, and mint→burn a real coin on live.
    describe.skipIf(isLiveBackend())('happy paths (dry only)', () => {
      it('should return none on a full burn (amount == coin.value)', async () => {
        const res = await token._burn(coinOf(AMOUNT), AMOUNT, REFUND_TO);
        expect(res.is_some).toBe(false);
      });

      it('should return some(refund) with refund.value == coin.value - amount on a partial burn', async () => {
        const res = await token._burn(coinOf(AMOUNT), 600n, REFUND_TO);
        expect(res.is_some).toBe(true);
        expect(res.value.value).toBe(AMOUNT - 600n);
      });
    });

    describe.runIf(isLiveBackend())('happy paths on live', () => {
      // LIVE: `_burn` receives a same-tx coin and spends it via
      // `sendImmediateShielded`. The coin's color is this token's `tokenColor()`
      // (contract-derived, NOT a genesis color), so it must come from a prior
      // `_mint` this run — a fabricated coin can't be received. `refundTo` receives
      // the partial-burn change, so it must be node-resolvable (`Z_RECIPIENT`).
      // Confirm against a node that the minted coin is spendable in the burn tx
      // (the wallet paying it into the contract).
      it('should return none on a full burn (amount == coin.value)', async () => {
        const coin = await token._mint(Z_RECIPIENT, AMOUNT, mintNonce());
        const res = await token._burn(coin, AMOUNT, Z_RECIPIENT);
        expect(res.is_some).toBe(false);
      });

      it('should return some(refund) with refund.value == coin.value - amount on a partial burn', async () => {
        const coin = await token._mint(Z_RECIPIENT, AMOUNT, mintNonce());
        const res = await token._burn(coin, 600n, Z_RECIPIENT);
        expect(res.is_some).toBe(true);
        expect(res.value.value).toBe(AMOUNT - 600n);
      });
    });
  });

  describe('_burnFromSelf (contract-held coin)', () => {
    let color: Uint8Array;
    beforeEach(async () => {
      token = await deploy(INIT);
      color = await token.tokenColor();
    });

    const qCoinOf = (value: bigint, c: Uint8Array = color) => ({
      nonce: b32('qcoin'),
      color: c,
      value,
      mt_index: 0n,
    });

    // Reverts assert-and-throw on the guards BEFORE the `sendShielded` spend, so
    // the fabricated coin never reaches Zswap — valid on both backends, un-gated.
    it('should revert on a wrong-color coin', async () => {
      await expect(
        token._burnFromSelf(qCoinOf(AMOUNT, b32('wrong')), AMOUNT),
      ).rejects.toThrow('NativeShieldedToken: wrong token');
    });

    it('should revert when amount > coin.value', async () => {
      await expect(
        token._burnFromSelf(qCoinOf(AMOUNT), AMOUNT + 1n),
      ).rejects.toThrow('NativeShieldedToken: insufficient coin value');
    });

    // The happy paths spend a coin the contract already holds. On live that means
    // a real Merkle-tree entry with a valid `mt_index`; a fabricated one reverts.
    // Split like ShieldedTreasury: keep the fabricated-coin assertions as dry
    // coverage, and mint→capture→burn on live.
    describe.skipIf(isLiveBackend())('happy paths (dry only)', () => {
      it('should return change on a partial burn', async () => {
        const res = await token._burnFromSelf(qCoinOf(AMOUNT), 600n);
        expect(res.is_some).toBe(true);
      });

      it('should return none on a full burn', async () => {
        const res = await token._burnFromSelf(qCoinOf(AMOUNT), AMOUNT);
        expect(res.is_some).toBe(false);
      });
    });

    describe.runIf(isLiveBackend())('happy paths on live', () => {
      // LIVE: `_burnFromSelf` spends a coin the CONTRACT already holds (a
      // Merkle-tree entry with a valid `mt_index`). Such a coin must be minted to
      // this contract and its `mt_index` recovered from the global zswap
      // ledger-events stream (ShieldedCoinTracker) once the mint finalizes — it
      // cannot be known from the spec alone. The `mt_index: 0n` below is a
      // placeholder; wire the real index in when running against a node.
      it('should return change on a partial burn', async () => {
        const coin = await token._mint(Z_RECIPIENT, AMOUNT, mintNonce());
        const res = await token._burnFromSelf({ ...coin, mt_index: 0n }, 600n);
        expect(res.is_some).toBe(true);
      });

      it('should return none on a full burn', async () => {
        const coin = await token._mint(Z_RECIPIENT, AMOUNT, mintNonce());
        const res = await token._burnFromSelf(
          { ...coin, mt_index: 0n },
          AMOUNT,
        );
        expect(res.is_some).toBe(false);
      });
    });
  });
});
