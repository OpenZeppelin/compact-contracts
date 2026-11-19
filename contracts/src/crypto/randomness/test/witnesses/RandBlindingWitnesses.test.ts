import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { describe, expect, it } from 'vitest';
import type { Ledger } from '../../../../../artifacts/crypto/randomness/test/mocks/MockRandBlinding/contract/index.js';
import {
  RandBlindingPrivateState,
  RandBlindingWitnesses,
} from './RandBlindingWitnesses.js';

const BLINDING = new Uint8Array(32).fill(0x34);

describe('RandBlindingPrivateState', () => {
  describe('generate', () => {
    it('should return a state with a 32-byte blinding', () => {
      const state = RandBlindingPrivateState.generate();
      expect(state.blinding).toBeInstanceOf(Uint8Array);
      expect(state.blinding.length).toBe(32);
    });

    it('should produce unique blinding on successive calls', () => {
      const a = RandBlindingPrivateState.generate();
      const b = RandBlindingPrivateState.generate();
      expect(a.blinding).not.toEqual(b.blinding);
    });
  });

  describe('withBlinding', () => {
    it('should accept a valid 32-byte blinding factor', () => {
      const state = RandBlindingPrivateState.withBlinding(BLINDING);
      expect(state.blinding).toEqual(BLINDING);
    });

    it('should create a defensive copy of the input blinding factor', () => {
      const blinding = new Uint8Array(32).fill(0xcc);
      const state = RandBlindingPrivateState.withBlinding(blinding);

      blinding.fill(0xff);
      expect(state.blinding).toEqual(new Uint8Array(32).fill(0xcc));
    });

    // The circuit rejects zero, this helper does not.
    it('should accept an all-zero value', () => {
      const state = RandBlindingPrivateState.withBlinding(new Uint8Array(32));
      expect(state.blinding).toEqual(new Uint8Array(32));
    });

    it('should throw for a blinding factor shorter than 32 bytes', () => {
      const short = new Uint8Array(16);
      expect(() => RandBlindingPrivateState.withBlinding(short)).toThrowError(
        'withBlinding: expected 32-byte blinding factor, received 16 bytes',
      );
    });

    it('should throw for a blinding factor longer than 32 bytes', () => {
      const long = new Uint8Array(64);
      expect(() => RandBlindingPrivateState.withBlinding(long)).toThrowError(
        'withBlinding: expected 32-byte blinding factor, received 64 bytes',
      );
    });

    it('should throw for an empty array', () => {
      expect(() =>
        RandBlindingPrivateState.withBlinding(new Uint8Array(0)),
      ).toThrowError(
        'withBlinding: expected 32-byte blinding factor, received 0 bytes',
      );
    });
  });
});

describe('RandBlindingWitnesses', () => {
  const witnesses = RandBlindingWitnesses();

  function makeContext(
    privateState: RandBlindingPrivateState,
  ): WitnessContext<Ledger, RandBlindingPrivateState> {
    return { privateState } as WitnessContext<Ledger, RandBlindingPrivateState>;
  }

  describe('wit_RandBlindingFactor', () => {
    it('should return a tuple of [privateState, blinding]', () => {
      const state = RandBlindingPrivateState.withBlinding(BLINDING);
      const ctx = makeContext(state);

      const [returnedState, returnedBlinding] =
        witnesses.wit_RandBlindingFactor(ctx);

      expect(returnedState).toBe(state);
      expect(returnedBlinding).toEqual(BLINDING);
    });

    it('should return the exact same privateState reference', () => {
      const state = RandBlindingPrivateState.generate();
      const ctx = makeContext(state);

      const [returnedState] = witnesses.wit_RandBlindingFactor(ctx);
      expect(returnedState).toBe(state);
    });

    it('should return the blinding as a Uint8Array', () => {
      const state = RandBlindingPrivateState.generate();
      const ctx = makeContext(state);

      const [, returnedBlinding] = witnesses.wit_RandBlindingFactor(ctx);
      expect(returnedBlinding).toBeInstanceOf(Uint8Array);
      expect(returnedBlinding.length).toBe(32);
    });

    it('should return a copy of the blinding', () => {
      const state = RandBlindingPrivateState.withBlinding(BLINDING);
      const ctx = makeContext(state);

      const [, returnedBlinding] = witnesses.wit_RandBlindingFactor(ctx);
      returnedBlinding.fill(0xff);

      expect(state.blinding).toEqual(BLINDING);
    });

    it('should work with a randomly generated state', () => {
      const state = RandBlindingPrivateState.generate();
      const ctx = makeContext(state);

      const [returnedState, returnedBlinding] =
        witnesses.wit_RandBlindingFactor(ctx);

      expect(returnedState).toBe(state);
      expect(returnedBlinding).toEqual(state.blinding);
    });
  });
});

describe('RandBlindingWitnesses factory', () => {
  it('should return a fresh witnesses object on each call', () => {
    const a = RandBlindingWitnesses();
    const b = RandBlindingWitnesses();
    expect(a).not.toBe(b);
  });

  it('should produce witnesses with identical behaviour', () => {
    const a = RandBlindingWitnesses();
    const b = RandBlindingWitnesses();
    const state = RandBlindingPrivateState.generate();
    const ctx = { privateState: state } as WitnessContext<
      Ledger,
      RandBlindingPrivateState
    >;

    const [stateA, blindingA] = a.wit_RandBlindingFactor(ctx);
    const [stateB, blindingB] = b.wit_RandBlindingFactor(ctx);

    expect(stateA).toBe(stateB);
    expect(blindingA).toEqual(blindingB);
  });
});
