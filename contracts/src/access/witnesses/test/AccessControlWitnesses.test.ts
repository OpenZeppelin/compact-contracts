import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { describe, expect, it } from 'vitest';
import type { Ledger } from '../../../../artifacts/MockAccessControl/contract/index.js';
import {
  AccessControlPrivateState,
  AccessControlWitnesses,
} from '../AccessControlWitnesses.js';

const SECRET_KEY = new Uint8Array(32).fill(0x34);

describe('AccessControlPrivateState', () => {
  describe('generate', () => {
    it('should return a state with a 32-byte secretKey', () => {
      const state = AccessControlPrivateState.generate();
      expect(state.secretKey).toBeInstanceOf(Uint8Array);
      expect(state.secretKey.length).toBe(32);
    });

    it('should produce unique secret key on successive calls', () => {
      const a = AccessControlPrivateState.generate();
      const b = AccessControlPrivateState.generate();
      expect(a.secretKey).not.toEqual(b.secretKey);
    });
  });

  describe('withSecretKey', () => {
    it('should accept a valid 32-byte secret key', () => {
      const state = AccessControlPrivateState.withSecretKey(SECRET_KEY);
      expect(state.secretKey).toEqual(SECRET_KEY);
    });

    it('should create a defensive copy of the input secret key', () => {
      const sk = new Uint8Array(32).fill(0xcc);
      const state = AccessControlPrivateState.withSecretKey(sk);

      sk.fill(0xff);
      expect(state.secretKey).toEqual(new Uint8Array(32).fill(0xcc));
    });

    it('should throw for a secret key shorter than 32 bytes', () => {
      const short = new Uint8Array(16);
      expect(() => AccessControlPrivateState.withSecretKey(short)).toThrowError(
        'withSecretKey: expected 32-byte secret key, received 16 bytes',
      );
    });

    it('should throw for a secret key longer than 32 bytes', () => {
      const long = new Uint8Array(64);
      expect(() => AccessControlPrivateState.withSecretKey(long)).toThrowError(
        'withSecretKey: expected 32-byte secret key, received 64 bytes',
      );
    });

    it('should throw for an empty array', () => {
      expect(() =>
        AccessControlPrivateState.withSecretKey(new Uint8Array(0)),
      ).toThrowError(
        'withSecretKey: expected 32-byte secret key, received 0 bytes',
      );
    });
  });
});

describe('AccessControlWitnesses', () => {
  const witnesses = AccessControlWitnesses();

  function makeContext(
    privateState: AccessControlPrivateState,
  ): WitnessContext<Ledger, AccessControlPrivateState> {
    return { privateState } as WitnessContext<
      Ledger,
      AccessControlPrivateState
    >;
  }

  describe('wit_AccessControlSK', () => {
    it('should return a tuple of [privateState, secretKey]', () => {
      const state = AccessControlPrivateState.withSecretKey(SECRET_KEY);
      const ctx = makeContext(state);

      const [returnedState, returnedSK] = witnesses.wit_AccessControlSK(ctx);

      expect(returnedState).toBe(state);
      expect(returnedSK).toEqual(SECRET_KEY);
    });

    it('should return the exact same privateState reference', () => {
      const state = AccessControlPrivateState.generate();
      const ctx = makeContext(state);

      const [returnedState] = witnesses.wit_AccessControlSK(ctx);
      expect(returnedState).toBe(state);
    });

    it('should return the secretKey as a Uint8Array', () => {
      const state = AccessControlPrivateState.generate();
      const ctx = makeContext(state);

      const [, returnedSK] = witnesses.wit_AccessControlSK(ctx);
      expect(returnedSK).toBeInstanceOf(Uint8Array);
      expect(returnedSK.length).toBe(32);
    });

    it('should work with a randomly generated state', () => {
      const state = AccessControlPrivateState.generate();
      const ctx = makeContext(state);

      const [returnedState, returnedSK] = witnesses.wit_AccessControlSK(ctx);

      expect(returnedState).toBe(state);
      expect(returnedSK).toEqual(state.secretKey);
    });
  });
});

describe('AccessControlWitnesses factory', () => {
  it('should return a fresh witnesses object on each call', () => {
    const a = AccessControlWitnesses();
    const b = AccessControlWitnesses();
    expect(a).not.toBe(b);
  });

  it('should produce witnesses with identical behaviour', () => {
    const a = AccessControlWitnesses();
    const b = AccessControlWitnesses();
    const state = AccessControlPrivateState.generate();
    const ctx = { privateState: state } as WitnessContext<
      Ledger,
      AccessControlPrivateState
    >;

    const [stateA, skA] = a.wit_AccessControlSK(ctx);
    const [stateB, skB] = b.wit_AccessControlSK(ctx);

    expect(stateA).toBe(stateB);
    expect(skA).toEqual(skB);
  });
});
