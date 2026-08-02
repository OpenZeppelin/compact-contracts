// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Drives ConfidentialNoteFungibleTokenAllowlist (KYC allowlist) circuits in
// off-chain tests.

import type {
  MerkleTreePath,
  WitnessContext,
} from '@midnight-ntwrk/compact-runtime';
import type { Ledger } from '../../../../artifacts/MockConfidentialNoteFungibleTokenAllowlist/contract/index.js';

export type ConfidentialNoteFungibleTokenAllowlistPrivateState = Record<
  string,
  never
>;

export const ConfidentialNoteFungibleTokenAllowlistPrivateState = {
  generate: (): ConfidentialNoteFungibleTokenAllowlistPrivateState => ({}),
};

export interface IConfidentialNoteFungibleTokenAllowlistWitnesses<P> {
  wit_AllowlistPath(
    context: WitnessContext<Ledger, P>,
    leaf: Uint8Array,
  ): [P, MerkleTreePath<Uint8Array>];
}

export const ConfidentialNoteFungibleTokenAllowlistWitnesses =
  (): IConfidentialNoteFungibleTokenAllowlistWitnesses<ConfidentialNoteFungibleTokenAllowlistPrivateState> => ({
    // The circuit passes the prover's identity leaf; we return its Merkle path
    // by reading the live allowlist tree from the ledger.
    wit_AllowlistPath(context, leaf) {
      const path = context.ledger.Allow__allowed.findPathForLeaf(leaf);
      if (path === undefined) {
        throw new Error('wit_AllowlistPath: leaf not found in allowlist');
      }
      return [context.privateState, path];
    },
  });
