import type {
  JubjubPoint,
  WitnessContext,
} from '@midnight-ntwrk/compact-runtime';
import { describe, expect, it } from 'vitest';
import type { Ledger } from '../../../../artifacts/MockConfidentialFungibleToken/contract/index.js';
import {
  type Ciphertext,
  ConfidentialFungibleTokenPrivateState,
  ConfidentialFungibleTokenWitnesses,
} from '../witnesses/ConfidentialFungibleTokenWitnesses.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * @description Builds a synthetic JubjubPoint for tests. The values are
 * arbitrary; only consistency between calls with the same inputs matters.
 */
function point(x: bigint, y: bigint): JubjubPoint {
  return { x, y };
}

/**
 * @description Builds a synthetic Ciphertext for tests.
 */
function ciphertext(
  c1x: bigint,
  c1y: bigint,
  c2x: bigint,
  c2y: bigint,
): Ciphertext {
  return { c1: point(c1x, c1y), c2: point(c2x, c2y) };
}

/**
 * @description A minimal witness context with empty ledger. The witness
 * implementations under test do not read the ledger.
 */
function makeContext(
  privateState: ConfidentialFungibleTokenPrivateState,
): WitnessContext<Ledger, ConfidentialFungibleTokenPrivateState> {
  return { privateState } as WitnessContext<
    Ledger,
    ConfidentialFungibleTokenPrivateState
  >;
}

const SK_A = new Uint8Array(32).fill(0xa1);
const EK_A = new Uint8Array(32).fill(0xa2);
const SK_B = new Uint8Array(32).fill(0xb1);
const EK_B = new Uint8Array(32).fill(0xb2);

// ---------------------------------------------------------------------------
// Private state construction
// ---------------------------------------------------------------------------

describe('ConfidentialFungibleTokenPrivateState.generate', () => {
  it('produces 32-byte SK and EK', () => {
    const state = ConfidentialFungibleTokenPrivateState.generate();

    expect(state.secretKey).toBeInstanceOf(Uint8Array);
    expect(state.secretKey.length).toBe(32);
    expect(state.encryptionKey).toBeInstanceOf(Uint8Array);
    expect(state.encryptionKey.length).toBe(32);
  });

  it('produces an empty cache', () => {
    const state = ConfidentialFungibleTokenPrivateState.generate();

    expect(state.plaintextCache).toBeInstanceOf(Map);
    expect(state.plaintextCache.size).toBe(0);
  });

  it('produces distinct keys across invocations', () => {
    const s1 = ConfidentialFungibleTokenPrivateState.generate();
    const s2 = ConfidentialFungibleTokenPrivateState.generate();

    expect(s1.secretKey).not.toEqual(s2.secretKey);
    expect(s1.encryptionKey).not.toEqual(s2.encryptionKey);
  });
});

