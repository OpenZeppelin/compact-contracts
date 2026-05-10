// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts v0.0.1-alpha.1 (multisig/witnesses/SignerTreeWitnesses.ts)

import type {
  MerkleTreePath,
  WitnessContext,
} from '@midnight-ntwrk/compact-runtime';

/**
 * Witness interface for `multisig/SignerTree.compact`.
 *
 * The module declares one witness — `wit_getSignerCommitmentPath` — which
 * looks up a candidate commitment in the on-chain tree and returns its
 * Merkle path. `_validateMember` then checks the path's root against the
 * tree's current root and the path's leaf against the candidate.
 */
export interface ISignerTreeWitnesses<L, P> {
  wit_getSignerCommitmentPath(
    context: WitnessContext<L, P>,
    commitment: Uint8Array,
  ): [P, MerkleTreePath<Uint8Array>];
}

/**
 * Stateless private state — `SignerTree` does not store secrets in private
 * state. The path lookup reads from the public ledger.
 */
export type SignerTreePrivateState = Record<string, never>;
export const SignerTreePrivateState: SignerTreePrivateState = {};

export const SignerTreePrivateStateOps = {
  generate: (): SignerTreePrivateState => ({}),

  /**
   * Read the path for `commitment` from the public ledger view of the tree.
   * Returns a default invalid path if the commitment is not currently in
   * the tree.
   *
   * NOTE: this expects the consumer contract to have imported `SignerTree`
   * with the exact prefix `SignerTree_`, so the namespaced ledger field is
   * `SignerTree__signerTree`. Importing under a different prefix breaks the
   * lookup.
   */
  getSignerCommitmentPath: <L>(
    ledger: L,
    commitment: Uint8Array,
  ): MerkleTreePath<Uint8Array> => {
    // Cast `ledger as any` to avoid the type gymnastics that ShieldedAccess-
    // Control's witness file uses for the same reason.
    const path = (ledger as any).SignerTree__signerTree.findPathForLeaf(
      commitment,
    );
    const defaultPath = {
      leaf: new Uint8Array(32),
      path: Array.from({ length: 20 }, () => ({
        sibling: { field: 0n },
        goes_left: false,
      })),
    };
    return path ?? defaultPath;
  },
};

export const SignerTreeWitnesses = <
  L,
>(): ISignerTreeWitnesses<L, SignerTreePrivateState> => ({
  wit_getSignerCommitmentPath(
    context: WitnessContext<L, SignerTreePrivateState>,
    commitment: Uint8Array,
  ): [SignerTreePrivateState, MerkleTreePath<Uint8Array>] {
    return [
      context.privateState,
      SignerTreePrivateStateOps.getSignerCommitmentPath<L>(
        context.ledger,
        commitment,
      ),
    ];
  },
});
