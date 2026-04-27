import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { describe, expect, it } from 'vitest';
import type { Ledger } from '../../../../artifacts/MockOwnable/contract/index.js';
import { OwnablePrivateState, OwnableWitnesses } from '../OwnableWitnesses.js';

const SECRET_KEY = new Uint8Array(32).fill(0x34);

describe('OwnablePrivateState', () => {
  describe('generate', () => {
    it('should return a state with a 32-byte secretKey', () => {
      const state = OwnablePrivateState.generate();
      expect(state.secretKey).toBeInstanceOf(Uint8Array);
      expect(state.secretKey.length).toBe(32);
    });

    it('should produce unique secret key on successive calls', () => {
      const a = OwnablePrivateState.generate();
      const b = OwnablePrivateState.generate();
      expect(a.secretKey).not.toEqual(b.secretKey);
    });
  });

  describe('withSecretKey', () => {
    it('should accept a valid 32-byte secret key', () => {
      const state = OwnablePrivateState.withSecretKey(SECRET_KEY);
      expect(state.secretKey).toEqual(SECRET_KEY);
    });

    it('should create a defensive copy of the input secret key', () => {
      const sk = new Uint8Array(32).fill(0xcc);
      const state = OwnablePrivateState.withSecretKey(sk);

      sk.fill(0xff);
      expect(state.secretKey).toEqual(new Uint8Array(32).fill(0xcc));
    });

    it('should throw for a secret key shorter than 32 bytes', () => {
      const short = new Uint8Array(16);
      expect(() => OwnablePrivateState.withSecretKey(short)).toThrowError(
        'withSecretKey: expected 32-byte secret key, received 16 bytes',
      );
    });

    it('should throw for a secret key longer than 32 bytes', () => {
      const long = new Uint8Array(64);
      expect(() => OwnablePrivateState.withSecretKey(long)).toThrowError(
        'withSecretKey: expected 32-byte secret key, received 64 bytes',
      );
    });

    it('should throw for an empty array', () => {
      expect(() =>
        OwnablePrivateState.withSecretKey(new Uint8Array(0)),
      ).toThrowError(
        'withSecretKey: expected 32-byte secret key, received 0 bytes',
      );
    });
  });
});

describe('OwnableWitnesses', () => {
  const witnesses = OwnableWitnesses();

  function makeContext(
    privateState: OwnablePrivateState,
  ): WitnessContext<Ledger, OwnablePrivateState> {
    return { privateState } as WitnessContext<Ledger, OwnablePrivateState>;
  }

  describe('wit_OwnableSK', () => {
    it('should return a tuple of [privateState, secretKey]', () => {
      const state = OwnablePrivateState.withSecretKey(SECRET_KEY);
      const ctx = makeContext(state);

      const [returnedState, returnedSK] = witnesses.wit_OwnableSK(ctx);

      expect(returnedState).toBe(state);
      expect(returnedSK).toEqual(SECRET_KEY);
    });

    it('should return the exact same privateState reference', () => {
      const state = OwnablePrivateState.generate();
      const ctx = makeContext(state);

      const [returnedState] = witnesses.wit_OwnableSK(ctx);
      expect(returnedState).toBe(state);
    });

    it('should return the secretKey as a Uint8Array', () => {
      const state = OwnablePrivateState.generate();
      const ctx = makeContext(state);

      const [, returnedSK] = witnesses.wit_OwnableSK(ctx);
      expect(returnedSK).toBeInstanceOf(Uint8Array);
      expect(returnedSK.length).toBe(32);
    });

    it('should work with a randomly generated state', () => {
      const state = OwnablePrivateState.generate();
      const ctx = makeContext(state);

      const [returnedState, returnedSK] = witnesses.wit_OwnableSK(ctx);

      expect(returnedState).toBe(state);
      expect(returnedSK).toEqual(state.secretKey);
    });
  });
});

describe('OwnableWitnesses factory', () => {
  it('should return a fresh witnesses object on each call', () => {
    const a = OwnableWitnesses();
    const b = OwnableWitnesses();
    expect(a).not.toBe(b);
  });

  it('should produce witnesses with identical behaviour', () => {
    const a = OwnableWitnesses();
    const b = OwnableWitnesses();
    const state = OwnablePrivateState.generate();
    const ctx = { privateState: state } as WitnessContext<
      Ledger,
      OwnablePrivateState
    >;

    const [stateA, skA] = a.wit_OwnableSK(ctx);
    const [stateB, skB] = b.wit_OwnableSK(ctx);

    expect(stateA).toBe(stateB);
    expect(skA).toEqual(skB);
  });
});
