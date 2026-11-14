import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { describe, expect, it } from 'vitest';
import type { Ledger } from '../../../../../artifacts/crypto/authentication/test/mocks/MockAuthPrfAddr/contract/index.js';
import {
  AuthPrfAddrPrivateState,
  AuthPrfAddrWitnesses,
} from './AuthPrfAddrWitnesses.js';

const SECRET_KEY = new Uint8Array(32).fill(0x34);

describe('AuthPrfAddrPrivateState', () => {
  describe('generate', () => {
    it('should return a state with a 32-byte secretKey', () => {
      const state = AuthPrfAddrPrivateState.generate();
      expect(state.secretKey).toBeInstanceOf(Uint8Array);
      expect(state.secretKey.length).toBe(32);
    });

    it('should produce unique secret key on successive calls', () => {
      const a = AuthPrfAddrPrivateState.generate();
      const b = AuthPrfAddrPrivateState.generate();
      expect(a.secretKey).not.toEqual(b.secretKey);
    });
  });

  describe('withSecretKey', () => {
    it('should accept a valid 32-byte secret key', () => {
      const state = AuthPrfAddrPrivateState.withSecretKey(SECRET_KEY);
      expect(state.secretKey).toEqual(SECRET_KEY);
    });

    it('should create a defensive copy of the input secret key', () => {
      const sk = new Uint8Array(32).fill(0xcc);
      const state = AuthPrfAddrPrivateState.withSecretKey(sk);

      sk.fill(0xff);
      expect(state.secretKey).toEqual(new Uint8Array(32).fill(0xcc));
    });

    it('should throw for a secret key shorter than 32 bytes', () => {
      const short = new Uint8Array(16);
      expect(() => AuthPrfAddrPrivateState.withSecretKey(short)).toThrowError(
        'withSecretKey: expected 32-byte secret key, received 16 bytes',
      );
    });

    it('should throw for a secret key longer than 32 bytes', () => {
      const long = new Uint8Array(64);
      expect(() => AuthPrfAddrPrivateState.withSecretKey(long)).toThrowError(
        'withSecretKey: expected 32-byte secret key, received 64 bytes',
      );
    });

    it('should throw for an empty array', () => {
      expect(() =>
        AuthPrfAddrPrivateState.withSecretKey(new Uint8Array(0)),
      ).toThrowError(
        'withSecretKey: expected 32-byte secret key, received 0 bytes',
      );
    });
  });
});

describe('AuthPrfAddrWitnesses', () => {
  const witnesses = AuthPrfAddrWitnesses();

  function makeContext(
    privateState: AuthPrfAddrPrivateState,
  ): WitnessContext<Ledger, AuthPrfAddrPrivateState> {
    return { privateState } as WitnessContext<Ledger, AuthPrfAddrPrivateState>;
  }

  describe('wit_AuthPrfAddrSK', () => {
    it('should return a tuple of [privateState, secretKey]', () => {
      const state = AuthPrfAddrPrivateState.withSecretKey(SECRET_KEY);
      const ctx = makeContext(state);

      const [returnedState, returnedSK] = witnesses.wit_AuthPrfAddrSK(ctx);

      expect(returnedState).toBe(state);
      expect(returnedSK).toEqual(SECRET_KEY);
    });

    it('should return the exact same privateState reference', () => {
      const state = AuthPrfAddrPrivateState.generate();
      const ctx = makeContext(state);

      const [returnedState] = witnesses.wit_AuthPrfAddrSK(ctx);
      expect(returnedState).toBe(state);
    });

    it('should return the secretKey as a Uint8Array', () => {
      const state = AuthPrfAddrPrivateState.generate();
      const ctx = makeContext(state);

      const [, returnedSK] = witnesses.wit_AuthPrfAddrSK(ctx);
      expect(returnedSK).toBeInstanceOf(Uint8Array);
      expect(returnedSK.length).toBe(32);
    });

    it('should return a copy of the secretKey', () => {
      const state = AuthPrfAddrPrivateState.withSecretKey(SECRET_KEY);
      const ctx = makeContext(state);

      const [, returnedSK] = witnesses.wit_AuthPrfAddrSK(ctx);
      returnedSK.fill(0xff);

      expect(state.secretKey).toEqual(SECRET_KEY);
    });

    it('should work with a randomly generated state', () => {
      const state = AuthPrfAddrPrivateState.generate();
      const ctx = makeContext(state);

      const [returnedState, returnedSK] = witnesses.wit_AuthPrfAddrSK(ctx);

      expect(returnedState).toBe(state);
      expect(returnedSK).toEqual(state.secretKey);
    });
  });
});

describe('AuthPrfAddrWitnesses factory', () => {
  it('should return a fresh witnesses object on each call', () => {
    const a = AuthPrfAddrWitnesses();
    const b = AuthPrfAddrWitnesses();
    expect(a).not.toBe(b);
  });

  it('should produce witnesses with identical behaviour', () => {
    const a = AuthPrfAddrWitnesses();
    const b = AuthPrfAddrWitnesses();
    const state = AuthPrfAddrPrivateState.generate();
    const ctx = { privateState: state } as WitnessContext<
      Ledger,
      AuthPrfAddrPrivateState
    >;

    const [stateA, skA] = a.wit_AuthPrfAddrSK(ctx);
    const [stateB, skB] = b.wit_AuthPrfAddrSK(ctx);

    expect(stateA).toBe(stateB);
    expect(skA).toEqual(skB);
  });
});
