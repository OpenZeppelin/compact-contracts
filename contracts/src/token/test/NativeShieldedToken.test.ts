import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/fixtures/address.js';
import {
  contractOwner,
  getQualifiedShieldedCoinInfo,
} from '#test-utils/harness/NativeShieldedTokenTracker.js';
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

const RECIPIENT = utils.encodeToPK('RECIPIENT');
const REFUND_TO = utils.encodeToPK('REFUND_TO');
const ZERO_KEY = { bytes: utils.zeroUint8Array() };

// Metadata
const NAME = 'Native Shielded Token';
const SYMBOL = 'NST';
const DECIMALS = 6n;
const DOMAIN = b32('domain-A');
const INIT = true;
const BAD_INIT = false;

// Amounts
const AMOUNT = 1_000n;
const PARTIAL = 600n;
const MAX_U64 = (1n << 64n) - 1n;

// The simulator's default contract address is zero, which `_mintToSelf` rejects
// as a zero recipient, so the deploy pins a non-zero address.
const SELF_ADDRESS = utils.toHexPadded('SELF');

const deploy = (init = INIT): Promise<NativeShieldedTokenSimulator> =>
  NativeShieldedTokenSimulator.create(DOMAIN, NAME, SYMBOL, DECIMALS, init, {
    contractAddress: SELF_ADDRESS,
  });

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
      expect(await token.tokenColor()).toStrictEqual(color);
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
      ['_mintToSelf', [AMOUNT, b32('n')]],
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

    it('should return a coin with color = tokenColor, value = amount, nonce = arg', async () => {
      const nonce = b32('mint-nonce-1');
      const coin = await token._mint(RECIPIENT, AMOUNT, nonce);
      expect(coin.value).toBe(AMOUNT);
      expect(coin.nonce).toStrictEqual(nonce);
      expect(coin.color).toStrictEqual(await token.tokenColor());
    });

    it('should mint distinct coins of one color for distinct nonces', async () => {
      const first = await token._mint(RECIPIENT, AMOUNT, b32('mint-1'));
      const second = await token._mint(RECIPIENT, AMOUNT, b32('mint-2'));
      expect(second.nonce).not.toStrictEqual(first.nonce);
      expect(second.color).toStrictEqual(first.color);
      expect(second.value).toBe(first.value);
    });

    it('should mint the maximum Uint<64> amount and reject one above it', async () => {
      const coin = await token._mint(RECIPIENT, MAX_U64, b32('max'));
      expect(coin.value).toBe(MAX_U64);
      // Above the bound the argument marshaller rejects before any circuit runs.
      await expect(
        token._mint(RECIPIENT, MAX_U64 + 1n, b32('over')),
      ).rejects.toThrow();
    });

    it('should revert on a zero recipient', async () => {
      await expect(token._mint(ZERO_KEY, AMOUNT, b32('z'))).rejects.toThrow(
        'NativeShieldedToken: invalid recipient',
      );
    });
  });

  describe('_mintToSelf', () => {
    beforeEach(async () => {
      token = await deploy(INIT);
    });

    it('should return a coin with color = tokenColor, value = amount, nonce = arg', async () => {
      const nonce = b32('self-mint-nonce-1');
      const coin = await token._mintToSelf(AMOUNT, nonce);
      expect(coin.value).toBe(AMOUNT);
      expect(coin.nonce).toStrictEqual(nonce);
      expect(coin.color).toStrictEqual(await token.tokenColor());
    });

    it('should mint the same color as _mint', async () => {
      const minted = await token._mint(RECIPIENT, AMOUNT, b32('to-user'));
      const held = await token._mintToSelf(AMOUNT, b32('to-self'));
      expect(held.color).toStrictEqual(minted.color);
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
        // @ts-expect-error retired Either recipient shape
        token._mint(
          utils.eitherUserFromCoinPublicKey(utils.toHexPadded('RECIPIENT')),
          AMOUNT,
          b32('e'),
        ),
      ).rejects.toThrow();
    });

    it('should reject an Either refundTo on _burn', async () => {
      const color = await token.tokenColor();
      await expect(
        token._burn(
          { nonce: b32('coin'), color, value: AMOUNT },
          PARTIAL,
          // @ts-expect-error retired Either recipient shape
          utils.eitherUserFromCoinPublicKey(utils.toHexPadded('REFUND_TO')),
        ),
      ).rejects.toThrow();
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
    });

    it('should return none on a full burn (amount == coin.value)', async () => {
      const coin = await token._mint(RECIPIENT, AMOUNT, b32('burn-full'));
      const res = await token._burn(coin, AMOUNT, REFUND_TO);
      expect(res.is_some).toBe(false);
    });

    it('should return some(refund) with refund.value == coin.value - amount on a partial burn', async () => {
      const coin = await token._mint(RECIPIENT, AMOUNT, b32('burn-part'));
      const res = await token._burn(coin, PARTIAL, REFUND_TO);
      expect(res.is_some).toBe(true);
      expect(res.value.value).toBe(AMOUNT - PARTIAL);
      expect(res.value.color).toStrictEqual(color);
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

    const heldCoin = async (value: bigint, label: string) =>
      getQualifiedShieldedCoinInfo(
        contractOwner(token),
        await token._mintToSelf(value, b32(label)),
      );

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

    it('should return none on a full burn', async () => {
      const coin = await heldCoin(AMOUNT, 'self-full');
      const res = await token._burnFromSelf(coin, AMOUNT);
      expect(res.is_some).toBe(false);
    });

    it('should return change on a partial burn and keep it spendable', async () => {
      const coin = await heldCoin(AMOUNT, 'self-part');
      const res = await token._burnFromSelf(coin, PARTIAL);
      expect(res.is_some).toBe(true);
      expect(res.value.value).toBe(AMOUNT - PARTIAL);
      expect(res.value.color).toStrictEqual(color);

      // Spending the change proves the contract received it, not just returned it.
      const change = await getQualifiedShieldedCoinInfo(
        contractOwner(token),
        res.value,
      );
      const second = await token._burnFromSelf(change, AMOUNT - PARTIAL);
      expect(second.is_some).toBe(false);
    });
  });
});
