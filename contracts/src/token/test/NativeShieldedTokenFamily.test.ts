import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/fixtures/address.js';
import {
  contractOwner,
  getQualifiedShieldedCoinInfo,
} from '#test-utils/harness/NativeShieldedTokenTracker.js';
import {
  NativeShieldedTokenFamilySimulator,
  type NativeShieldedTokenFamilySimulator as Sim,
} from './simulators/NativeShieldedTokenFamilySimulator.js';

const b32 = (label: string): Uint8Array => {
  const u = new Uint8Array(32);
  u.set(new TextEncoder().encode(label).slice(0, 32));
  return u;
};

const RECIPIENT = utils.encodeToPK('RECIPIENT');
const REFUND_TO = utils.encodeToPK('REFUND_TO');
const ZERO_KEY = { bytes: utils.zeroUint8Array() };

const NAME = 'Family Token';
const SYMBOL = 'FAM';
const DECIMALS = 6n;
const DOMAIN_A = b32('domain-A');
const DOMAIN_B = b32('domain-B');
const INIT = true;
const BAD_INIT = false;
const AMOUNT = 1_000n;
const PARTIAL = 600n;
const MAX_U64 = (1n << 64n) - 1n;

// The simulator's default contract address is zero, which `_mintToSelf` rejects
// as a zero recipient, so the deploy pins a non-zero address.
const SELF_ADDRESS = utils.toHexPadded('SELF');

