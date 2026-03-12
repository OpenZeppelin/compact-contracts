import type { MerkleTreePath } from '@midnight-ntwrk/compact-runtime';
import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin-compact/contracts-simulator';
import {
  ledger,
  Contract as MockShieldedAccessControl,
  type ZswapCoinPublicKey,
} from '../../../../artifacts/MockShieldedAccessControl/contract/index.js';
import {
  ShieldedAccessControlPrivateState,
  ShieldedAccessControlWitnesses,
} from '../../witnesses/ShieldedAccessControlWitnesses.js';

/**
 * Type constructor args
 */
type ShieldedAccessControlArgs = readonly [
  instanceSalt: Uint8Array,
  isInit: boolean,
];

const ShieldedAccessControlSimulatorBase = createSimulator<
  ShieldedAccessControlPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ShieldedAccessControlWitnesses>,
  MockShieldedAccessControl<ShieldedAccessControlPrivateState>,
  ShieldedAccessControlArgs
>({
  contractFactory: (witnesses) =>
    new MockShieldedAccessControl<ShieldedAccessControlPrivateState>(witnesses),
  defaultPrivateState: () => ShieldedAccessControlPrivateState.generate(),
  contractArgs: (instanceSalt, isInit) => {
    return [instanceSalt, isInit];
  },
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ShieldedAccessControlWitnesses(),
});

/**
 * ShieldedAccessControlSimulator
 */
export class ShieldedAccessControlSimulator extends ShieldedAccessControlSimulatorBase {
  constructor(
    instanceSalt: Uint8Array,
    isInit: boolean,
    options: BaseSimulatorOptions<
      ShieldedAccessControlPrivateState,
      ReturnType<typeof ShieldedAccessControlWitnesses>
    > = {},
  ) {
    super([instanceSalt, isInit], options);
  }

  public _computeRoleCommitment(
    role: Uint8Array,
    accountId: Uint8Array,
  ): Uint8Array {
    return this.circuits.impure._computeRoleCommitment(role, accountId);
  }

  public _computeAccountId(
    zcpk: ZswapCoinPublicKey,
    nonce: Uint8Array,
  ): Uint8Array {
    return this.circuits.impure._computeAccountId(zcpk, nonce);
  }

  public _computeNullifier(roleCommitment: Uint8Array): Uint8Array {
    return this.circuits.pure._computeNullifier(roleCommitment);
  }

  public proveCallerRole(role: Uint8Array): boolean {
    return this.circuits.impure.proveCallerRole(role);
  }

  /**
   * @description Transfers ownership to `newOwnerId`.
   * `newOwnerId` must be precalculated and given to the current owner off chain.
   * @param newOwnerId The new owner's unique identifier (`SHA256(pk, nonce)`).
   */
  public assertOnlyRole(role: Uint8Array) {
    this.circuits.impure.assertOnlyRole(role);
  }

  public _validateRole(role: Uint8Array, accountId: Uint8Array): boolean {
    return this.circuits.impure._validateRole(role, accountId);
  }

  /**
   * @description Computes the RoleCheck commitment from the given `id` and `counter`.
   * @param id - The unique identifier of the owner calculated by `SHA256(pk, nonce)`.
   * @param counter - The current counter or round. This increments by `1`
   * after every transfer to prevent duplicate commitments given the same `id`.
   * @returns The commitment derived from `id` and `counter`.
   */
  public getRoleAdmin(role: Uint8Array): Uint8Array {
    return this.circuits.impure.getRoleAdmin(role);
  }

  /**
   * @description Computes the unique identifier (`id`) of the owner from their
   * public key and a secret nonce.
   * @param pk - The public key of the identity being committed.
   * @param nonce - A private nonce to scope the commitment.
   * @returns The computed owner ID.
   */
  public grantRole(role: Uint8Array, accountId: Uint8Array) {
    this.circuits.impure.grantRole(role, accountId);
  }

  /**
   * @description Transfers ownership to owner id `newOwnerId` without
   * enforcing permission checks on the caller.
   * @param newOwnerId - The unique identifier of the new owner calculated by `SHA256(pk, nonce)`.
   */
  public revokeRole(role: Uint8Array, accountId: Uint8Array) {
    this.circuits.impure.revokeRole(role, accountId);
  }

  /**
   * @description Transfers ownership to owner id `newOwnerId` without
   * enforcing permission checks on the caller.
   * @param newOwnerId - The unique identifier of the new owner calculated by `SHA256(pk, nonce)`.
   */
  public renounceRole(role: Uint8Array, callerConfirmation: Uint8Array) {
    this.circuits.impure.renounceRole(role, callerConfirmation);
  }

  /**
   * @description Transfers ownership to owner id `newOwnerId` without
   * enforcing permission checks on the caller.
   * @param newOwnerId - The unique identifier of the new owner calculated by `SHA256(pk, nonce)`.
   */
  public _setRoleAdmin(role: Uint8Array, adminRole: Uint8Array) {
    this.circuits.impure._setRoleAdmin(role, adminRole);
  }

  /**
   * @description Transfers ownership to owner id `newOwnerId` without
   * enforcing permission checks on the caller.
   * @param newOwnerId - The unique identifier of the new owner calculated by `SHA256(pk, nonce)`.
   */
  public _grantRole(role: Uint8Array, accountId: Uint8Array): boolean {
    return this.circuits.impure._grantRole(role, accountId);
  }

  /**
   * @description Transfers ownership to owner id `newOwnerId` without
   * enforcing permission checks on the caller.
   * @param newOwnerId - The unique identifier of the new owner calculated by `SHA256(pk, nonce)`.
   */
  public _revokeRole(role: Uint8Array, accountId: Uint8Array): boolean {
    return this.circuits.impure._revokeRole(role, accountId);
  }

  public readonly privateState = {
    /**
     * @description Contextually sets a new nonce into the private state.
     * @param newNonce The secret nonce.
     * @returns The ShieldedAccessControl private state after setting the new nonce.
     */
    injectSecretNonce: (
      role: Uint8Array,
      newNonce: Buffer<ArrayBufferLike>,
    ): ShieldedAccessControlPrivateState => {
      const currentState = this.getPrivateState();
      const updatedState = {
        roles: { ...currentState.roles },
      };
      const roleString = Buffer.from(role).toString('hex');
      updatedState.roles[roleString] = newNonce;
      this.circuitContextManager.updatePrivateState(updatedState);
      return updatedState;
    },

    /**
     * @description Returns the secret nonce for a given role.
     * @returns The secret nonce.
     */
    getCurrentSecretNonce: (role: Uint8Array): Uint8Array => {
      const roleString = Buffer.from(role).toString('hex');
      return this.getPrivateState().roles[roleString];
    },
    getCommitmentPathWithFindForLeaf: (
      roleCommitment: Uint8Array,
    ): MerkleTreePath<Uint8Array> | undefined => {
      return this.getPublicState().ShieldedAccessControl__operatorRoles.findPathForLeaf(
        roleCommitment,
      );
    },
    getCommitmentPathWithWitnessImpl: (
      roleCommitment: Uint8Array,
    ): MerkleTreePath<Uint8Array> => {
      return this.witnesses.wit_getRoleCommitmentPath(
        this.getWitnessContext(),
        roleCommitment,
      )[1];
    },
  };
}
