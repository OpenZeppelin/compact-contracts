import { getRandomValues } from 'node:crypto';
import type {
  MerkleTreePath,
  WitnessContext,
} from '@midnight-ntwrk/compact-runtime';

/**
 * @description Interface defining the witness methods for ShieldedAccessControl operations.
 * @template L - The ledger type.
 * @template P - The private state type.
 */
export interface IShieldedAccessControlWitnesses<L, P> {
  /**
   * Returns the user's secret key from the private state.
   * The same key is used across all roles within a contract instance.
   * @param context - The witness context containing the private state.
   * @returns A tuple of the private state and the secret key as a Uint8Array.
   */
  wit_secretKey(context: WitnessContext<L, P>): [P, Uint8Array];

  /**
   * Returns a Merkle tree path for a given role commitment.
   * @param context - The witness context containing the private state and ledger.
   * @param roleCommitment - The role commitment to find a path for.
   * @returns A tuple of the private state and the Merkle tree path.
   */
  wit_getRoleCommitmentPath(
    context: WitnessContext<L, P>,
    roleCommitment: Uint8Array,
  ): [P, MerkleTreePath<Uint8Array>];
}

/**
 * @description Represents the private state of a Shielded AccessControl contract.
 * Contains a single secret key used to derive the user's account identifier.
 * The same key is used across all roles within a contract instance.
 */
export type ShieldedAccessControlPrivateState = {
  /** @description A 32-byte secret key used to derive the shielded account identifier. */
  secretKey: Uint8Array;
};

/**
 * @description Utility object for managing the private state of a Shielded AccessControl contract.
 */
export const ShieldedAccessControlPrivateState = {
  /**
   * @description Generates a new private state with a cryptographically random secret key.
   * @returns A fresh ShieldedAccessControlPrivateState instance.
   */
  generate: (): ShieldedAccessControlPrivateState => ({
    secretKey: new Uint8Array(getRandomValues(Buffer.alloc(32))),
  }),

  /**
   * @description Creates a new private state with a user-defined secret key.
   * Useful for deterministic key generation in testing or advanced use cases.
   *
   * @param sk - The 32-byte secret key to use.
   * @returns A fresh ShieldedAccessControlPrivateState instance with the provided key.
   *
   * @example
   * ```typescript
   * const deterministicKey = myDeterministicScheme(...);
   * const privateState = ShieldedAccessControlPrivateState.withSecretKey(deterministicKey);
   * ```
   */
  withSecretKey: (sk: Uint8Array): ShieldedAccessControlPrivateState => ({
    secretKey: sk,
  }),

  /**
   * @description Returns the Merkle tree path for a given role commitment, or a default
   * invalid path if the commitment is not found in the tree.
   *
   * @param ledger - The contract ledger containing the operator roles Merkle tree.
   * @param roleCommitment - The role commitment to search for.
   * @returns The Merkle tree path if found, otherwise a default invalid path.
   */
  getRoleCommitmentPath: <L>(
    ledger: L,
    roleCommitment: Uint8Array,
  ): MerkleTreePath<Uint8Array> => {
    const path =
      // cast ledger as any to avoid type gymnastics
      (ledger as any).ShieldedAccessControl__operatorRoles.findPathForLeaf(
        roleCommitment,
      );
    const defaultPath = {
      leaf: new Uint8Array(32),
      path: Array.from({ length: 20 }, () => ({
        sibling: { field: 0n },
        goes_left: false,
      })),
    };
    return path ? path : defaultPath;
  },
};

/**
 * @description Factory function creating witness implementations for Shielded AccessControl operations.
 * @returns An object implementing the Witnesses interface for ShieldedAccessControlPrivateState.
 */
export const ShieldedAccessControlWitnesses = <
  L,
>(): IShieldedAccessControlWitnesses<L, ShieldedAccessControlPrivateState> => ({
  wit_secretKey(
    context: WitnessContext<L, ShieldedAccessControlPrivateState>,
  ): [ShieldedAccessControlPrivateState, Uint8Array] {
    return [context.privateState, context.privateState.secretKey];
  },

  wit_getRoleCommitmentPath(
    context: WitnessContext<L, ShieldedAccessControlPrivateState>,
    roleCommitment: Uint8Array,
  ): [ShieldedAccessControlPrivateState, MerkleTreePath<Uint8Array>] {
    return [
      context.privateState,
      ShieldedAccessControlPrivateState.getRoleCommitmentPath<L>(
        context.ledger,
        roleCommitment,
      ),
    ];
  },
});
