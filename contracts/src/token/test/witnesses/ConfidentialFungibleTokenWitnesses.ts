// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Unaudited reference material that drives Compact circuits in
// off-chain tests. Not shipped as a consumable artifact. Production
// consumers must author and audit their own witnesses.
//
// SECURITY — randomness: `wit_RandomnessSeed` below returns a FIXED seed from
// private state so tests are reproducible. A production wallet MUST return a
// fresh, cryptographically-random, unpredictable 32-byte seed per circuit
// invocation. A fixed or predictable seed does NOT affect integrity (balances,
// allowances, and supply are still sound), but it destroys confidentiality:
// the seed -> randomness expansion is deterministic and public, so anyone who
// knows (or guesses) the seed can strip the ElGamal mask and brute-force every
// bounded amount (< 2^48) on the public ledger. Reusing a seed across
// transactions also leaks plaintext differences. Do not copy this seed
// behavior into a real wallet.

import { getRandomValues } from 'node:crypto';
import type {
  JubjubPoint,
  WitnessContext,
} from '@midnight-ntwrk/compact-runtime';

/**
 * @description Default deterministic randomness seed for tests. `wit_RandomnessSeed`
 * returns whatever seed is held in private state, and the module expands it
 * in-circuit with distinct tags, so a single fixed seed yields reproducible
 * ciphertexts across a run. Tests that need a fresh seed per transaction (e.g.
 * to avoid identical memo ciphertexts) can rotate it via the simulator's
 * `privateState.setRandomnessSeed`.
 */
