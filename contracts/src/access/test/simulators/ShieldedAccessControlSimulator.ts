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
    role: Uint8Array,
  ): Uint8Array {
    return this.circuits.impure._computeAccountId(role);
  }

  public _computeNullifier(roleCommitment: Uint8Array): Uint8Array {
    return this.circuits.pure._computeNullifier(roleCommitment);
  }

  public proveCallerRole(role: Uint8Array): boolean {
    return this.circuits.impure.proveCallerRole(role);
  }

  public _uncheckedProveCallerRole(role: Uint8Array): boolean {
    return this.circuits.impure._uncheckedProveCallerRole(role);
  }

  public assertOnlyRole(role: Uint8Array) {
    this.circuits.impure.assertOnlyRole(role);
  }

  public _uncheckedAssertOnlyRole(role: Uint8Array) {
    this.circuits.impure._uncheckedAssertOnlyRole(role);
  }

  public _validateRole(role: Uint8Array, accountId: Uint8Array): boolean {
    return this.circuits.impure._validateRole(role, accountId);
  }

  public getRoleAdmin(role: Uint8Array): Uint8Array {
    return this.circuits.impure.getRoleAdmin(role);
  }

  public grantRole(role: Uint8Array, accountId: Uint8Array) {
    this.circuits.impure.grantRole(role, accountId);
  }

  public _uncheckedGrantRole(role: Uint8Array, accountId: Uint8Array) {
    this.circuits.impure._uncheckedGrantRole(role, accountId);
  }

  public revokeRole(role: Uint8Array, accountId: Uint8Array) {
    this.circuits.impure.revokeRole(role, accountId);
  }

  public _uncheckedRevokeRole(role: Uint8Array, accountId: Uint8Array) {
    this.circuits.impure._uncheckedRevokeRole(role, accountId);
  }

  public renounceRole(role: Uint8Array, callerConfirmation: Uint8Array) {
    this.circuits.impure.renounceRole(role, callerConfirmation);
  }

  public _setRoleAdmin(role: Uint8Array, adminRole: Uint8Array) {
    this.circuits.impure._setRoleAdmin(role, adminRole);
  }

  public _grantRole(role: Uint8Array, accountId: Uint8Array): boolean {
    return this.circuits.impure._grantRole(role, accountId);
  }

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
