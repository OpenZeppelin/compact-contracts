import { getRandomValues } from 'node:crypto';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type {
  Ledger,
  MerkleTreePath,
} from '../../../artifacts/MockShieldedAccessControl/contract/index.js';

/**
 * @description Interface defining the witness methods for ShieldedAccessControl operations.
 * @template P - The private state type.
 */
export interface IShieldedAccessControlWitnesses<P> {
  /**
   * Retrieves the secret nonce from the private state.
   * @param context - The witness context containing the private state.
   * @returns A tuple of the private state and the secret nonce as a Uint8Array.
   */
  wit_secretNonce(
    context: WitnessContext<Ledger, P>,
    roleId: Uint8Array,
  ): [P, Uint8Array];
  wit_getRoleCommitmentPath(
    context: WitnessContext<Ledger, P>,
    roleCommitment: Uint8Array,
  ): [P, MerkleTreePath<Uint8Array>];
  wit_getCommitmentNullifierPath(
    context: WitnessContext<Ledger, P>,
    nullifierCommitment: Uint8Array,
  ): [P, MerkleTreePath<Uint8Array>];
}

type RoleId = string;
type SecretNonce = Uint8Array;

/**
 * @description Represents the private state of a Shielded AccessControl contract, storing
 * mappings from a 32 byte hex string to a 32 byte secret nonce.
 */
export type ShieldedAccessControlPrivateState = {
  /** @description A 32-byte secret nonce used as a privacy additive. */
  roles: Record<RoleId, SecretNonce>;
};

/**
 * @description Utility object for managing the private state of a Shielded AccessControl contract.
 */
export const ShieldedAccessControlPrivateState = {
  /**
   * @description Generates a new private state with a random secret nonce and a default roleId of 0.
   * @returns A fresh ShieldedAccessControlPrivateState instance.
   */
  generate: (): ShieldedAccessControlPrivateState => {
    const defaultRoleId: string = Buffer.alloc(32).toString('hex');
    const secretNonce = new Uint8Array(getRandomValues(Buffer.alloc(32)));

    return { roles: { [defaultRoleId]: secretNonce } };
  },

  /**
   * @description Generates a new private state with a user-defined secret nonce.
   * Useful for deterministic nonce generation or advanced use cases.
   *
   * @param nonce - The 32-byte secret nonce to use.
   * @returns A fresh ShieldedAccessControlPrivateState instance with the provided nonce.
   *
   * @example
   * ```typescript
   * // For deterministic nonces (user-defined scheme)
   * const deterministicNonce = myDeterministicScheme(...);
   * const privateState = ShieldedAccessControlPrivateState.withNonce(deterministicNonce);
   * ```
   */
  withRoleAndNonce: (
    roleId: Buffer,
    nonce: Buffer,
  ): ShieldedAccessControlPrivateState => {
    const roleString = roleId.toString('hex');
    return { roles: { [roleString]: nonce } };
  },

  setRole: (
    privateState: ShieldedAccessControlPrivateState,
    roleId: Buffer,
    nonce: Buffer,
  ): ShieldedAccessControlPrivateState => {
    const roleString = roleId.toString('hex');
    privateState.roles[roleString] = nonce;
    return privateState;
  },

  getRoleCommitmentPath: (
    ledger: Ledger,
    roleCommitment: Uint8Array,
  ): MerkleTreePath<Uint8Array> => {
    const path =
      ledger.ShieldedAccessControl__operatorRoles.findPathForLeaf(
        roleCommitment,
      );
    const defaultPath: MerkleTreePath<Uint8Array> = {
      leaf: new Uint8Array(32),
      path: Array.from({ length: 20 }, () => ({
        sibling: { field: 0n },
        goes_left: false,
      })),
    };
    return path ? path : defaultPath;
  },
  getCommitmentNullifierPath: (
    ledger: Ledger,
    nullifierCommitment: Uint8Array,
  ): MerkleTreePath<Uint8Array> => {
    const path =
      ledger.ShieldedAccessControl__roleCommitmentNullifiers.findPathForLeaf(
        nullifierCommitment,
      );
    const defaultPath: MerkleTreePath<Uint8Array> = {
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
export const ShieldedAccessControlWitnesses =
  (): IShieldedAccessControlWitnesses<ShieldedAccessControlPrivateState> => ({
    wit_secretNonce(
      context: WitnessContext<Ledger, ShieldedAccessControlPrivateState>,
      roleId: Uint8Array,
    ): [ShieldedAccessControlPrivateState, Uint8Array] {
      const roleString = Buffer.from(roleId).toString('hex');
      return [context.privateState, context.privateState.roles[roleString]];
    },
    wit_getRoleCommitmentPath(
      context: WitnessContext<Ledger, ShieldedAccessControlPrivateState>,
      roleCommitment: Uint8Array,
    ): [ShieldedAccessControlPrivateState, MerkleTreePath<Uint8Array>] {
      return [
        context.privateState,
        ShieldedAccessControlPrivateState.getRoleCommitmentPath(
          context.ledger,
          roleCommitment,
        ),
      ];
    },
    wit_getCommitmentNullifierPath(
      context: WitnessContext<Ledger, ShieldedAccessControlPrivateState>,
      nullifierCommitment: Uint8Array,
    ): [ShieldedAccessControlPrivateState, MerkleTreePath<Uint8Array>] {
      return [
        context.privateState,
        ShieldedAccessControlPrivateState.getCommitmentNullifierPath(
          context.ledger,
          nullifierCommitment,
        ),
      ];
    },
  });
