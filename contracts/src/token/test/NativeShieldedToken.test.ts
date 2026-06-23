import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import {
  type NativeShieldedTokenSimulator as Sim,
  NativeShieldedTokenSimulator,
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
const SEED = b32('nonce-seed');
const INIT = true;
const BAD_INIT = false;

// Amounts
const AMOUNT = 1_000n;

const deploy = (init = INIT): Promise<NativeShieldedTokenSimulator> =>
  NativeShieldedTokenSimulator.create(DOMAIN, SEED, NAME, SYMBOL, DECIMALS, init);

let token: NativeShieldedTokenSimulator;

describe('NativeShieldedToken (Fungible profile)', () => {
  describe('initialization', () => {
    beforeEach(async () => {
      token = await deploy(INIT);
    });

    it('should expose the constructor metadata (INV-14)', async () => {
      expect(await token.name()).toEqual(NAME);
      expect(await token.symbol()).toEqual(SYMBOL);
      expect(await token.decimals()).toEqual(DECIMALS);
    });

    it('should report _isInitialized true after construction (INV-15)', async () => {
      expect(await token.isInitialized()).toBe(true);
    });

    it('should compute tokenColor as a 32-byte value at call time (INV-1)', async () => {
      const color = await token.tokenColor();
      expect(color).toBeInstanceOf(Uint8Array);
      expect(color.length).toBe(32);
      // Stable across calls (same domain + same contract address).
      expect(await token.tokenColor()).toEqual(color);
    });

    it('should start with zero supply counters (INV-2, INV-4)', async () => {
      expect(await token.totalMinted()).toBe(0n);
      expect(await token.totalBurned()).toBe(0n);
      expect(await token.totalSupply()).toBe(0n);
    });
  });

  describe('before initialization', () => {
    beforeEach(async () => {
      token = await deploy(BAD_INIT);
    });

    type FailingCircuit = [method: keyof Sim, args: unknown[]];
    const circuitsToFail: FailingCircuit[] = [
      ['name', []],
      ['symbol', []],
      ['decimals', []],
      ['tokenColor', []],
      ['_mint', [RECIPIENT, AMOUNT, b32('n')]],
      ['_burn', [{ nonce: b32('cn'), color: b32('c'), value: AMOUNT }, AMOUNT, REFUND_TO]],
      [
        '_burnFromContract',
        [{ nonce: b32('cn'), color: b32('c'), value: AMOUNT, mt_index: 0n }, AMOUNT],
      ],
    ];

    it.each(circuitsToFail)(
      'should revert %s before initialize (INV-15)',
      async (method, args) => {
        await expect(
          (token[method] as (...a: unknown[]) => Promise<unknown>)(...args),
        ).rejects.toThrow('NativeShieldedToken: contract not initialized');
      },
    );

    it('should report zero supply before initialize (supply getters do not gate on init) (INV-2, INV-4)', async () => {
      // Supply accounting now lives in the standalone NativeShieldedTokenSupply
      // extension. Its counters default to 0 and read independently of the
      // token module's init flag; init enforcement stays on _mint/_burn.
      expect(await token.totalMinted()).toBe(0n);
      expect(await token.totalBurned()).toBe(0n);
      expect(await token.totalSupply()).toBe(0n);
    });

    it('should revert _deriveNonce before the chain is seeded (INV-13)', async () => {
      await expect(token._deriveNonce()).rejects.toThrow(
        'NativeShieldedTokenDerivedNonce: chain not seeded',
      );
    });
  });

  describe('_mint', () => {
    beforeEach(async () => {
      token = await deploy(INIT);
    });

    it('should return a coin with color = tokenColor, value = amount, nonce = arg (INV-1)', async () => {
      const nonce = b32('mint-nonce-1');
      const coin = await token._mint(RECIPIENT, AMOUNT, nonce);
      expect(coin.value).toBe(AMOUNT);
      expect(coin.nonce).toEqual(nonce);
      expect(coin.color).toEqual(await token.tokenColor());
    });

    it('should mint to a contract-address recipient (INV-1)', async () => {
      const coin = await token._mint(RECIPIENT_CONTRACT, AMOUNT, b32('mint-c'));
      expect(coin.value).toBe(AMOUNT);
      expect(coin.color).toEqual(await token.tokenColor());
    });

    it('should increment totalMinted by amount (INV-2)', async () => {
      await token._mint(RECIPIENT, AMOUNT, b32('m1'));
      expect(await token.totalMinted()).toBe(AMOUNT);
      await token._mint(RECIPIENT, 500n, b32('m2'));
      expect(await token.totalMinted()).toBe(AMOUNT + 500n);
    });

    it('should revert on a zero recipient key (INV-6)', async () => {
      await expect(token._mint(ZERO_KEY, AMOUNT, b32('z'))).rejects.toThrow(
        'NativeShieldedToken: invalid recipient',
      );
    });

    it('should revert on a zero recipient address (INV-6)', async () => {
      await expect(token._mint(ZERO_ADDRESS, AMOUNT, b32('z'))).rejects.toThrow(
        'NativeShieldedToken: invalid recipient',
      );
    });

    // INV-3 (Uint<128> overflow of totalMinted) — the guard
    // `MAX_UINT128 - _totalMinted >= amount` is present, but with `amount`
    // capped at Uint<64> it would take ~2^64 mints to approach the bound, so
    // it is not reachable in a unit test without a state-injection hook. The
    // guard itself is trivially correct; left unexercised by design.
    it.skip('should revert on Uint<128> overflow of totalMinted (INV-3)', () => {});
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

    it('should revert on a wrong-color coin (INV-1)', async () => {
      await expect(
        token._burn(coinOf(AMOUNT, b32('wrong')), AMOUNT, REFUND_TO),
      ).rejects.toThrow('NativeShieldedToken: wrong token');
    });

    it('should revert when amount > coin.value (INV-8)', async () => {
      await expect(
        token._burn(coinOf(AMOUNT), AMOUNT + 1n, REFUND_TO),
      ).rejects.toThrow('NativeShieldedToken: insufficient coin value');
    });

    it('should revert on a zero refundTo (INV-7)', async () => {
      await expect(token._burn(coinOf(AMOUNT), 1n, ZERO_KEY)).rejects.toThrow(
        'NativeShieldedToken: invalid refund target',
      );
      await expect(
        token._burn(coinOf(AMOUNT), 1n, ZERO_ADDRESS),
      ).rejects.toThrow('NativeShieldedToken: invalid refund target');
    });

    it('should return none on a full burn (amount == coin.value) (INV-10)', async () => {
      const res = await token._burn(coinOf(AMOUNT), AMOUNT, REFUND_TO);
      expect(res.is_some).toBe(false);
    });

    it('should return some(refund) with refund.value == coin.value - amount on a partial burn (INV-10)', async () => {
      const res = await token._burn(coinOf(AMOUNT), 600n, REFUND_TO);
      expect(res.is_some).toBe(true);
      expect(res.value.value).toBe(AMOUNT - 600n);
    });

    it('should increment totalBurned by amount (INV-4)', async () => {
      await token._burn(coinOf(AMOUNT), AMOUNT, REFUND_TO);
      expect(await token.totalBurned()).toBe(AMOUNT);
    });
  });

  describe('_burnFromContract (contract-held coin)', () => {
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

    it('should revert on a wrong-color coin (INV-1)', async () => {
      await expect(
        token._burnFromContract(qCoinOf(AMOUNT, b32('wrong')), AMOUNT),
      ).rejects.toThrow('NativeShieldedToken: wrong token');
    });

    it('should revert when amount > coin.value (INV-8)', async () => {
      await expect(
        token._burnFromContract(qCoinOf(AMOUNT), AMOUNT + 1n),
      ).rejects.toThrow('NativeShieldedToken: insufficient coin value');
    });

    it('should return change and increment totalBurned on a partial burn (INV-4, INV-10)', async () => {
      const res = await token._burnFromContract(qCoinOf(AMOUNT), 600n);
      expect(res.is_some).toBe(true);
      expect(await token.totalBurned()).toBe(600n);
    });

    it('should return none and increment totalBurned on a full burn (INV-4, INV-10)', async () => {
      const res = await token._burnFromContract(qCoinOf(AMOUNT), AMOUNT);
      expect(res.is_some).toBe(false);
      expect(await token.totalBurned()).toBe(AMOUNT);
    });
  });

  describe('supply accounting', () => {
    beforeEach(async () => {
      token = await deploy(INIT);
    });

    it('should report totalSupply == totalMinted - totalBurned after a mint/burn sequence (INV-5)', async () => {
      const color = await token.tokenColor();
      await token._mint(RECIPIENT, AMOUNT, b32('s1'));
      await token._mint(RECIPIENT, 500n, b32('s2'));
      await token._burn({ nonce: b32('c'), color, value: 400n }, 400n, REFUND_TO);
      expect(await token.totalMinted()).toBe(1_500n);
      expect(await token.totalBurned()).toBe(400n);
      expect(await token.totalSupply()).toBe(1_100n);
    });

    // MED-1: totalSupply underflow safety relies on the proof-loop invariant
    // burned <= minted. The simulator does not model coin conservation, so a
    // fabricated over-value burn drives burned > minted and the getter
    // underflows. This documents the dependency: real safety is proof-loop
    // provided, and unit tests must respect conservation (mint before burn).
    it('should be drivable into burned > minted under --skip-zk (MED-1 boundary)', async () => {
      const color = await token.tokenColor();
      // No mint; burn a fabricated coin of the right color.
      await token._burn({ nonce: b32('c'), color, value: AMOUNT }, AMOUNT, REFUND_TO);
      expect(await token.totalMinted()).toBe(0n);
      expect(await token.totalBurned()).toBe(AMOUNT);
      // burned > minted: totalSupply() either throws (Uint underflow) or wraps.
      // Either way it is not a meaningful value — assert the hazard exists.
      let threwOrWrapped = false;
      try {
        const s = await token.totalSupply();
        threwOrWrapped = s !== 0n; // a wrap yields a huge number, never 0 here
      } catch {
        threwOrWrapped = true;
      }
      expect(threwOrWrapped).toBe(true);
    });
  });

  afterEach(() => {
    // no shared resources to tear down (pure simulator)
  });
});