describe('ConfidentialFungibleTokenPrivateState.withSecrets', () => {
  it('stores the supplied SK and EK', () => {
    const state = ConfidentialFungibleTokenPrivateState.withSecrets(SK_A, EK_A);

    expect(state.secretKey).toEqual(SK_A);
    expect(state.encryptionKey).toEqual(EK_A);
  });

  it('starts with an empty cache', () => {
    const state = ConfidentialFungibleTokenPrivateState.withSecrets(SK_A, EK_A);

    expect(state.plaintextCache.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Cache operations
// ---------------------------------------------------------------------------

describe('ConfidentialFungibleTokenPrivateState.cachePlaintext', () => {
  it('records a plaintext keyed by ciphertext identity', () => {
    const initial = ConfidentialFungibleTokenPrivateState.withSecrets(
      SK_A,
      EK_A,
    );
    const ct = ciphertext(1n, 2n, 3n, 4n);

    const updated = ConfidentialFungibleTokenPrivateState.cachePlaintext(
      initial,
      ct,
      100n,
    );

    expect(
      ConfidentialFungibleTokenPrivateState.lookupPlaintext(updated, ct),
    ).toBe(100n);
  });

  it('does not mutate the input state', () => {
    const initial = ConfidentialFungibleTokenPrivateState.withSecrets(
      SK_A,
      EK_A,
    );
    const ct = ciphertext(1n, 2n, 3n, 4n);

    ConfidentialFungibleTokenPrivateState.cachePlaintext(initial, ct, 100n);

    expect(initial.plaintextCache.size).toBe(0);
  });

  it('preserves SK and EK in the updated state', () => {
    const initial = ConfidentialFungibleTokenPrivateState.withSecrets(
      SK_A,
      EK_A,
    );
    const ct = ciphertext(1n, 2n, 3n, 4n);

    const updated = ConfidentialFungibleTokenPrivateState.cachePlaintext(
      initial,
      ct,
      100n,
    );

    expect(updated.secretKey).toEqual(SK_A);
    expect(updated.encryptionKey).toEqual(EK_A);
  });

  it('supports multiple distinct ciphertexts in the cache', () => {
    let state = ConfidentialFungibleTokenPrivateState.withSecrets(SK_A, EK_A);
    const ct1 = ciphertext(1n, 2n, 3n, 4n);
    const ct2 = ciphertext(5n, 6n, 7n, 8n);

    state = ConfidentialFungibleTokenPrivateState.cachePlaintext(
      state,
      ct1,
      100n,
    );
    state = ConfidentialFungibleTokenPrivateState.cachePlaintext(
      state,
      ct2,
      200n,
    );

    expect(
      ConfidentialFungibleTokenPrivateState.lookupPlaintext(state, ct1),
    ).toBe(100n);
    expect(
      ConfidentialFungibleTokenPrivateState.lookupPlaintext(state, ct2),
    ).toBe(200n);
  });

  it('overwrites an existing entry for the same ciphertext', () => {
    let state = ConfidentialFungibleTokenPrivateState.withSecrets(SK_A, EK_A);
    const ct = ciphertext(1n, 2n, 3n, 4n);

    state = ConfidentialFungibleTokenPrivateState.cachePlaintext(
      state,
      ct,
      100n,
    );
    state = ConfidentialFungibleTokenPrivateState.cachePlaintext(
      state,
      ct,
      250n,
    );

    expect(
      ConfidentialFungibleTokenPrivateState.lookupPlaintext(state, ct),
    ).toBe(250n);
  });
});

describe('ConfidentialFungibleTokenPrivateState.lookupPlaintext', () => {
  it('returns undefined for an empty cache', () => {
    const state = ConfidentialFungibleTokenPrivateState.withSecrets(SK_A, EK_A);
    const ct = ciphertext(1n, 2n, 3n, 4n);

    expect(
      ConfidentialFungibleTokenPrivateState.lookupPlaintext(state, ct),
    ).toBeUndefined();
  });

  it('returns undefined for a ciphertext not in the cache', () => {
    let state = ConfidentialFungibleTokenPrivateState.withSecrets(SK_A, EK_A);
    const ct1 = ciphertext(1n, 2n, 3n, 4n);
    const ct2 = ciphertext(5n, 6n, 7n, 8n);

    state = ConfidentialFungibleTokenPrivateState.cachePlaintext(
      state,
      ct1,
      100n,
    );

    expect(
      ConfidentialFungibleTokenPrivateState.lookupPlaintext(state, ct2),
    ).toBeUndefined();
  });

  it('treats structurally equal ciphertexts as the same key', () => {
    let state = ConfidentialFungibleTokenPrivateState.withSecrets(SK_A, EK_A);
    const stored = ciphertext(1n, 2n, 3n, 4n);
    const queried = ciphertext(1n, 2n, 3n, 4n); // distinct object, same values

    state = ConfidentialFungibleTokenPrivateState.cachePlaintext(
      state,
      stored,
      100n,
    );

    expect(
      ConfidentialFungibleTokenPrivateState.lookupPlaintext(state, queried),
    ).toBe(100n);
  });

  it('distinguishes ciphertexts differing only in c1', () => {
    let state = ConfidentialFungibleTokenPrivateState.withSecrets(SK_A, EK_A);
    const ct1 = ciphertext(1n, 2n, 3n, 4n);
    const ct2 = ciphertext(99n, 2n, 3n, 4n); // different c1.x

    state = ConfidentialFungibleTokenPrivateState.cachePlaintext(
      state,
      ct1,
      100n,
    );

    expect(
      ConfidentialFungibleTokenPrivateState.lookupPlaintext(state, ct2),
    ).toBeUndefined();
  });

  it('distinguishes ciphertexts differing only in c2', () => {
    let state = ConfidentialFungibleTokenPrivateState.withSecrets(SK_A, EK_A);
    const ct1 = ciphertext(1n, 2n, 3n, 4n);
    const ct2 = ciphertext(1n, 2n, 3n, 99n); // different c2.y

    state = ConfidentialFungibleTokenPrivateState.cachePlaintext(
      state,
      ct1,
      100n,
    );

    expect(
      ConfidentialFungibleTokenPrivateState.lookupPlaintext(state, ct2),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Witness functions
// ---------------------------------------------------------------------------

describe('wit_ConfidentialTokenSK', () => {
  it('returns the SK from private state', () => {
    const witnesses = ConfidentialFungibleTokenWitnesses();
    const state = ConfidentialFungibleTokenPrivateState.withSecrets(SK_A, EK_A);

    const [returnedState, sk] = witnesses.wit_ConfidentialTokenSK(
      makeContext(state),
    );

    expect(sk).toEqual(SK_A);
    expect(returnedState).toBe(state);
  });

  it('reflects SK changes between calls', () => {
    const witnesses = ConfidentialFungibleTokenWitnesses();
    const stateA = ConfidentialFungibleTokenPrivateState.withSecrets(
      SK_A,
      EK_A,
    );
    const stateB = ConfidentialFungibleTokenPrivateState.withSecrets(
      SK_B,
      EK_B,
    );

    const [, skA] = witnesses.wit_ConfidentialTokenSK(makeContext(stateA));
    const [, skB] = witnesses.wit_ConfidentialTokenSK(makeContext(stateB));

    expect(skA).toEqual(SK_A);
    expect(skB).toEqual(SK_B);
  });
});

describe('wit_ConfidentialTokenEK', () => {
  it('returns the EK from private state', () => {
    const witnesses = ConfidentialFungibleTokenWitnesses();
    const state = ConfidentialFungibleTokenPrivateState.withSecrets(SK_A, EK_A);

    const [returnedState, ek] = witnesses.wit_ConfidentialTokenEK(
      makeContext(state),
    );

    expect(ek).toEqual(EK_A);
    expect(returnedState).toBe(state);
  });

  it('returns EK independently of SK', () => {
    const witnesses = ConfidentialFungibleTokenWitnesses();
    const state = ConfidentialFungibleTokenPrivateState.withSecrets(SK_A, EK_B);

    const [, sk] = witnesses.wit_ConfidentialTokenSK(makeContext(state));
    const [, ek] = witnesses.wit_ConfidentialTokenEK(makeContext(state));

    expect(sk).toEqual(SK_A);
    expect(ek).toEqual(EK_B);
  });
});

describe('wit_PlaintextBalance', () => {
  it('returns the cached plaintext for a known ciphertext', () => {
    const witnesses = ConfidentialFungibleTokenWitnesses();
    let state = ConfidentialFungibleTokenPrivateState.withSecrets(SK_A, EK_A);
    const ct = ciphertext(1n, 2n, 3n, 4n);
    state = ConfidentialFungibleTokenPrivateState.cachePlaintext(
      state,
      ct,
      500n,
    );

    const [, plaintext] = witnesses.wit_PlaintextBalance(
      makeContext(state),
      ct,
    );

    expect(plaintext).toBe(500n);
  });

  it('throws when the ciphertext is not cached', () => {
    const witnesses = ConfidentialFungibleTokenWitnesses();
    const state = ConfidentialFungibleTokenPrivateState.withSecrets(SK_A, EK_A);
    const ct = ciphertext(1n, 2n, 3n, 4n);

    expect(() =>
      witnesses.wit_PlaintextBalance(makeContext(state), ct),
    ).toThrow();
  });

  it('does not mutate private state when returning a cached value', () => {
    const witnesses = ConfidentialFungibleTokenWitnesses();
    let state = ConfidentialFungibleTokenPrivateState.withSecrets(SK_A, EK_A);
    const ct = ciphertext(1n, 2n, 3n, 4n);
    state = ConfidentialFungibleTokenPrivateState.cachePlaintext(
      state,
      ct,
      500n,
    );

    const [returnedState] = witnesses.wit_PlaintextBalance(
      makeContext(state),
      ct,
    );

    expect(returnedState).toBe(state);
  });

  it('returns distinct plaintexts for distinct ciphertexts in the same state', () => {
    const witnesses = ConfidentialFungibleTokenWitnesses();
    let state = ConfidentialFungibleTokenPrivateState.withSecrets(SK_A, EK_A);
    const ct1 = ciphertext(1n, 2n, 3n, 4n);
    const ct2 = ciphertext(5n, 6n, 7n, 8n);
    state = ConfidentialFungibleTokenPrivateState.cachePlaintext(
      state,
      ct1,
      100n,
    );
    state = ConfidentialFungibleTokenPrivateState.cachePlaintext(
      state,
      ct2,
      200n,
    );

    const [, p1] = witnesses.wit_PlaintextBalance(makeContext(state), ct1);
    const [, p2] = witnesses.wit_PlaintextBalance(makeContext(state), ct2);

    expect(p1).toBe(100n);
    expect(p2).toBe(200n);
  });
});

describe('wit_RandomnessSeed', () => {
  it('returns a 32-byte buffer', () => {
    const witnesses = ConfidentialFungibleTokenWitnesses();
    const state = ConfidentialFungibleTokenPrivateState.withSecrets(SK_A, EK_A);

    const [, seed] = witnesses.wit_RandomnessSeed(makeContext(state));

    expect(seed).toBeInstanceOf(Uint8Array);
    expect(seed.length).toBe(32);
  });

  it('returns the seed held in private state, stably across calls', () => {
    const witnesses = ConfidentialFungibleTokenWitnesses();
    const state = ConfidentialFungibleTokenPrivateState.withSecrets(SK_A, EK_A);

    // The seed must be stable within an invocation: the module calls
    // wit_RandomnessSeed multiple times per circuit and relies on getting the
    // same seed (expanded with distinct tags) each time.
    const [, seed1] = witnesses.wit_RandomnessSeed(makeContext(state));
    const [, seed2] = witnesses.wit_RandomnessSeed(makeContext(state));

    expect(seed1).toEqual(state.randomnessSeed);
    expect(seed2).toEqual(seed1);
  });

  it('reflects a seed override supplied via withSecrets', () => {
    const witnesses = ConfidentialFungibleTokenWitnesses();
    const customSeed = new Uint8Array(32).fill(0x99);
    const state = ConfidentialFungibleTokenPrivateState.withSecrets(
      SK_A,
      EK_A,
      customSeed,
    );

    const [, seed] = witnesses.wit_RandomnessSeed(makeContext(state));

    expect(seed).toEqual(customSeed);
  });

  it('does not modify the private state', () => {
    const witnesses = ConfidentialFungibleTokenWitnesses();
    const state = ConfidentialFungibleTokenPrivateState.withSecrets(SK_A, EK_A);

    const [returnedState] = witnesses.wit_RandomnessSeed(makeContext(state));

    expect(returnedState).toBe(state);
  });
});
