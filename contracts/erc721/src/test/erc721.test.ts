import type { CoinPublicKey } from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { ERC721Simulator } from './simulators/ERC721Simulator';
import type { MaybeString } from './types/string';
import {encodeToPK, createEitherTestContractAddress, createEitherTestUser} from './utils/address';

const NO_STRING: MaybeString = {
  is_some: false,
  value: ''
};
const NAME: MaybeString = {
  is_some: true,
  value: "NAME"
};
const SYMBOL: MaybeString = {
  is_some: true,
  value: "SYMBOL"
};

const TOKENID: bigint = BigInt(1);

const AMOUNT: bigint = BigInt(250);
const MAX_UINT128 = BigInt(2 ** 128) - BigInt(1);

const OWNER = String(Buffer.from("OWNER", 'ascii').toString('hex')).padStart(64, '0');
const SPENDER = String(Buffer.from("SPENDER", 'ascii').toString('hex')).padStart(64, '0');
const UNAUTHORIZED = String(Buffer.from("UNAUTHORIZED", 'ascii').toString('hex')).padStart(64, '0');
const ZERO = String().padStart(64, '0');
const Z_OWNER = encodeToPK('OWNER');
const EITHER_Z_OWNER = createEitherTestUser('OWNER');
const Z_RECIPIENT = createEitherTestUser('RECIPIENT');
const Z_SPENDER = createEitherTestUser('SPENDER');
const Z_OTHER = createEitherTestUser('OTHER');
const SOME_CONTRACT = createEitherTestContractAddress('SOME_CONTRACT');

let token: ERC721Simulator;
let caller: CoinPublicKey;

describe('ERC721', () => {
  describe('initializer and metadata', () => {
    it('should initialize metadata', () => {
      token = new ERC721Simulator(NAME, SYMBOL);

      expect(token.name()).toEqual(NAME);
      expect(token.symbol()).toEqual(SYMBOL);
    });

    it('should initialize empty metadata', () => {
      token = new ERC721Simulator(NO_STRING, NO_STRING);

      expect(token.name()).toEqual(NO_STRING);
      expect(token.symbol()).toEqual(NO_STRING);
    });
  });

  beforeEach(() => {
    token = new ERC721Simulator(NAME, SYMBOL);
  });

  describe('balanceOf', () => {
    it('should return zero when requested account has no balance', () => {
      expect(token.balanceOf(Z_OWNER)).toEqual(0n);
    });

    it('should return balance when requested account has tokens', () => {
      token._mint(EITHER_Z_OWNER, AMOUNT);
      expect(token.balanceOf(EITHER_Z_OWNER.left)).toEqual(AMOUNT);
    });
  });

  describe('ownerOf', () => {
    it('should throw if tokenId does not exist', () => {
      expect(() => {
        token.ownerOf(TOKENID);
      }).toThrow('ERC721: Nonexistent Token');
    })
  })


});
