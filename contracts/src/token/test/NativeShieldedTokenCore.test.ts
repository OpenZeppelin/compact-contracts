import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/fixtures/address.js';
import {
  contractOwner,
  getQualifiedShieldedCoinInfo,
} from '#test-utils/harness/NativeShieldedTokenTracker.js';
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
const FOREIGN_CONTRACT = utils.createEitherTestContractAddress('OTHER');
const ZERO_KEY = utils.ZERO_KEY;
const ZERO_ADDRESS = utils.ZERO_ADDRESS;

const NAME = 'Core Token';
const SYMBOL = 'CORE';
const DECIMALS = 6n;
const DOMAIN_A = b32('domain-A');
const DOMAIN_B = b32('domain-B');
const INIT = true;
const BAD_INIT = false;
const AMOUNT = 1_000n;
const PARTIAL = 600n;
const MAX_U64 = (1n << 64n) - 1n;

// The simulator's default contract address is zero, which `_mint` rejects as a
// zero recipient, so the self arm needs a pinned non-zero address.
const SELF_ADDRESS = utils.toHexPadded('SELF');
const SELF_ARM = utils.createEitherTestContractAddress('SELF');
const AT_SELF = { contractAddress: SELF_ADDRESS };

const deploy = (init = INIT): Promise<NativeShieldedTokenCoreSimulator> =>
  NativeShieldedTokenCoreSimulator.create(
    NAME,
    SYMBOL,
    DECIMALS,
    init,
    AT_SELF,
  );

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
        AT_SELF,
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

  describe('contract-addressed recipients', () => {
    beforeEach(async () => {
      token = await deploy(INIT);
    });

    it('should mint to its own address', async () => {
      const nonce = b32('self-mint');
      const coin = await token._mint(DOMAIN_A, SELF_ARM, AMOUNT, nonce);
      expect(coin.value).toBe(AMOUNT);
      expect(coin.nonce).toStrictEqual(nonce);
      expect(coin.color).toStrictEqual(await token.tokenColor(DOMAIN_A));
    });

    it('should reject a mint to a foreign contract', async () => {
      await expect(
        token._mint(DOMAIN_A, FOREIGN_CONTRACT, AMOUNT, b32('foreign')),
      ).rejects.toThrow('NativeShieldedToken: recipient contract must be self');
    });

    it('should refund the change to its own address', async () => {
      const coin = await token._mint(
        DOMAIN_A,
        RECIPIENT,
        AMOUNT,
        b32('self-refund'),
      );
      const res = await token._burn(DOMAIN_A, coin, PARTIAL, SELF_ARM);
      expect(res.is_some).toBe(true);
      expect(res.value.value).toBe(AMOUNT - PARTIAL);
      expect(res.value.color).toStrictEqual(await token.tokenColor(DOMAIN_A));

      // Spending the refund proves the contract claimed it, not just returned it.
      const held = await getQualifiedShieldedCoinInfo(
        contractOwner(token),
        res.value,
      );
      const second = await token._burnFromSelf(
        DOMAIN_A,
        held,
        AMOUNT - PARTIAL,
      );
      expect(second.is_some).toBe(false);
    });

    it('should return none on a full burn with a self refundTo', async () => {
      const coin = await token._mint(
        DOMAIN_A,
        RECIPIENT,
        AMOUNT,
        b32('self-full'),
      );
      const res = await token._burn(DOMAIN_A, coin, AMOUNT, SELF_ARM);
      expect(res.is_some).toBe(false);
    });

    it('should reject a refund to a foreign contract', async () => {
      await expect(
        token._burn(
          DOMAIN_A,
          {
            nonce: b32('coin'),
            color: await token.tokenColor(DOMAIN_A),
            value: AMOUNT,
          },
          PARTIAL,
          FOREIGN_CONTRACT,
        ),
      ).rejects.toThrow('NativeShieldedToken: refund contract must be self');
    });

    it('should reject the zero contract address on both arms', async () => {
      await expect(
        token._mint(DOMAIN_A, ZERO_ADDRESS, AMOUNT, b32('za')),
      ).rejects.toThrow('NativeShieldedToken: invalid recipient');

      const colorA = await token.tokenColor(DOMAIN_A);
      await expect(
        token._burn(
          DOMAIN_A,
          { nonce: b32('coin'), color: colorA, value: AMOUNT },
          PARTIAL,
          ZERO_ADDRESS,
        ),
      ).rejects.toThrow('NativeShieldedToken: invalid refund target');
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
        await token._mint(DOMAIN_A, SELF_ARM, value, b32(label)),
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
