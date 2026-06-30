import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import {
  NativeShieldedTokenCoreSimulator,
  type NativeShieldedTokenCoreSimulator as Sim,
} from './simulators/NativeShieldedTokenCoreSimulator.js';

const b32 = (label: string): Uint8Array => {
  const u = new Uint8Array(32);
  u.set(new TextEncoder().encode(label).slice(0, 32));
  return u;
};

const RECIPIENT = utils.createEitherTestUser('RECIPIENT');
const REFUND_TO = utils.createEitherTestUser('REFUND_TO');
const { ZERO_KEY, ZERO_ADDRESS } = utils;

const NAME = 'Core Token';
const SYMBOL = 'CORE';
const DECIMALS = 6n;
const DOMAIN_A = b32('domain-A');
const DOMAIN_B = b32('domain-B');
const INIT = true;
const BAD_INIT = false;
const AMOUNT = 1_000n;

const deploy = (init = INIT): Promise<NativeShieldedTokenCoreSimulator> =>
  NativeShieldedTokenCoreSimulator.create(NAME, SYMBOL, DECIMALS, init);

let token: NativeShieldedTokenCoreSimulator;

describe('NativeShieldedTokenCore (bare base)', () => {
  describe('initialization', () => {
    beforeEach(async () => {
      token = await deploy(INIT);
    });

    it('should expose the metadata', async () => {
      expect(await token.name()).toEqual(NAME);
      expect(await token.symbol()).toEqual(SYMBOL);
      expect(await token.decimals()).toEqual(DECIMALS);
      expect(await token.isInitialized()).toBe(true);
    });
  });

  describe('simulator wiring', () => {
    it('should return ledger metadata verbatim from the getters', async () => {
      token = await deploy(INIT);

      const state = await token.getPublicState();

      // The ledger holds exactly what the constructor wrote ...
      expect(state._name).toEqual(NAME);
      expect(state._symbol).toEqual(SYMBOL);
      expect(state._decimals).toEqual(DECIMALS);
      expect(state._isInitialized).toBe(true);

      // ... and each getter reads its own slot straight from that ledger.
      expect(await token.name()).toEqual(state._name);
      expect(await token.symbol()).toEqual(state._symbol);
      expect(await token.decimals()).toEqual(state._decimals);
      expect(await token.isInitialized()).toBe(state._isInitialized);
    });

    it('should keep getters in concert with distinct stored metadata', async () => {
      token = await NativeShieldedTokenCoreSimulator.create(
        'Another Asset',
        'AAA',
        18n,
        INIT,
      );

      const state = await token.getPublicState();

      expect(await token.name()).toEqual(state._name);
      expect(await token.symbol()).toEqual(state._symbol);
      expect(await token.decimals()).toEqual(state._decimals);
      expect(state._name).toEqual('Another Asset');
      expect(state._symbol).toEqual('AAA');
      expect(state._decimals).toEqual(18n);
    });
  });

  describe('init guards', () => {
    it('assertInitialized passes and assertNotInitialized reverts once initialized', async () => {
      token = await deploy(INIT);
      await token.assertInitialized();
      await expect(token.assertNotInitialized()).rejects.toThrow(
        'NativeShieldedToken: contract already initialized',
      );
    });

    it('assertNotInitialized passes and assertInitialized reverts when uninitialized', async () => {
      token = await deploy(BAD_INIT);
      await token.assertNotInitialized();
      await expect(token.assertInitialized()).rejects.toThrow(
        'NativeShieldedToken: contract not initialized',
      );
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
      ['assertInitialized', []],
      ['name', []],
      ['symbol', []],
      ['decimals', []],
      ['tokenColor', [DOMAIN_A]],
      ['_mint', [DOMAIN_A, RECIPIENT, AMOUNT, b32('n')]],
      [
        '_burn',
        [
          DOMAIN_A,
          { nonce: b32('cn'), color: b32('c'), value: AMOUNT },
          AMOUNT,
          REFUND_TO,
        ],
      ],
      [
        '_burnFromSelf',
        [
          DOMAIN_A,
          { nonce: b32('cn'), color: b32('c'), value: AMOUNT, mt_index: 0n },
          AMOUNT,
        ],
      ],
    ];

    it.each(
      circuitsToFail,
    )('should revert %s before initialize', async (method, args) => {
      await expect(
        (token[method] as (...a: unknown[]) => Promise<unknown>)(...args),
      ).rejects.toThrow('NativeShieldedToken: contract not initialized');
    });
  });

  describe('_mint (per domain)', () => {
    beforeEach(async () => {
      token = await deploy(INIT);
    });

    it('should return a coin with color = tokenColor(domain), value, nonce', async () => {
      const nonce = b32('m-a');
      const coin = await token._mint(DOMAIN_A, RECIPIENT, AMOUNT, nonce);
      expect(coin.value).toBe(AMOUNT);
      expect(coin.nonce).toEqual(nonce);
      expect(coin.color).toEqual(await token.tokenColor(DOMAIN_A));
    });

    it('should revert on a zero recipient', async () => {
      await expect(
        token._mint(DOMAIN_A, ZERO_KEY, AMOUNT, b32('z')),
      ).rejects.toThrow('NativeShieldedToken: invalid recipient');
      await expect(
        token._mint(DOMAIN_A, ZERO_ADDRESS, AMOUNT, b32('z')),
      ).rejects.toThrow('NativeShieldedToken: invalid recipient');
    });
  });

  describe('multi-domain isolation', () => {
    beforeEach(async () => {
      token = await deploy(INIT);
    });

    it('should give distinct colors to distinct domains', async () => {
      expect(await token.tokenColor(DOMAIN_A)).not.toEqual(
        await token.tokenColor(DOMAIN_B),
      );
    });

    it('should reject burning a domain-A coin under domain B (wrong color)', async () => {
      const colorA = await token.tokenColor(DOMAIN_A);
      await expect(
        token._burn(
          DOMAIN_B,
          { nonce: b32('c'), color: colorA, value: AMOUNT },
          AMOUNT,
          REFUND_TO,
        ),
      ).rejects.toThrow('NativeShieldedToken: wrong token');
    });
  });

  describe('_burn (per domain)', () => {
    let colorA: Uint8Array;
    beforeEach(async () => {
      token = await deploy(INIT);
      colorA = await token.tokenColor(DOMAIN_A);
    });

    const coinOf = (value: bigint, c: Uint8Array = colorA) => ({
      nonce: b32('coin'),
      color: c,
      value,
    });

    it('should revert when amount > coin.value', async () => {
      await expect(
        token._burn(DOMAIN_A, coinOf(AMOUNT), AMOUNT + 1n, REFUND_TO),
      ).rejects.toThrow('NativeShieldedToken: insufficient coin value');
    });

    it('should revert on a zero refundTo', async () => {
      await expect(
        token._burn(DOMAIN_A, coinOf(AMOUNT), 1n, ZERO_KEY),
      ).rejects.toThrow('NativeShieldedToken: invalid refund target');
    });

    it('should return none on a full burn and some(refund) on a partial burn', async () => {
      expect(
        (await token._burn(DOMAIN_A, coinOf(AMOUNT), AMOUNT, REFUND_TO))
          .is_some,
      ).toBe(false);
      const partial = await token._burn(
        DOMAIN_A,
        coinOf(AMOUNT),
        600n,
        REFUND_TO,
      );
      expect(partial.is_some).toBe(true);
      expect(partial.value.value).toBe(AMOUNT - 600n);
    });
  });

  describe('_burnFromSelf (per domain)', () => {
    let colorA: Uint8Array;
    beforeEach(async () => {
      token = await deploy(INIT);
      colorA = await token.tokenColor(DOMAIN_A);
    });

    const qCoinOf = (value: bigint, c: Uint8Array = colorA) => ({
      nonce: b32('qcoin'),
      color: c,
      value,
      mt_index: 0n,
    });

    it('should return change on a partial burn and none on a full burn', async () => {
      expect(
        (await token._burnFromSelf(DOMAIN_A, qCoinOf(AMOUNT), 600n)).is_some,
      ).toBe(true);
      expect(
        (await token._burnFromSelf(DOMAIN_A, qCoinOf(AMOUNT), AMOUNT)).is_some,
      ).toBe(false);
    });

    it('should reject a wrong-color coin', async () => {
      await expect(
        token._burnFromSelf(DOMAIN_A, qCoinOf(AMOUNT, b32('wrong')), AMOUNT),
      ).rejects.toThrow('NativeShieldedToken: wrong token');
    });
  });
});
