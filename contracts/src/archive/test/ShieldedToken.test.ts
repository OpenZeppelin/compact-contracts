import type { CoinInfo, TokenType } from '@midnight-ntwrk/compact-runtime';
import {
  encodeCoinInfo,
  encodeTokenType,
  sampleContractAddress,
  tokenType,
} from '@midnight-ntwrk/onchain-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Maybe } from '../../../artifacts/MockShieldedToken/contract/index.js'; // Combined imports
import { ShieldedTokenSimulator } from './simulators/ShieldedTokenSimulator.js';
import * as utils from './utils/address.js';

const NO_STRING: Maybe<string> = {
  is_some: false,
  value: '',
};
const NAME: Maybe<string> = {
  is_some: true,
  value: 'NAME',
};
const SYMBOL: Maybe<string> = {
  is_some: true,
  value: 'SYMBOL',
};
const DECIMALS: bigint = 18n;
const NONCE: Uint8Array = utils.pad('NONCE', 32);
const DOMAIN: Uint8Array = utils.pad('ShieldedToken', 32);

const AMOUNT: bigint = BigInt(250);
const MAX_UINT64 = BigInt(2 ** 64) - BigInt(1);

const Z_OWNER = utils.createEitherTestUser('OWNER');

let token: ShieldedTokenSimulator;
let thisTokenType: TokenType;

