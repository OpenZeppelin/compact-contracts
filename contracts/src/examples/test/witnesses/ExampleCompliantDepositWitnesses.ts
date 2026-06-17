// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Unaudited reference material that drives Compact circuits in off-chain
// tests. Production consumers must author and audit their own witnesses.
//
// SECURITY — randomness: `wit_RandomnessSeed` returns a FIXED seed from private
// state for reproducibility. A production wallet MUST return a fresh,
// cryptographically-random seed per invocation; a fixed/predictable seed
// destroys confidentiality (see ConfidentialFungibleToken's header).

import { getRandomValues } from 'node:crypto';
import type {
  JubjubPoint,
  WitnessContext,
} from '@midnight-ntwrk/compact-runtime';

export const DEFAULT_RANDOMNESS_SEED: Uint8Array = new Uint8Array(32).fill(
  0x2a,
);

export type Ciphertext = { c1: JubjubPoint; c2: JubjubPoint };

function serializeCiphertext(ct: Ciphertext): string {
  return `${ct.c1.x.toString(16)}:${ct.c1.y.toString(16)}:${ct.c2.x.toString(16)}:${ct.c2.y.toString(16)}`;
}

/**
 * @description Private state for the ExampleCompliantDeposit harness. It carries
 * the holder secrets used by `ConfidentialFungibleToken` (SK / EK / plaintext
 * cache / randomness seed) plus the issuer secret used by `Ownable`
 * (`ownerSecretKey`, returned by `wit_OwnableSK`). The active identity is
 * whatever these are currently set to.
 */
export type ExampleCompliantDepositPrivateState = {
  secretKey: Uint8Array;
  encryptionKey: Uint8Array;
  plaintextCache: Map<string, bigint>;
  randomnessSeed: Uint8Array;
  ownerSecretKey: Uint8Array;
};

export const ExampleCompliantDepositPrivateState = {
  generate: (): ExampleCompliantDepositPrivateState => ({
    secretKey: new Uint8Array(getRandomValues(Buffer.alloc(32))),
    encryptionKey: new Uint8Array(getRandomValues(Buffer.alloc(32))),
    plaintextCache: new Map(),
    randomnessSeed: DEFAULT_RANDOMNESS_SEED,
    ownerSecretKey: new Uint8Array(32),
  }),

  withSecrets: (
    sk: Uint8Array,
    ek: Uint8Array,
    ownerSecretKey: Uint8Array = new Uint8Array(32),
  ): ExampleCompliantDepositPrivateState => ({
    secretKey: sk,
    encryptionKey: ek,
    plaintextCache: new Map(),
    randomnessSeed: DEFAULT_RANDOMNESS_SEED,
    ownerSecretKey,
  }),

  cachePlaintext: (
    state: ExampleCompliantDepositPrivateState,
    ct: Ciphertext,
    plaintext: bigint,
  ): ExampleCompliantDepositPrivateState => {
    const newCache = new Map(state.plaintextCache);
    newCache.set(serializeCiphertext(ct), plaintext);
    return { ...state, plaintextCache: newCache };
  },

  lookupPlaintext: (
    state: ExampleCompliantDepositPrivateState,
    ct: Ciphertext,
  ): bigint | undefined => {
    return state.plaintextCache.get(serializeCiphertext(ct));
  },
};

export const ExampleCompliantDepositWitnesses = <L>() => ({
  wit_ConfidentialTokenSK(
    context: WitnessContext<L, ExampleCompliantDepositPrivateState>,
  ): [ExampleCompliantDepositPrivateState, Uint8Array] {
    return [context.privateState, context.privateState.secretKey];
  },

  wit_ConfidentialTokenEK(
    context: WitnessContext<L, ExampleCompliantDepositPrivateState>,
  ): [ExampleCompliantDepositPrivateState, Uint8Array] {
    return [context.privateState, context.privateState.encryptionKey];
  },

  wit_PlaintextBalance(
    context: WitnessContext<L, ExampleCompliantDepositPrivateState>,
    ct: Ciphertext,
  ): [ExampleCompliantDepositPrivateState, bigint] {
    const plaintext = ExampleCompliantDepositPrivateState.lookupPlaintext(
      context.privateState,
      ct,
    );
    if (plaintext === undefined) {
      throw new Error(
        `wit_PlaintextBalance: no cached plaintext for ${serializeCiphertext(ct)}`,
      );
    }
    return [context.privateState, plaintext];
  },

  wit_RandomnessSeed(
    context: WitnessContext<L, ExampleCompliantDepositPrivateState>,
  ): [ExampleCompliantDepositPrivateState, Uint8Array] {
    return [context.privateState, context.privateState.randomnessSeed];
  },

  wit_OwnableSK(
    context: WitnessContext<L, ExampleCompliantDepositPrivateState>,
  ): [ExampleCompliantDepositPrivateState, Uint8Array] {
    return [context.privateState, context.privateState.ownerSecretKey];
  },
});
