import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { describe, expect, it } from 'vitest';
import type { Ledger } from '../../../../artifacts/MockCaller/contract/index.js';
import { CallerPrivateState, CallerWitnesses } from './CallerWitnesses.js';

const SECRET_KEY = new Uint8Array(32).fill(0x34);

describe('CallerPrivateState', () => {
  describe('generate', () => {
    it('should return a state with a 32-byte secretKey', () => {
      const state = CallerPrivateState.generate();
      expect(state.secretKey).toBeInstanceOf(Uint8Array);
      expect(state.secretKey.length).toBe(32);
    });

    it('should produce unique secret key on successive calls', () => {
      const a = CallerPrivateState.generate();
      const b = CallerPrivateState.generate();
      expect(a.secretKey).not.toEqual(b.secretKey);
    });
  });

  describe('withSecretKey', () => {
    it('should accept a valid 32-byte secret key', () => {
      const state = CallerPrivateState.withSecretKey(SECRET_KEY);
      expect(state.secretKey).toEqual(SECRET_KEY);
    });

    it('should create a defensive copy of the input secret key', () => {
      const sk = new Uint8Array(32).fill(0xcc);
      const state = CallerPrivateState.withSecretKey(sk);

      sk.fill(0xff);
      expect(state.secretKey).toEqual(new Uint8Array(32).fill(0xcc));
    });

    it('should throw for a secret key shorter than 32 bytes', () => {
      const short = new Uint8Array(16);
      expect(() => CallerPrivateState.withSecretKey(short)).toThrowError(
        'withSecretKey: expected 32-byte secret key, received 16 bytes',
      );
    });

    it('should throw for a secret key longer than 32 bytes', () => {
      const long = new Uint8Array(64);
      expect(() => CallerPrivateState.withSecretKey(long)).toThrowError(
        'withSecretKey: expected 32-byte secret key, received 64 bytes',
      );
    });

    it('should throw for an empty array', () => {
      expect(() =>
        CallerPrivateState.withSecretKey(new Uint8Array(0)),
      ).toThrowError(
        'withSecretKey: expected 32-byte secret key, received 0 bytes',
      );
    });
  });
});

describe('CallerWitnesses', () => {
  const witnesses = CallerWitnesses();

  function makeContext(
    privateState: CallerPrivateState,
  ): WitnessContext<Ledger, CallerPrivateState> {
    return { privateState } as WitnessContext<Ledger, CallerPrivateState>;
  }

  describe('wit_CallerSK', () => {
    it('should return a tuple of [privateState, secretKey]', () => {
      const state = CallerPrivateState.withSecretKey(SECRET_KEY);
      const ctx = makeContext(state);

      const [returnedState, returnedSK] = witnesses.wit_CallerSK(ctx);

      expect(returnedState).toBe(state);
      expect(returnedSK).toEqual(SECRET_KEY);
    });

    it('should return the exact same privateState reference', () => {
      const state = CallerPrivateState.generate();
      const ctx = makeContext(state);

      const [returnedState] = witnesses.wit_CallerSK(ctx);
      expect(returnedState).toBe(state);
    });

    it('should return the secretKey as a Uint8Array', () => {
      const state = CallerPrivateState.generate();
      const ctx = makeContext(state);

      const [, returnedSK] = witnesses.wit_CallerSK(ctx);
      expect(returnedSK).toBeInstanceOf(Uint8Array);
      expect(returnedSK.length).toBe(32);
    });

    it('should work with a randomly generated state', () => {
      const state = CallerPrivateState.generate();
      const ctx = makeContext(state);

      const [returnedState, returnedSK] = witnesses.wit_CallerSK(ctx);

      expect(returnedState).toBe(state);
      expect(returnedSK).toEqual(state.secretKey);
    });
  });
});

describe('CallerWitnesses factory', () => {
  it('should return a fresh witnesses object on each call', () => {
    const a = CallerWitnesses();
    const b = CallerWitnesses();
    expect(a).not.toBe(b);
  });

  it('should produce witnesses with identical behaviour', () => {
    const a = CallerWitnesses();
    const b = CallerWitnesses();
    const state = CallerPrivateState.generate();
    const ctx = { privateState: state } as WitnessContext<
      Ledger,
      CallerPrivateState
    >;

    const [stateA, skA] = a.wit_CallerSK(ctx);
    const [stateB, skB] = b.wit_CallerSK(ctx);

    expect(stateA).toBe(stateB);
    expect(skA).toEqual(skB);
  });
});
