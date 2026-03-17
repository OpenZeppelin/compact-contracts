import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { describe, expect, it } from 'vitest';
import type { Ledger } from '../../../../artifacts/MockZOwnablePK/contract/index.js';
import {
  ZOwnablePKPrivateState,
  ZOwnablePKWitnesses,
} from '../ZOwnablePKWitnesses.js';

const NONCE = Buffer.alloc(32, 0x34);

describe('ZOwnablePKPrivateState', () => {
  describe('generate', () => {
    it('should return a state with a 32-byte secretNonce', () => {
      const state = ZOwnablePKPrivateState.generate();
      expect(state.secretNonce).toBeInstanceOf(Buffer);
      expect(state.secretNonce.length).toBe(32);
    });

    it('should produce unique nonces on successive calls', () => {
      const a = ZOwnablePKPrivateState.generate();
      const b = ZOwnablePKPrivateState.generate();
      expect(a.secretNonce.equals(b.secretNonce)).toBe(false);
    });
  });

  describe('withNonce', () => {
    it('should accept a valid 32-byte nonce', () => {
      const state = ZOwnablePKPrivateState.withNonce(NONCE);
      expect(state.secretNonce).toEqual(NONCE);
    });

    it('should create a defensive copy of the input nonce', () => {
      const nonce = Buffer.alloc(32, 0xcc);
      const state = ZOwnablePKPrivateState.withNonce(nonce);

      nonce.fill(0xff);
      expect(state.secretNonce).toEqual(Buffer.alloc(32, 0xcc));
    });

    it('should throw for a nonce shorter than 32 bytes', () => {
      const short = Buffer.alloc(16);
      expect(() => ZOwnablePKPrivateState.withNonce(short)).toThrowError(
        'withNonce: expected 32-byte nonce, received 16 bytes',
      );
    });

    it('should throw for a nonce longer than 32 bytes', () => {
      const long = Buffer.alloc(64);
      expect(() => ZOwnablePKPrivateState.withNonce(long)).toThrowError(
        'withNonce: expected 32-byte nonce, received 64 bytes',
      );
    });

    it('should throw for an empty buffer', () => {
      expect(() =>
        ZOwnablePKPrivateState.withNonce(Buffer.alloc(0)),
      ).toThrowError('withNonce: expected 32-byte nonce, received 0 bytes');
    });
  });
});

describe('ZOwnablePKWitnesses', () => {
  const witnesses = ZOwnablePKWitnesses();

  function makeContext(
    privateState: ZOwnablePKPrivateState,
  ): WitnessContext<Ledger, ZOwnablePKPrivateState> {
    return { privateState } as WitnessContext<Ledger, ZOwnablePKPrivateState>;
  }

  describe('wit_secretNonce', () => {
    it('should return a tuple of [privateState, secretNonce]', () => {
      const state = ZOwnablePKPrivateState.withNonce(NONCE);
      const ctx = makeContext(state);

      const [returnedState, returnedNonce] = witnesses.wit_secretNonce(ctx);

      expect(returnedState).toBe(state);
      expect(returnedNonce).toEqual(NONCE);
    });

    it('should return the exact same privateState reference', () => {
      const state = ZOwnablePKPrivateState.generate();
      const ctx = makeContext(state);

      const [returnedState] = witnesses.wit_secretNonce(ctx);
      expect(returnedState).toBe(state);
    });

    it('should return the secretNonce as a Uint8Array', () => {
      const state = ZOwnablePKPrivateState.generate();
      const ctx = makeContext(state);

      const [, returnedNonce] = witnesses.wit_secretNonce(ctx);
      expect(returnedNonce).toBeInstanceOf(Uint8Array);
      expect(returnedNonce.length).toBe(32);
    });

    it('should work with a randomly generated state', () => {
      const state = ZOwnablePKPrivateState.generate();
      const ctx = makeContext(state);

      const [returnedState, returnedNonce] = witnesses.wit_secretNonce(ctx);

      expect(returnedState).toBe(state);
      expect(Buffer.from(returnedNonce).equals(state.secretNonce)).toBe(true);
    });
  });
});

describe('ZOwnablePKWitnesses factory', () => {
  it('should return a fresh witnesses object on each call', () => {
    const a = ZOwnablePKWitnesses();
    const b = ZOwnablePKWitnesses();
    expect(a).not.toBe(b);
  });

  it('should produce witnesses with identical behaviour', () => {
    const a = ZOwnablePKWitnesses();
    const b = ZOwnablePKWitnesses();
    const state = ZOwnablePKPrivateState.generate();
    const ctx = { privateState: state } as WitnessContext<
      Ledger,
      ZOwnablePKPrivateState
    >;

    const [stateA, nonceA] = a.wit_secretNonce(ctx);
    const [stateB, nonceB] = b.wit_secretNonce(ctx);

    expect(stateA).toBe(stateB);
    expect(Buffer.from(nonceA).equals(Buffer.from(nonceB))).toBe(true);
  });
});
