import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { describe, expect, it } from 'vitest';
import type { Ledger } from '../../../../../artifacts/crypto/randomness/test/mocks/MockRandPrfExpand/contract/index.js';
import {
  RandPrfExpandPrivateState,
  RandPrfExpandWitnesses,
} from './RandPrfExpandWitnesses.js';

const SEED = new Uint8Array(32).fill(0x34);

describe('RandPrfExpandPrivateState', () => {
  describe('generate', () => {
    it('should return a state with a 32-byte seed', () => {
      const state = RandPrfExpandPrivateState.generate();
      expect(state.seed).toBeInstanceOf(Uint8Array);
      expect(state.seed.length).toBe(32);
    });

    it('should produce unique seeds on successive calls', () => {
      const a = RandPrfExpandPrivateState.generate();
      const b = RandPrfExpandPrivateState.generate();
      expect(a.seed).not.toEqual(b.seed);
    });
  });

  describe('withSeed', () => {
    it('should accept a valid 32-byte seed', () => {
      const state = RandPrfExpandPrivateState.withSeed(SEED);
      expect(state.seed).toEqual(SEED);
    });

    // The circuit, not the wallet helper, rejects the zero seed.
    it('should accept the zero seed', () => {
      const state = RandPrfExpandPrivateState.withSeed(new Uint8Array(32));
      expect(state.seed).toEqual(new Uint8Array(32));
    });

    it('should create a defensive copy of the input seed', () => {
      const seed = new Uint8Array(32).fill(0xcc);
      const state = RandPrfExpandPrivateState.withSeed(seed);

      seed.fill(0xff);
      expect(state.seed).toEqual(new Uint8Array(32).fill(0xcc));
    });

    it('should throw for a seed shorter than 32 bytes', () => {
      const short = new Uint8Array(16);
      expect(() => RandPrfExpandPrivateState.withSeed(short)).toThrowError(
        'withSeed: expected 32-byte seed, received 16 bytes',
      );
    });

    it('should throw for a seed longer than 32 bytes', () => {
      const long = new Uint8Array(64);
      expect(() => RandPrfExpandPrivateState.withSeed(long)).toThrowError(
        'withSeed: expected 32-byte seed, received 64 bytes',
      );
    });

    it('should throw for an empty array', () => {
      expect(() =>
        RandPrfExpandPrivateState.withSeed(new Uint8Array(0)),
      ).toThrowError('withSeed: expected 32-byte seed, received 0 bytes');
    });
  });
});

describe('RandPrfExpandWitnesses', () => {
  const witnesses = RandPrfExpandWitnesses();

  function makeContext(
    privateState: RandPrfExpandPrivateState,
  ): WitnessContext<Ledger, RandPrfExpandPrivateState> {
    return { privateState } as WitnessContext<
      Ledger,
      RandPrfExpandPrivateState
    >;
  }

  describe('wit_RandPrfExpandSeed', () => {
    it('should return a tuple of [privateState, seed]', () => {
      const state = RandPrfExpandPrivateState.withSeed(SEED);
      const ctx = makeContext(state);

      const [returnedState, returnedSeed] =
        witnesses.wit_RandPrfExpandSeed(ctx);

      expect(returnedState).toBe(state);
      expect(returnedSeed).toEqual(SEED);
    });

    it('should return the exact same privateState reference', () => {
      const state = RandPrfExpandPrivateState.generate();
      const ctx = makeContext(state);

      const [returnedState] = witnesses.wit_RandPrfExpandSeed(ctx);
      expect(returnedState).toBe(state);
    });

    it('should return the seed as a Uint8Array', () => {
      const state = RandPrfExpandPrivateState.generate();
      const ctx = makeContext(state);

      const [, returnedSeed] = witnesses.wit_RandPrfExpandSeed(ctx);
      expect(returnedSeed).toBeInstanceOf(Uint8Array);
      expect(returnedSeed.length).toBe(32);
    });

    it('should return a copy the caller cannot use to mutate the state', () => {
      const state = RandPrfExpandPrivateState.withSeed(SEED);
      const ctx = makeContext(state);

      const [, returnedSeed] = witnesses.wit_RandPrfExpandSeed(ctx);
      returnedSeed.fill(0xff);

      expect(state.seed).toEqual(SEED);
    });
  });
});

describe('RandPrfExpandWitnesses factory', () => {
  it('should return a fresh witnesses object on each call', () => {
    const a = RandPrfExpandWitnesses();
    const b = RandPrfExpandWitnesses();
    expect(a).not.toBe(b);
  });

  it('should produce witnesses with identical behaviour', () => {
    const a = RandPrfExpandWitnesses();
    const b = RandPrfExpandWitnesses();
    const state = RandPrfExpandPrivateState.generate();
    const ctx = { privateState: state } as WitnessContext<
      Ledger,
      RandPrfExpandPrivateState
    >;

    const [stateA, seedA] = a.wit_RandPrfExpandSeed(ctx);
    const [stateB, seedB] = b.wit_RandPrfExpandSeed(ctx);

    expect(stateA).toBe(stateB);
    expect(seedA).toEqual(seedB);
  });
});
