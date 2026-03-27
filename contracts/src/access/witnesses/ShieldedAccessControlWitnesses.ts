import { getRandomValues } from 'node:crypto';
import type {
  MerkleTreePath,
  WitnessContext,
} from '@midnight-ntwrk/compact-runtime';

/**
 * @description Interface defining the witness methods for ShieldedAccessControl operations
 * @template L - The ledger type.
 * @template P - The private state type.
 */
export interface IShieldedAccessControlWitnesses<L, P> {
  /**
   * Retrieves the secret nonce from the private state.
   * @param context - The witness context containing the private state.
   * @returns A tuple of the private state and the secret nonce as a Uint8Array.
   */
  wit_secretNonce(
    context: WitnessContext<L, P>,
    role: Uint8Array,
  ): [P, Uint8Array];
  wit_getRoleCommitmentPath(
    context: WitnessContext<L, P>,
    roleCommitment: Uint8Array,
  ): [P, MerkleTreePath<Uint8Array>];
}

type Role = string;
type SecretNonce = Uint8Array;

/**
 * @description Represents the private state of a Shielded AccessControl contract, storing
 * mappings from a 32 byte hex string to a 32 byte secret nonce.
 */
export type ShieldedAccessControlPrivateState = {
  /** @description A 32-byte secret nonce used as a privacy additive. */
  roles: Record<Role, SecretNonce | undefined>;
};

/**
 * @description Utility object for managing the private state of a Shielded AccessControl contract.
 */
export const ShieldedAccessControlPrivateState = {
  /**
   * @description Generates a new private state with a random secret nonce and a default role of 0.
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
    role: Buffer,
    nonce: Buffer,
  ): ShieldedAccessControlPrivateState => {
    const roleString = role.toString('hex');
    return { roles: { [roleString]: nonce } };
  },

  setRole: (
    privateState: ShieldedAccessControlPrivateState,
    role: Buffer,
    nonce: Buffer,
  ): ShieldedAccessControlPrivateState => {
    const roleString = role.toString('hex');
    const roles: Record<string, Uint8Array> = {};

    for (const [k, v] of Object.entries(privateState.roles)) {
      if (typeof v === 'undefined') {
        throw new Error(`Missing secret nonce for role ${k}`);
      }
      roles[k] = new Uint8Array(v);
    }

    roles[roleString] = new Uint8Array(nonce);
    return { roles };
  },

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
  wit_secretNonce(
    context: WitnessContext<L, ShieldedAccessControlPrivateState>,
    role: Uint8Array,
  ): [ShieldedAccessControlPrivateState, Uint8Array] {
    const roleString = Buffer.from(role).toString('hex');
    const roleNonce = context.privateState.roles[roleString];
    if (typeof roleNonce === 'undefined') {
      throw new Error(`Missing secret nonce for role ${roleString}`);
    }
    return [context.privateState, roleNonce];
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