export const DEFAULT_RANDOMNESS_SEED: Uint8Array = new Uint8Array(32).fill(
  0x2a,
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * @description The Ciphertext type as represented by the Compact runtime in
 * TypeScript. Provided here for clarity; the actual type comes from the
 * compiled contract's index.d.ts.
 */
export type Ciphertext = {
  c1: JubjubPoint;
  c2: JubjubPoint;
};

/**
 * @description Canonical serialization of a Ciphertext to a string, used as
 * the lookup key in the plaintext cache. Concatenates the field elements of
 * both points in hex.
 *
 * @notice This is a private utility for the witness layer. If a canonical
 * Ciphertext serialization becomes available in the Compact runtime or a
 * project-wide utility, this should be replaced.
 */
function serializeCiphertext(ct: Ciphertext): string {
  return `${ct.c1.x.toString(16)}:${ct.c1.y.toString(16)}:${ct.c2.x.toString(16)}:${ct.c2.y.toString(16)}`;
}

// ---------------------------------------------------------------------------
// Witness interface
// ---------------------------------------------------------------------------

/**
 * @description Interface defining the witness methods required by the
 * ConfidentialFungibleToken module.
 *
 * @template L - The ledger type.
 * @template P - The private state type.
 */
export interface IConfidentialFungibleTokenWitnesses<L, P> {
  /**
   * Returns the user's account secret key. Verified in-circuit by binding
   * `accountId = persistentHash(SK)` to the on-chain account identifier.
   */
  wit_ConfidentialTokenSK(context: WitnessContext<L, P>): [P, Uint8Array];

  /**
   * Returns the user's ElGamal encryption secret. Verified in-circuit by
   * `ElGamal_assertDecryptsTo`, which re-derives the pk and asserts
   * equality with the on-chain stored pk.
   */
  wit_ConfidentialTokenEK(context: WitnessContext<L, P>): [P, Uint8Array];

  /**
   * Returns the wallet's cached plaintext for the given ciphertext.
   * Verified in-circuit by `ElGamal_assertDecryptsTo`.
   *
   * @param ct - The ciphertext whose plaintext is being requested.
   */
  wit_PlaintextBalance(
    context: WitnessContext<L, P>,
    ct: Ciphertext,
  ): [P, bigint];

  /**
   * Returns the 32-byte randomness seed for the circuit invocation. The seed
   * is held in private state and returned unchanged on every call, so it is
   * stable within (and across) invocations — the module relies on a single
   * seed per invocation, expanded in-circuit with distinct tags. Holding it in
   * state also keeps it predictable to the wallet, which is required for flows
   * that re-query a ciphertext the same circuit just produced (e.g. `approve`
   * after a prior-escrow refund).
   */
  wit_RandomnessSeed(context: WitnessContext<L, P>): [P, Uint8Array];
}

// ---------------------------------------------------------------------------
// Private state
// ---------------------------------------------------------------------------

/**
 * @description Private state for a ConfidentialFungibleToken wallet.
 *
 * Holds the two secrets (SK for account identity, EK for ElGamal
 * encryption) and a local cache mapping ciphertexts to their plaintext
 * values. The cache is populated by the wallet whenever:
 *   - it constructs a ciphertext locally (sending), in which case the
 *     plaintext is known directly;
 *   - it decrypts an incoming memo (receiving), in which case the
 *     plaintext is recovered via discrete-log search and cached against
 *     the resulting balance ciphertext.
 *
 * The cache is keyed by a canonical serialization of the ciphertext, not
 * by call order or position. This matches the circuit-side witness
 * signature `wit_PlaintextBalance(ct)` which passes the ciphertext
 * explicitly.
 */
export type ConfidentialFungibleTokenPrivateState = {
  /** 32-byte account secret. Derives accountId. */
  secretKey: Uint8Array;

  /** 32-byte ElGamal encryption secret. Derives the encryption pk. */
  encryptionKey: Uint8Array;

  /**
   * Cached plaintexts for ciphertexts the wallet knows the value of.
   * Keyed by canonical ciphertext serialization.
   */
  plaintextCache: Map<string, bigint>;

  /** 32-byte seed returned by `wit_RandomnessSeed`. */
  randomnessSeed: Uint8Array;
};

/**
 * @description Utilities for constructing and managing
 * ConfidentialFungibleTokenPrivateState.
 */
export const ConfidentialFungibleTokenPrivateState = {
  /**
   * @description Generates a fresh private state with cryptographically
   * random SK and EK and an empty plaintext cache.
   */
  generate: (): ConfidentialFungibleTokenPrivateState => ({
    secretKey: new Uint8Array(getRandomValues(Buffer.alloc(32))),
    encryptionKey: new Uint8Array(getRandomValues(Buffer.alloc(32))),
    plaintextCache: new Map(),
    randomnessSeed: DEFAULT_RANDOMNESS_SEED,
  }),

  /**
   * @description Creates a private state with user-supplied SK and EK and
   * an empty plaintext cache. Useful for deterministic tests. The randomness
   * seed defaults to `DEFAULT_RANDOMNESS_SEED` unless overridden.
   */
  withSecrets: (
    sk: Uint8Array,
    ek: Uint8Array,
    randomnessSeed: Uint8Array = DEFAULT_RANDOMNESS_SEED,
  ): ConfidentialFungibleTokenPrivateState => ({
    secretKey: sk,
    encryptionKey: ek,
    plaintextCache: new Map(),
    randomnessSeed,
  }),

  /**
   * @description Records a known plaintext for a ciphertext in the cache.
   * Called by the wallet whenever it learns a ciphertext's plaintext —
   * either by constructing the ciphertext locally or by decrypting an
   * incoming memo.
   */
  cachePlaintext: (
    state: ConfidentialFungibleTokenPrivateState,
    ct: Ciphertext,
    plaintext: bigint,
  ): ConfidentialFungibleTokenPrivateState => {
    const newCache = new Map(state.plaintextCache);
    newCache.set(serializeCiphertext(ct), plaintext);
    return { ...state, plaintextCache: newCache };
  },

  /**
   * @description Returns the cached plaintext for a ciphertext, or
   * undefined if the cache has no entry. Used directly by
   * `wit_PlaintextBalance`.
   */
  lookupPlaintext: (
    state: ConfidentialFungibleTokenPrivateState,
    ct: Ciphertext,
  ): bigint | undefined => {
    return state.plaintextCache.get(serializeCiphertext(ct));
  },
};

// ---------------------------------------------------------------------------
// Witness factory
// ---------------------------------------------------------------------------

/**
 * @description Factory function producing witness implementations for the
 * ConfidentialFungibleToken module.
 *
 * @notice The plaintext balance witness throws if the requested ciphertext
 * is not in the cache. In production this would indicate a wallet bug —
 * the wallet should always know the plaintext of any ciphertext the
 * contract asks it about, because every such ciphertext is either:
 *   (a) one the wallet constructed (and so knows by construction), or
 *   (b) one the wallet received via memo (and so decrypted and cached).
 *
 * In tests, throwing surfaces cache-population bugs immediately rather
 * than silently returning a wrong value.
 */

export const ConfidentialFungibleTokenWitnesses = <
  L,
>(): IConfidentialFungibleTokenWitnesses<
  L,
  ConfidentialFungibleTokenPrivateState
> => ({
  wit_ConfidentialTokenSK(
    context: WitnessContext<L, ConfidentialFungibleTokenPrivateState>,
  ): [ConfidentialFungibleTokenPrivateState, Uint8Array] {
    return [context.privateState, context.privateState.secretKey];
  },

  wit_ConfidentialTokenEK(
    context: WitnessContext<L, ConfidentialFungibleTokenPrivateState>,
  ): [ConfidentialFungibleTokenPrivateState, Uint8Array] {
    return [context.privateState, context.privateState.encryptionKey];
  },

  wit_PlaintextBalance(
    context: WitnessContext<L, ConfidentialFungibleTokenPrivateState>,
    ct: Ciphertext,
  ): [ConfidentialFungibleTokenPrivateState, bigint] {
    const plaintext = ConfidentialFungibleTokenPrivateState.lookupPlaintext(
      context.privateState,
      ct,
    );
    if (plaintext === undefined) {
      throw new Error(
        `wit_PlaintextBalance: no cached plaintext for ciphertext ${serializeCiphertext(ct)}. ` +
          'The wallet should cache plaintexts for all ciphertexts the contract may query.',
      );
    }
    return [context.privateState, plaintext];
  },

  wit_RandomnessSeed(
    context: WitnessContext<L, ConfidentialFungibleTokenPrivateState>,
  ): [ConfidentialFungibleTokenPrivateState, Uint8Array] {
    return [context.privateState, context.privateState.randomnessSeed];
  },
});

// ---------------------------------------------------------------------------
// Discrete-log recovery (stub)
// ---------------------------------------------------------------------------

/**
 * @description Recovers the plaintext value from a memo ciphertext by
 * computing the discrete log of the recovered group element.
 *
 * STUBBED: this is not implemented. The production version would use
 * baby-step giant-step (BSGS) over the bounded plaintext range [0, 2^48)
 * with a precomputed table of ~16MB and millisecond lookups. For tests
 * that need to exercise the receive-and-decrypt flow, callers can either:
 *   (a) skip the recovery and cache the plaintext directly via
 *       `ConfidentialFungibleTokenPrivateState.cachePlaintext` if the
 *       value is known by construction, or
 *   (b) implement a small brute-force recovery limited to small values
 *       for use in tests only.
 *
 * @throws Always. Replace with a real implementation when memo decryption
 * is needed end-to-end.
 */
export function recoverMemoPlaintext(
  _memo: Ciphertext,
  _ek: Uint8Array,
): bigint {
  throw new Error(
    'recoverMemoPlaintext is not implemented. ' +
      'For tests, cache plaintexts directly via ConfidentialFungibleTokenPrivateState.cachePlaintext.',
  );
}
