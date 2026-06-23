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
const SEED = b32('nonce-seed');
const DOMAIN_A = b32('domain-A');
const DOMAIN_B = b32('domain-B');
const INIT = true;
const BAD_INIT = false;
const AMOUNT = 1_000n;

const deploy = (init = INIT): NativeShieldedTokenFamilySimulator =>
  new NativeShieldedTokenFamilySimulator(SEED, NAME, SYMBOL, DECIMALS, init);

let token: NativeShieldedTokenFamilySimulator;

describe('NativeShieldedTokenFamily (Family profile)', () => {
  describe('initialization', () => {
    beforeEach(() => {
      token = deploy(INIT);
    });

    it('should expose the family metadata (INV-14)', () => {
      expect(token.name()).toEqual(NAME);
      expect(token.symbol()).toEqual(SYMBOL);
      expect(token.decimals()).toEqual(DECIMALS);
      expect(token.isInitialized()).toBe(true);
    });

    it('should return 0 supply for an unknown domain (INV-2)', () => {
      expect(token.totalMinted(DOMAIN_A)).toBe(0n);
      expect(token.totalBurned(DOMAIN_A)).toBe(0n);
      expect(token.totalSupply(DOMAIN_A)).toBe(0n);
    });
  });

  describe('before initialization', () => {
    beforeEach(() => {
      token = deploy(BAD_INIT);
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
        '_burnFromContract',
        [DOMAIN_A, { nonce: b32('cn'), color: b32('c'), value: AMOUNT, mt_index: 0n }, AMOUNT],
      ],
    ];

    it.each(circuitsToFail)(
      'should revert %s before initialize (INV-15)',
      (method, args) => {
        expect(() => {
          (token[method] as (...a: unknown[]) => unknown)(...args);
        }).toThrow('NativeShieldedTokenFamily: contract not initialized');
      },
    );

    it('should report zero supply before initialize for any domain (getters do not gate on init) (INV-2)', () => {
      // Per-domain supply accounting now lives in the standalone
      // NativeShieldedTokenFamilySupply extension; an absent domain reads as 0
      // independently of the family module's init flag.
      expect(token.totalMinted(DOMAIN_A)).toBe(0n);
      expect(token.totalBurned(DOMAIN_A)).toBe(0n);
      expect(token.totalSupply(DOMAIN_A)).toBe(0n);
    });
  });

  describe('_mint (per domain)', () => {
    beforeEach(() => {
      token = deploy(INIT);
    });

    it('should return a coin with color = tokenColor(domain), value, nonce (INV-1)', () => {
      const nonce = b32('m-a');
      const coin = token._mint(DOMAIN_A, RECIPIENT, AMOUNT, nonce);
      expect(coin.value).toBe(AMOUNT);
      expect(coin.nonce).toEqual(nonce);
      expect(coin.color).toEqual(token.tokenColor(DOMAIN_A));
    });

    it('should increment totalMinted(domain) by amount (INV-2)', () => {
      token._mint(DOMAIN_A, RECIPIENT, AMOUNT, b32('m-a'));
      expect(token.totalMinted(DOMAIN_A)).toBe(AMOUNT);
    });

    it('should revert on a zero recipient (INV-6)', () => {
      expect(() => token._mint(DOMAIN_A, ZERO_KEY, AMOUNT, b32('z'))).toThrow(
        'NativeShieldedTokenFamily: invalid recipient',
      );
      expect(() => token._mint(DOMAIN_A, ZERO_ADDRESS, AMOUNT, b32('z'))).toThrow(
        'NativeShieldedTokenFamily: invalid recipient',
      );
    });
  });

  describe('multi-domain isolation', () => {
    beforeEach(() => {
      token = deploy(INIT);
    });

    it('should accumulate independent supplies for distinct domains (INV-2)', () => {
      token._mint(DOMAIN_A, RECIPIENT, 1_000n, b32('a1'));
      token._mint(DOMAIN_B, RECIPIENT, 250n, b32('b1'));
      expect(token.totalMinted(DOMAIN_A)).toBe(1_000n);
      expect(token.totalMinted(DOMAIN_B)).toBe(250n);
    });

    it('should give distinct colors to distinct domains (INV-1)', () => {
      expect(token.tokenColor(DOMAIN_A)).not.toEqual(token.tokenColor(DOMAIN_B));
    });

    it('should keep domain B unaffected by a burn under domain A', () => {
      const colorA = token.tokenColor(DOMAIN_A);
      token._mint(DOMAIN_A, RECIPIENT, 1_000n, b32('a1'));
      token._mint(DOMAIN_B, RECIPIENT, 1_000n, b32('b1'));
      token._burn(DOMAIN_A, { nonce: b32('c'), color: colorA, value: 400n }, 400n, REFUND_TO);
      expect(token.totalBurned(DOMAIN_A)).toBe(400n);
      expect(token.totalBurned(DOMAIN_B)).toBe(0n);
      expect(token.totalSupply(DOMAIN_A)).toBe(600n);
      expect(token.totalSupply(DOMAIN_B)).toBe(1_000n);
    });

    it('should reject burning a domain-A coin under domain B (wrong color) (INV-1)', () => {
      const colorA = token.tokenColor(DOMAIN_A);
      expect(() =>
        token._burn(DOMAIN_B, { nonce: b32('c'), color: colorA, value: AMOUNT }, AMOUNT, REFUND_TO),
      ).toThrow('NativeShieldedTokenFamily: wrong token');
    });
  });

  describe('_burn (per domain)', () => {
    let colorA: Uint8Array;
    beforeEach(() => {
      token = deploy(INIT);
      colorA = token.tokenColor(DOMAIN_A);
    });

    const coinOf = (value: bigint, c: Uint8Array = colorA) => ({
      nonce: b32('coin'),
      color: c,
      value,
    });

    it('should revert when amount > coin.value (INV-8)', () => {
      expect(() => token._burn(DOMAIN_A, coinOf(AMOUNT), AMOUNT + 1n, REFUND_TO)).toThrow(
        'NativeShieldedTokenFamily: insufficient coin value',
      );
    });

    it('should revert on a zero refundTo (INV-7)', () => {
      expect(() => token._burn(DOMAIN_A, coinOf(AMOUNT), 1n, ZERO_KEY)).toThrow(
        'NativeShieldedTokenFamily: invalid refund target',
      );
    });

    it('should return none on a full burn and some(refund) on a partial burn (INV-10)', () => {
      expect(token._burn(DOMAIN_A, coinOf(AMOUNT), AMOUNT, REFUND_TO).is_some).toBe(false);
      const partial = token._burn(DOMAIN_A, coinOf(AMOUNT), 600n, REFUND_TO);
      expect(partial.is_some).toBe(true);
      expect(partial.value.value).toBe(AMOUNT - 600n);
    });

    it('should report totalSupply(domain) == minted - burned (INV-5)', () => {
      token._mint(DOMAIN_A, RECIPIENT, AMOUNT, b32('m'));
      token._burn(DOMAIN_A, coinOf(400n), 400n, REFUND_TO);
      expect(token.totalSupply(DOMAIN_A)).toBe(AMOUNT - 400n);
    });
  });
});