const deploy = (init = INIT): Promise<NativeShieldedTokenFamilySimulator> =>
  NativeShieldedTokenFamilySimulator.create(NAME, SYMBOL, DECIMALS, init, {
    contractAddress: SELF_ADDRESS,
  });

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
      ['_mintToSelf', [DOMAIN_A, AMOUNT, b32('n')]],
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
      expect(coin.nonce).toStrictEqual(nonce);
      expect(coin.color).toStrictEqual(await token.tokenColor(DOMAIN_A));
    });

    it('should mint distinct coins of one color for distinct nonces', async () => {
      const first = await token._mint(DOMAIN_A, RECIPIENT, AMOUNT, b32('m-1'));
      const second = await token._mint(DOMAIN_A, RECIPIENT, AMOUNT, b32('m-2'));
      expect(second.nonce).not.toStrictEqual(first.nonce);
      expect(second.color).toStrictEqual(first.color);
      expect(second.value).toBe(first.value);
    });

    it('should mint the maximum Uint<64> amount and reject one above it', async () => {
      const coin = await token._mint(DOMAIN_A, RECIPIENT, MAX_U64, b32('max'));
      expect(coin.value).toBe(MAX_U64);
      // Above the bound the argument marshaller rejects before any circuit runs.
      await expect(
        token._mint(DOMAIN_A, RECIPIENT, MAX_U64 + 1n, b32('over')),
      ).rejects.toThrow();
    });

    it('should revert on a zero recipient', async () => {
      await expect(
        token._mint(DOMAIN_A, ZERO_KEY, AMOUNT, b32('z')),
      ).rejects.toThrow('NativeShieldedToken: invalid recipient');
    });
  });

  describe('_mintToSelf (per domain)', () => {
    beforeEach(async () => {
      token = await deploy(INIT);
    });

    it('should return a coin with color = tokenColor(domain), value, nonce', async () => {
      const nonce = b32('self-m-a');
      const coin = await token._mintToSelf(DOMAIN_A, AMOUNT, nonce);
      expect(coin.value).toBe(AMOUNT);
      expect(coin.nonce).toStrictEqual(nonce);
      expect(coin.color).toStrictEqual(await token.tokenColor(DOMAIN_A));
    });

    it('should keep distinct domains on distinct colors', async () => {
      const a = await token._mintToSelf(DOMAIN_A, AMOUNT, b32('self-a'));
      const b = await token._mintToSelf(DOMAIN_B, AMOUNT, b32('self-b'));
      expect(a.color).not.toStrictEqual(b.color);
    });
  });

  // `@ts-expect-error` is the guarantee; the runtime throw is the argument
  // marshaller's backstop.
  describe('retired Either recipient shape', () => {
    beforeEach(async () => {
      token = await deploy(INIT);
    });

    it('should reject an Either recipient on _mint', async () => {
      await expect(
        token._mint(
          DOMAIN_A,
          // @ts-expect-error retired Either recipient shape
          utils.eitherUserFromCoinPublicKey(utils.toHexPadded('RECIPIENT')),
          AMOUNT,
          b32('e'),
        ),
      ).rejects.toThrow();
    });

    it('should reject an Either refundTo on _burn', async () => {
      const colorA = await token.tokenColor(DOMAIN_A);
      await expect(
        token._burn(
          DOMAIN_A,
          { nonce: b32('coin'), color: colorA, value: AMOUNT },
          PARTIAL,
          // @ts-expect-error retired Either recipient shape
          utils.eitherUserFromCoinPublicKey(utils.toHexPadded('REFUND_TO')),
        ),
      ).rejects.toThrow();
    });
  });

  describe('multi-domain isolation', () => {
    beforeEach(async () => {
      token = await deploy(INIT);
    });

    it('should give distinct colors to distinct domains', async () => {
      expect(await token.tokenColor(DOMAIN_A)).not.toStrictEqual(
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

    it('should return none on a full burn', async () => {
      const coin = await token._mint(
        DOMAIN_A,
        RECIPIENT,
        AMOUNT,
        b32('burn-full'),
      );
      const res = await token._burn(DOMAIN_A, coin, AMOUNT, REFUND_TO);
      expect(res.is_some).toBe(false);
    });

    it('should return some(refund) with refund.value == coin.value - amount on a partial burn', async () => {
      const coin = await token._mint(
        DOMAIN_A,
        RECIPIENT,
        AMOUNT,
        b32('burn-part'),
      );
      const res = await token._burn(DOMAIN_A, coin, PARTIAL, REFUND_TO);
      expect(res.is_some).toBe(true);
      expect(res.value.value).toBe(AMOUNT - PARTIAL);
      expect(res.value.color).toStrictEqual(colorA);
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

    const heldCoin = async (value: bigint, label: string) =>
      getQualifiedShieldedCoinInfo(
        contractOwner(token),
        await token._mintToSelf(DOMAIN_A, value, b32(label)),
      );

    it('should reject a wrong-color coin', async () => {
      await expect(
        token._burnFromSelf(DOMAIN_A, qCoinOf(AMOUNT, b32('wrong')), AMOUNT),
      ).rejects.toThrow('NativeShieldedToken: wrong token');
    });

    it('should revert when amount > coin.value', async () => {
      await expect(
        token._burnFromSelf(DOMAIN_A, qCoinOf(AMOUNT), AMOUNT + 1n),
      ).rejects.toThrow('NativeShieldedToken: insufficient coin value');
    });

    it('should return none on a full burn', async () => {
      const coin = await heldCoin(AMOUNT, 'self-full');
      const res = await token._burnFromSelf(DOMAIN_A, coin, AMOUNT);
      expect(res.is_some).toBe(false);
    });

    it('should return change on a partial burn and keep it spendable', async () => {
      const coin = await heldCoin(AMOUNT, 'self-part');
      const res = await token._burnFromSelf(DOMAIN_A, coin, PARTIAL);
      expect(res.is_some).toBe(true);
      expect(res.value.value).toBe(AMOUNT - PARTIAL);
      expect(res.value.color).toStrictEqual(colorA);

      // Spending the change proves the contract received it, not just returned it.
      const change = await getQualifiedShieldedCoinInfo(
        contractOwner(token),
        res.value,
      );
      const second = await token._burnFromSelf(
        DOMAIN_A,
        change,
        AMOUNT - PARTIAL,
      );
      expect(second.is_some).toBe(false);
    });
  });
});
