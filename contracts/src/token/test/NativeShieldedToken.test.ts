import { beforeEach, describe, expect, it } from 'vitest';
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
const INIT = true;
const BAD_INIT = false;

// Amounts
const AMOUNT = 1_000n;

const deploy = (init = INIT): Promise<NativeShieldedTokenSimulator> =>
  NativeShieldedTokenSimulator.create(DOMAIN, NAME, SYMBOL, DECIMALS, init);

let token: NativeShieldedTokenSimulator;

describe('NativeShieldedToken (Fungible profile)', () => {
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
      ['_burn', [{ nonce: b32('cn'), color: b32('c'), value: AMOUNT }, AMOUNT, REFUND_TO]],
      [
        '_burnFromSelf',
        [{ nonce: b32('cn'), color: b32('c'), value: AMOUNT, mt_index: 0n }, AMOUNT],
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

    it('should return a coin with color = tokenColor, value = amount, nonce = arg', async () => {
      const nonce = b32('mint-nonce-1');
      const coin = await token._mint(RECIPIENT, AMOUNT, nonce);
      expect(coin.value).toBe(AMOUNT);
      expect(coin.nonce).toEqual(nonce);
      expect(coin.color).toEqual(await token.tokenColor());
    });

    it('should mint to a contract-address recipient', async () => {
      const coin = await token._mint(RECIPIENT_CONTRACT, AMOUNT, b32('mint-c'));
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

    it('should return change on a partial burn', async () => {
      const res = await token._burnFromSelf(qCoinOf(AMOUNT), 600n);
      expect(res.is_some).toBe(true);
    });

    it('should return none on a full burn', async () => {
      const res = await token._burnFromSelf(qCoinOf(AMOUNT), AMOUNT);
      expect(res.is_some).toBe(false);
    });
  });
});
