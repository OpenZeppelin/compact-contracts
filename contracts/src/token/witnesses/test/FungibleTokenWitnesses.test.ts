import { describe, expect, it } from 'vitest';
import {
  FungibleTokenPrivateState,
  FungibleTokenWitnesses,
} from '../FungibleTokenWitnesses.js';

const SECRET_KEY = new Uint8Array(32).fill(0x34);

describe('FungibleTokenPrivateState', () => {
  describe('generate', () => {
    it('should return a state with a 32-byte zswapCoinSecretKey', () => {
      const state = FungibleTokenPrivateState.generate();
      expect(state.zswapCoinSecretKey).toBeInstanceOf(Uint8Array);
      expect(state.zswapCoinSecretKey.length).toBe(32);
    });

    it('should produce unique secret key on successive calls', () => {
      const a = FungibleTokenPrivateState.generate();
      const b = FungibleTokenPrivateState.generate();
      expect(a.zswapCoinSecretKey).not.toEqual(b.zswapCoinSecretKey);
    });
  });

  describe('withSecretKey', () => {
    it('should accept a valid 32-byte secret key', () => {
      const state = FungibleTokenPrivateState.withSecretKey(SECRET_KEY);
      expect(state.zswapCoinSecretKey).toEqual(SECRET_KEY);
    });

    it('should create a defensive copy of the input secret key', () => {
      const sk = new Uint8Array(32).fill(0xcc);
      const state = FungibleTokenPrivateState.withSecretKey(sk);

      sk.fill(0xff);
      expect(state.zswapCoinSecretKey).toEqual(new Uint8Array(32).fill(0xcc));
    });

    it('should throw for a secret key shorter than 32 bytes', () => {
      const short = new Uint8Array(16);
      expect(() => FungibleTokenPrivateState.withSecretKey(short)).toThrowError(
        'withSecretKey: expected 32-byte secret key, received 16 bytes',
      );
    });

    it('should throw for a secret key longer than 32 bytes', () => {
      const long = new Uint8Array(64);
      expect(() => FungibleTokenPrivateState.withSecretKey(long)).toThrowError(
        'withSecretKey: expected 32-byte secret key, received 64 bytes',
      );
    });

    it('should throw for an empty array', () => {
      expect(() =>
        FungibleTokenPrivateState.withSecretKey(new Uint8Array(0)),
      ).toThrowError(
        'withSecretKey: expected 32-byte secret key, received 0 bytes',
      );
    });
  });
});

describe('FungibleTokenWitnesses', () => {
  const witnesses = FungibleTokenWitnesses();

  it('should expose no caller-auth witnesses', () => {
    expect(witnesses).toEqual({});
  });
});

describe('FungibleTokenWitnesses factory', () => {
  it('should return a fresh witnesses object on each call', () => {
    const a = FungibleTokenWitnesses();
    const b = FungibleTokenWitnesses();
    expect(a).not.toBe(b);
  });

  it('should produce witnesses with identical behaviour', () => {
    const a = FungibleTokenWitnesses();
    const b = FungibleTokenWitnesses();
    expect(a).toEqual(b);
  });
});
