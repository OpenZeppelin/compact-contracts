import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import {
  type NativeShieldedTokenFamilySimulator as Sim,
  NativeShieldedTokenFamilySimulator,
} from './simulators/NativeShieldedTokenFamilySimulator.js';

const b32 = (label: string): Uint8Array => {
  const u = new Uint8Array(32);
  u.set(new TextEncoder().encode(label).slice(0, 32));
  return u;
};

const RECIPIENT = utils.createEitherTestUser('RECIPIENT');
const REFUND_TO = utils.createEitherTestUser('REFUND_TO');
const { ZERO_KEY, ZERO_ADDRESS } = utils;

const NAME = 'Family Token';
const SYMBOL = 'FAM';
const DECIMALS = 6n;
const DOMAIN_A = b32('domain-A');
const DOMAIN_B = b32('domain-B');
const INIT = true;
const BAD_INIT = false;
const AMOUNT = 1_000n;

const deploy = (init = INIT): Promise<NativeShieldedTokenFamilySimulator> =>
  NativeShieldedTokenFamilySimulator.create(NAME, SYMBOL, DECIMALS, init);

let token: NativeShieldedTokenFamilySimulator;

describe('NativeShieldedTokenFamily (Family profile)', () => {
  describe('initialization', () => {
    beforeEach(async () => {
      token = await deploy(INIT);
    });

    it('should expose the family metadata', async () => {
      expect(await token.name()).toEqual(NAME);
      expect(await token.symbol()).toEqual(SYMBOL);
      expect(await token.decimals()).toEqual(DECIMALS);
      expect(await token.isInitialized()).toBe(true);
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
      ['tokenColor', [DOMAIN_A]],
      ['_mint', [DOMAIN_A, RECIPIENT, AMOUNT, b32('n')]],
      ['_burn', [DOMAIN_A, { nonce: b32('cn'), color: b32('c'), value: AMOUNT }, AMOUNT, REFUND_TO]],
      [
        '_burnFromSelf',
        [DOMAIN_A, { nonce: b32('cn'), color: b32('c'), value: AMOUNT, mt_index: 0n }, AMOUNT],
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
        token._burn(DOMAIN_B, { nonce: b32('c'), color: colorA, value: AMOUNT }, AMOUNT, REFUND_TO),
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
      expect((await token._burn(DOMAIN_A, coinOf(AMOUNT), AMOUNT, REFUND_TO)).is_some).toBe(false);
      const partial = await token._burn(DOMAIN_A, coinOf(AMOUNT), 600n, REFUND_TO);
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
      expect((await token._burnFromSelf(DOMAIN_A, qCoinOf(AMOUNT), 600n)).is_some).toBe(true);
      expect((await token._burnFromSelf(DOMAIN_A, qCoinOf(AMOUNT), AMOUNT)).is_some).toBe(false);
    });

    it('should reject a wrong-color coin', async () => {
      await expect(
        token._burnFromSelf(DOMAIN_A, qCoinOf(AMOUNT, b32('wrong')), AMOUNT),
      ).rejects.toThrow('NativeShieldedToken: wrong token');
    });
  });
});
