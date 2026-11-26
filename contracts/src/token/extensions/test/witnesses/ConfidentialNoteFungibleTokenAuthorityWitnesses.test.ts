import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { describe, expect, it } from 'vitest';
import type { Ledger } from '../../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenAuthority/contract/index.js';
import {
  ConfidentialNoteFungibleTokenAuthorityPrivateState,
  ConfidentialNoteFungibleTokenAuthorityWitnesses,
} from './ConfidentialNoteFungibleTokenAuthorityWitnesses.js';

type PrivateState = ConfidentialNoteFungibleTokenAuthorityPrivateState;
const PrivateState = ConfidentialNoteFungibleTokenAuthorityPrivateState;

const SECRET_KEY = new Uint8Array(32).fill(0x34);

const makeContext = (
  privateState: PrivateState,
): WitnessContext<Ledger, PrivateState> =>
  ({ privateState }) as WitnessContext<Ledger, PrivateState>;

describe('ConfidentialNoteFungibleTokenAuthorityPrivateState', () => {
  describe('generate', () => {
    it('should return a state with a 32-byte secretKey', () => {
      const state = PrivateState.generate();
      expect(state.secretKey).toBeInstanceOf(Uint8Array);
      expect(state.secretKey.length).toBe(32);
    });

    it('should produce a unique secret key on successive calls', () => {
      const a = PrivateState.generate();
      const b = PrivateState.generate();
      expect(a.secretKey).not.toEqual(b.secretKey);
    });
  });

  describe('withSecretKey', () => {
    it('should accept a valid 32-byte secret key', () => {
      const state = PrivateState.withSecretKey(SECRET_KEY);
      expect(state.secretKey).toEqual(SECRET_KEY);
    });

    it('should create a defensive copy of the input secret key', () => {
      const sk = new Uint8Array(32).fill(0xcc);
      const state = PrivateState.withSecretKey(sk);

      sk.fill(0xff);
      expect(state.secretKey).toEqual(new Uint8Array(32).fill(0xcc));
    });

    it.each([
      ['shorter than 32 bytes', 16],
      ['longer than 32 bytes', 64],
      ['empty', 0],
    ])('should throw for a secret key %s', (_, length) => {
      expect(() =>
        PrivateState.withSecretKey(new Uint8Array(length)),
      ).toThrowError(
        `withSecretKey: expected 32-byte secret key, received ${length} bytes`,
      );
    });
  });
});

describe('ConfidentialNoteFungibleTokenAuthorityWitnesses', () => {
  const witnesses = ConfidentialNoteFungibleTokenAuthorityWitnesses<Ledger>();

  describe('wit_AuthPrfPseudonymSK', () => {
    it('should return a tuple of [privateState, secretKey]', () => {
      const state = PrivateState.withSecretKey(SECRET_KEY);

      const [returnedState, returnedSK] = witnesses.wit_AuthPrfPseudonymSK(
        makeContext(state),
      );

      expect(returnedState).toBe(state);
      expect(returnedSK).toEqual(SECRET_KEY);
    });

    it('should return a copy of the secret key', () => {
      const state = PrivateState.withSecretKey(SECRET_KEY);

      const [, returnedSK] = witnesses.wit_AuthPrfPseudonymSK(
        makeContext(state),
      );
      returnedSK.fill(0xff);

      expect(state.secretKey).toEqual(SECRET_KEY);
    });

    it('should work with a randomly generated state', () => {
      const state = PrivateState.generate();

      const [returnedState, returnedSK] = witnesses.wit_AuthPrfPseudonymSK(
        makeContext(state),
      );

      expect(returnedState).toBe(state);
      expect(returnedSK).toBeInstanceOf(Uint8Array);
      expect(returnedSK).toEqual(state.secretKey);
    });
  });
});

describe('ConfidentialNoteFungibleTokenAuthorityWitnesses factory', () => {
  it('should return a fresh witnesses object on each call', () => {
    const a = ConfidentialNoteFungibleTokenAuthorityWitnesses<Ledger>();
    const b = ConfidentialNoteFungibleTokenAuthorityWitnesses<Ledger>();
    expect(a).not.toBe(b);
  });

  it('should produce witnesses with identical behaviour', () => {
    const a = ConfidentialNoteFungibleTokenAuthorityWitnesses<Ledger>();
    const b = ConfidentialNoteFungibleTokenAuthorityWitnesses<Ledger>();
    const ctx = makeContext(PrivateState.generate());

    const [stateA, skA] = a.wit_AuthPrfPseudonymSK(ctx);
    const [stateB, skB] = b.wit_AuthPrfPseudonymSK(ctx);

    expect(stateA).toBe(stateB);
    expect(skA).toEqual(skB);
  });
});
