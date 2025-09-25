import { getRandomValues } from 'node:crypto';
import {
  CompactTypeBytes,
  CompactTypeVector,
  convert_bigint_to_Uint8Array,
  persistentHash,
  type WitnessContext,
} from '@midnight-ntwrk/compact-runtime';
import type {
  ContractAddress,
  Either,
  Ledger,
  MerkleTreePath,
  ZswapCoinPublicKey,
} from '../../../artifacts/MockShieldedAccessControl/contract/index.cjs';
import { eitherToBytes } from '../test/utils/address';

const COMMITMENT_DOMAIN = new Uint8Array(32);
new TextEncoder().encodeInto('ShieldedAccessControl:commitment', COMMITMENT_DOMAIN);

export function fmtHexString(bytes: string | Uint8Array): string {
  if (bytes instanceof String) {
    return `${bytes.slice(0, 4)}...${bytes.slice(-4)}`;
  } else {
    const buffStr = Buffer.from(bytes as Uint8Array).toString('hex');
    return `${buffStr.slice(0, 4)}...${buffStr.slice(-4)}`;
  }
}

export function createAccountId(account: Either<ZswapCoinPublicKey, ContractAddress>, secretNonce: Uint8Array): Uint8Array {
  const rt_type = new CompactTypeVector(2, new CompactTypeBytes(32));
  const bAccount = eitherToBytes(account);
  return persistentHash(rt_type, [secretNonce, bAccount]);
}

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
  wit_getRoleIndex(
    context: WitnessContext<Ledger, P>,
    roleId: Uint8Array,
    accountId: Uint8Array
  ): [P, bigint];
}

type RoleId = string;
type SecretNonce = Uint8Array;

/**
 * @description Represents the private state of an ownable contract, storing a secret nonce.
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
  generate: (
  ): ShieldedAccessControlPrivateState => {
    const defaultRoleId: string = Buffer.alloc(32).toString('hex');
    const secretNonce = new Uint8Array(getRandomValues(Buffer.alloc(32)));

    const privateState: ShieldedAccessControlPrivateState = {
      roles: {},
    };
    privateState.roles[defaultRoleId] = secretNonce;
    return privateState;
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
    const privateState: ShieldedAccessControlPrivateState = {
      roles: {},
    };
    privateState.roles[roleString] = nonce;
    return privateState;
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
      path: Array.from({ length: 10 }, () => ({
        sibling: { field: 0n },
        goes_left: false,
      })),
    };
    return path ? path : defaultPath;
  },

  // If index cannot be found in MT return _currentMTIndex
  getRoleIndex: (
    {
      ledger,
      privateState,
    }: WitnessContext<Ledger, ShieldedAccessControlPrivateState>,
    roleId: Uint8Array,
    accountId: Uint8Array
  ): bigint => {
    const rt_type = new CompactTypeVector(4, new CompactTypeBytes(32));
    // Iterate over each MT index to determine if commitment exists
    console.log("current MT index ", ledger.ShieldedAccessControl__currentMerkleTreeIndex);
    for (let i = 0; i <= ledger.ShieldedAccessControl__currentMerkleTreeIndex; i++) {
      const index = BigInt(i);
      const bIndex = convert_bigint_to_Uint8Array(32, index);
      const commitment = persistentHash(rt_type, [
        accountId,
        roleId,
        bIndex,
        COMMITMENT_DOMAIN,
      ]);
      try {
        const pathForLeaf = ledger.ShieldedAccessControl__operatorRoles.pathForLeaf(
          index,
          commitment,
        );
        if (Buffer.from(pathForLeaf.leaf).compare(Buffer.from(commitment)) === 0) {
          return index;
        }
      } catch (e: unknown) {
        if (e instanceof Error) {
          const [msg, index] = e.message.split(':');
          if (msg === 'invalid index into sparse merkle tree') {
            // console.log(`accountId ${fmtHexString(accountId)} with commitment ${fmtHexString(commitment)} not found at index ${index}`);
          } else {
            throw e;
          }
        }
      }
    }

    console.log("WIT - Commitment DNE, returning MT index ", ledger.ShieldedAccessControl__currentMerkleTreeIndex.toString());

    // If commitment doesn't exist return currentMTIndex
    // Used for adding roles
    return ledger.ShieldedAccessControl__currentMerkleTreeIndex;
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
    wit_getRoleIndex(
      context: WitnessContext<Ledger, ShieldedAccessControlPrivateState>,
      roleId: Uint8Array,
      accountId: Uint8Array
    ): [ShieldedAccessControlPrivateState, bigint] {
      return [
        context.privateState,
        ShieldedAccessControlPrivateState.getRoleIndex(context, roleId, accountId),
      ];
    },
  });