describe('Shielded token', () => {
  describe('initializer and metadata', () => {
    it('should initialize metadata', async () => {
      token = await ShieldedTokenSimulator.create(
        NONCE,
        NAME,
        SYMBOL,
        DECIMALS,
      );

      expect(await token.name()).toEqual(NAME);
      expect(await token.symbol()).toEqual(SYMBOL);
      expect(await token.decimals()).toEqual(DECIMALS);
    });

    it('should initialize empty metadata', async () => {
      token = await ShieldedTokenSimulator.create(
        NONCE,
        NO_STRING,
        NO_STRING,
        0n,
      );

      expect(await token.name()).toEqual(NO_STRING);
      expect(await token.symbol()).toEqual(NO_STRING);
      expect(await token.decimals()).toEqual(0n);
    });

    it('should set public state', async () => {
      token = await ShieldedTokenSimulator.create(
        NONCE,
        NAME,
        SYMBOL,
        DECIMALS,
      );

      expect(token.getCurrentPublicState().ShieldedToken__counter).toEqual(0n);
      expect(token.getCurrentPublicState().ShieldedToken__domain).toEqual(
        DOMAIN,
      );
      expect(token.getCurrentPublicState().ShieldedToken__counter).toEqual(0n);
    });
  });

  beforeEach(async () => {
    token = await ShieldedTokenSimulator.create(NONCE, NAME, SYMBOL, DECIMALS);
    thisTokenType = tokenType(DOMAIN, token.contractAddress);
  });

  describe('mint', () => {
    it('should mint', async () => {
      const res = await token.mint(Z_OWNER, AMOUNT);
      const thisNonce = token.getCurrentPublicState().ShieldedToken__nonce;
      const thisCoinInfo = {
        color: encodeTokenType(thisTokenType),
        nonce: thisNonce,
        value: AMOUNT,
      };

      // Check circuit result
      expect(res.result).toEqual(thisCoinInfo);
      // Check circuit outputs
      expect(res.context.currentZswapLocalState.outputs[0].coinInfo).toEqual(
        thisCoinInfo,
      );
      expect(res.context.currentZswapLocalState.outputs[0].recipient).toEqual(
        Z_OWNER,
      );
      // Check supply
      expect(await token.totalSupply()).toEqual(AMOUNT);
    });

    it('should bump counter', async () => {
      expect(token.getCurrentPublicState().ShieldedToken__counter).toEqual(0n);
      await token.mint(Z_OWNER, AMOUNT);

      expect(token.getCurrentPublicState().ShieldedToken__counter).toEqual(1n);
    });

    it('should bump nonce', async () => {
      const initNonce = token.getCurrentPublicState().ShieldedToken__nonce;
      expect(initNonce).toEqual(NONCE);

      await token.mint(Z_OWNER, AMOUNT);

      // TODO: create js equivalent of `evolve_nonce` circuit to derive correct value
      expect(initNonce).not.toEqual(
        token.getCurrentPublicState().ShieldedToken__nonce,
      );
    });

    it('should fail when minting to the zero address', async () => {
      await expect(token.mint(utils.ZERO_KEY, AMOUNT)).rejects.toThrow(
        'ShieldedToken: invalid recipient',
      );
    });

    it('should fail when minting overflow uint64', async () => {
      await token.mint(Z_OWNER, MAX_UINT64);

      await expect(token.mint(Z_OWNER, 1n)).rejects.toThrow(
        'arithmetic overflow',
      );
    });
  });

  describe('burn', () => {
    beforeEach(async () => {
      await token.mint(Z_OWNER, AMOUNT);
    });

    it('should burn (whole)', async () => {
      const nonceStr = NONCE.filter((x) => x !== 0)
        .join('')
        .padStart(64, '0'); //297481949006
      const coin_info: CoinInfo = {
        type: thisTokenType,
        nonce: nonceStr,
        value: AMOUNT,
      };
      const encoded_coin_info = encodeCoinInfo(coin_info);

      // Burn
      const res = await token.burn(encoded_coin_info, AMOUNT);

      // Check circuit result
      expect(res.result.change.is_some).toBe(false);
      expect(res.result.change.value).toEqual({
        nonce: utils.pad('', 32),
        color: utils.pad('', 32),
        value: 0n,
      });

      // Check input len
      expect(res.context.currentZswapLocalState.inputs.length).toEqual(1);

      // Check input data
      const txInputs = res.context.currentZswapLocalState.inputs[0];
      expect(txInputs.value).toEqual(AMOUNT);
      expect(txInputs.color).toEqual(encoded_coin_info.color);
      expect(txInputs.nonce).toEqual(encoded_coin_info.nonce);

      // Check supply
      expect(await token.totalSupply()).toEqual(0n);
    });

    it('should burn (partial)', async () => {
      const nonceStr = NONCE.filter((x) => x !== 0)
        .join('')
        .padStart(64, '0');
      const coin_info: CoinInfo = {
        type: thisTokenType,
        nonce: nonceStr,
        value: AMOUNT,
      };
      const partialAmt = AMOUNT - 1n;
      const encoded_coin_info = encodeCoinInfo(coin_info);

      // Burn
      const res = await token.burn(encoded_coin_info, partialAmt);

      // Check circuit result
      const change = res.result.change;
      expect(change.is_some).toBe(true);
      expect(change.value.color).toEqual(encoded_coin_info.color);
      expect(change.value.value).toEqual(1n);
      expect(change.value.nonce).not.toEqual(NONCE);

      // Check input len
      expect(res.context.currentZswapLocalState.inputs.length).toEqual(2);

      // Check input data
      const [txInput1, txInput2] = res.context.currentZswapLocalState.inputs;
      expect(txInput1.value).toEqual(AMOUNT); // Coin
      expect(txInput2.value).toEqual(1n); // Change

      // Check input color
      expect(txInput1.color).toEqual(encoded_coin_info.color);
      expect(txInput2.color).toEqual(encoded_coin_info.color);

      // Check input nonce
      expect(txInput1.nonce).toEqual(encoded_coin_info.nonce);
      expect(txInput2.nonce).not.toEqual(encoded_coin_info.nonce);

      // Check supply
      expect(await token.totalSupply()).toEqual(1n);
    });

    it('should fail with incorrect domain', async () => {
      const nonceStr = NONCE.filter((x) => x !== 0)
        .join('')
        .padStart(64, '0');
      const badDomain = utils.pad('badDomain', 32);
      const badTokeType = tokenType(badDomain, token.contractAddress);
      const coin_info: CoinInfo = {
        type: badTokeType,
        nonce: nonceStr,
        value: AMOUNT,
      };
      const encoded_coin_info = encodeCoinInfo(coin_info);

      await expect(token.burn(encoded_coin_info, AMOUNT)).rejects.toThrow(
        'ShieldedToken: token not created from this contract',
      );
    });

    it('should fail with incorrect address', async () => {
      const nonceStr = NONCE.filter((x) => x !== 0)
        .join('')
        .padStart(64, '0');
      const badAddress = sampleContractAddress();
      const badTokeType = tokenType(DOMAIN, badAddress);
      const coin_info: CoinInfo = {
        type: badTokeType,
        nonce: nonceStr,
        value: AMOUNT,
      };
      const encoded_coin_info = encodeCoinInfo(coin_info);

      await expect(token.burn(encoded_coin_info, AMOUNT)).rejects.toThrow(
        'ShieldedToken: token not created from this contract',
      );
    });

    it('should fail when not enough balance', async () => {
      const nonceStr = NONCE.filter((x) => x !== 0)
        .join('')
        .padStart(64, '0');
      thisTokenType = tokenType(DOMAIN, token.contractAddress);
      const coin_info: CoinInfo = {
        type: thisTokenType,
        nonce: nonceStr,
        value: AMOUNT,
      };
      const encoded_coin_info = encodeCoinInfo(coin_info);

      await expect(token.burn(encoded_coin_info, AMOUNT + 1n)).rejects.toThrow(
        'ShieldedToken: insufficient token amount to burn',
      );
    });
  });
});
