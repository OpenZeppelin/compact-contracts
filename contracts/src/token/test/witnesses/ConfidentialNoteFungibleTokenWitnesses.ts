// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Drives ConfidentialNoteFungibleToken (core) circuits in off-chain tests.

import { getRandomValues } from 'node:crypto';
import type {
  MerkleTreePath,
  WitnessContext,
} from '@midnight-ntwrk/compact-runtime';
import type { Ledger } from '../../../../artifacts/MockConfidentialNoteFungibleToken/contract/index.js';

/** A note as the circuits see it: value + field-typed nonce. */
export type Note = { value: bigint; nonce: bigint };

export type ConfidentialNoteFungibleTokenPrivateState = {
  /** Owner spend secret; pk = Hf(sk). */
  secretKey: Uint8Array;
  /** The input note being spent in a transfer/burn (or consume target). */
  inputNote: Note;
  /**
   * Optional fixed nonce-randomness seed. Leave undefined for the
   * production-correct behavior (a fresh secret seed per witness call).
   */
  nonceSeed?: Uint8Array;
};

export const ConfidentialNoteFungibleTokenPrivateState = {
  generate: (): ConfidentialNoteFungibleTokenPrivateState => ({
    secretKey: new Uint8Array(getRandomValues(Buffer.alloc(32))),
    inputNote: { value: 0n, nonce: 0n },
  }),
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

export const ConfidentialNoteFungibleTokenWitnesses =
  (): IConfidentialNoteFungibleTokenWitnesses<ConfidentialNoteFungibleTokenPrivateState> => ({
    wit_SecretKey(context) {
      return [context.privateState, context.privateState.secretKey];
    },
    wit_InputNote(context) {
      return [context.privateState, context.privateState.inputNote];
    },
    // The circuit passes the input commitment; we return its Merkle path by
    // reading the live commitment tree from the ledger.
    wit_Path(context, cm) {
      const path = context.ledger.Core__commitments.findPathForLeaf(cm);
      if (path === undefined) {
        throw new Error('wit_Path: commitment not found in tree');
      }
      return [context.privateState, path];
    },
    // Fresh + secret per call, as the module requires; a fixed seed is only
    // honored when a test explicitly plants one.
    wit_NonceRandomness(context) {
      return [
        context.privateState,
        context.privateState.nonceSeed ??
          new Uint8Array(getRandomValues(Buffer.alloc(32))),
      ];
    },
  });
