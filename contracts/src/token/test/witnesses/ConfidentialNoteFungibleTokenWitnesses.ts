// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Drives the ConfidentialNoteFungibleToken core circuits in off-chain tests.

import { getRandomValues } from 'node:crypto';
import type {
  MerkleTreePath,
  WitnessContext,
} from '@midnight-ntwrk/compact-runtime';
import type { Ledger } from '../../../../artifacts/MockConfidentialNoteFungibleToken/contract/index.js';

/** A note as the circuits see it: value plus a field-typed nonce. */
export type Note = { value: bigint; nonce: bigint };

/**
 * The private inputs the circuits ask for, held in a plain object the spec
 * mutates between calls.
 *
 * A real wallet would keep these in simulator private state, but
 * `setPrivateState` throws on the live backend, and this module's every spend
 * has to name a different input note. Closing the witnesses over a mutable
 * wallet instead keeps one spec file runnable on both backends.
 */
export type NoteWallet = {
  /** Owner spend secret; `pk = Hf(sk)`. */
  secretKey: Uint8Array;
  /** The input note consumed by the next transfer / burn / consume. */
  inputNote: Note;
  /**
   * Fixed nonce-randomness seed. Leave undefined for the production-correct
   * behavior (a fresh secret seed per witness call); set one only to test what
   * a reused seed does.
   */
  nonceSeed?: Uint8Array;
  /**
   * Merkle path returned verbatim instead of one looked up in the live tree.
   * Plants a stale (historical) or mismatched path, which a well-behaved
   * wallet never does.
   */
  pathOverride?: MerkleTreePath<Uint8Array>;
};

export const createNoteWallet = (): NoteWallet => ({
  secretKey: new Uint8Array(getRandomValues(Buffer.alloc(32))),
  inputNote: { value: 0n, nonce: 0n },
});

/** The core declares no private state; the wallet above carries everything. */
export type ConfidentialNoteFungibleTokenPrivateState = Record<string, never>;
export const ConfidentialNoteFungibleTokenPrivateState = {
  generate: (): ConfidentialNoteFungibleTokenPrivateState => ({}),
};

export interface IConfidentialNoteFungibleTokenWitnesses<P> {
  wit_SecretKey(context: WitnessContext<Ledger, P>): [P, Uint8Array];
  wit_InputNote(context: WitnessContext<Ledger, P>): [P, Note];
  wit_Path(
    context: WitnessContext<Ledger, P>,
    cm: Uint8Array,
  ): [P, MerkleTreePath<Uint8Array>];
  wit_NonceRandomness(context: WitnessContext<Ledger, P>): [P, Uint8Array];
}

export const ConfidentialNoteFungibleTokenWitnesses = (
  wallet: NoteWallet,
): IConfidentialNoteFungibleTokenWitnesses<ConfidentialNoteFungibleTokenPrivateState> => ({
  wit_SecretKey(context) {
    return [context.privateState, wallet.secretKey];
  },
  wit_InputNote(context) {
    return [context.privateState, wallet.inputNote];
  },
  // The circuit passes the input commitment; the wallet answers with its
  // Merkle path, read here from the live commitment tree.
  wit_Path(context, cm) {
    const planted = wallet.pathOverride;
    if (planted !== undefined) {
      return [context.privateState, planted];
    }
    const path = context.ledger.Core__commitments.findPathForLeaf(cm);
    if (path === undefined) {
      throw new Error('wit_Path: commitment not found in tree');
    }
    return [context.privateState, path];
  },
  // Fresh and secret per call, as the module requires; a fixed seed is only
  // honored when a spec explicitly plants one.
  wit_NonceRandomness(context) {
    return [
      context.privateState,
      wallet.nonceSeed ?? new Uint8Array(getRandomValues(Buffer.alloc(32))),
    ];
  },
});
